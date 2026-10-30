import { test, expect } from "../../../support/browser-test";
import { acceptanceServer } from "../../../support/fixture-server";
import { openBrandedExtension } from "../../../support/branded-extension";
import { privateCapturePage } from "../../../fixtures/vision/private-page";
import { createServer, type ServerResponse } from "node:http";
import {
  recognitionInputSchema,
  validatePng,
} from "../../../../packages/vision/contracts";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("Chrome rechecks private mask evidence after backend health before sending pixels", async ({}, info) => {
  let held: ServerResponse | undefined,
    armed = false,
    healthCount = 0,
    healthHeldAt = 0,
    negativeOcrPosts = 0,
    positiveOcrPosts = 0,
    otherPosts = 0,
    positive = false,
    positiveInputValid = false,
    positiveCaptureId = "";
  const health = { protocols: [], capabilities: ["cpu-ocr"] };
  const server = createServer((request, response) => {
    response.setHeader(
      "Access-Control-Allow-Origin",
      request.headers.origin || "*",
    );
    response.setHeader(
      "Access-Control-Allow-Headers",
      "authorization,content-type",
    );
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "OPTIONS") return void response.end();
    if (request.url === "/v2/health" && armed) {
      request.resume();
      armed = false;
      healthCount++;
      healthHeldAt = Date.now();
      held = response;
      return;
    }
    if (request.url === "/v2/ocr" && request.method === "POST") {
      if (positive) positiveOcrPosts++;
      else negativeOcrPosts++;
      // The positive control exercises the configured loopback API. Validate
      // only the masked wire contract in memory; no image/body is recorded.
      const chunks: Buffer[] = [];
      let bytes = 0;
      request.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 6 * 1024 * 1024) request.destroy();
        else chunks.push(chunk);
      });
      request.on("end", () => {
        try {
          const input = recognitionInputSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
          validatePng(input);
          if (positive) {
            positiveInputValid = true;
            positiveCaptureId = input.captureId;
          }
        } catch {
          /* Report only the bounded validity flag, never private input. */
        }
        chunks.length = 0;
        // No pretend recognition result or navigation authority is supplied.
        response
          .writeHead(503)
          .end(JSON.stringify({ error: "Controlled local OCR fixture" }));
      });
      return;
    }
    request.resume();
    if (request.method === "POST") otherPosts++;
    response.end(JSON.stringify(health));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Local backend fixture unavailable");
  const fixture = await acceptanceServer({
    "/acceptance/fixture": privateCapturePage,
  });
  const app = await openBrandedExtension("chrome", fixture.url, ["<all_urls>"]);
  try {
    await info.attach("browser-runtime", {
      body: Buffer.from(
        JSON.stringify({
          name: "chrome",
          version: app.version,
          target: "chromium",
        }),
      ),
      contentType: "application/json",
    });
    await app.extension(() => {
      const api = (globalThis as any).chrome;
      const state = {
        prepares: 0,
        lastPreparedAt: 0,
        latestCaptureId: "",
        listener: undefined as any,
      };
      state.listener = (message: any, sender: any) => {
        if (
          sender.id === api.runtime.id &&
          !sender.tab &&
          message?.target === "offscreen" &&
          message.type === "OCR_REQUEST" &&
          message.prepareOnly === true &&
          /^[a-f0-9-]{36}$/i.test(message.stamp?.captureId || "")
        ) {
          state.prepares++;
          state.lastPreparedAt = Date.now();
          state.latestCaptureId = message.stamp.captureId;
        }
      };
      api.runtime.onMessage.addListener(state.listener);
      (globalThis as any).__vision38Egress = state;
    });
    const observer = () =>
      app.extension(() => {
        const state = (globalThis as any).__vision38Egress;
        return {
          prepares: state.prepares,
          lastPreparedAt: state.lastPreparedAt,
          latestCaptureId: state.latestCaptureId,
        };
      });
    await app.start();
    await app.goal("Show nonexistent nebula vault");
    const actual = await app.waitFor(
      () =>
        app.extension(async () => {
          const api = (globalThis as any).chrome;
          const value = await api.runtime.sendMessage({ type: "GET_SESSION" });
          return {
            stage: value.view?.goalPlan?.recoveryStage,
            issue: value.view?.goalPlan?.issue,
            clarification: !!value.view?.clarification,
            request: value.view?.request?.id,
          };
        }),
      (value) =>
        value.stage === "vision" &&
        value.issue === "no-match" &&
        !value.clarification,
      "Actual no-match recovery reaches vision",
      15_000,
    );
    expect(actual.request).toBeTruthy();
    expect(
      (
        await app.message({
          type: "SET_BACKEND",
          url: "http://127.0.0.1:" + address.port,
          token: "a".repeat(64),
          enabled: true,
        })
      ).error,
    ).toBeUndefined();
    expect(
      (await app.message({ type: "SET_VISION", backend: true })).error,
    ).toBeUndefined();
    armed = true;
    await app.site(() => document.title);
    expect(
      (await app.message({ type: "REQUEST_VISION" })).error,
    ).toBeUndefined();
    await expect.poll(() => healthCount, { timeout: 10_000 }).toBe(1);
    expect(held && !held.writableEnded).toBe(true);
    const prepared = await observer();
    expect(prepared.prepares).toBe(1);
    expect(prepared.lastPreparedAt).toBeLessThanOrEqual(healthHeldAt);
    await app.site(() =>
      (window as any).__vision38Fixture.changePrivateGeometry(),
    );
    held!.end(JSON.stringify(health));
    // A faulty before-send fence would post immediately after the health response.
    await app.driver.sleep(1500);
    expect(negativeOcrPosts).toBe(0);
    await app.message({ type: "SET_VISION", backend: false });
    expect(otherPosts).toBe(0);
    // The same real owner must transmit one valid prepared PNG when no DOM
    // change occurs. This rules out a disabled or unreachable OCR path.
    armed = false;
    positive = true;
    await app.waitFor(
      () => app.progress(),
      (value) =>
        value.goalPlan?.recoveryStage === "vision" &&
        value.goalPlan.issue === "no-match",
      "Retained actual vision recovery",
      15_000,
    );
    expect((await app.message({ type: "GET_PAGE" })).error).toBeUndefined();
    await app.message({ type: "SET_VISION", backend: true });
    await app.site(() => document.title);
    await app.message({ type: "REQUEST_VISION" });
    await expect
      .poll(() => positiveOcrPosts === 1 && positiveInputValid, {
        timeout: 10_000,
      })
      .toBe(true);
    const positivePrepared = await observer();
    expect(positivePrepared.prepares).toBe(2);
    expect(positiveCaptureId).toBe(positivePrepared.latestCaptureId);
    expect(positiveCaptureId).not.toBe(prepared.latestCaptureId);
    expect(otherPosts).toBe(0);
    await app.message({ type: "SET_VISION", backend: false });
    await info.attach("pixel-privacy", {
      body: Buffer.from(
        JSON.stringify({
          target: "chromium",
          version: app.version,
          permissionProfile: "disposable all-URLs capture pregrant",
          humanActivation: "pending",
          actualVisionRecovery: true,
          heldHealthRequests: healthCount,
          geometryChangedBeforeHealthRelease: true,
          actualPreparedRequests: positivePrepared.prepares,
          preparePrecededHeldHealth: true,
          negativeOcrPosts,
          positiveOcrPosts,
          positiveInputValid,
          positiveCaptureMatched: true,
          otherPosts,
          imagesPersisted: false,
        }),
      ),
      contentType: "application/json",
    });
  } finally {
    held?.end();
    await app
      .extension(() => {
        const api = (globalThis as any).chrome,
          state = (globalThis as any).__vision38Egress;
        if (state) api.runtime.onMessage.removeListener(state.listener);
        delete (globalThis as any).__vision38Egress;
      })
      .catch(() => {});
    await app.close();
    await fixture.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
