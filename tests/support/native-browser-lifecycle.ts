import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";
import type { WebDriver } from "selenium-webdriver";

type OwnedFirefox = {
  driver: WebDriver;
  processId: number;
  profile: string;
  closing?: Promise<void>;
};
const owned = new Map<WebDriver, OwnedFirefox>();

/** Keep timed-out Marionette commands from stranding disposable browser trees. */
export async function registerFirefoxDriver(driver: WebDriver) {
  const capabilities = await driver.getCapabilities();
  const processId = Number(capabilities.get("moz:processID"));
  const profile = resolve(String(capabilities.get("moz:profile")));
  if (
    !Number.isSafeInteger(processId) ||
    processId < 1 ||
    !profile.startsWith(resolve(tmpdir()) + sep) ||
    !basename(profile).startsWith("rust_mozprofile")
  )
    throw Error(
      "Firefox must expose its disposable process and profile ownership",
    );
  owned.set(driver, { driver, processId, profile });
}

async function dispose(entry: OwnedFirefox) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      entry.driver.quit(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(Error("Firefox WebDriver shutdown exceeded thirty seconds")),
          30000,
        );
      }),
    ]);
  } catch (failure) {
    if (process.platform === "win32") {
      const profileLiteral = "'" + entry.profile.replaceAll("'", "''") + "'";
      // PID alone is insufficient: recheck the exact temporary profile and executable.
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$taskBrowser=Get-CimInstance Win32_Process -Filter 'ProcessId=${entry.processId}'; if($taskBrowser) {if($taskBrowser.Name -ne 'firefox.exe' -or !$taskBrowser.CommandLine.Contains(${profileLiteral}) -or $taskBrowser.CommandLine -notmatch '-headless') {throw 'Disposable Firefox identity changed'}; taskkill.exe /PID ${entry.processId} /T /F | Out-Null; if($LASTEXITCODE) {throw 'Firefox cleanup failed'}}`,
        ],
        { timeout: 10000, stdio: "ignore" },
      );
    }
    throw failure;
  } finally {
    clearTimeout(timer);
    owned.delete(entry.driver);
  }
}

export function closeFirefoxDriver(driver: WebDriver) {
  const entry = owned.get(driver);
  return entry ? (entry.closing ||= dispose(entry)) : Promise.resolve();
}

export async function cleanupNativeDrivers() {
  const results = await Promise.allSettled(
    [...owned.keys()].map(closeFirefoxDriver),
  );
  const errors = results.filter((result) => result.status === "rejected");
  if (errors.length)
    throw new AggregateError(
      errors.map((result) => result.reason),
      "Disposable Firefox cleanup failed",
    );
}
