import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { setGoal } from "../support/acceptance-runner";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
type App = Awaited<ReturnType<typeof openNavigatorExtension>>;
async function next(app: App, label: string) {
  try {
    await expect
      .poll(async () => {
        const v = await app.view();
        return v.page?.controls.find((c: any) => c.id === v.selectedControlId)
          ?.label;
      })
      .toBe(label);
  } catch (error) {
    const v = await app.view();
    throw new Error(
      String(error) +
        "\n" +
        JSON.stringify({
          status: v.status,
          instruction: v.instruction,
          plan: v.goalPlan,
          journey: v.journey,
          controls: v.page?.controls.map((c: any) => ({
            label: c.label,
            kind: c.kind,
            form: c.form,
          })),
        }),
    );
  }
}
test("retains create-account context through a dynamic account menu, a new document and form fields", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/auth/**", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: r.request().url().endsWith("/enrol")
          ? '<main><h1>Create account</h1><form method="post"><label>Username<input></label><label>Password<input type="password" autocomplete="new-password"></label><label>Email (optional)<input type="email"></label><button>Create your account</button></form></main>'
          : `<button aria-expanded="false" aria-controls="account-menu">Account</button><div id="account-menu" hidden></div><script>document.querySelector('button').onclick=function(){this.setAttribute('aria-expanded','true');const menu=document.querySelector('#account-menu');menu.hidden=false;menu.innerHTML='<a href="/auth/enrol">Sign up</a>';}</script>`,
      }),
    );
    await app.page.goto("http://localhost:5173/auth/start");
    await app.start();
    const initial = await setGoal(app, "create account");
    await next(app, "Account");
    await app.page
      .getByRole("button", { name: "Account", exact: true })
      .click();
    await next(app, "Sign up");
    await app.page.getByRole("link", { name: "Sign up", exact: true }).click();
    await next(app, "Username");
    const arrival = await app.view();
    expect(arrival.journey).toMatchObject({
      id: initial.view.journey.id,
      goal: "create account",
      status: "active",
      objective: { workflow: "register" },
    });
    expect(arrival.journey.progress).toHaveLength(2);
    expect(arrival.goalPlan.status).toBe("guiding");
    await app.page
      .getByRole("textbox", { name: "Username", exact: true })
      .fill("USER_VALUE_SENTINEL");
    await next(app, "Email (optional)");
    await app.page
      .getByRole("textbox", { name: "Email (optional)", exact: true })
      .focus();
    await expect
      .poll(async () => (await app.view()).goalPlan?.issue)
      .toBe("consequential");
    const final = await app.view();
    expect(final.journey.status).toBe("active");
    expect(final.selectedControlId).toBeUndefined();
    expect(final.journey.progress).toHaveLength(4);
    expect(JSON.stringify(final)).not.toContain("USER_VALUE_SENTINEL");
    await expect(
      app.panel.getByRole("region", { name: "Task journey" }),
    ).toContainText("Complete private credentials");
    await expect(app.panel.getByLabel("Route estimate")).toContainText(
      "unavailable",
    );
    expect(app.page.url()).toContain("/auth/enrol");
    await app.panel.screenshot({
      path: `output/qa/authentication-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});
test("retains a plain login goal through an expected cross-origin popup", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://127.0.0.1:5173/auth-popup", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<a target="_blank" href="http://localhost:5173/auth-login">Log in</a>',
      }),
    );
    await app.context.route("http://localhost:5173/auth-login", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<main><h1>Log in</h1><form method="post"><label>Username<input></label><input type="password" autocomplete="current-password"><button>Log in</button></form></main>',
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/auth-popup");
    await app.start();
    const initial = await setGoal(app, "How to log in");
    await next(app, "Log in");
    const popupPromise = app.context.waitForEvent("page");
    await app.page.getByRole("link", { name: "Log in" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await popup.bringToFront();
    await expect
      .poll(async () => (await app.view()).continuationOrigin)
      .toBe("http://localhost:5173");
    await expect(
      app.panel.getByRole("button", { name: "Continue task here" }),
    ).toBeEnabled();
    await app.panel
      .getByRole("button", { name: "Continue task here" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await next(app, "Username");
    expect((await app.view()).journey).toMatchObject({
      id: initial.view.journey.id,
      goal: "How to log in",
      status: "active",
    });
    await popup.getByRole("textbox", { name: "Username" }).focus();
    await expect
      .poll(async () => (await app.view()).goalPlan?.issue)
      .toBe("consequential");
    expect((await app.view()).journey.status).toBe("active");
  } finally {
    await app.close();
  }
});
test("an unmatched destination reports an unavailable estimate instead of zero clicks", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/unmatched", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<h1>Welcome</h1><a href="/about">About</a>',
      }),
    );
    await app.page.goto("http://localhost:5173/unmatched");
    await app.start();
    await setGoal(app, "create account");
    await expect(app.panel.getByLabel("Route estimate")).toContainText(
      "unavailable",
    );
    await expect(
      app.panel.getByRole("region", { name: "Task journey" }),
    ).toContainText("could not identify a reliable next step");
    await expect(app.panel.getByLabel("Route estimate")).not.toContainText(
      "0–0",
    );
  } finally {
    await app.close();
  }
});

test("an authentication server redirect retains context while unrelated navigation is rejected", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url?.startsWith("/redirect-auth/form"))
      response.end(
        '<main><h1>Sign in</h1><form method="post"><label>Username<input></label><input type="password" autocomplete="current-password"><button>Sign in</button></form></main>',
      );
    else if (request.url === "/redirect-auth/start")
      response.end('<a href="/redirect-auth/entry">Log in</a>');
    else {
      response.writeHead(302, {
        Location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/redirect-auth/form?session=QUERY_SENTINEL`,
      });
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await app.page.goto(`http://localhost:${port}/redirect-auth/start`);
    await app.start();
    const initial = await setGoal(app, "login");
    await app.page.getByRole("link", { name: "Log in" }).click();
    await expect
      .poll(async () => (await app.view()).continuationOrigin)
      .toBe(`http://127.0.0.1:${port}`);
    const held = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_SESSION" }),
    );
    expect(held.pendingNavigation.redirected).toBe(true);
    expect(JSON.stringify(held)).not.toContain("QUERY_SENTINEL");
    await expect(
      app.panel.getByRole("button", { name: "Continue task here" }),
    ).toBeEnabled();
    await app.panel
      .getByRole("button", { name: "Continue task here" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await next(app, "Username");
    expect((await app.view()).journey).toMatchObject({
      id: initial.view.journey.id,
      status: "active",
      goal: "login",
    });
    expect((await app.view()).journey.progress).toHaveLength(1);
    await app.stop();
    await app.page.goto(`http://localhost:${port}/redirect-auth/start`);
    await app.start();
    await setGoal(app, "login");
    // A typed/address-bar navigation is not the selected link's redirect chain.
    await app.page.goto(`http://localhost:${port}/redirect-auth/unrelated`);
    await expect.poll(async () => (await app.view()).status).toBe("stopped");
    expect((await app.view()).continuationOrigin).toBeUndefined();
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
