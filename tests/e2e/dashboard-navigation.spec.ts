import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";

for (const platform of ["cloudflare", "github"] as const) {
  test(`${platform}: account settings survives an unmounted menu without substituting product settings`, async ({}, info) => {
    const base =
      platform === "cloudflare"
        ? "https://dash.cloudflare.com"
        : "https://github.com";
    const app = await openNavigatorExtension(
      info.project.use.viewport || undefined,
      [base + "/*"],
      false,
    );
    const label = platform === "cloudflare" ? "Manage account" : "User menu";
    const destinationLabel =
      platform === "cloudflare" ? "Account settings" : "Settings";
    const opener =
      platform === "cloudflare"
        ? `<nav aria-label="Account navigation" style="height:180px;overflow:auto"><a href="/product">Workers &amp; Pages</a><div style="height:650px"></div><button type="button" aria-expanded="false" aria-controls="account-menu">${label}</button></nav>`
        : '<header><button type="button" aria-haspopup="menu"><svg role="img" aria-label="User menu"></svg></button></header>';
    try {
      await app.context.route(base + "/**", (route) => {
        const final =
          new URL(route.request().url()).pathname === "/account-preferences";
        return route.fulfill({
          contentType: "text/html",
          body: `<html lang="en"><body>${
            final
              ? "<main><h1>Account settings</h1><p>Manage your account preferences</p></main>"
              : `${opener}<main><h1>Applications dashboard</h1><nav aria-label="Repository"><a href="/product-preferences">${platform === "github" ? "Settings" : "Worker settings"}</a></nav></main><script>document.querySelector('button').onclick=()=>{const menu=document.createElement('div');menu.id='account-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','User navigation');menu.innerHTML='<a href="/account-preferences">${destinationLabel}</a><a href="/repo-preferences">Repository settings</a>';document.body.append(menu);${platform === "cloudflare" ? "document.querySelector('button').setAttribute('aria-expanded','true')" : ""}}</script>`
          }</body></html>`,
        });
      });
      await app.page.goto(base + "/dashboard");
      await app.page.bringToFront();
      await expect(app.panel.getByLabel("Navigation goal")).toBeVisible();
      await app.panel.getByLabel("Navigation goal").fill("Account settings");
      await app.page.bringToFront();
      await app.panel
        .getByRole("button", { name: "Guide me", exact: true })
        .evaluate((e) => (e as HTMLButtonElement).click());
      await expect
        .poll(
          async () => {
            const v = await app.view();
            return v?.controls?.find(
              (c: { id: string }) => c.id === v.selectedControlId,
            )?.label;
          },
          { timeout: 20000 },
        )
        .toBe(label);
      const before = await app.view(),
        id = before.request.id;
      expect(before.goalPlan.exploration).toBe(true);
      expect(before.request.original).toBe("Account settings");
      await expect(
        app.panel.getByRole("status", { name: "Navigation status" }),
      ).toContainText("Account settings");
      const widths = await app.panel
        .getByLabel("Navigation goal")
        .evaluate((e) => ({
          field: e.getBoundingClientRect().width,
          container: e.closest("form")!.getBoundingClientRect().width,
        }));
      expect(widths.field).toBeGreaterThan(widths.container * 0.95);
      await app.page.getByRole("button", { name: label, exact: true }).click();
      await expect
        .poll(
          async () => {
            const v = await app.view();
            return v?.controls?.find(
              (c: { id: string }) => c.id === v.selectedControlId,
            )?.label;
          },
          { timeout: 20000 },
        )
        .toBe(destinationLabel);
      const opened = await app.view();
      expect(opened.request.id).toBe(id);
      expect(opened.request.tasks[0].status).not.toBe("completed");
      expect(opened.goalPlan.exploration).not.toBe(true);
      await app.page
        .getByRole("link", { name: destinationLabel, exact: true })
        .and(app.page.locator("#account-menu a"))
        .click();
      await expect(
        app.page.getByRole("heading", {
          name: "Account settings",
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(async () => (await app.view())?.request?.status, {
          timeout: 20000,
        })
        .toBe("completed");
      expect((await app.view()).request.id).toBe(id);
    } finally {
      await app.close();
    }
  });
}
