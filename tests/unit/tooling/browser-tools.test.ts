import { expect, test, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { error as webdriverError, type WebDriver } from "selenium-webdriver";
import { focusWebDriverWindow } from "../../support/webdriver-extension";
import {
  installedBrowserBinary,
  nativeBrowserScale,
  resolveBrowserTools,
} from "../../support/browser-tools";
import {
  assertOwnedMacFirefoxProcess,
  inspectMacProcess,
  ownedFirefoxProfile,
  registerFirefoxDriver,
  stopOwnedMacFirefoxProcess,
  type MacFirefoxProcess,
} from "../../support/native-browser-lifecycle";

test("native backing-scale fixtures accept only the declared 1x and 2x modes", () => {
  expect(nativeBrowserScale({})).toBeUndefined();
  expect(nativeBrowserScale({ THOLI_BROWSER_SCALE: "1" })).toBe(1);
  expect(nativeBrowserScale({ THOLI_BROWSER_SCALE: "2" })).toBe(2);
  for (const value of ["", "0", "1.5", "3", "2x"])
    expect(() => nativeBrowserScale({ THOLI_BROWSER_SCALE: value })).toThrow(
      "must be exactly 1 or 2",
    );
});

test("native BiDi reads preserve same-window focus and frame boundaries while classic execution forces activation", async () => {
  let selected = "panel";
  const window = vi.fn(async (handle: string) => {
    selected = handle;
  });
  const defaultContent = vi.fn(async () => undefined);
  const getWindowHandle = vi.fn(async () => selected);
  const driver = {
    getWindowHandle,
    switchTo: () => ({ window, defaultContent }),
  } as unknown as WebDriver;
  await focusWebDriverWindow(driver, "panel", "bidi");
  expect(window).not.toHaveBeenCalled();
  expect(defaultContent).toHaveBeenCalledOnce();
  await focusWebDriverWindow(driver, "website", "bidi");
  expect(window).toHaveBeenLastCalledWith("website");
  expect(defaultContent).toHaveBeenCalledTimes(2);
  await focusWebDriverWindow(driver, "website", "classic");
  expect(window).toHaveBeenCalledTimes(2);
  expect(getWindowHandle).toHaveBeenCalledTimes(2);
  getWindowHandle.mockRejectedValueOnce(new webdriverError.NoSuchWindowError());
  await focusWebDriverWindow(driver, "panel", "bidi");
  expect(window).toHaveBeenLastCalledWith("panel");
  expect(defaultContent).toHaveBeenCalledTimes(4);
});

test("macOS discovers browser app bundles and honors explicit per-browser overrides", () => {
  const available = new Set([
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Users/test/Applications/Firefox.app/Contents/MacOS/firefox",
    "/Custom/Firefox Nightly.app/Contents/MacOS/firefox",
  ]);
  const options = {
    platform: "darwin" as const,
    environment: {},
    homeDirectory: "/Users/test",
    exists: (path: string) => available.has(path),
    windowsFirefox: vi.fn(() => "unused"),
  };
  expect(installedBrowserBinary("chrome", options)).toBe(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  expect(installedBrowserBinary("firefox", options)).toBe(
    "/Users/test/Applications/Firefox.app/Contents/MacOS/firefox",
  );
  expect(
    installedBrowserBinary("firefox", {
      ...options,
      environment: {
        THOLI_FIREFOX_BINARY: "/Custom/Firefox Nightly.app",
      },
    }),
  ).toBe("/Custom/Firefox Nightly.app/Contents/MacOS/firefox");
  expect(() =>
    installedBrowserBinary("chrome", {
      ...options,
      environment: { THOLI_CHROME_BINARY: "/missing/Chrome.app" },
    }),
  ).toThrow("configured chrome test binary does not exist");
  expect(options.windowsFirefox).not.toHaveBeenCalled();
  expect(
    installedBrowserBinary("firefox", {
      ...options,
      exists: () => false,
    }),
  ).toBeUndefined();
});

test("native runtime resolution uses Selenium's platform owner and preserves driver overrides", () => {
  const resolve = vi.fn(() => ({
    browserPath: "/Applications/Firefox.app/Contents/MacOS/firefox",
    driverPath: "/cache/geckodriver",
  }));
  const dependencies = { resolve, exists: () => true };
  expect(
    resolveBrowserTools(
      { browser: "firefox", driverVersion: "0.37.1" },
      dependencies,
    ),
  ).toEqual(resolve.mock.results[0].value);
  expect(resolve).toHaveBeenLastCalledWith([
    "--browser",
    "firefox",
    "--output",
    "json",
    "--avoid-stats",
    "--driver-version",
    "0.37.1",
  ]);
  resolve.mockClear();
  expect(
    resolveBrowserTools(
      {
        browser: "firefox",
        binary: "/custom/firefox",
        driver: "/custom/geckodriver",
        driverVersion: "0.37.1",
      },
      dependencies,
    ),
  ).toEqual({
    browserPath: "/custom/firefox",
    driverPath: "/custom/geckodriver",
  });
  expect(resolve).not.toHaveBeenCalled();
  expect(() =>
    resolveBrowserTools(
      { browser: "firefox", driver: "/missing/geckodriver" },
      { ...dependencies, exists: () => false },
    ),
  ).toThrow("configured firefox test runtime is missing");
  expect(resolve).not.toHaveBeenCalled();
});

test("disposable profile ownership accepts canonical aliases and closes rejected sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-browser-tools-"));
  try {
    const physical = join(directory, "physical"),
      alias = join(directory, "alias");
    await mkdir(physical);
    const profile = await mkdtemp(join(physical, "rust_mozprofile"));
    await symlink(
      physical,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    // Windows may retain an 8.3 alias in either canonical spelling. Prove the
    // accepted alias is the same physical directory without requiring one spelling.
    const actual = statSync(
      ownedFirefoxProfile(join(alias, basename(profile)), alias),
      { bigint: true },
    );
    const expected = statSync(profile, { bigint: true });
    expect(actual.isDirectory() && expected.isDirectory()).toBe(true);
    expect(actual.ino).toBeGreaterThan(0n);
    expect(expected.ino).toBeGreaterThan(0n);
    expect([actual.dev, actual.ino]).toEqual([expected.dev, expected.ino]);
    const outside = await mkdtemp(join(directory, "rust_mozprofile"));
    expect(() => ownedFirefoxProfile(outside, alias)).toThrow(
      "disposable profile ownership",
    );
    const userProfile = join(directory, "user-profile");
    await mkdir(userProfile);
    const driver = {
      getCapabilities: vi.fn(
        async () =>
          new Map<string, unknown>([
            ["moz:processID", 1234],
            ["moz:profile", userProfile],
          ]),
      ),
      quit: vi.fn(async () => undefined),
    };
    await expect(
      registerFirefoxDriver(driver as unknown as WebDriver),
    ).rejects.toThrow("disposable profile ownership");
    expect(driver.quit).toHaveBeenCalledOnce();
  } finally {
    const actual = await realpath(directory),
      temporary = await realpath(tmpdir());
    if (!actual.startsWith(temporary + sep))
      throw Error("Unexpected browser-tool fixture cleanup path.");
    await rm(directory, { recursive: true, force: true });
  }
});

