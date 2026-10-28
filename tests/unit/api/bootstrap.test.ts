import { EventEmitter } from "node:events";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPrivateApi } from "../../../apps/api/src/cli";
import { startServiceApi } from "../../../apps/api/src/service";
import { createApi, createServiceApi } from "../../../apps/api/src/server";
import { runExecutable, startRuntime } from "../../../apps/api/src/runtime";
import type { ApiOptions } from "../../../apps/api/src/config";

vi.mock("../../../apps/api/src/server", () => ({
  createApi: vi.fn(),
  createServiceApi: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    const resolved = resolve(directory);
    if (
      !isAbsolute(directory) ||
      resolved !== directory ||
      !resolved.startsWith(resolve(tmpdir()) + sep + "tholi-api-bootstrap-")
    )
      throw new Error(
        "Refusing cleanup outside the API bootstrap temporary directory.",
      );
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "tholi-api-bootstrap-"));
  directories.push(directory);
  return directory;
}

function application() {
  return {
    listen: vi.fn().mockResolvedValue("http://127.0.0.1:8787"),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("API bootstrap and shutdown", () => {
  it("imports both executable entrypoints without starting an application", () => {
    expect(createApi).not.toHaveBeenCalled();
    expect(createServiceApi).not.toHaveBeenCalled();
  });

  it("closes once and removes signal handlers on explicit shutdown", async () => {
    const app = application(),
      signals = new EventEmitter();
    const runtime = await startRuntime(
      async () => app,
      { host: "127.0.0.1", port: 8787 },
      { signals },
    );
    expect(app.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 8787 });
    expect(signals.listenerCount("SIGINT")).toBe(1);
    const first = runtime.shutdown();
    expect(runtime.shutdown()).toBe(first);
    await first;
    expect(app.close).toHaveBeenCalledOnce();
    expect(
      signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM"),
    ).toBe(0);
  });

  it("handles repeated termination callbacks through one drain and exit", async () => {
    const app = application(),
      signals = new EventEmitter(),
      exit = vi.fn();
    const runtime = await startRuntime(
      async () => app,
      { host: "127.0.0.1", port: 8787 },
      { signals, exit },
    );
    const signal = signals.listeners("SIGTERM")[0];
    signal();
    signal();
    await runtime.shutdown();
    await Promise.resolve();
    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("cleans resources after listen failure without leaking its error details", async () => {
    const app = application(),
      signals = new EventEmitter();
    app.listen.mockRejectedValue(new Error("secret-token and /private/path"));
    await expect(
      startRuntime(
        async () => app,
        { host: "127.0.0.1", port: 8787 },
        { signals },
      ),
    ).rejects.toThrow("Tholi API could not start listening.");
    expect(app.close).toHaveBeenCalledOnce();
    expect(
      signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM"),
    ).toBe(0);
  });

  it("reports a failed signal drain safely and exits unsuccessfully", async () => {
    const app = application(),
      signals = new EventEmitter(),
      exit = vi.fn(),
      reportError = vi.fn();
    app.close.mockRejectedValue(new Error("private database credentials"));
    const runtime = await startRuntime(
      async () => app,
      { host: "127.0.0.1", port: 8787 },
      { signals, exit, reportError },
    );
    signals.emit("SIGINT");
    await runtime.shutdown().catch(() => {});
    await Promise.resolve();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      "Tholi API shutdown failed or exceeded its deadline.",
    );
  });

  it("bounds a stuck drain instead of leaving a signalled executable running", async () => {
    vi.useFakeTimers();
    const app = application(),
      signals = new EventEmitter(),
      exit = vi.fn(),
      reportError = vi.fn();
    app.close.mockReturnValue(new Promise(() => {}));
    const runtime = await startRuntime(
      async () => app,
      { host: "127.0.0.1", port: 8787 },
      { signals, exit, reportError },
    );
    signals.emit("SIGTERM");
    const drained = runtime.shutdown().catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await drained).toBe("Tholi API shutdown timed out.");
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(app.close).toHaveBeenCalledOnce();
  });

  it("skips listening and closes an application whose initialization finishes after termination", async () => {
    const app = application(),
      signals = new EventEmitter(),
      exit = vi.fn();
    let finish!: (value: typeof app) => void;
    const initialized = new Promise<typeof app>((resolve) => {
      finish = resolve;
    });
    const started = startRuntime(
      () => initialized,
      { host: "127.0.0.1", port: 8787 },
      { signals, exit },
    );
    signals.emit("SIGTERM");
    finish(app);
    await expect(started).rejects.toThrow("Tholi API startup was interrupted.");
    expect(app.listen).not.toHaveBeenCalled();
    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("waits for in-flight listening to settle before closing and never reports a stopped startup as successful", async () => {
    const app = application(),
      signals = new EventEmitter(),
      exit = vi.fn();
    let finish!: () => void, entered!: () => void;
    const listening = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const enteredListen = new Promise<void>((resolve) => {
      entered = resolve;
    });
    app.listen.mockImplementation(() => {
      entered();
      return listening;
    });
    const started = startRuntime(
      async () => app,
      { host: "127.0.0.1", port: 8787 },
      { signals, exit },
    );
    await enteredListen;
    signals.emit("SIGTERM");
    expect(app.close).not.toHaveBeenCalled();
    finish();
    await expect(started).rejects.toThrow("Tholi API startup was interrupted.");
    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(
      signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM"),
    ).toBe(0);
  });

  it("removes signal handlers after initialization fails", async () => {
    const signals = new EventEmitter();
    await expect(
      startRuntime(
        async () => {
          throw Error("secret initialization detail");
        },
        { host: "127.0.0.1", port: 8787 },
        { signals },
      ),
    ).rejects.toThrow("Tholi API initialization failed.");
    expect(
      signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM"),
    ).toBe(0);
  });

  it("validates configuration before creating connection files or runtime resources", async () => {
    const directory = join(await temporaryDirectory(), "not-created"),
      factory = vi.fn();
    await expect(
      startPrivateApi(
        { NAVIGATOR_DATA_DIR: directory, NAVIGATOR_PORT: "not-a-port" },
        factory,
      ),
    ).rejects.toThrow(/Port/);
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(factory).not.toHaveBeenCalled();
    await expect(
      startServiceApi({ THOLI_SERVICE_ORIGINS: "*" }, factory),
    ).rejects.toThrow(/origins/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("preserves malformed stored settings rather than replacing the owner's token", async () => {
    const directory = await temporaryDirectory(),
      factory = vi.fn();
    const path = join(directory, "connection.json"),
      original = '{"token":"broken","origins":[]}';
    await writeFile(path, original);
    await expect(
      startPrivateApi({ NAVIGATOR_DATA_DIR: directory }, factory),
    ).rejects.toThrow(/token/);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(factory).not.toHaveBeenCalled();
  });

  it("creates and reuses the legacy connection identity and leaves overrides unpersisted", async () => {
    const directory = await temporaryDirectory(),
      signals = new EventEmitter();
    const app = application(),
      factory = vi.fn(async (_options: ApiOptions) => app);
    const first = await startPrivateApi(
      { NAVIGATOR_DATA_DIR: directory },
      factory,
      { signals },
    );
    await first.shutdown();
    const path = join(directory, "connection.json"),
      original = await readFile(path, "utf8");
    const connection = JSON.parse(original);
    expect(connection).toEqual({
      token: expect.stringMatching(/^[a-f0-9]{64}$/),
      origins: [],
    });
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    const origin = "chrome-extension://" + "a".repeat(32);
    const second = await startPrivateApi(
      { NAVIGATOR_DATA_DIR: directory, NAVIGATOR_EXTENSION_ORIGINS: origin },
      factory,
      { signals },
    );
    await second.shutdown();
    expect(factory.mock.calls[1][0]).toMatchObject({
      token: connection.token,
      origins: [origin],
    });
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("boots the service without reading legacy configuration or granting shared-token access", async () => {
    const app = application(),
      signals = new EventEmitter(),
      factory = vi.fn(async () => app);
    const runtime = await startServiceApi(
      { PORT: "8080", NAVIGATOR_PORT: "invalid", NAVIGATOR_DATA_DIR: "\0" },
      factory,
      { signals },
    );
    expect(factory).toHaveBeenCalledExactlyOnceWith({ origins: [] });
    expect(app.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 8080 });
    await runtime.shutdown();
  });

  it("prints a safe executable startup error and sets a failure exit status", async () => {
    const originalExitCode = process.exitCode;
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      await runExecutable(async () => {
        throw new Error("token=private-secret");
      });
      expect(stderr).toHaveBeenCalledExactlyOnceWith(
        "Tholi API startup failed. Check configuration and local resources.\n",
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });
});
