import type { WebDriver } from "selenium-webdriver";
import type { EventEmitter } from "node:events";
export interface SeleniumBidi {
  send(command: {
    method: string;
    params: Record<string, unknown>;
  }): Promise<{ result?: any; error?: string; message?: string }>;
  subscribe(event: string, contexts: string[]): Promise<void>;
  socket: Promise<EventEmitter>;
}
export function seleniumBidi(driver: WebDriver) {
  return (driver as unknown as { getBidi(): Promise<SeleniumBidi> }).getBidi();
}
export async function attachWebDriverExtension(
  driver: WebDriver,
  website: string,
  panel: string,
  tabId: number,
  url: string,
  finishNetwork: () => Promise<void>,
  closeDriver = () => driver.quit(),
) {
  const bidi = await seleniumBidi(driver);
  async function extension<T>(
    fn: (...args: any[]) => T,
    ...args: unknown[]
  ): Promise<Awaited<T>> {
    const result = await bidi.send({
      method: "script.callFunction",
      params: {
        functionDeclaration:
          "async function(args){return JSON.stringify({value:await (" +
          fn.toString() +
          ")(...JSON.parse(args))});}",
        target: { context: panel },
        awaitPromise: true,
        arguments: [{ type: "string", value: JSON.stringify(args) }],
      },
    });
    if (result.error || result.result?.type !== "success")
      throw Error(
        result.message ||
          result.result?.exceptionDetails?.text ||
          "Extension WebDriver command failed",
      );
    return JSON.parse(result.result.result.value).value;
  }
  async function message<T = any>(
    command: unknown,
    projection = "",
  ): Promise<T> {
    const reply = await extension(
      function (command: unknown, projection: string) {
        const api = (globalThis as any).browser || (globalThis as any).chrome;
        return api.runtime.sendMessage(command).then((reply: any) => {
          const view = reply?.view;
          if (projection === "memory-summary")
            return { error: reply?.error, pages: reply?.memory?.pages.length };
          if (projection === "progress")
            return {
              status: view?.status,
              verifiedSteps: view?.verifiedSteps,
              request: view?.request,
              journey: view?.journey,
              goalPlan: view?.goalPlan,
              selectedControlId: view?.selectedControlId,
            };
          if (projection === "selected") {
            const target = view?.page?.controls.find(
              (c: any) => c.id === view.selectedControlId,
            );
            return {
              status: view?.goalPlan?.status,
              signature: target?.signature,
              inViewport: target?.inViewport,
            };
          }
          return reply;
        });
      },
      command,
      projection,
    );
    return reply as T;
  }
  async function site<T>(fn: (...args: any[]) => T, ...args: unknown[]) {
    await driver.switchTo().window(website);
    return driver.executeScript<T>(fn, ...args);
  }
  async function waitFor<T>(
    read: () => Promise<T>,
    predicate: (value: T) => boolean,
    label: string,
    timeout = 10000,
  ) {
    return driver
      .wait(
        async () => {
          const value = await read();
          return predicate(value) ? { value } : false;
        },
        timeout,
        label,
      )
      .then((result) => {
        if (!result) throw Error(label);
        return result.value;
      });
  }
  return {
    driver,
    website,
    panel,
    tabId,
    message,
    site,
    waitFor,
    version: (await driver.getCapabilities()).get("browserVersion") as string,
    extension,
    async start() {
      await driver.switchTo().window(website);
      const result = await message({
        type: "START",
        routeId: "navigator.live",
        routeVersion: "1.0.0",
        tabId,
        origin: new URL(url).origin,
      });
      if (result.error) throw Error(result.error);
      return result;
    },
    async goal(goal: string) {
      await driver.switchTo().window(website);
      // The same bounded responsive-reflow retry as the Chromium acceptance adapter.
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await message({ type: "GET_PAGE" });
        if (current.error) throw Error(current.error);
        const result = await message({
          type: "SET_GOAL",
          goal,
          revision: current.page.revision,
        });
        if (
          result.error ===
            "The page changed before this request. Use the current scan." &&
          attempt < 2
        )
          continue;
        if (result.error) throw Error(result.error);
        return result;
      }
      throw Error("Fresh observation could not be obtained");
    },
    async view() {
      return (await message({ type: "GET_SESSION" })).view;
    },
    async progress() {
      return message({ type: "GET_SESSION" }, "progress");
    },
    async selected() {
      return message({ type: "GET_SESSION" }, "selected");
    },
    async visit(url: string) {
      await driver.switchTo().window(website);
      await driver.get(url);
    },
    async close() {
      try {
        await finishNetwork();
      } finally {
        await closeDriver();
      }
    },
  };
}
