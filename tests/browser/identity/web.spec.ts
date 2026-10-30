import { test, expect, errors } from "../../support/browser-test";
import { artifactFiles } from "../../../scripts/artifact-files.mjs";
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
  WebsiteIdentityError,
} from "../../support/website-auth";
import type { BrowserContext } from "@playwright/test";
import { productAnalyticsRecordSchema } from "../../../packages/navigation-core/contracts-analytics";

test("configured website uses real signup email recovery and retained identity without requiring accounts for Local", async ({
  browser,
  browserName,
}, info) => {
  const environment = nativeIdentityEnvironment();
  const fixture = syntheticWebsiteIdentity(environment);
  const buildDigest = digest(await artifactFiles("dist/web"));
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
    let localAccountRequests = 0;
    let productRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
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
    progress.operation = "read prior verification mail";
    const beforeVerification = await capturedMessageIds(
      environment,
      fixture.email,
    );
    progress.operation = "open website signup";
    await page.goto(environment.webOrigin + "/signup");
    progress.operation = "follow real provider signup link";
    await page
      .getByRole("link", { name: "Continue to sign up", exact: true })
      .click();
    progress.operation = "wait for configured provider registration";
    await page.waitForURL((url) => url.origin === environment.providerOrigin);
    await expect(page.locator("#kc-register-form")).toBeVisible();
    progress.registrationFormObserved = true;
    await saveProgress();
    for (const [id, value] of Object.entries({
      username: fixture.username,
      email: fixture.email,
      firstName: "Local",
      lastName: "Verification",
    })) {
      progress.operation = `fill registration field ${id}`;
      await page.locator(`[id="${id}"]`).fill(value);
    }
    progress.registrationFieldsFilled = true;
    progress.operation = "submit real registration form";
    await saveProgress();
    await page.locator('#kc-register-form input[type="submit"]').click();
    progress.registrationSubmitted = true;
    progress.providerFormError = await providerRegistrationError(page);
    if (progress.providerFormError !== "none")
      throw new WebsiteIdentityError("PROVIDER_FORM_REJECTED");
    progress.operation =
      "verify account remains unavailable before email approval";
    const pendingAccount = await accountResponse(page, environment);
    progress.accountHttpStatus = pendingAccount.status;
    progress.accountErrorCode = pendingAccount.errorCode;
    expect(pendingAccount.status).toBe(401);
    progress.operation = "wait for captured verification email";
    await saveProgress();
    const verification = await localEmailAction(
      environment,
      fixture.email,
      beforeVerification,
    );
    progress.verificationEmailFound = true;
    progress.operation = "follow approved real verification action";
    await saveProgress();
    await page.goto(verification);
    progress.verificationActionFollowed = true;
    progress.operation = "set the initial password after verified email";
    await expect(page.locator("#kc-passwd-update-form")).toBeVisible();
    progress.passwordSetupObserved = true;
    await saveProgress();
    await setWebsitePassword(page, fixture.password);
    progress.passwordSetupCompleted = true;
    progress.operation = "wait for real website account callback";
    await saveProgress();
    const first = await waitForWebsiteAccount(page, environment);
    progress.accountHttpStatus = 200;
    progress.accountErrorCode = "none";
    await saveProgress();
    checks.push(
      "real registration requires email verification before creating account access",
    );
    stage = "real optional account analytics choices collection and withdrawal";
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
    await accountPermission.check();
    await expect(measurements).toContainText("Account permission saved.");
    expect(productRequests).toBe(0);
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
    await checkAccountLayout(page);
    checks.push(
      "real account and retained measurements fit four widths in both themes with visible keyboard focus and reduced motion",
    );
    stage = "real optional account analytics withdrawal";
    await page
      .getByRole("button", { name: "Cookie settings", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Cookie settings", exact: true })
      .getByRole("button", { name: "Essential only", exact: true })
      .click();
    await expect(browserPermission).not.toBeChecked();
    await expect(accountPermission).toBeChecked();
    const beforePublic = productRequests;
    await page.goto(environment.webOrigin + "/onboarding");
    await page
      .getByRole("button", { name: "Skip onboarding", exact: true })
      .click();
    await expect(page).toHaveURL(environment.webOrigin + "/download");
    expect(productRequests).toBe(beforePublic);
    await page.goto(environment.webOrigin + "/account");
    await waitForWebsiteAccount(page, environment);
    await expect(accountPermission).toBeChecked();
    await expect(browserPermission).not.toBeChecked();
    await accountPermission.uncheck();
    await expect(measurements).toContainText(
      "Account permission withdrawn and retained product measurements removed.",
    );
    await measurements
      .getByRole("button", {
        name: "Review retained measurements",
        exact: true,
      })
      .click();
    await expect(exported).toHaveText("[]");
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
    stage = "callback cookie binding and session credential protection";
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
    await page.reload();
    await waitForWebsiteAccount(page, environment);
    const other = page
      .locator(".account-sessions > li")
      .filter({ hasNotText: "This session" });
    await expect(other).toHaveCount(1);
    await other
      .getByRole("button", { name: "Revoke web session", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "The Tholi session was revoked." }),
    ).toBeVisible();
    expect((await accountResponse(secondPage, environment)).status).toBe(401);
    await secondPage.reload();
    await expect(
      secondPage
        .locator(".account-security")
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    checks.push(
      "real refresh retains the session and a revoked second browser loses account access",
    );
    stage = "explicit Tholi and identity-provider sign-out";
    await signOutWebsite(page, environment, true);
    checks.push(
      "Tholi logout and explicitly confirmed provider logout complete separately",
    );
    stage = "real password recovery email and password update";
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
        .filter({ hasText: "All Tholi sessions were signed out." }),
    ).toBeVisible();
    expect((await accountResponse(recoveredPage, environment)).status).toBe(
      401,
    );
    checks.push(
      "retained configuration preserves registered users and account links; sign-out everywhere revokes their sessions",
    );
    expect(digest(await artifactFiles("dist/web"))).toBe(buildDigest);
    passed = true;
  } catch (failure) {
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
