import type { WebDriver } from "selenium-webdriver";
import { seleniumBidi } from "./webdriver-extension";
export function assertFixtureUrl(url: string) {
  if (
    (process.env.THOLI_TEST_TIER === "pr" ||
      process.env.THOLI_BROWSER_NETWORK === "fixtures") &&
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  )
    throw Error("Public URL in deterministic browser fixture");
}
export async function fixtureOnlySeleniumNetwork(
  driver: WebDriver,
  contexts: string[],
) {
  if (
    process.env.THOLI_TEST_TIER !== "pr" &&
    process.env.THOLI_BROWSER_NETWORK !== "fixtures"
  )
    return async () => {};
  const bidi = await seleniumBidi(driver);
  const socket = await bidi.socket,
    unexpected: string[] = [],
    pending = new Set<Promise<void>>();
  await bidi.subscribe("network.beforeRequestSent", contexts);
  const listener = (bytes: Buffer) => {
    const event = JSON.parse(bytes.toString());
    if (
      event.method !== "network.beforeRequestSent" ||
      !event.params?.isBlocked
    )
      return;
    const { request } = event.params,
      url = new URL(request.url);
    const allowed = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (!allowed) unexpected.push(url.origin + url.pathname);
    const job = bidi
      .send({
        method: allowed ? "network.continueRequest" : "network.failRequest",
        params: { request: request.request },
      })
      .then((reply) => {
        if (reply.error)
          unexpected.push("Network interception failed: " + reply.message);
      })
      .catch((error) => {
        unexpected.push(String(error));
      });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  };
  socket.on("message", listener);
  const interception = await bidi.send({
    method: "network.addIntercept",
    params: {
      phases: ["beforeRequestSent"],
      contexts,
      urlPatterns: [
        { type: "pattern", protocol: "http" },
        { type: "pattern", protocol: "https" },
      ],
    },
  });
  if (interception.error) throw Error(interception.message);
  return async () => {
    await Promise.allSettled(pending);
    await bidi.send({
      method: "network.removeIntercept",
      params: { intercept: interception.result?.intercept },
    });
    socket.off("message", listener);
    if (unexpected.length)
      throw Error(
        "Browser fixture tests attempted public requests: " +
          unexpected.join(", "),
      );
  };
}
