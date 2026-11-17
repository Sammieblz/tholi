import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyBuildManifest } from "../build-manifest.mjs";
import { artifactFiles } from "../artifact-files.mjs";
import { digest } from "../evidence.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);

/** Existing real browser/identity owners run while the smoke owns its stack. */
export async function runWebsiteIdentityChecks({
  directory,
  envFile,
  project,
  settings,
  ports,
  preparedImage,
}) {
  const startedAt = Date.now();
  await verifyBuildManifest();
  const sideBuild = resolve(directory, "website");
  const environment = {
    ...process.env,
    THOLI_IDENTITY_ENV_FILE: envFile,
    THOLI_IDENTITY_PROJECT: project,
    THOLI_IDENTITY_SERVICE_ORIGIN: `http://127.0.0.1:${ports.API_HOST_PORT}`,
    THOLI_IDENTITY_PROVIDER_ORIGIN: `http://localhost:${ports.OIDC_HOST_PORT}`,
    THOLI_IDENTITY_USERNAME: "tholi-local-user",
    THOLI_IDENTITY_PASSWORD: settings.OIDC_TEST_PASSWORD,
    THOLI_BROWSER_GROUP: "identity-web",
    THOLI_IDENTITY_WEB_DIRECTORY: sideBuild,
    VITE_THOLI_SERVICE_ORIGIN: `http://127.0.0.1:${ports.API_HOST_PORT}`,
    THOLI_UI_PORT: String(ports.WEB_HOST_PORT),
    THOLI_BUILD_PREPARED: "1",
    ...(preparedImage ? { THOLI_PREPARED_IMAGE: preparedImage } : {}),
  };
  const npm =
    process.env.npm_execpath ||
    fileURLToPath(
      new URL(
        "node_modules/npm/bin/npm-cli.js",
        pathToFileURL(process.execPath),
      ),
    );
  let stage = "configured website build";
  try {
    await execute(process.execPath, [npm, "run", "build:web"], {
      cwd: root,
      env: environment,
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    stage = "real local website account cases";
    await execute(process.execPath, ["scripts/test.mjs", "identity-web"], {
      cwd: root,
      env: environment,
      // Twelve existing cases each retain their own five-minute bound. Allow
      // those owners to finish rather than terminating their coordinator early.
      timeout: 65 * 60000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    // Provider forms and mail links must not enter distributable build logs.
    throw Error(
      `Real local website identity cohort failed during ${stage}${error.killed ? " (coordinator deadline)" : ""}; inspect its sanitized owner reports.`,
    );
  }
  const buildDigest = digest(await artifactFiles(sideBuild));
  const reports = [];
  await mkdir(resolve(directory, "website-identity"));
  for (const browser of ["chromium", "firefox"])
    for (const suffix of [
      "",
      "-provider-settings",
      "-dashboard-data",
      "-dashboard-finance",
      "-dashboard-lifecycle",
      "-private-learning",
    ]) {
      const name = browser + suffix + ".json";
      const path = resolve(root, "output/qa/website-identity", name);
      const report = JSON.parse(await readFile(path, "utf8"));
      assert.equal(report.passed, true);
      if (report.cleanupCompleted !== undefined)
        assert.equal(report.cleanupCompleted, true);
      assert.ok(Date.parse(report.evaluatedAt) >= startedAt);
      assert.equal(report.buildDigest, buildDigest);
      if (report.modelRequests !== undefined)
        assert.equal(report.modelRequests, 0);
      await copyFile(path, resolve(directory, "website-identity", name));
      reports.push({ name, browser, passed: true });
    }
  await verifyBuildManifest();
  return {
    passed: true,
    project,
    buildDigest,
    reports,
    externalModelCalls: 0,
    scope:
      "Real local website registration, mail verification, recovery, account/data/credit controls; no native store permission or screen-reader certification",
  };
}
