import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";
async function fixture(holdHydration = false) {
  const app = await openNavigatorExtension(undefined, []);
  if (holdHydration) {
    await app.panel.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let held = true;
      const waiting: (() => void)[] = [];
      (globalThis as any).__releaseHydration = () => {
        held = false;
        waiting.splice(0).forEach((release) => release());
      };
      chrome.runtime.sendMessage = (async (message: any) => {
        const reply = await send(message);
        if (message.type === "UI_GET" && held)
          await new Promise<void>((resolve) => waiting.push(resolve));
        return reply;
      }) as typeof chrome.runtime.sendMessage;
    });
    await app.panel.reload();
  }
  await app.context.route("http://127.0.0.1:5173/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html lang="en"><body><header><button aria-expanded="false" aria-controls="menu" onclick="this.setAttribute(\'aria-expanded\',\'true\');document.getElementById(\'menu\').hidden=false">Account menu</button><nav id="menu" aria-label="User navigation" hidden><a href="/settings">Account settings</a></nav></header><main><h1>Workspace</h1><p>Welcome to your workspace.</p></main></body></html>',
    }),
  );
  await app.page.goto("http://127.0.0.1:5173/ui-fixture");
  await app.page.bringToFront();
  await expect(
    app.panel.getByRole("textbox", { name: "Navigation goal" }),
  ).toBeVisible();
  return app;
}
async function destination(
  app: Awaited<ReturnType<typeof fixture>>,
  text: string,
) {
  await app.panel.getByRole("textbox", { name: "Navigation goal" }).fill(text);
  await app.panel.evaluate(() => (globalThis as any).__releaseHydration?.());
  const guide = app.panel.getByRole("button", {
    name: "Guide me",
    exact: true,
  });
  await expect(guide).toBeEnabled();
  await expect(
    app.panel.getByRole("textbox", { name: "Navigation goal" }),
  ).toHaveValue(text);
  await app.page.bringToFront();
  // The sidebar is a separate test tab. Keep the authorized website active
  // while dispatching the submit only after the real button is enabled.
  await guide.evaluate((e) => (e as HTMLButtonElement).click());
  try {
    await expect
      .poll(async () => !!(await app.view())?.selectedControlId, {
        timeout: 20000,
      })
      .toBe(true);
  } catch (e) {
    console.log(
      "FIXTURE DIAGNOSTICS",
      await app.panel.locator("main").innerText(),
      await app.panel.evaluate(
        async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
      ),
    );
    throw e;
  }
}
test("Guide and Conversation keep one journey and grounded evidence", async ({}, info) => {
  const app = await fixture(true);
  try {
    await destination(app, "Account settings");
    const id = (await app.view()).request.id;
    const protectedStorage = await app.panel.evaluate(async () => {
      const current = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: current.tabId },
        func: async () => {
          try {
            await chrome.storage.local.get("backend");
            return "allowed";
          } catch {
            return "blocked";
          }
        },
      });
      return result.result;
    });
    expect(protectedStorage).toBe("blocked");
    await app.panel
      .getByRole("button", { name: "Conversation", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await app.panel
      .getByRole("textbox", { name: "Navigation goal" })
      .fill("Why this step?");
    await app.panel
      .getByRole("button", { name: "Send", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect(
      app.panel.getByLabel("Conversation", { exact: true }),
    ).toContainText((await app.view()).goalPlan.reason);
    expect((await app.view()).request.id).toBe(id);
    await app.panel
      .getByRole("textbox", { name: "Navigation goal" })
      .fill("Pause navigation");
    await app.panel
      .getByRole("button", { name: "Send", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect.poll(async () => (await app.view())?.status).toBe("paused");
    await app.panel.screenshot({
      path: info.outputPath("sidebar-conversation.png"),
      fullPage: true,
    });
    await app.panel
      .getByRole("button", { name: "Guide", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect(
      app.panel.getByRole("textbox", { name: "Navigation goal" }),
    ).toHaveValue("");
    expect((await app.view()).request.id).toBe(id);
  } finally {
    await app.close();
  }
});
test("widget uses fresh frame binding, blocks secrets, moves and resizes", async ({}, info) => {
  const app = await fixture();
  try {
    await destination(app, "Account settings");
    const id = (await app.view()).request.id;
    await app.panel
      .getByRole("button", { name: "Tholi settings", exact: true })
      .click();
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Use floating widget", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(() =>
        app.page
          .frames()
          .find((f) => f.url().includes("/widget.html?grant="))
          ?.url(),
      )
      .toBeTruthy();
    const frame = app.page
      .frames()
      .find((f) => f.url().includes("/widget.html?grant="))!;
    await expect(
      frame.getByRole("button", { name: "Pause navigation", exact: true }),
    ).toBeVisible();

    expect(
      await frame.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "GET_BACKEND" })).error,
      ),
    ).toContain("sidebar");
    await app.page.setViewportSize({ width: 1280, height: 900 });
    const cdp = await app.context.newCDPSession(app.page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: 1400, height: 1000 },
    });
    await cdp.detach();
    await frame
      .getByRole("button", { name: "Widget menu", exact: true })
      .click();
    await frame
      .getByRole("button", { name: "Conversation", exact: true })
      .click();
    await frame.getByLabel("Navigation goal").fill("Why this step?");
    await frame.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      frame.getByLabel("Conversation", { exact: true }),
    ).toContainText((await app.view()).goalPlan.reason);
    expect((await app.view()).request.id).toBe(id);
    await frame
      .getByRole("button", { name: "Widget menu", exact: true })
      .click();
    await frame.getByRole("button", { name: "Guide", exact: true }).click();
    await expect
      .poll(() => frame.locator(".tholi-body").evaluate((e) => e.scrollTop))
      .toBe(0);
    await expect
      .poll(() =>
        frame.locator(".tholi-instruction").evaluate((e) => {
          const body = e.closest(".tholi-body")!.getBoundingClientRect();
          const instruction = e.getBoundingClientRect();
          return (
            instruction.top >= body.top && instruction.bottom <= body.bottom
          );
        }),
      )
      .toBe(true);
    await app.page.screenshot({ path: info.outputPath("standard-widget.png") });
    await frame
      .getByRole("button", { name: "Pause navigation", exact: true })
      .click();
    await expect.poll(async () => (await app.view())?.status).toBe("paused");
    expect((await app.view()).request.id).toBe(id);
    const bounds = () => app.page.locator("#tholi-widget").boundingBox();
    // Position controls use the same accessible menu as the other widget tools.
    const layoutStart = (await bounds())!;
    await frame
      .getByRole("button", { name: "Widget menu", exact: true })
      .click();
    await frame.getByRole("button", { name: "Left", exact: true }).click();
    await expect
      .poll(async () => (await bounds())!.x)
      .toBeLessThan(layoutStart.x);
    await app.page.keyboard.press("Escape");
    expect((await app.view()).request.id).toBe(id);
    const before = (await bounds())!;
    await app.page.mouse.move(before.x + 60, before.y + 14);
    await app.page.mouse.down();
    // Move away from the docking edge; docking has separate activation checks.
    await app.page.mouse.move(before.x + 10, before.y + 90);
    await app.page.mouse.up();
    const moved = (await bounds())!;
    expect(moved.y).toBeGreaterThan(before.y);
    await app.page.mouse.move(
      moved.x + moved.width - 10,
      moved.y + moved.height - 10,
    );
    await app.page.mouse.down();
    await app.page.mouse.move(moved.x + 260, moved.y + 220);
    await app.page.mouse.up();
    await expect.poll(async () => (await bounds())!.height).toBeLessThan(300);
    await expect(frame.getByLabel("Navigation goal")).toBeVisible();
    await app.page.screenshot({ path: info.outputPath("compact-widget.png") });
    await frame
      .getByRole("button", { name: "Widget menu", exact: true })
      .click();
    await expect(
      frame.getByRole("button", { name: "Resume navigation", exact: true }),
    ).toBeVisible();
    await frame
      .getByRole("button", { name: "Resume navigation", exact: true })
      .click();
    await expect.poll(async () => (await app.view())?.status).toBe("running");
    const small = (await bounds())!;
    await app.page.mouse.move(
      small.x + small.width - 10,
      small.y + small.height - 10,
    );
    await app.page.mouse.down();
    await app.page.mouse.move(small.x + 190, small.y + 130);
    await app.page.mouse.up();
    expect((await bounds())!.width).toBe(240);
    expect((await bounds())!.height).toBe(180);
    const inputBox = await frame.getByLabel("Navigation goal").boundingBox();
    const minimum = (await bounds())!;
    expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(
      minimum.y + minimum.height,
    );
    await app.page.screenshot({ path: info.outputPath("minimum-widget.png") });
    await frame
      .getByRole("button", { name: "Widget menu", exact: true })
      .click();
    await frame
      .getByRole("button", { name: "Expand widget", exact: true })
      .click();
    await expect.poll(async () => (await bounds())!.width).toBe(420);
    await expect.poll(async () => (await bounds())!.height).toBe(620);
    // Size changes preserve the authorized frame and its composer focus.
    let expanded = app.page.frames().find((f) => f.url() === frame.url())!;
    await expect(
      expanded.getByRole("button", { name: "Pause navigation", exact: true }),
    ).toBeVisible();
    expect((await app.view()).request.id).toBe(id);
    const previousWidgetUrl = expanded.url();
    await app.page.reload();
    await expect
      .poll(() =>
        app.page
          .frames()
          .some(
            (f) =>
              f.url().includes("/widget.html?grant=") &&
              f.url() !== previousWidgetUrl,
          ),
      )
      .toBe(true);
    expanded = app.page
      .frames()
      .find(
        (f) =>
          f.url().includes("/widget.html?grant=") &&
          f.url() !== previousWidgetUrl,
      )!;
    await expect(
      expanded.getByRole("button", { name: "Widget menu", exact: true }),
    ).toBeVisible();
    expect((await app.view()).request.id).toBe(id);
    const data = await app.panel.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "GET_PAGE" }),
    );
    expect(
      data.page.controls.some((c: { label: string }) =>
        c.label.includes("Resume navigation"),
      ),
    ).toBe(false);
    await app.page.evaluate(() => {
      const input = document.createElement("input");
      input.value = "PRIVATE_FIXTURE_VALUE";
      document.body.append(input);
    });
    const capture = await app.panel.evaluate(async () => {
      const session = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      return chrome.tabs.sendMessage(
        session.tabId,
        { type: "PREPARE_CAPTURE", sessionId: session.sessionId },
        { frameId: 0 },
      );
    });
    expect(capture.masks.length).toBeGreaterThan(0);
    expect(JSON.stringify(capture)).not.toContain("PRIVATE_FIXTURE_VALUE");
    expect(
      await app.page
        .locator("#tholi-widget")
        .evaluate((e) => getComputedStyle(e).visibility),
    ).toBe("hidden");
    await app.panel.evaluate(async () => {
      const session = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      await chrome.tabs.sendMessage(
        session.tabId,
        { type: "RESTORE_CAPTURE", sessionId: session.sessionId },
        { frameId: 0 },
      );
    });
    const stranger = await app.context.newPage();
    await stranger.goto(expanded.url());
    await expect(stranger.locator("body")).toContainText("Reconnecting");
    expect(
      await stranger.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "UI_GET" })).error,
      ),
    ).toContain("Trusted");
    await stranger.close();
    await app.page.bringToFront();
    await expanded.getByLabel("Navigation goal").fill("Follow-up destination");
    await expect
      .poll(() =>
        app.panel.evaluate(
          async () =>
            (await chrome.storage.session.get("tholiDraft")).tholiDraft,
        ),
      )
      .toBe("Follow-up destination");
    await expanded
      .getByRole("button", { name: "Widget menu", exact: true })
      .click();
    await expanded
      .getByRole("button", { name: "Dock to sidebar", exact: true })
      .click();
    await expect(app.page.locator("#tholi-widget")).toHaveCount(0);
    await expect(app.panel.getByLabel("Navigation goal")).toHaveValue(
      "Follow-up destination",
    );
    expect((await app.view()).request.id).toBe(id);
  } finally {
    await app.close();
  }
});

