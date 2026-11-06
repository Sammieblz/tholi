import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

type BrowserName = "chrome" | "firefox";
type ManagerPaths = { browserPath: string; driverPath: string };
type Manager = (args: string[]) => ManagerPaths;
const manager = createRequire(import.meta.url)(
  "selenium-webdriver/common/seleniumManager.js",
) as { binaryPaths: Manager };

/** Explicit fixture backing scale, independent of physical Retina certification. */
export function nativeBrowserScale(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.THOLI_BROWSER_SCALE;
  if (value === undefined) return;
  if (value !== "1" && value !== "2")
    throw Error("THOLI_BROWSER_SCALE must be exactly 1 or 2.");
  return Number(value) as 1 | 2;
}

function registeredFirefox() {
  for (const root of ["HKCU", "HKLM"]) {
    try {
      const result = execFileSync(
        "reg.exe",
        [
          "query",
          root +
            "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe",
          "/ve",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const path = result.match(/REG_SZ\s+(.+)/)?.[1].trim();
      if (path && existsSync(path)) return path;
    } catch {
      // Selenium Manager retains discovery when Windows has no registered app.
    }
  }
}

/** Native fixtures discover applications without changing a user's browser profile. */
export function installedBrowserBinary(
  browser: BrowserName,
  options: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    exists?: (path: string) => boolean;
    windowsFirefox?: () => string | undefined;
  } = {},
) {
  const platform = options.platform ?? process.platform,
    environment = options.environment ?? process.env,
    exists = options.exists ?? existsSync,
    paths = platform === "win32" ? win32 : posix,
    executable = browser === "chrome" ? "Google Chrome" : "firefox",
    app = browser === "chrome" ? "Google Chrome.app" : "Firefox.app",
    override =
      environment[
        browser === "chrome" ? "THOLI_CHROME_BINARY" : "THOLI_FIREFOX_BINARY"
      ];
  const unpackBundle = (path: string) =>
    platform === "darwin" && /\.app\/?$/.test(path)
      ? paths.join(path, "Contents", "MacOS", executable)
      : path;
  if (override) {
    const binary = unpackBundle(override);
    if (!exists(binary))
      throw Error(`The configured ${browser} test binary does not exist.`);
    return binary;
  }
  if (platform === "darwin") {
    for (const directory of [
      "/Applications",
      paths.join(options.homeDirectory ?? homedir(), "Applications"),
    ]) {
      const binary = unpackBundle(paths.join(directory, app));
      if (exists(binary)) return binary;
    }
  }
  if (browser === "firefox" && platform === "win32")
    return (options.windowsFirefox ?? registeredFirefox)();
}

/** The installed Selenium package owns OS/architecture selection and driver resolution. */
export function resolveBrowserTools(
  options: {
    browser: BrowserName;
    binary?: string;
    driver?: string;
    driverVersion?: string;
    skipDriverInPath?: boolean;
  },
  dependencies: {
    resolve?: Manager;
    exists?: (path: string) => boolean;
  } = {},
): ManagerPaths {
  const exists = dependencies.exists ?? existsSync;
  for (const override of [options.binary, options.driver])
    if (override && !exists(override))
      throw Error(`The configured ${options.browser} test runtime is missing.`);
  if (options.binary && options.driver)
    return { browserPath: options.binary, driverPath: options.driver };
  const result = (dependencies.resolve ?? manager.binaryPaths)([
    "--browser",
    options.browser,
    "--output",
    "json",
    "--avoid-stats",
    ...(options.driverVersion
      ? ["--driver-version", options.driverVersion]
      : []),
    ...(options.binary ? ["--browser-path", options.binary] : []),
    ...(options.skipDriverInPath ? ["--skip-driver-in-path"] : []),
  ]);
  if (
    !result ||
    typeof result.browserPath !== "string" ||
    !result.browserPath ||
    typeof result.driverPath !== "string" ||
    !result.driverPath
  )
    throw Error(`The ${options.browser} test runtime could not be resolved.`);
  return {
    browserPath: options.binary || result.browserPath,
    driverPath: options.driver || result.driverPath,
  };
}
