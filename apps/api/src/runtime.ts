import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ListenOptions } from "./config";

export interface RuntimeApplication {
  listen(options: ListenOptions): Promise<unknown>;
  close(): Promise<void>;
}

type Signal = "SIGINT" | "SIGTERM";
export interface RuntimeOptions {
  signals?: {
    on(signal: Signal, listener: () => void): unknown;
    off(signal: Signal, listener: () => void): unknown;
  };
  reportError?: (message: string) => void;
  exit?: (code: number) => void;
  drainMs?: number;
}

export async function startRuntime<T extends RuntimeApplication>(
  factory: () => Promise<T>,
  listen: ListenOptions,
  options: RuntimeOptions = {},
) {
  const signals = options.signals ?? process;
  const reportError =
    options.reportError ??
    ((message: string) => process.stderr.write(message + "\n"));
  const drainMs = options.drainMs ?? 8000;
  if (!Number.isSafeInteger(drainMs) || drainMs < 1)
    throw new Error("Invalid runtime drain deadline.");
  let app: T | undefined;
  let closing: Promise<void> | undefined;
  let signalled = false;
  const listening = Promise.resolve()
    .then(factory)
    .then(async (created) => {
      app = created;
      if (!closing) await app.listen(listen);
    });
  const shutdown = (): Promise<void> => {
    if (closing) return closing;
    signals.off("SIGINT", onSignal);
    signals.off("SIGTERM", onSignal);
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Tholi API shutdown timed out.")),
        drainMs,
      );
      timer.unref();
    });
    const close = listening.catch(() => {}).then(() => app?.close());
    closing = Promise.race([close, deadline]).finally(() =>
      clearTimeout(timer),
    );
    return closing;
  };
  const onSignal = () => {
    if (signalled) return;
    signalled = true;
    void shutdown().then(
      () => options.exit?.(0),
      () => {
        reportError("Tholi API shutdown failed or exceeded its deadline.");
        options.exit?.(1);
      },
    );
  };
  signals.on("SIGINT", onSignal);
  signals.on("SIGTERM", onSignal);
  try {
    await listening;
  } catch {
    await shutdown().catch(() => {
      reportError("Tholi API startup cleanup failed or exceeded its deadline.");
      options.exit?.(1);
    });
    throw new Error(
      app
        ? "Tholi API could not start listening."
        : "Tholi API initialization failed.",
    );
  }
  if (closing) {
    await closing;
    throw new Error("Tholi API startup was interrupted.");
  }
  if (!app) throw new Error("Tholi API initialization failed.");
  return { app, shutdown };
}

export function isMainModule(url: string): boolean {
  return (
    !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url
  );
}

export async function runExecutable(start: () => Promise<unknown>) {
  try {
    await start();
  } catch {
    process.stderr.write(
      "Tholi API startup failed. Check configuration and local resources.\n",
    );
    process.exitCode = 1;
  }
}
