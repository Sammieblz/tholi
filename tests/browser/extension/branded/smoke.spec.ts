import { test, expect } from "../../../support/browser-test";
import { openBrandedExtension } from "../../../support/branded-extension";
import { verifyWebDriverSurfaces } from "../../../support/webdriver-surfaces";
import { acceptanceServer } from "../../../support/fixture-server";
for (const browser of ["chrome", "edge", "brave"] as const)
  test(
    browser +
      " loads the built Chromium target and verifies a website interaction",
    async ({}, info) => {
      const fixture = await acceptanceServer();
      let app: Awaited<ReturnType<typeof openBrandedExtension>> | undefined;
      try {
        app = await openBrandedExtension(browser, fixture.url);
        const current = app;
        await info.attach("browser-runtime", {
          body: Buffer.from(
            JSON.stringify({
              name: browser,
              version: app.version,
              target: "chromium",
            }),
          ),
          contentType: "application/json",
        });
        expect((await app.start()).documentId).toBeTruthy();
        const goal = await app.goal("Show search");
        expect(goal.view.goalPlan.status).toBe("guiding");
        expect(
          goal.view.page.controls.find(
            (control: any) => control.id === goal.view.selectedControlId,
          )?.label,
        ).toBe("Search catalogue");
        await app.site(() => document.title);
        await app.driver.findElement({ css: 'input[type="search"]' }).click();
        await app.waitFor(
          () => current.view(),
          (view) => view.goalPlan?.status === "completed",
          "The actual browser focus must be verified",
        );
        expect(
          await app.site(() => document.activeElement?.getAttribute("type")),
        ).toBe("search");
        const surfaces = await verifyWebDriverSurfaces(app, "chromium");
        await info.attach("native-surfaces", {
          body: Buffer.from(JSON.stringify(surfaces)),
          contentType: "application/json",
        });
      } finally {
        await app?.close();
        await fixture.close();
      }
    },
  );