test("sidebar layouts support large text, reduced motion and dark appearance", async ({}, info) => {
  const app = await fixture();
  try {
    await app.panel.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await destination(app, "Account settings");
    for (const width of [300, 380, 620]) {
      await app.panel.setViewportSize({ width, height: 900 });
      expect(
        await app.panel.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await app.panel.screenshot({
        path: info.outputPath("sidebar-" + width + ".png"),
      });
    }
    await app.panel.setViewportSize({ width: 380, height: 900 });
    await app.panel.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent();
      await chrome.tabs.setZoom(tab!.id!, 2);
    });
    expect(
      await app.panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Chrome zoom reports CSS widths to full-page capture but paints in DIPs.
    // Capture both native viewport positions to avoid a cropped QA artifact.
    await app.panel.screenshot({
      path: info.outputPath("sidebar-200-percent-top.png"),
    });
    await app.panel
      .getByRole("button", { name: "Stop", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      app.panel.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await app.panel.screenshot({
      path: info.outputPath("sidebar-200-percent.png"),
    });
  } finally {
    await app.close();
  }
});

test("interrupted widget mount falls back to sidebar without losing destination", async () => {
  const app = await openNavigatorExtension(undefined, []);
  try {
    await app.context.route("http://127.0.0.1:5173/blocked", (r) =>
      r.fulfill({
        contentType: "text/html",
        headers: { "content-security-policy": "frame-src 'none'" },
        body: '<html><body><button aria-expanded="false">Account menu</button></body></html>',
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/blocked");
    await app.page.bringToFront();
    await destination(app, "Account settings");
    const id = (await app.view()).request.id;
    await app.page.evaluate(() =>
      new MutationObserver(() =>
        document.getElementById("tholi-widget")?.remove(),
      ).observe(document.documentElement, { childList: true }),
    );
    await app.panel
      .getByRole("button", { name: "Tholi settings", exact: true })
      .click();
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Use floating widget", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect(app.panel.getByRole("alert")).toContainText("could not load", {
      timeout: 10000,
    });
    expect((await app.view()).request.id).toBe(id);
    expect((await app.view()).request.status).not.toBe("completed");
    await expect(app.page.locator("#tholi-widget")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
test("busy page motion retains one highlight and reports frame timing", async ({}, info) => {
  // Collect all 120 samples even on the known slow 50,000-node workload.
  // This is a wall-clock budget, not a relaxed frame-time target. Keep the
  // mutation load, measured timings and every safety assertion unchanged.
  test.setTimeout(90_000);
  const app = await fixture();
  try {
    await app.panel.evaluate(async () => {
      const context = await chrome.runtime.sendMessage({ type: "GET_CONTEXT" });
      await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: () => {
          const original = Element.prototype.animate;
          (window as any).__reminderAnimations = [];
          Element.prototype.animate = function (...args) {
            const animation = original.apply(this, args);
            if (typeof args[1] === "object" && args[1]?.iterations === 4)
              (window as any).__reminderAnimations.push(animation);
            return animation;
          };
        },
      });
    });
    const reminders = () =>
      app.panel.evaluate(async () => {
        const session = await chrome.runtime.sendMessage({
          type: "GET_SESSION",
        });
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: session.tabId },
          func: () => {
            const animations = (window as any)
              .__reminderAnimations as Animation[];
            return {
              count: animations.length,
              timing: animations[0]?.effect?.getTiming(),
              state: animations[0]?.playState,
            };
          },
        });
        return result.result!;
      });
    // Establish a grounded step first. This measures motion under mutation load,
    // independently of model cold startup and initial discovery benchmarks.
    await destination(app, "Account settings");
    await app.page.evaluate(() => {
      const region = document.createElement("section");
      region.id = "storm";
      const batch = document.createDocumentFragment();
      for (let i = 0; i < 50000; i++) {
        const span = document.createElement("span");
        span.textContent = ".";
        batch.append(span);
      }
      region.append(batch);
      document.body.append(region);
    });
    const stats = await app.page.evaluate(async () => {
      const root = document.getElementById("internet-navigator-overlay")!,
        times: number[] = [];
      let previous = performance.now(),
        count = 0;
      const interval = setInterval(() => {
        const r = document.getElementById("storm")!;
        for (let i = 0; i < 100; i++)
          r.children[(count + i) % 50000].textContent = String(count);
        count += 100;
      }, 50);
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          times.push(now - previous);
          previous = now;
          if (times.length < 120) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      clearInterval(interval);
      times.sort((a, b) => a - b);
      return {
        nodes: document.getElementById("storm")!.children.length,
        frameP95Ms: times[Math.floor(times.length * 0.95)],
        sameRoot:
          document.getElementById("internet-navigator-overlay") === root,
      };
    });
    expect(stats.sameRoot).toBe(true);
    expect(stats.nodes).toBe(50000);
    await expect
      .poll(async () => (await reminders()).count, { timeout: 10000 })
      .toBe(1);
    expect((await reminders()).timing).toMatchObject({
      duration: 1200,
      iterations: 4,
    });
    await app.page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await app.page.keyboard.press("Escape");
    await expect.poll(async () => (await reminders()).state).toBe("idle");
    expect((await reminders()).count).toBe(1);
    await info.attach("motion-benchmark", {
      body: JSON.stringify(stats),
      contentType: "application/json",
    });
  } finally {
    await app.close();
  }
});
