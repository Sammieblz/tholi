import { test, expect } from "../../support/browser-test";
import { By } from "selenium-webdriver";
import { openBrandedExtension } from "../../support/branded-extension";
import {
  openFirefoxExtension,
  grantFirefoxFixturePermissions,
} from "../../support/firefox-extension";
import type firefox from "selenium-webdriver/firefox.js";
import backendDataPermissions from "../../../config/backend-data-permissions.json" with { type: "json" };
import { acceptanceServer } from "../../support/fixture-server";
import { waitForIdentityGatewayCapacity } from "../../support/identity-gateway";
import { buildProvenance } from "../../support/build-provenance";
import { unchangedBuild, writeEvidence } from "../../support/evidence";
import {
  accountControl,
  cancelNativeSignIn,
  completeNativeSignIn,
  configureNativeAccount,
  nativeIdentityEnvironment,
  nativeTokenIsolation,
  openAccountSettings,
  registerNativeCallback,
  restartNativeBackground,
} from "../../support/webdriver-auth";
import { serviceAuthStatusSchema } from "../../../apps/extension/src/platform/service-auth-contract";
import {
  openWelcomeSetup,
  verifyFreshWelcomeSetup,
  welcomeTabCount,
} from "../../support/webdriver-welcome";

for (const browser of ["chrome", "firefox"] as const)
  test(`${browser} uses native local OIDC with private sessions and preserves local guidance`, async ({}, info) => {
    const environment = nativeIdentityEnvironment();
    const target = browser === "firefox" ? "firefox" : "chromium";
    const provenance = await buildProvenance(target);
    const fixture = await acceptanceServer();
    let app: Awaited<ReturnType<typeof openBrandedExtension>> | undefined;
    let passed = false;
    const checks: string[] = [];
    const permissionCheck =
      browser === "firefox"
        ? "Firefox initially ungranted authenticationInfo notification clicked"
        : "Chrome existing declared loopback host access; no new permission prompt";
    try {
      app =
        browser === "firefox"
          ? await openFirefoxExtension(fixture.url)
          : await openBrandedExtension("chrome", fixture.url);
      await verifyFreshWelcomeSetup(app);
      checks.push(
        "fresh installation opens the shared introduction; local completion enables no transmission",
      );
      await app.start();
      await app.goal("Show search");
      await app.message({ type: "PAUSE" });
      await app.message({
        type: "UI_SAVE",
        draft: "Retain this local navigation draft",
      });
      const journey = await app.message({ type: "GET_SESSION" });
      const memory = (await app.message({ type: "GET_MEMORY" })).memory.pages
        .length;
      await waitForIdentityGatewayCapacity();
      await registerNativeCallback(app, target, environment);
      await configureNativeAccount(app, target, environment);
      checks.push(permissionCheck);
      await cancelNativeSignIn(app, environment);
      checks.push("native popup cancellation creates no session");
      const welcome = await openWelcomeSetup(app);
      if (!welcome) throw Error("The packaged welcome tab is missing.");
      const welcomeRpc = async (command: unknown) => {
        const result = await app!.message(command);
        await app!.driver.switchTo().window(welcome);
        return result;
      };
      await app.driver.navigate().refresh();
      await (await accountControl(app, "Review introduction")).click();
      for (let step = 2; step <= 3; step++)
        await (await accountControl(app, "Next")).click();
      await cancelNativeSignIn(app, environment, {
        handle: welcome,
        signup: true,
      });
      checks.push(
        "welcome sign-up opens the real provider registration form; cancellation creates no native session",
      );
      await app.driver.switchTo().window(welcome);
      await app.driver.navigate().refresh();
      await (await accountControl(app, "Review guidance options")).click();
      await (await accountControl(app, "Choose Free Cloud")).click();
      expect(await welcomeRpc({ type: "SETUP_STATUS" })).toMatchObject({
        complete: false,
        planIntent: { mode: "free-cloud" },
      });
      const signedIn = await completeNativeSignIn(app, environment, welcome);
      await app.driver.switchTo().window(welcome);
      const currentApp = app;
      await app.driver.wait(
        async () =>
          (await currentApp.driver.findElements(By.css(".welcome-plan-review")))
            .length > 0,
        15_000,
      );
      expect(await welcomeRpc({ type: "AUTH_INFERENCE_STATUS" })).toMatchObject(
        { enabled: false, images: false },
      );
      expect(
        await app.driver
          .findElement(
            By.xpath(
              '//button[normalize-space(.)="Confirm Free Cloud development"]',
            ),
          )
          .isEnabled(),
      ).toBe(false);
      if (browser === "firefox") {
        expect(
          await grantFirefoxFixturePermissions(app.driver as firefox.Driver, {
            data_collection: backendDataPermissions,
          }),
        ).toBe(true);
        checks.push(
          "backend data categories pregranted for fake transport; native data-consent prompt remains pending",
        );
        await app.driver.switchTo().window(welcome);
      }
      await app.driver
        .findElement(By.css('.welcome-consent input[type="checkbox"]'))
        .click();
      await waitForIdentityGatewayCapacity();
      await (
        await accountControl(app, "Confirm Free Cloud development")
      ).click();
      await app.driver.wait(
        async () => {
          return (
            (
              await currentApp.driver.findElements(
                By.css(".welcome-complete:not(.welcome-plan-review)"),
              )
            ).length > 0
          );
        },
        15_000,
        "Verified Free enrollment and explicit consent complete setup",
      );
      expect(await welcomeRpc({ type: "SETUP_STATUS" })).toMatchObject({
        complete: true,
        choice: "account",
        planIntent: { mode: "free-cloud" },
      });
      expect(await welcomeRpc({ type: "AUTH_INFERENCE_STATUS" })).toMatchObject(
        { enabled: true, images: false, profile: "fake" },
      );
      checks.push(
        "native plan intent survives real PKCE sign-in; verified PostgreSQL Free allowance and separate context consent complete setup without checkout or uploads",
      );
      await (await accountControl(app, "Review guidance options")).click();
      const catalog = await welcomeRpc({ type: "SETUP_PLANS" });
      const paid = catalog.catalog.plans.find(
        (plan: { mode: string }) => plan.mode === "paid",
      );
      expect(paid).toBeTruthy();
      await (await accountControl(app, `Review ${paid.name}`)).click();
      await app.driver.wait(
        async () =>
          (await currentApp.driver.findElements(By.css(".welcome-plan-review")))
            .length > 0,
        10_000,
        "Paid plan review appears after the saved choice is acknowledged",
      );
      expect(await welcomeRpc({ type: "SETUP_STATUS" })).toMatchObject({
        complete: false,
        planIntent: {
          mode: "paid",
          planId: paid.id,
          planVersion: paid.version,
        },
      });
      expect(
        await app.driver.findElements(
          By.css(
            'input[autocomplete="cc-number"], input[autocomplete="cc-csc"], .welcome-consent',
          ),
        ),
      ).toHaveLength(0);
      expect(await welcomeRpc({ type: "AUTH_INFERENCE_STATUS" })).toMatchObject(
        { enabled: false, images: false },
      );
      checks.push(
        "paid intent retains the server catalog ID/version with checkout and processing disabled; explicit Local fallback completes without data loss",
      );
      await (await accountControl(app, "Use Tholi locally")).click();
      await app.driver.wait(
        async () =>
          (
            await currentApp.driver.findElements(
              By.css(".welcome-complete:not(.welcome-plan-review)"),
            )
          ).length > 0,
        10_000,
        "Local completion is acknowledged",
      );
      expect(await welcomeRpc({ type: "SETUP_STATUS" })).toMatchObject({
        complete: true,
        choice: "local",
        planIntent: { mode: "local" },
      });
      expect(
        await app.message({ type: "AUTH_INFERENCE_STATUS" }),
      ).toMatchObject({ enabled: false, images: false });
      await waitForIdentityGatewayCapacity();
      await openAccountSettings(app);
      expect(signedIn.account).toBeDefined();
      expect(signedIn.session?.clientKind).toBe("extension");
      expect(Object.keys(signedIn).sort()).toEqual([
        "account",
        "configured",
        "origin",
        "session",
      ]);
      checks.push("native PKCE broker sign-in exposes account metadata only");
      expect(await nativeTokenIsolation(app)).toEqual({
        privateAuthExposed: false,
        accountRpcDenied: true,
        privateDatabaseExposed: false,
      });
      checks.push("content cannot read account credentials or use account RPC");
      expect(
        serviceAuthStatusSchema.parse(
          await app.message({ type: "AUTH_STATUS" }),
        ).account?.id,
      ).toBe(signedIn.account?.id);
      await app.focusPanel();
      await (await accountControl(app, "Renew session")).click();
      const driver = app.driver;
      await app.waitFor(
        () =>
          driver
            .findElement(By.css('.tholi-account-settings > [role="status"]'))
            .getText(),
        (text) => text === "Your session was renewed.",
        "Native session renewal completes",
      );
      expect(
        serviceAuthStatusSchema.parse(
          await app.message({ type: "AUTH_STATUS" }),
        ).session?.id,
      ).toBe(signedIn.session?.id);
      checks.push("refresh preserves the current session");
      const welcomeCount = await welcomeTabCount(app);
      await restartNativeBackground(app, target);
      expect(await welcomeTabCount(app)).toBe(welcomeCount);
      expect(
        serviceAuthStatusSchema.parse(
          await app.message({ type: "AUTH_STATUS" }),
        ).account?.id,
      ).toBe(signedIn.account?.id);
      checks.push(
        "native background restart retains protected account credentials",
      );
      await (await accountControl(app, "Review sessions")).click();
      const current = await app.driver.wait(
        async () => {
          for (const item of await app!.driver.findElements(
            By.css(".tholi-account-settings li"),
          ))
            if ((await item.getText()).includes("This session")) return item;
          return false;
        },
        10_000,
        "The actual current Tholi session appears in native settings",
      );
      if (!current) throw Error("The current account session is missing.");
      await current
        .findElement(By.xpath('.//button[normalize-space(.)="Revoke session"]'))
        .click();
      await app.driver
        .findElement(
          By.xpath(
            '//div[contains(@class,"tholi-confirm-dialog")]//button[normalize-space(.)="Revoke session"]',
          ),
        )
        .click();
      await app.waitFor(
        () => app!.message({ type: "AUTH_STATUS" }),
        (raw) => serviceAuthStatusSchema.safeParse(raw).success && !raw.account,
        "Revoking the current native session clears account access",
      );
      checks.push("session revocation clears current private credentials");
      await openAccountSettings(app);
      await completeNativeSignIn(app, environment);
      await (await accountControl(app, "Sign out")).click();
      await app.waitFor(
        () => app!.message({ type: "AUTH_STATUS" }),
        (raw) => serviceAuthStatusSchema.safeParse(raw).success && !raw.account,
        "Native sign-out clears account access",
      );
      checks.push("explicit logout clears the account session");
      const retained = await app.message({ type: "GET_SESSION" });
      expect(retained.sessionId).toBe(journey.sessionId);
      expect(retained.documentId).toBe(journey.documentId);
      expect(retained.view.status).toBe("paused");
      expect((await app.message({ type: "UI_GET" })).draft).toBe(
        "Retain this local navigation draft",
      );
      // The test panel is an extension tab. Read the website's memory with that
      // website active, as it is when using the actual browser sidebar.
      await app.driver.switchTo().window(app.website);
      expect(
        (await app.message({ type: "GET_MEMORY" })).memory.pages.length,
      ).toBe(memory);
      checks.push(
        "local journey draft and saved knowledge survive account lifecycle",
      );
      expect(await unchangedBuild(provenance)).toBe(true);
      passed = true;
    } finally {
      const version = app?.version;
      let disposed = false;
      try {
        await app?.close();
        disposed = true;
      } finally {
        await fixture.close();
        const evidence = {
          ...provenance,
          evaluatedAt: new Date().toISOString(),
          passed: passed && disposed,
          browser,
          nativeWindowMode: "headless disposable browser",
          version,
          project: environment.project,
          checks,
          signedInProvider: "local synthetic OIDC",
          nativePermissions: checks.includes(permissionCheck)
            ? permissionCheck
            : "not completed",
          installTimeConsent: "not exercised by unpacked installation",
          publicationAuthorized: false,
        };
        await writeEvidence(
          `output/qa/native-identity/${browser}.json`,
          evidence,
        );
        await info.attach("native-identity", {
          body: Buffer.from(JSON.stringify(evidence)),
          contentType: "application/json",
        });
      }
    }
  });
