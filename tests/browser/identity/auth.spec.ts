import { test, expect } from "../../support/browser-test";
import { By } from "selenium-webdriver";
import { openBrandedExtension } from "../../support/branded-extension";
import { openFirefoxExtension } from "../../support/firefox-extension";
import { acceptanceServer } from "../../support/fixture-server";
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
      await registerNativeCallback(app, target, environment);
      await configureNativeAccount(app, target, environment);
      checks.push(permissionCheck);
      await cancelNativeSignIn(app, environment);
      checks.push("native popup cancellation creates no session");
      const signedIn = await completeNativeSignIn(app, environment);
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
      await (await accountControl(app, "Renew session")).click();
      const driver = app.driver;
      await app.waitFor(
        () =>
          driver
            .findElement(By.css('.tholi-account-settings [role="status"]'))
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
      await restartNativeBackground(app, target);
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
