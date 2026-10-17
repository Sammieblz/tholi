import { test, expect } from "../../../support/browser-test";
import { createServer } from "node:http";
import { openNavigatorExtension } from "../../../support/navigator-extension";
test("an older backend without workflow capabilities falls back to bundled local planning", async () => {
  const paths: string[] = [],
    server = createServer((req, res) => {
      paths.push(req.url || "");
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          version: "0.7.1",
          protocols: [1],
          capabilities: ["english-nlp"],
        }),
      );
    });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test port");
  const app = await openNavigatorExtension();
  try {
    await app.context.route("**/older-backend", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<h1>Workspace</h1><button aria-label="Menu" aria-haspopup="menu" aria-expanded="false">Menu</button>',
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/older-backend");
    await app.start();
    await app.panel.evaluate(
      async (settings) =>
        chrome.runtime.sendMessage({ type: "SET_BACKEND", ...settings }),
      {
        url: "http://127.0.0.1:" + address.port,
        token: "a".repeat(64),
        enabled: true,
      },
    );
    const page = await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({ type: "GET_PAGE" }),
    );
    const result = await app.panel.evaluate(
      async (revision) =>
        chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal: "Please find Menu",
          revision,
        }),
      page.page.revision,
    );
    expect(result.error).toBeUndefined();
    await expect
      .poll(async () => {
        const v = await app.view();
        return v.controls.find((c: any) => c.id === v.selectedControlId)?.label;
      })
      .toBe("Menu");
    expect(paths).toContain("/v2/health");
    expect(paths.some((p) => p.endsWith("/plans"))).toBe(false);
    expect((await app.view()).embeddingActivity.llmCalls).toBe(0);
  } finally {
    await app.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
