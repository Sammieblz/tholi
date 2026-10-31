import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { chromium } from "@playwright/test";
import { operatorEvaluationManifestSha256 } from "../../packages/navigation-core/contracts-evaluation";
import { serviceOrigin } from "../../packages/navigation-core/service-client";
import { openNavigatorExtension } from "./navigator-extension";
import { comparisonHostPermissions } from "./perception-comparison";
import { bootstrapOperatorEvaluationSession } from "./bootstrap-evaluation-session";

/** CLI-only local setup; neither mode constructs a model adapter. */
export async function runEvaluationBootstrap() {
  const { values } = parseArgs({
    options: {
      preflight: { type: "boolean" },
      origin: { type: "string" },
      callback: { type: "string" },
      "env-file": { type: "string" },
      "authorization-origin": { type: "string" },
      "provider-origin": { type: "string" },
      output: { type: "string" },
      "record-fake-consent": { type: "boolean" },
    },
  });
  const origin = serviceOrigin(values.origin || "");
  if (
    new URL(origin).protocol !== "http:" ||
    new URL(origin).hostname !== "127.0.0.1"
  )
    throw Error("Explicit evaluation loopback origin required.");
  if (values.preflight) {
    const app = await openNavigatorExtension(
      { width: 1280, height: 900 },
      comparisonHostPermissions(origin),
      {
        persistentPermissions: true,
        standalone: true,
      },
    );
    try {
      const worker = app.context.serviceWorkers()[0];
      if (!worker)
        throw Error("The installed evaluation worker is unavailable.");
      const actual = await worker.evaluate(() => ({
        callback: chrome.identity.getRedirectURL(),
        manifest: chrome.runtime.getManifest(),
      }));
      return {
        mode: "callback-preflight",
        callback: actual.callback,
        runtimeManifestSha256: await operatorEvaluationManifestSha256(
          actual.manifest,
        ),
        nativeWindowVerified: false,
      };
    } finally {
      await app.close();
    }
  }
  if (
    !values.callback ||
    !values["env-file"] ||
    !values["authorization-origin"] ||
    !values["provider-origin"] ||
    !values.output
  )
    throw Error(
      "Explicit local identity configuration, callback and new private output are required.",
    );
  const qa = await realpath(resolve("output/qa"));
  const envFile = await realpath(resolve(values["env-file"]));
  if (!envFile.startsWith(qa + sep))
    throw Error("Use an allocated identity environment under output/qa.");
  const settings = parseEnv(await readFile(envFile, "utf8"));
  const realm = JSON.parse(
    await readFile(resolve("infra/local/oidc/tholi-local-realm.json"), "utf8"),
  );
  const user = realm.users?.find(
    (candidate: {
      username?: string;
      email?: string;
      emailVerified?: boolean;
    }) =>
      candidate.username === "tholi-local-user" &&
      candidate.email?.endsWith("@example.test") &&
      candidate.emailVerified === true,
  );
  if (!user || !settings.OIDC_TEST_PASSWORD || !settings.COMPOSE_PROJECT_NAME)
    throw Error(
      "The disposable synthetic identity configuration is unavailable.",
    );
  Object.assign(process.env, {
    THOLI_IDENTITY_ENV_FILE: envFile,
    THOLI_IDENTITY_PROJECT: settings.COMPOSE_PROJECT_NAME,
    THOLI_IDENTITY_SERVICE_ORIGIN: values["authorization-origin"],
    THOLI_IDENTITY_PROVIDER_ORIGIN: values["provider-origin"],
    THOLI_IDENTITY_USERNAME: user.username,
    THOLI_IDENTITY_PASSWORD: settings.OIDC_TEST_PASSWORD,
    THOLI_TEST_TIER: "operator-bootstrap",
    THOLI_BROWSER_NETWORK: "local-identity",
  });
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
  });
  try {
    return await bootstrapOperatorEvaluationSession(browser, {
      callback: values.callback,
      evaluationOrigin: origin,
      outputFile: values.output,
      recordEvaluationConsent: !!values["record-fake-consent"],
    });
  } finally {
    await browser.close();
  }
}
