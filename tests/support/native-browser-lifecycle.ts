import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, posix, relative, resolve } from "node:path";
import type { WebDriver } from "selenium-webdriver";

type OwnedFirefox = {
  driver: WebDriver;
  processId: number;
  profile: string;
  reportedProfile: string;
  macProcess?: MacFirefoxProcess;
  closing?: Promise<void>;
};
const owned = new Map<WebDriver, OwnedFirefox>();

export type MacFirefoxProcess = {
  executable: string;
  started: string;
  command: string;
};
type MacFirefoxOwnership = Pick<
  OwnedFirefox,
  "processId" | "profile" | "reportedProfile"
> & { macProcess: MacFirefoxProcess };

function inspectMacProcess(processId: number): MacFirefoxProcess | undefined {
  let output: string;
  try {
    output = execFileSync(
      "ps",
      [
        "-ww",
        "-p",
        String(processId),
        "-o",
        "comm=",
        "-o",
        "lstart=",
        "-o",
        "args=",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        timeout: 500,
        maxBuffer: 32768,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: { toString(): string };
      stderr?: { toString(): string };
    };
    if (
      failure.status === 1 &&
      !failure.stdout?.toString().trim() &&
      !failure.stderr?.toString().trim()
    )
      return;
    throw Error("The owned Firefox process could not be inspected.");
  }
  if (!output) return;
  const match = output.match(
    /^(.*?)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
  );
  if (!match) throw Error("The owned Firefox process identity is unavailable.");
  return { executable: match[1], started: match[2], command: match[3] };
}

/** Canonical paths handle macOS's /var -> /private/var temporary-directory alias. */
export function ownedFirefoxProfile(profile: string, temporaryRoot = tmpdir()) {
  const actual = realpathSync(resolve(profile)),
    root = realpathSync(resolve(temporaryRoot)),
    inside = relative(root, actual);
  if (
    !inside ||
    isAbsolute(inside) ||
    inside === ".." ||
    inside.startsWith("..\\") ||
    inside.startsWith("../") ||
    !basename(actual).startsWith("rust_mozprofile")
  )
    throw Error("Firefox must expose its disposable profile ownership.");
  return actual;
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertOwnedMacFirefoxProcess(
  expected: Pick<MacFirefoxOwnership, "profile" | "reportedProfile"> & {
    macProcess?: MacFirefoxProcess;
  },
  actual: MacFirefoxProcess,
) {
  const executable = posix.basename(actual.executable).toLowerCase(),
    matchesProfile = [expected.profile, expected.reportedProfile].some(
      (profile) =>
        new RegExp(
          `(?:^|\\s)--?profile(?:\\s+|=)(?:"${escapePattern(profile)}"|'${escapePattern(profile)}'|${escapePattern(profile)})(?=\\s|$)`,
        ).test(actual.command),
    );
  if (
    !["firefox", "firefox-bin"].includes(executable) ||
    !/(?:^|\s)--?headless(?=\s|$)/.test(actual.command) ||
    !matchesProfile ||
    !actual.started ||
    (expected.macProcess &&
      (actual.started !== expected.macProcess.started ||
        actual.executable !== expected.macProcess.executable))
  )
    throw Error("Disposable Firefox process identity changed.");
}

/** Only the registered root PID is signalled; this does not certify every browser child. */
export async function stopOwnedMacFirefoxProcess(
  expected: MacFirefoxOwnership,
  runtime: {
    inspect?: (processId: number) => MacFirefoxProcess | undefined;
    signal?: (processId: number, signal: "SIGTERM" | "SIGKILL") => void;
    pause?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {},
) {
  if (!Number.isSafeInteger(expected.processId) || expected.processId < 1)
    throw Error("Firefox cleanup requires one positive owned process ID.");
  const inspect = runtime.inspect ?? inspectMacProcess,
    signal = runtime.signal ?? ((pid, kind) => process.kill(pid, kind)),
    pause =
      runtime.pause ??
      ((milliseconds) =>
        new Promise<void>((done) => setTimeout(done, milliseconds))),
    now = runtime.now ?? (() => performance.now());
  const present = () => {
    const actual = inspect(expected.processId);
    if (!actual) return false;
    assertOwnedMacFirefoxProcess(expected, actual);
    return true;
  };
  const waitForExit = async (milliseconds: number) => {
    const deadline = now() + milliseconds;
    while (now() < deadline) {
      await pause(200);
      if (!present()) return true;
    }
    return false;
  };
  const send = (kind: "SIGTERM" | "SIGKILL") => {
    try {
      signal(expected.processId, kind);
    } catch (error) {
      if ((error as { code?: string }).code === "ESRCH" && !present()) return;
      throw Error("The owned Firefox process could not be stopped.");
    }
  };
  if (!present()) return;
  send("SIGTERM");
  if (await waitForExit(5000)) return;
  if (!present()) return;
  send("SIGKILL");
  if (!(await waitForExit(1000)))
    throw Error("The owned Firefox process did not exit after cleanup.");
}

async function quitWithDeadline(driver: WebDriver) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      driver.quit(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(Error("Firefox WebDriver shutdown exceeded thirty seconds")),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keep timed-out Marionette commands from stranding disposable browser trees. */
export async function registerFirefoxDriver(driver: WebDriver) {
  try {
    const capabilities = await driver.getCapabilities(),
      processId = Number(capabilities.get("moz:processID")),
      reportedProfile = resolve(String(capabilities.get("moz:profile"))),
      profile = ownedFirefoxProfile(reportedProfile);
    if (!Number.isSafeInteger(processId) || processId < 1)
      throw Error("Firefox must expose its disposable process ownership.");
    const macProcess =
      process.platform === "darwin" ? inspectMacProcess(processId) : undefined;
    if (process.platform === "darwin") {
      if (!macProcess)
        throw Error("The disposable Firefox process is no longer available.");
      assertOwnedMacFirefoxProcess({ profile, reportedProfile }, macProcess);
    }
    owned.set(driver, {
      driver,
      processId,
      profile,
      reportedProfile,
      macProcess,
    });
  } catch (failure) {
    // A just-created WebDriver session is ours, but unproved PIDs are never killed.
    try {
      await quitWithDeadline(driver);
    } catch (cleanupFailure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        "Firefox ownership validation and session cleanup failed.",
      );
    }
    throw failure;
  }
}

async function dispose(entry: OwnedFirefox) {
  try {
    await quitWithDeadline(entry.driver);
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
    } else if (process.platform === "darwin" && entry.macProcess) {
      await stopOwnedMacFirefoxProcess({
        ...entry,
        macProcess: entry.macProcess,
      });
    }
    throw failure;
  } finally {
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
