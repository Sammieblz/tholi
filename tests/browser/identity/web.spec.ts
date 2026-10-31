import { test, expect, errors } from "../../support/browser-test";
import {
  artifactFiles,
  websiteArtifactDirectory,
} from "../../../scripts/artifact-files.mjs";
import { digest } from "../../../scripts/evidence.mjs";
import { writeEvidence } from "../../support/evidence";
import {
  nativeIdentityEnvironment,
  reconcileIdentityConfiguration,
} from "../../support/webdriver-auth";
import {
  accountResponse,
  capturedMessageIds,
  checkCookieBinding,
  checkAccountLayout,
  closeIdentityContext,
  identityContext,
  localEmailAction,
  providerRegistrationError,
  signInWebsite,
  setWebsitePassword,
  signOutWebsite,
  syntheticWebsiteIdentity,
  waitForWebsiteAccount,
  waitForIdentityGatewayCapacity,
  WebsiteIdentityError,
  registerWebsiteAccount,
  websiteAccountRequest,
  downloadWebsiteJson,
  prepareWebsiteDashboardAccount,
} from "../../support/website-auth";
import type { BrowserContext } from "@playwright/test";
import { productAnalyticsRecordSchema } from "../../../packages/navigation-core/contracts-analytics";
import {
  savedDataRecordSchema,
  savedDataStorageUsageSchema,
  savedDataExportSnapshotSchema,
  savedDataPageSchema,
  SAVED_DATA_LIMITS,
} from "../../../packages/navigation-core/contracts-saved-data";
import { workspaceCreditsSchema } from "../../../packages/navigation-core/contracts-credits";
import { identityRevokedSchema } from "../../../packages/navigation-core/contracts-identity";
import { productEntitlementsSchema } from "../../../packages/navigation-core/contracts-plans";
import {
  SERVICE_ACCOUNT_BINDING_HEADER,
  serviceCapabilitiesSchema,
} from "../../../packages/navigation-core/contracts-service";
import {
  accountDeletionResultSchema,
  accountExportManifestSchema,
  accountExportPartSchema,
} from "../../../packages/navigation-core/contracts-account";
import { SUPPORT_LIMITS } from "../../../packages/navigation-core/contracts-support";

function sourceFailureLine(error: unknown): number | null {
  const line =
    error instanceof Error
      ? /web\.spec\.ts:(\d+):\d+/.exec(error.stack ?? "")?.[1]
      : undefined;
  return line ? Number(line) : null;
}