const profile = "/private/var/folders/test/T/rust_mozprofile-123",
  reportedProfile = "/var/folders/test/T/rust_mozprofile-123";
function macProcess(): MacFirefoxProcess {
  return {
    executable: "/Applications/Firefox.app/Contents/MacOS/firefox",
    started: "Thu Nov  5 12:34:56 2026",
    command: `firefox -headless -marionette -profile "${reportedProfile}"`,
  };
}
function ownership() {
  return {
    processId: 9001,
    profile,
    reportedProfile,
    macProcess: macProcess(),
  };
}

test("Darwin process inspection retains the full executable when a middle comm column would be truncated", () => {
  const process = macProcess();
  const observed = inspectMacProcess(9001, (fields) => {
    if (fields.includes("comm="))
      return fields.length === 2
        ? process.executable
        : process.executable.slice(0, -5);
    return `${process.started} ${process.command}\n`;
  });
  expect(observed).toEqual(process);
  expect(() =>
    assertOwnedMacFirefoxProcess(ownership(), observed!),
  ).not.toThrow();
  expect(inspectMacProcess(9001, () => "")).toBeUndefined();
});

test("macOS cleanup requires the exact profile, headless executable and original process identity", () => {
  const expected = ownership();
  expect(() =>
    assertOwnedMacFirefoxProcess(expected, macProcess()),
  ).not.toThrow();
  for (const changed of [
    {
      executable:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    { command: `firefox -profile ${reportedProfile}` },
    { command: `firefox -headless -profile ${reportedProfile}-other` },
    { command: `firefox -headless --other-argument ${reportedProfile}` },
    { started: "Thu Nov  5 12:35:56 2026" },
    { executable: "/Custom/Firefox.app/Contents/MacOS/firefox" },
  ])
    expect(() =>
      assertOwnedMacFirefoxProcess(expected, { ...macProcess(), ...changed }),
    ).toThrow("Disposable Firefox process identity changed");
});

test("macOS fallback signals only the proven root process and bounds escalation", async () => {
  let elapsed = 0,
    running = true;
  const signal = vi.fn((_processId: number, kind: "SIGTERM" | "SIGKILL") => {
    if (kind === "SIGKILL") running = false;
  });
  await stopOwnedMacFirefoxProcess(ownership(), {
    inspect: () => (running ? macProcess() : undefined),
    signal,
    pause: async (milliseconds) => {
      elapsed += milliseconds;
    },
    now: () => elapsed,
  });
  expect(signal.mock.calls).toEqual([
    [9001, "SIGTERM"],
    [9001, "SIGKILL"],
  ]);
  expect(elapsed).toBeLessThanOrEqual(6000);
});

test("macOS fallback stops when a PID changes ownership and ignores a departed process", async () => {
  let calls = 0;
  const signal = vi.fn();
  await expect(
    stopOwnedMacFirefoxProcess(ownership(), {
      inspect: () => ({
        ...macProcess(),
        started:
          ++calls === 1 ? macProcess().started : "Thu Nov  5 12:35:56 2026",
      }),
      signal,
      pause: async () => undefined,
      now: () => 0,
    }),
  ).rejects.toThrow("Disposable Firefox process identity changed");
  expect(signal.mock.calls).toEqual([[9001, "SIGTERM"]]);
  signal.mockClear();
  await stopOwnedMacFirefoxProcess(ownership(), {
    inspect: () => undefined,
    signal,
  });
  expect(signal).not.toHaveBeenCalled();
  await expect(
    stopOwnedMacFirefoxProcess(
      { ...ownership(), processId: -1 },
      { inspect: () => macProcess(), signal },
    ),
  ).rejects.toThrow("one positive owned process ID");
  expect(signal).not.toHaveBeenCalled();
});
