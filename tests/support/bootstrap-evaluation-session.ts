import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { parseEnv } from "node:util";
import { expect, type Browser } from "@playwright/test";
import {
  identityAccountResponseSchema,
  identityExchangeSchema,
  identityTokensSchema,
} from "../../packages/navigation-core/contracts-identity";
import {
  consentPageSchema,
  consentSchema,
  consentUpdateSchema,
  policyCatalogSchema,
} from "../../packages/navigation-core/contracts-authorization";
import {
  serviceOrigin,
  serviceRequest,
} from "../../packages/navigation-core/service-client";
import { nativeIdentityEnvironment } from "./webdriver-auth";
import { nativeEvaluationSessionSchema } from "./evaluation-session";
import {
  completeLocalProviderSignIn,
  identityContext,
  closeIdentityContext,
} from "./website-auth";

/** Ordinary broker/PKCE issuance, without a native identity-window certification claim. */
export async function bootstrapOperatorEvaluationSession(
  browser: Browser,
  options: {
    callback: string;
    evaluationOrigin: string;
    outputFile: string;
    recordEvaluationConsent?: boolean;
  },
) {
  const environment = nativeIdentityEnvironment();
  const callback = nativeEvaluationSessionSchema.shape.callback.parse(
    options.callback,
  );
  if (new URL(callback).pathname !== "/")
    throw Error("Use the installed extension's default callback.");
  const origin = serviceOrigin(options.evaluationOrigin);
  if (
    new URL(origin).protocol !== "http:" ||
    new URL(origin).hostname !== "127.0.0.1"
  )
    throw Error("Operator bootstrap is local only.");
  const settings = parseEnv(await readFile(environment.envFile, "utf8"));
  if (
    !(settings.THOLI_IDENTITY_CHROMIUM_CALLBACKS || "")
      .split(",")
      .includes(callback)
  )
    throw Error(
      "Register the exact installed callback in the owned local identity environment first.",
    );
  const qa = await realpath(resolve("output/qa"));
  const target = resolve(options.outputFile);
  if (!target.startsWith(qa + sep))
    throw Error("Private operator sessions must remain in output/qa.");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if ((await realpath(dirname(target))) !== dirname(target))
    throw Error("Private session directory aliases are not allowed.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorization = new URL(
    "/api/v1/auth/authorize",
    environment.serviceOrigin,
  );
  authorization.search = new URLSearchParams({
    clientId: "extension-chromium",
    action: "signin",
    destination: "client",
    redirectUri: callback,
    state,
    codeChallenge: challenge,
  }).toString();
  const context = await identityContext(browser);
  let returned: URL | undefined;
  try {
    const registered = new URL(callback);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === registered.origin &&
        url.pathname === registered.pathname
      ) {
        if (
          returned ||
          url.hash ||
          url.searchParams.get("state") !== state ||
          [...url.searchParams.keys()].length !== 2 ||
          [...url.searchParams.keys()].some(
            (key) => key !== "code" && key !== "state",
          )
        ) {
          await route.abort();
          return;
        }
        returned = url;
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          body: "Local broker callback received.",
        });
      } else if (
        [environment.serviceOrigin, environment.providerOrigin].includes(
          url.origin,
        )
      )
        await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(authorization.href);
    await completeLocalProviderSignIn(
      page,
      environment,
      environment.username,
      environment.password,
    );
    await expect
      .poll(() => !!returned, {
        timeout: 30000,
        message: "The local broker returns the bound extension code",
      })
      .toBe(true);
    const exchange = identityExchangeSchema.parse({
      code: returned!.searchParams.get("code"),
      clientId: "extension-chromium",
      redirectUri: callback,
      codeVerifier: verifier,
    });
    const tokens = await serviceRequest(
      environment.serviceOrigin,
      "/api/v1/auth/exchange",
      identityTokensSchema,
      { method: "POST", body: exchange },
    );
    const request = {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    };
    const account = await serviceRequest(
      environment.serviceOrigin,
      "/api/v1/account",
      identityAccountResponseSchema,
      request,
    );
    if (
      account.session.clientId !== "extension-chromium" ||
      account.session.clientKind !== "extension" ||
      account.session.id !== tokens.sessionId ||
      account.account.id !== tokens.account.id ||
      account.account.workspaceId !== tokens.account.workspaceId
    )
      throw Error("The issued local extension session could not be verified.");
    if (options.recordEvaluationConsent) {
      const base = `/api/v1/workspaces/${tokens.account.workspaceId}` as const;
      const policies = await serviceRequest(
        environment.serviceOrigin,
        `${base}/policies`,
        policyCatalogSchema,
        request,
      );
      const consents = await serviceRequest(
        environment.serviceOrigin,
        `${base}/consents`,
        consentPageSchema,
        request,
      );
      for (const purpose of [
        "cloud_inference",
        "image_transmission",
      ] as const) {
        const policy = policies.consentPolicies.find(
          (item) => item.purpose === purpose,
        );
        if (!policy) throw Error("The local processing policy is unavailable.");
        const previous = consents.items.find(
          (item) => item.purpose === purpose,
        );
        if (
          previous?.granted &&
          previous.policyVersion === policy.policyVersion
        )
          continue;
        const body = consentUpdateSchema.parse({
          purpose,
          policyVersion: policy.policyVersion,
          granted: true,
          expectedRevision: previous?.revision ?? "0",
        });
        const saved = await serviceRequest(
          environment.serviceOrigin,
          `${base}/consents`,
          consentSchema,
          { ...request, method: "POST", body },
        );
        if (
          saved.purpose !== purpose ||
          !saved.granted ||
          saved.policyVersion !== policy.policyVersion
        )
          throw Error("The local processing consent could not be verified.");
      }
    }
    const wrapper = nativeEvaluationSessionSchema.parse({
      version: 1,
      serviceOrigin: origin,
      authorizationOrigin: environment.serviceOrigin,
      callback,
      clientId: "extension-chromium",
      tokens,
    });
    await writeFile(target, JSON.stringify(wrapper) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return {
      accountId: account.account.id,
      workspaceId: account.account.workspaceId,
      sessionId: account.session.id,
      clientId: account.session.clientId,
      sessionExpiresAt: tokens.sessionExpiresAt,
      nativeWindowVerified: false,
      consentRecorded: !!options.recordEvaluationConsent,
    };
  } catch {
    throw Error(
      "Local operator PKCE bootstrap failed. No model call was started.",
    );
  } finally {
    await closeIdentityContext(context);
  }
}