test("configured website uses real signup email recovery and retained identity without requiring accounts for Local", async ({
  browser,
  browserName,
}, info) => {
  const environment = nativeIdentityEnvironment();
  const fixture = syntheticWebsiteIdentity(environment);
  const buildDigest = digest(await artifactFiles(websiteArtifactDirectory()));
  const contexts: BrowserContext[] = [];
  const checks: string[] = [];
  const progress = {
    operation: "public installation and practice",
    registrationFormObserved: false,
    registrationFieldsFilled: false,
    registrationSubmitted: false,
    verificationEmailFound: false,
    verificationActionFollowed: false,
    passwordSetupObserved: false,
    passwordSetupCompleted: false,
    callbackObserved: false,
    accountHttpStatus: 0,
    accountErrorCode: "not checked",
    providerFormError: "none",
    failureReason: "none",
    failureLine: null as number | null,
    sessionHttpStatus: { refresh: 0, revocation: 0, revokedSessionRead: 0 },
    analyticsHttpStatus: {
      capabilities: 0,
      policies: 0,
      consentRead: 0,
      consentWrite: 0,
      collection: 0,
      export: 0,
      deletion: 0,
    },
    // Browser-observed requests only; fixture APIRequestContext calls are separate.
    browserServiceRequests: {
      get: 0,
      post: 0,
      patch: 0,
      delete: 0,
      options: 0,
      other: 0,
    },
    rateLimitResponses: { json: 0, html: 0, other: 0 },
    gatewayCapacityWaitMs: {
      initial: 0,
      publicReentry: 0,
      primaryReload: 0,
      afterAnalytics: 0,
      beforeRecovery: 0,
    },
  };
  const saveProgress = () =>
    writeEvidence(
      `output/qa/website-identity/${browserName}-progress.json`,
      progress,
    );
  let stage = "account-free installation and practice",
    passed = false,
    callback = "";
  const context = await identityContext(browser);
  contexts.push(context);
  const page = await context.newPage();
  try {
    stage = progress.operation = "initial gateway capacity schedule";
    progress.gatewayCapacityWaitMs.initial =
      await waitForIdentityGatewayCapacity();
    stage = "account-free installation and practice";
    progress.operation = "public installation and practice";
    let localAccountRequests = 0;
    let productRequests = 0;
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== environment.serviceOrigin) return;
      const method = response.request().method();
      const status = response.status();
      if (method === "POST" && url.pathname === "/api/v1/auth/refresh")
        progress.sessionHttpStatus.refresh = status;
      if (
        method === "DELETE" &&
        /^\/api\/v1\/account\/sessions\/[a-f0-9-]{36}$/i.test(url.pathname)
      )
        progress.sessionHttpStatus.revocation = status;
      if (status === 429) {
        const contentType = response.headers()["content-type"] ?? "";
        if (contentType.startsWith("application/json"))
          progress.rateLimitResponses.json++;
        else if (contentType.startsWith("text/html"))
          progress.rateLimitResponses.html++;
        else progress.rateLimitResponses.other++;
      }
      if (method === "GET" && url.pathname === "/api/v1/capabilities")
        progress.analyticsHttpStatus.capabilities = status;
      else if (
        method === "GET" &&
        /\/workspaces\/[^/]+\/policies$/.test(url.pathname)
      )
        progress.analyticsHttpStatus.policies = status;
      else if (/\/workspaces\/[^/]+\/consents$/.test(url.pathname)) {
        if (method === "GET") progress.analyticsHttpStatus.consentRead = status;
        else if (method === "POST")
          progress.analyticsHttpStatus.consentWrite = status;
      } else if (/\/workspaces\/[^/]+\/analytics\/events$/.test(url.pathname)) {
        if (method === "GET") progress.analyticsHttpStatus.export = status;
        else if (method === "POST")
          progress.analyticsHttpStatus.collection = status;
        else if (method === "DELETE")
          progress.analyticsHttpStatus.deletion = status;
      }
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === environment.serviceOrigin) {
        switch (request.method()) {
          case "GET":
            progress.browserServiceRequests.get++;
            break;
          case "POST":
            progress.browserServiceRequests.post++;
            break;
          case "PATCH":
            progress.browserServiceRequests.patch++;
            break;
          case "DELETE":
            progress.browserServiceRequests.delete++;
            break;
          case "OPTIONS":
            progress.browserServiceRequests.options++;
            break;
          default:
            progress.browserServiceRequests.other++;
        }
      }
      if (
        url.origin === environment.serviceOrigin &&
        url.pathname === "/api/v1/auth/callback"
      ) {
        callback = url.href;
        progress.callbackObserved = true;
      }
      if (
        url.origin === environment.serviceOrigin &&
        url.pathname.startsWith("/api/v1/account")
      )
        localAccountRequests++;
      if (
        url.origin === environment.serviceOrigin &&
        /\/analytics\/events$/.test(url.pathname) &&
        request.method() === "POST"
      )
        productRequests++;
    });
    await page.goto(environment.webOrigin + "/download");
    await page
      .getByRole("button", { name: "Essential only", exact: true })
      .click();
    await expect(
      page
        .locator(".browser-install-options")
        .getByRole("link", { name: "Add to Chrome", exact: true }),
    ).toHaveAttribute(
      "href",
      "https://chromewebstore.google.com/detail/tholi/pliafmeneaalhbecphnodbifdfcajngk",
    );
    await expect(
      page
        .locator(".browser-install-options")
        .getByRole("link", { name: "Add to Firefox", exact: true }),
    ).toHaveAttribute(
      "href",
      "https://addons.mozilla.org/en-US/firefox/addon/tholi/",
    );
    await page.goto(environment.webOrigin + "/onboarding");
    await page
      .getByRole("button", { name: "Try the demonstration", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Find account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await expect(
      page
        .locator(".demo-workspace")
        .getByRole("heading", { name: "Account settings", exact: true }),
    ).toBeVisible();
    expect(localAccountRequests).toBe(0);
    checks.push(
      "Essential-only installation and isolated Local practice work without an account",
    );
    stage = "real provider registration and verification email";
    const first = await registerWebsiteAccount(
      page,
      environment,
      fixture,
      async (step, pending) => {
        progress.operation = `real registration: ${step}`;
        if (step === "form") progress.registrationFormObserved = true;
        if (step === "fields") progress.registrationFieldsFilled = true;
        if (step === "submitted") progress.registrationSubmitted = true;
        if (pending) {
          progress.accountHttpStatus = pending.status;
          progress.accountErrorCode = pending.errorCode;
        }
        if (step === "verification-found")
          progress.verificationEmailFound = true;
        if (step === "verification-followed")
          progress.verificationActionFollowed = true;
        if (step === "password-form") progress.passwordSetupObserved = true;
        if (step === "password-set") progress.passwordSetupCompleted = true;
        await saveProgress();
      },
    );
    progress.accountHttpStatus = 200;
    progress.accountErrorCode = "none";
    await saveProgress();
    checks.push(
      "real registration requires email verification before creating account access",
    );
    stage = progress.operation = "analytics initial consent controls";
    await saveProgress();
    await page.goto(environment.webOrigin + "/account/security");
    const measurements = page.locator(
      'section[aria-labelledby="account-analytics-heading"]',
    );
    const accountPermission = measurements.getByRole("checkbox", {
      name: "Allow optional product measurements for this account",
      exact: true,
    });
    const browserPermission = measurements.getByRole("checkbox", {
      name: "Allow measurements from this browser",
      exact: true,
    });
    await expect(accountPermission).toBeVisible();
    await expect(accountPermission).not.toBeChecked();
    await expect(browserPermission).not.toBeChecked();
    expect(productRequests).toBe(0);
    stage = progress.operation = "analytics save account permission";
    await saveProgress();
    // This controlled value follows the server response; .check() would assert
    // an immediate state change before the authorized mutation has completed.
    await accountPermission.click();
    await expect(measurements).toContainText("Account permission saved.");
    await expect(accountPermission).toBeChecked();
    expect(productRequests).toBe(0);
    stage = progress.operation = "analytics enable browser and collect event";
    await saveProgress();
    const collected = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.origin === environment.serviceOrigin &&
        /\/analytics\/events$/.test(url.pathname) &&
        response.request().method() === "POST"
      );
    });
    await browserPermission.focus();
    await page.keyboard.press("Space");
    expect((await collected).status()).toBe(200);
    await expect(browserPermission).toBeChecked();
    stage = progress.operation = "analytics export retained event";
    await saveProgress();
    await measurements
      .getByRole("button", {
        name: "Review retained measurements",
        exact: true,
      })
      .click();
    const exported = measurements.getByRole("region", {
      name: "Retained product measurements JSON",
      exact: true,
    });
    await expect(exported).toBeVisible();
    const rows = productAnalyticsRecordSchema
      .array()
      .max(100)
      .parse(JSON.parse((await exported.textContent())!));
    expect(
      rows.some(
        (row) => row.event.name === "page_view" && row.event.page === "account",
      ),
    ).toBe(true);
    stage =
      "signed-in account and retained measurements layout keyboard focus and reduced motion";
    progress.operation = stage;
    await checkAccountLayout(page);
    checks.push(
      "real account and retained measurements fit four widths in both themes with visible keyboard focus and reduced motion",
    );
    stage = progress.operation =
      "analytics withdraw browser consent through Essential only";
    await saveProgress();
    await page
      .getByRole("button", { name: "Cookie settings", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Cookie settings", exact: true })
      .getByRole("button", { name: "Essential only", exact: true })
      .click();
    await expect(browserPermission).not.toBeChecked();
    await expect(accountPermission).toBeChecked();
    stage = progress.operation = "analytics public Local pages remain inert";
    await saveProgress();
    const beforePublic = productRequests;
    await page.goto(environment.webOrigin + "/onboarding");
    await page
      .getByRole("button", { name: "Skip onboarding", exact: true })
      .click();
    await expect(page).toHaveURL(environment.webOrigin + "/download");
    expect(productRequests).toBe(beforePublic);
    progress.gatewayCapacityWaitMs.publicReentry =
      await waitForIdentityGatewayCapacity();
    await page.goto(environment.webOrigin + "/account");
    await waitForWebsiteAccount(page, environment);
    await page.goto(environment.webOrigin + "/account/security");
    await expect(accountPermission).toBeChecked();
    await expect(browserPermission).not.toBeChecked();
    stage = progress.operation = "analytics withdraw account permission";
    await saveProgress();
    await accountPermission.click();
    await expect(measurements).toContainText(
      "Account permission withdrawn and retained product measurements removed.",
    );
    await expect(accountPermission).not.toBeChecked();
    stage = progress.operation = "analytics export after account withdrawal";
    await saveProgress();
    await measurements
      .getByRole("button", {
        name: "Review retained measurements",
        exact: true,
      })
      .click();
    await expect(exported).toHaveText("[]");
    stage = progress.operation =
      "analytics delete retained events without collection permission";
    await saveProgress();
    await measurements
      .getByRole("button", { name: "Delete measurements", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(measurements).toContainText(
      "Retained product measurements deleted.",
    );
    checks.push(
      "real cookie/CSRF analytics collection needs both independent choices; withdrawal purges retained records and Local public pages remain inert",
    );
    stage = progress.operation =
      "gateway capacity schedule before session checks";
    await saveProgress();
    progress.gatewayCapacityWaitMs.afterAnalytics =
      await waitForIdentityGatewayCapacity();
    stage = "callback cookie binding and session credential protection";
    progress.operation = stage;
    await checkCookieBinding(browser, context, callback, environment);
    const cookies = (
      await context.cookies(environment.serviceOrigin + "/api/v1/account")
    ).filter((cookie) =>
      ["tholi_session", "tholi_refresh"].includes(cookie.name),
    );
    expect(cookies.length).toBe(2);
    expect(
      cookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        [...Object.keys(localStorage), ...Object.keys(sessionStorage)].some(
          (key) => /token|account|refresh|session/i.test(key),
        ),
      ),
    ).toBe(false);
    checks.push(
      "actual callback rejects foreign cookie binding and completed-flow replay; credentials stay HttpOnly",
    );
    stage = "real session refresh and device revocation";
    progress.operation = stage;
    await page
      .getByRole("button", { name: "Renew session", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your account session was renewed." }),
    ).toBeVisible();
    expect((await accountResponse(page, environment)).value?.session.id).toBe(
      first.session.id,
    );
    const secondContext = await identityContext(browser);
    contexts.push(secondContext);
    const secondPage = await secondContext.newPage();
    const second = await signInWebsite(
      secondPage,
      environment,
      fixture.username,
      fixture.password,
    );
    expect(second.account.id).toBe(first.account.id);
    expect(second.session.id === first.session.id).toBe(false);
    progress.gatewayCapacityWaitMs.primaryReload =
      await waitForIdentityGatewayCapacity();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Account and security", exact: true }),
    ).toBeVisible();
    const other = page
      .locator(".account-sessions > li")
      .filter({ hasNotText: "This session" });
    await expect(other).toHaveCount(1);
    await other
      .getByRole("button", { name: "Revoke web session", exact: true })
      .click();
    const revocationReply = page.waitForResponse(
      (response) =>
        new URL(response.url()).origin === environment.serviceOrigin &&
        new URL(response.url()).pathname ===
          `/api/v1/account/sessions/${second.session.id}` &&
        response.request().method() === "DELETE",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    const revoked = await revocationReply;
    progress.sessionHttpStatus.revocation = revoked.status();
    expect(revoked.status()).toBe(200);
    identityRevokedSchema.parse(await revoked.json());
    const revocationStatus = page
      .getByRole("status")
      .filter({ hasText: "The Tholi session was revoked." });
    await expect(revocationStatus).toBeVisible();
    progress.sessionHttpStatus.revokedSessionRead = (
      await accountResponse(secondPage, environment)
    ).status;
    expect(progress.sessionHttpStatus.revokedSessionRead).toBe(401);
    await secondPage.reload();
    await expect(
      secondPage
        .locator(".account-gate")
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    checks.push(
      "real refresh retains the session and a revoked second browser loses account access",
    );
    stage = "explicit Tholi and identity-provider sign-out";
    progress.operation = stage;
    await signOutWebsite(page, environment, true);
    checks.push(
      "Tholi logout and explicitly confirmed provider logout complete separately",
    );
    stage = progress.operation =
      "gateway capacity schedule before recovery checks";
    await saveProgress();
    progress.gatewayCapacityWaitMs.beforeRecovery =
      await waitForIdentityGatewayCapacity();
    stage = "real password recovery email and password update";
    progress.operation = stage;
    const beforeRecovery = await capturedMessageIds(environment, fixture.email);
    await page.goto(environment.webOrigin + "/signin");
    await page
      .getByRole("link", { name: "Recover account access", exact: true })
      .click();
    await page.waitForURL((url) => url.origin === environment.providerOrigin);
    await page.locator("#username").fill(fixture.username);
    await page.locator('#kc-reset-password-form button[type="submit"]').click();
    await page.goto(
      await localEmailAction(environment, fixture.email, beforeRecovery),
    );
    await setWebsitePassword(page, fixture.newPassword);
    const recoveredContext = await identityContext(browser);
    contexts.push(recoveredContext);
    const recoveredPage = await recoveredContext.newPage();
    const recovered = await signInWebsite(
      recoveredPage,
      environment,
      fixture.username,
      fixture.newPassword,
    );
    expect(recovered.account.id).toBe(first.account.id);
    checks.push(
      "real recovery email changes the password and fresh-browser sign-in preserves account identity",
    );
    stage = "retained realm reconciliation and fresh-browser sign-in";
    progress.operation = stage;
    reconcileIdentityConfiguration(environment);
    const retainedContext = await identityContext(browser);
    contexts.push(retainedContext);
    const retainedPage = await retainedContext.newPage();
    const retained = await signInWebsite(
      retainedPage,
      environment,
      fixture.username,
      fixture.newPassword,
    );
    expect(retained.account.id).toBe(first.account.id);
    expect(retained.account.workspaceId).toBe(first.account.workspaceId);
    await retainedPage.goto(environment.webOrigin + "/account/security");
    await retainedPage
      .getByRole("button", { name: "Sign out everywhere", exact: true })
      .click();
    await retainedPage
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(
      retainedPage
        .getByRole("status")
        .filter({ hasText: "Signed out of Tholi." }),
    ).toBeVisible();
    expect((await accountResponse(recoveredPage, environment)).status).toBe(
      401,
    );
    checks.push(
      "retained configuration preserves registered users and account links; sign-out everywhere revokes their sessions",
    );
    expect(digest(await artifactFiles(websiteArtifactDirectory()))).toBe(
      buildDigest,
    );
    passed = true;
  } catch (failure) {
    progress.failureLine = sourceFailureLine(failure);
    progress.failureReason =
      failure instanceof WebsiteIdentityError
        ? failure.reason
        : failure instanceof errors.TimeoutError
          ? "TIMEOUT"
          : "OPERATION_FAILED";
    progress.providerFormError = await providerRegistrationError(page).catch(
      () => "PROVIDER_CONTEXT_UNAVAILABLE",
    );
    try {
      const current = await accountResponse(page, environment);
      progress.accountHttpStatus = current.status;
      progress.accountErrorCode = current.errorCode;
    } catch {
      progress.accountErrorCode = "ACCOUNT_DIAGNOSTIC_UNAVAILABLE";
    }
    await saveProgress();
    throw Error(
      `Real website identity verification failed during ${stage}. Sanitized progress: ${JSON.stringify(progress)}`,
    );
  } finally {
    const disposal = await Promise.allSettled(
      contexts.map(closeIdentityContext),
    );
    const disposed = disposal.every((result) => result.status === "fulfilled");
    const evidence = {
      evaluatedAt: new Date().toISOString(),
      passed: passed && disposed,
      browser: browserName,
      version: browser.version(),
      project: environment.project,
      buildDigest,
      stage,
      checks,
      progress,
      cleanupCompleted: disposed,
      fixture: "synthetic local signup",
      publicationAuthorized: false,
    };
    await writeEvidence(
      `output/qa/website-identity/${browserName}.json`,
      evidence,
    );
    await info.attach("website-identity", {
      body: Buffer.from(JSON.stringify(evidence)),
      contentType: "application/json",
    });
    if (passed && !disposed)
      throw Error(
        "Real website identity verification could not complete browser-context cleanup.",
      );
  }
});

for (const scenario of ["data", "finance", "lifecycle"] as const) {
  test(`real account dashboard ${scenario === "data" ? "manages approved saved data and protected selected exports" : scenario === "finance" ? "manages exact allowances and private deep links" : "manages account exports and deletion without cross-account disclosure"}`, async ({
    browser,
    browserName,
  }, info) => {
    const environment = nativeIdentityEnvironment();
    const fixture = syntheticWebsiteIdentity(environment);
    const buildDigest = digest(await artifactFiles(websiteArtifactDirectory()));
    const context = await identityContext(browser);
    const page = await context.newPage();
    const checks: string[] = [];
    let stage = "registration",
      passed = false,
      disposed = false,
      failureReason = "none";
    let failureLine: number | null = null;
    let analyticsRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.origin === environment.serviceOrigin &&
        /\/analytics\/events$/.test(url.pathname) &&
        request.method() === "POST"
      )
        analyticsRequests++;
    });
    try {
      const prepared = await prepareWebsiteDashboardAccount(
        page,
        environment,
        fixture,
        scenario === "data" ? "website" : "api",
        (value) => {
          stage = value;
        },
      );
      const { owner, workspace, records, labels, profile } = prepared;
      checks.push(...prepared.checks);
      if (scenario === "data") {
        stage = "saved data review editing filtering and focus";
        await waitForIdentityGatewayCapacity();
        await page.goto(environment.webOrigin + "/account/data");
        const items = page.getByRole("list", {
          name: "Saved items",
          exact: true,
        });
        await expect(items.locator(":scope > li")).toHaveCount(4);
        for (const label of labels) {
          const opener = page.getByRole("button", {
            name: `View ${label}`,
            exact: true,
          });
          await opener.focus();
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("heading", { name: label, exact: true }),
          ).toBeFocused();
          await page
            .getByRole("button", { name: "Close details", exact: true })
            .click();
          await expect(opener).toBeFocused();
        }
        await page
          .getByRole("button", { name: "View Dashboard route", exact: true })
          .click();
        const details = page.locator(".saved-data-detail");
        await details
          .getByLabel("Label", { exact: true })
          .fill("Dashboard renamed route");
        await details.getByLabel("Folder", { exact: true }).fill("Daily work");
        await details
          .getByRole("textbox", { name: /^Tags\b/ })
          .fill("review, work");
        await details
          .getByRole("button", { name: "Save cloud changes", exact: true })
          .click();
        await expect(
          details.getByRole("heading", {
            name: "Dashboard renamed route",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Close details", exact: true })
          .click();
        await page
          .getByLabel("Search saved data", { exact: true })
          .fill("renamed");
        await page
          .getByRole("button", { name: "Apply filters", exact: true })
          .click();
        await expect(items.locator(":scope > li")).toHaveCount(1);
        await expect(items).toContainText("Dashboard renamed route");
        await waitForIdentityGatewayCapacity();
        await page.getByLabel("Search saved data", { exact: true }).fill("");
        await page
          .getByRole("combobox", { name: /^Type\b/ })
          .selectOption("preferences");
        await page
          .getByRole("button", { name: "Apply filters", exact: true })
          .click();
        await expect(items.locator(":scope > li")).toHaveCount(1);
        await page
          .getByRole("button", {
            name: "View Dashboard appearance",
            exact: true,
          })
          .click();
        await details
          .getByRole("combobox", { name: /^Saved website appearance\b/ })
          .selectOption("light");
        await details
          .getByRole("button", { name: "Save cloud changes", exact: true })
          .click();
        await expect(
          details.getByRole("combobox", {
            name: /^Saved website appearance\b/,
          }),
        ).toHaveValue("light");
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "Your cloud item was saved." }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Close details", exact: true })
          .click();
        const restoredCollection = page.waitForResponse((response) => {
          const target = new URL(response.url());
          return (
            target.origin === environment.serviceOrigin &&
            target.pathname === `${workspace}/artifacts` &&
            !["query", "kind", "folder", "tag", "cursor"].some((key) =>
              target.searchParams.has(key),
            ) &&
            response.request().method() === "GET"
          );
        });
        await page.getByRole("combobox", { name: /^Type\b/ }).selectOption("");
        await page
          .getByRole("button", { name: "Apply filters", exact: true })
          .click();
        const restoredReply = await restoredCollection;
        expect(restoredReply.status()).toBe(200);
        const restored = savedDataPageSchema.parse(await restoredReply.json());
        expect(restored.items.map((item) => item.id).sort()).toEqual(
          records.map((item) => item.id).sort(),
        );
        await expect(items.locator(":scope > li")).toHaveCount(4);
        checks.push(
          "all four real saved types support fresh reads, metadata edits, filters and detail focus return",
        );

        stage = "private selected export download";
        await waitForIdentityGatewayCapacity();
        for (const label of ["Dashboard renamed route", ...labels.slice(1)])
          await page
            .getByRole("checkbox", { name: `Select ${label}`, exact: true })
            .check();
        await page
          .getByRole("button", { name: "Export selected", exact: true })
          .click();
        const downloadButton = page.getByRole("button", {
          name: "Download saved items",
          exact: true,
        });
        await expect
          .poll(
            async () => {
              if (await downloadButton.isVisible()) return true;
              const check = page.getByRole("button", {
                name: "Check saved items status",
                exact: true,
              });
              if (await check.isEnabled()) await check.click();
              return downloadButton.isVisible();
            },
            {
              timeout: 20000,
              intervals: [500, 1000, 2000],
              message:
                "The same private export reaches ready through the real local worker",
            },
          )
          .toBe(true);
        const snapshot = await downloadWebsiteJson(
          page,
          downloadButton,
          "tholi-saved-data.json",
          savedDataExportSnapshotSchema,
          SAVED_DATA_LIMITS.importBytes,
        );
        expect(snapshot.items.map((entry) => entry.id).sort()).toEqual(
          records.map((entry) => entry.id).sort(),
        );
        checks.push(
          "selected export passes actual private signing download validation and leaves no retained test download",
        );

        stage = "cloud deletion confirmation and narrow layout";
        await page.setViewportSize({ width: 320, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page
          .getByRole("button", { name: "View Dashboard excerpt", exact: true })
          .click();
        const deleteButton = details.getByRole("button", {
          name: "Delete cloud item",
          exact: true,
        });
        await deleteButton.focus();
        await page.keyboard.press("Enter");
        const confirmation = page.getByRole("alertdialog");
        await confirmation
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(deleteButton).toBeFocused();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await deleteButton.click();
        await confirmation
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await expect(
          details.getByRole("heading", {
            name: "Deleted cloud item",
            exact: true,
          }),
        ).toBeVisible();
        await expect(items.locator(":scope > li")).toHaveCount(3);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ reducedMotion: "no-preference" });

        checks.push(
          "keyboard-confirmed cloud deletion preserves the other three items and cancellation focus",
        );
      } else {
        stage = "independent lifecycle data preparation";
        const route = records[0];
        if (route.kind !== "saved_route" || !route.data)
          throw Error("DASHBOARD_ROUTE_FIXTURE_INVALID");
        records[0] = await websiteAccountRequest(
          page,
          environment,
          owner,
          `${workspace}/artifacts/${route.id}`,
          savedDataRecordSchema,
          "PATCH",
          {
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: route.revision,
            approved: true,
            artifact: {
              id: route.id,
              schemaVersion: route.schemaVersion,
              kind: route.kind,
              data: route.data,
              metadata: {
                label: "Dashboard renamed route",
                folder: "Daily work",
                tags: ["review", "work"],
              },
            },
          },
        );
        records[2] = await websiteAccountRequest(
          page,
          environment,
          owner,
          `${workspace}/artifacts/${records[2].id}`,
          savedDataRecordSchema,
          "DELETE",
          {
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: records[2].revision,
            approved: true,
          },
        );
        if (scenario === "finance") {
          stage = "exact credit and storage display with deep link refresh";
          await waitForIdentityGatewayCapacity();
          const credits = await websiteAccountRequest(
            page,
            environment,
            owner,
            `${workspace}/credits`,
            workspaceCreditsSchema,
          );
          const storage = await websiteAccountRequest(
            page,
            environment,
            owner,
            `${workspace}/artifacts/usage`,
            savedDataStorageUsageSchema,
          );
          const entitlements = await websiteAccountRequest(
            page,
            environment,
            owner,
            `${workspace}/entitlements`,
            productEntitlementsSchema,
          );
          const caps = entitlements.effective?.caps;
          if (!caps) throw Error("DASHBOARD_ENROLLED_PLAN_MISSING");
          expect(storage.artifacts).toBe("3");
          await page.goto(environment.webOrigin + "/account/credits");
          const definition = (label: string) =>
            page
              .locator("dt")
              .filter({ hasText: new RegExp(`^${label}$`) })
              .locator("xpath=following-sibling::dd[1]");
          const format = (value: string) =>
            page.evaluate(
              (quantity) => new Intl.NumberFormat().format(BigInt(quantity)),
              value,
            );
          await expect(definition("Available")).toHaveText(
            await format(credits.balance.available),
          );
          await expect(definition("Reserved")).toHaveText(
            await format(credits.balance.reserved),
          );
          await expect(definition("Spent")).toHaveText(
            await format(credits.balance.spent),
          );
          await expect(definition("Stored bytes")).toHaveText(
            `${await format(storage.bytes)} of ${await format(caps.maxStoredBytes)}`,
          );
          await expect(definition("Saved items")).toHaveText(
            `${await format(storage.artifacts)} of ${await format(String(caps.maxSavedArtifacts))}`,
          );
          await expect(definition("Requests per period")).toHaveText(
            await format(String(caps.requestsPerPeriod)),
          );
          await expect(definition("Input token limit")).toHaveText(
            await format(String(caps.maxInputTokens)),
          );
          await page
            .getByRole("button", { name: "Load credit history", exact: true })
            .click();
          await expect(
            page.getByRole("table").filter({
              hasText:
                "Grants, settlements and refunds recorded by the service",
            }),
          ).toContainText("Grant");
          await page
            .getByRole("button", { name: "Load usage activity", exact: true })
            .click();
          await expect(
            page.getByText("No processing entries in this page.", {
              exact: true,
            }),
          ).toBeVisible();
          await waitForIdentityGatewayCapacity();
          for (const [path, title, label] of [
            ["/account/data", "Saved data", "Saved data"],
            ["/account/credits", "Credits and usage", "Credits and usage"],
            ["/account/billing", "Plans and billing", "Plans"],
            ["/account/security", "Account and security", "Security"],
            ["/account", "Your Tholi account", "Overview"],
          ]) {
            if (path === "/account/security")
              await waitForIdentityGatewayCapacity();
            await page.getByRole("link", { name: label, exact: true }).click();
            await expect(page).toHaveURL(environment.webOrigin + path);
            await page.reload();
            await expect(
              page.getByRole("heading", { name: title, exact: true }),
            ).toBeVisible();
          }
          checks.push(
            "exact real credit/storage quantities and all private route refreshes remain available without checkout",
          );
        } else {
          stage = "provider account controls and retained full account export";
          await waitForIdentityGatewayCapacity();
          await page.goto(environment.webOrigin + "/account/security");
          const management = page.getByRole("link", {
            name: "Manage profile and security",
            exact: true,
          });
          await expect(management).toHaveAttribute(
            "href",
            profile.provider.managementUrl!,
          );
          const openingManagement = page.waitForEvent("popup");
          await management.click();
          const providerPage = await openingManagement;
          try {
            await providerPage.waitForURL(
              (url) =>
                url.origin === environment.providerOrigin &&
                url.pathname.startsWith("/realms/tholi-local/account"),
            );
            expect(new URL(providerPage.url()).origin).toBe(
              environment.providerOrigin,
            );
          } finally {
            await providerPage.close();
          }
          await page
            .getByRole("button", { name: "Export account data", exact: true })
            .click();
          const exports = page.getByRole("region", {
            name: "Export your account data",
            exact: true,
          });
          await expect(
            exports.getByRole("button", {
              name: "Review export 1",
              exact: true,
            }),
          ).toBeVisible();
          // Server discovery after reload, rather than retaining a component-only job reference.
          await waitForIdentityGatewayCapacity();
          await page.reload();
          await exports
            .getByRole("button", { name: "Review export 1", exact: true })
            .click();
          await expect
            .poll(
              async () => {
                const ready = exports.getByRole("status").filter({
                  hasText:
                    "Export files are available. Review the index to see the exact contents.",
                });
                if (await ready.isVisible()) return true;
                const check = exports.getByRole("button", {
                  name: "Check export status",
                  exact: true,
                });
                if (await check.isEnabled()) await check.click();
                return ready.isVisible();
              },
              {
                timeout: 20000,
                intervals: [500, 1000, 2000],
                message:
                  "The real worker delivers the same discovered account export",
              },
            )
            .toBe(true);
          await waitForIdentityGatewayCapacity();
          await exports
            .getByRole("button", { name: "Show export files", exact: true })
            .click();
          await expect(
            exports.getByText(
              "This index reports the supported export as complete.",
              { exact: true },
            ),
          ).toBeVisible();
          const manifest = await downloadWebsiteJson(
            page,
            exports.getByRole("button", {
              name: "Download account export manifest",
              exact: true,
            }),
            /^tholi-account-manifest-[a-f0-9-]{36}\.json$/,
            accountExportManifestSchema,
            SUPPORT_LIMITS.maxFileBytes,
          );
          expect(manifest.accountId).toBe(owner.account.id);
          expect(manifest.complete).toBe(true);
          expect(manifest.omissions).toEqual([]);
          const savedPart = manifest.parts.find(
            (part) =>
              part.section === "saved_data" &&
              part.workspaceId === owner.account.workspaceId,
          );
          if (!savedPart) throw Error("DASHBOARD_SAVED_EXPORT_PART_MISSING");
          const savedFile = exports
            .locator(".account-export-files > li")
            .filter({
              has: page.getByRole("heading", {
                name: new RegExp(
                  `^Saved items, file ${manifest.parts.indexOf(savedPart) + 1}$`,
                ),
              }),
            });
          const fullSnapshot = await downloadWebsiteJson(
            page,
            savedFile.getByRole("button", {
              name: /^Download Saved items, file /,
            }),
            `tholi-account-part-${savedPart.fileId}.json`,
            accountExportPartSchema,
            SUPPORT_LIMITS.maxFileBytes,
          );
          expect(fullSnapshot.section).toBe("saved_data");
          if (fullSnapshot.section !== "saved_data")
            throw Error("DASHBOARD_SAVED_EXPORT_PART_INVALID");
          expect(fullSnapshot.accountId).toBe(owner.account.id);
          expect(fullSnapshot.generation).toBe(manifest.generation);
          expect(fullSnapshot.items.map((item) => item.id).sort()).toEqual(
            records.map((item) => item.id).sort(),
          );
          expect(
            fullSnapshot.items.find((item) => item.id === records[2].id)
              ?.deletedAt,
          ).not.toBeNull();
          checks.push(
            "provider controls use the configured origin; reload discovers the same real account export and its protected index and typed saved-data part download",
          );

          stage = "real account switching";
          await waitForIdentityGatewayCapacity();
          await page.goto(environment.webOrigin + "/account/security");
          await signOutWebsite(page, environment, true);
          const switched = await signInWebsite(
            page,
            environment,
            environment.username,
            environment.password,
          );
          expect(switched.account.id).not.toBe(owner.account.id);
          await page.goto(environment.webOrigin + "/account/data");
          for (const label of ["Dashboard renamed route", ...labels.slice(1)])
            await expect(
              page.getByRole("button", { name: `View ${label}`, exact: true }),
            ).toHaveCount(0);
          const forbidden = await page.request.get(
            new URL(
              `${workspace}/artifacts/${records[0].id}`,
              environment.serviceOrigin,
            ).href,
            {
              headers: {
                [SERVICE_ACCOUNT_BINDING_HEADER]: switched.account.id,
              },
              failOnStatusCode: false,
            },
          );
          expect(forbidden.status()).toBe(403);
          expect(analyticsRequests).toBe(0);
          checks.push(
            "real sign-out/sign-in account switching removes previous cloud views and denies the former workspace",
          );
          stage = "accepted account deletion and immediate session revocation";
          await waitForIdentityGatewayCapacity();
          await page.goto(environment.webOrigin + "/account/security");
          await signOutWebsite(page, environment, true);
          const deleting = await signInWebsite(
            page,
            environment,
            fixture.username,
            fixture.password,
          );
          expect(deleting.account.id).toBe(owner.account.id);
          await waitForIdentityGatewayCapacity();
          const deletionCapabilities = page.waitForResponse(
            (response) =>
              new URL(response.url()).origin === environment.serviceOrigin &&
              new URL(response.url()).pathname === "/api/v1/capabilities" &&
              response.request().method() === "GET",
          );
          await page.goto(environment.webOrigin + "/account/security");
          const offered = await deletionCapabilities;
          expect(offered.status()).toBe(200);
          expect(
            serviceCapabilitiesSchema.parse(await offered.json()).capabilities,
          ).toContain("account-deletion");
          await page.setViewportSize({ width: 320, height: 900 });
          await page.emulateMedia({ reducedMotion: "reduce" });
          const deleteAccount = page.getByRole("button", {
            name: "Delete account",
            exact: true,
          });
          await expect(deleteAccount).toBeDisabled();
          await page
            .getByLabel("Type DELETE to confirm", { exact: true })
            .fill("DELETE");
          await expect(deleteAccount).toBeEnabled();
          await deleteAccount.focus();
          await page.keyboard.press("Enter");
          const deletion = page.getByRole("alertdialog", {
            name: "Request account deletion?",
            exact: true,
          });
          await deletion
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          await expect(deleteAccount).toBeFocused();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
          await deleteAccount.click();
          const deletionResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).origin === environment.serviceOrigin &&
              new URL(response.url()).pathname === "/api/v1/account/deletion",
          );
          await deletion
            .getByRole("button", {
              name: "Request account deletion",
              exact: true,
            })
            .click();
          const accepted = await deletionResponse;
          expect(accepted.status()).toBe(200);
          const receipt = accountDeletionResultSchema.parse(
            await accepted.json(),
          );
          expect(receipt.status).toBe("deletion_pending");
          expect(receipt.signedOut).toBe(true);
          await expect(
            page.getByRole("status").filter({
              hasText:
                "Your account deletion request was accepted. You are signed out while deletion continues.",
            }),
          ).toBeVisible();
          expect((await accountResponse(page, environment)).status).toBe(401);
          await expect(
            page.getByText("Local extension data remains on your device.", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("navigation", {
              name: "Account sections",
              exact: true,
            }),
          ).toHaveCount(0);
          checks.push(
            "keyboard deletion confirmation preserves cancellation focus; the actual pending receipt signs out and revokes access without claiming physical cleanup finished",
          );
        }
      }
      expect(analyticsRequests).toBe(0);
      expect(digest(await artifactFiles(websiteArtifactDirectory()))).toBe(
        buildDigest,
      );
      passed = true;
    } catch (error) {
      failureReason =
        error instanceof WebsiteIdentityError
          ? error.reason
          : error instanceof errors.TimeoutError
            ? "TIMEOUT"
            : error instanceof Error &&
                /^DASHBOARD_[A-Z_0-9]+$/.test(error.message)
              ? error.message
              : "OPERATION_FAILED";
      failureLine = sourceFailureLine(error);
      throw Error(
        `Dashboard verification failed during ${stage}: ${failureReason}${failureLine ? ` at line ${failureLine}` : ""}`,
      );
    } finally {
      const disposal = await Promise.allSettled([
        closeIdentityContext(context),
      ]);
      disposed = disposal.every((item) => item.status === "fulfilled");
      const evidence = {
        evaluatedAt: new Date().toISOString(),
        passed: passed && disposed,
        browser: browserName,
        version: browser.version(),
        buildDigest,
        stage,
        failureReason,
        failureLine,
        checks,
        cleanupCompleted: disposed,
        fixture: "real synthetic local identity and approved data",
        publicationAuthorized: false,
      };
      await writeEvidence(
        `output/qa/website-identity/${browserName}-dashboard-${scenario}.json`,
        evidence,
      );
      await info.attach(`website-dashboard-${scenario}`, {
        body: Buffer.from(JSON.stringify(evidence)),
        contentType: "application/json",
      });
      if (passed && !disposed) throw Error("DASHBOARD_CONTEXT_CLEANUP_FAILED");
    }
  });
}
