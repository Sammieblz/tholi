import { cleanupPermissionVariants } from "./permission-variant";
import { cleanupNativeDrivers } from "./native-browser-lifecycle";
import { externalProviderKind } from "./provider-network-guard";
import { test as base, type BrowserContext } from "@playwright/test";
export * from "@playwright/test";
const installed = new WeakSet<BrowserContext>();
const unexpected: string[] = [];
const blockedProviders = { model: 0, payment: 0 };
function zeroCostCollection() {
  return (
    process.env.THOLI_BROWSER_GROUP === "navigation-baseline" ||
    (process.env.THOLI_BROWSER_GROUP === "perception-comparison" &&
      process.env.THOLI_EVALUATION_MODE === "dry-run")
  );
}
export async function deterministicNetwork(context: BrowserContext) {
  const fixturesOnly =
    process.env.THOLI_TEST_TIER === "pr" ||
    process.env.THOLI_BROWSER_NETWORK === "fixtures";
  if ((!fixturesOnly && !zeroCostCollection()) || installed.has(context))
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
    const provider = externalProviderKind(url);
    if (provider) {
      blockedProviders[provider]++;
      unexpected.push("external-" + provider);
      return route.abort("blockedbyclient");
    }
    if (
      !fixturesOnly ||
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
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
      const before = { ...blockedProviders };
      await use();
      if (zeroCostCollection())
        await base.info().attach("zero-cost-provider-network", {
          body: Buffer.from(
            JSON.stringify({
              scope: "browser-routable-http",
              blockedModelRequests: blockedProviders.model - before.model,
              blockedPaymentRequests: blockedProviders.payment - before.payment,
            }),
          ),
          contentType: "application/json",
        });
      if (unexpected.length > first) {
        const requests = unexpected.splice(0);
        throw Error(
          "Test network policy rejected requests: " + requests.join(", "),
        );
      }
    },
    { auto: true },
  ],
});
