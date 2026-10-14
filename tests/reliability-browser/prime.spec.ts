import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
test("one Prime request survives login, delayed 2FA, documents, menus and cancellation review", async () => {
  const app = await openNavigatorExtension(
    undefined,
    ["https://www.amazon.com/*"],
    false,
  );
  const base = "https://www.amazon.com";
  const pages: Record<string, string> = {
    "/": '<main><h1>Your account</h1><a href="/login">Account &amp; Lists</a></main>',
    "/login":
      '<main><form action="/otp"><h1>Sign in</h1><input type="password" autocomplete="current-password"><button type="submit">Sign in</button></form></main>',
    "/otp":
      '<main><form action="/account"><h1>Two-step verification</h1><input autocomplete="one-time-code"><button type="submit">Verify</button></form></main>',
    "/account":
      '<main><h1>Your Account</h1><a href="/prime">Prime membership</a></main>',
    "/prime":
      '<main><h1>Prime membership</h1><button aria-haspopup="menu" onpointerenter="document.getElementById(\'membership-popup\').hidden=false">Manage membership</button></main><div role="menu" id="membership-popup" hidden><a href="/retention">End membership</a></div>',
    "/retention":
      '<main><h1>Prime membership</h1><a href="/confirm">Continue to cancel</a><button>Keep my membership</button></main>',
    "/confirm":
      '<main><h1>Prime membership</h1><a href="/result">Confirm cancellation</a></main>',
    "/result":
      "<main><h1>Prime membership</h1><p>Your Prime membership will end on your renewal date.</p></main>",
  };
  try {
    await app.context.route(base + "/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body:
          '<!doctype html><html lang="en"><body>' +
          (pages[new URL(route.request().url()).pathname] || pages["/"]) +
          "</body></html>",
      }),
    );
    await app.page.goto(base + "/");
    await app.page.bringToFront();
    await expect(app.panel.getByLabel("Navigation goal")).toBeVisible();
    await app.panel
      .getByLabel("Navigation goal")
      .fill("Help me cancel my Amazon Prime subscription");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Guide me" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(
        async () => {
          const v = await app.view();
          if (v?.request && !v.selectedControlId && v.goalPlan)
            throw Error(
              JSON.stringify({
                instruction: v.instruction,
                plan: v.goalPlan,
                workflow: v.journey?.workflow,
                controls: v.page?.controls,
              }),
            );
          return v?.request;
        },
        { timeout: 20000 },
      )
      .toBeTruthy();
    await expect
      .poll(
        async () => {
          const alerts = await app.panel.getByRole("alert").allTextContents();
          if (alerts.length) throw Error(alerts.join(" "));
          return (await app.view())?.selectedControlId;
        },
        { timeout: 20000 },
      )
      .toBeTruthy();
    const id = (await app.view()).request.id;
    await app.page.getByRole("link", { name: "Account & Lists" }).click();
    await expect
      .poll(async () => (await app.view())?.page?.screen?.kind)
      .toBe("credentials");
    await app.page.getByRole("button", { name: "Sign in" }).click();
    await expect
      .poll(async () => (await app.view())?.page?.screen?.kind)
      .toBe("two-factor");
    await app.page.clock.install();
    await app.page.clock.fastForward(180000);
    expect((await app.view()).request.id).toBe(id);
    expect((await app.view()).request.status).not.toBe("completed");
    await app.page
      .locator('input[autocomplete="one-time-code"]')
      .fill("731942");
    expect(JSON.stringify(await app.view())).not.toContain("731942");
    await app.page.getByRole("button", { name: "Verify", exact: true }).click();
    const next = async (label: string) => {
      try {
        await expect
          .poll(
            async () => {
              const v = await app.view();
              return v?.page?.controls.find(
                (c: any) => c.id === v.selectedControlId,
              )?.label;
            },
            { timeout: 15000 },
          )
          .toBe(label);
      } catch {
        const v = await app.view();
        throw Error(
          JSON.stringify({
            expected: label,
            status: v?.status,
            instruction: v?.instruction,
            workflow: v?.journey?.workflow,
            plan: v?.goalPlan,
            controls: v?.page?.controls,
          }),
        );
      }
      expect((await app.view()).request.id).toBe(id);
    };
    await next("Prime membership");
    await app.page
      .getByRole("link", { name: "Prime membership", exact: true })
      .click();
    await next("Manage membership");
    await app.page.getByRole("button", { name: "Manage membership" }).hover();
    await next("End membership");
    await app.page.getByRole("link", { name: "End membership" }).click();
    await next("Continue to cancel");
    await app.page.getByRole("link", { name: "Continue to cancel" }).click();
    await next("Confirm cancellation");
    await app.page.getByRole("link", { name: "Confirm cancellation" }).click();
    await expect
      .poll(async () => (await app.view())?.request?.status, { timeout: 30000 })
      .toBe("completed");
    expect((await app.view()).request.id).toBe(id);
    await expect(
      app.panel.getByRole("button", {
        name: /I performed|check this page|Try visual assistance/i,
      }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
