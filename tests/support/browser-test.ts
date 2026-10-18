import { cleanupPermissionVariants } from "./permission-variant";
import { cleanupNativeDrivers } from "./native-browser-lifecycle";
import { test as base, type BrowserContext } from "@playwright/test";
export * from "@playwright/test";
const installed = new WeakSet<BrowserContext>();
const unexpected: string[] = [];
export async function deterministicNetwork(context: BrowserContext) {
  if (
    (process.env.THOLI_TEST_TIER !== "pr" &&
      process.env.THOLI_BROWSER_NETWORK !== "fixtures") ||
    installed.has(context)
  )
    return;
  installed.add(context);
  const browser = context.browser();
  if (browser)
    await base.info().attach("browser-runtime", {
      body: Buffer.from(
        JSON.stringify({
          name: browser.browserType().name(),
          version: browser.version(),
        }),
      ),
      contentType: "application/json",
    });
  await context.route(/^https?:/, async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      return route.continue();
    unexpected.push(url.origin + url.pathname);
    await route.abort("blockedbyclient");
  });
}
export const test = base.extend<
  { networkPolicy: void; nativeBrowserCleanup: void },
  { permissionCopies: void }
>({
  nativeBrowserCleanup: [
    async ({}, use) => {
      try {
        await use();
      } finally {
        await cleanupNativeDrivers();
      }
    },
    { auto: true, timeout: 45000 },
  ],
  permissionCopies: [
    async ({}, use) => {
      await use();
      await cleanupPermissionVariants();
    },
    { scope: "worker", auto: true },
  ],
  context: async ({ context }, use) => {
    await deterministicNetwork(context);
    await use(context);
  },
  networkPolicy: [
    async ({}, use) => {
      const first = 0;
      await use();
      if (unexpected.length > first) {
        const requests = unexpected.splice(0);
        throw Error(
          "PR tests attempted public network requests: " + requests.join(", "),
        );
      }
    },
    { auto: true },
  ],
});
