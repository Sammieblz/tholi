import { afterEach, expect, test, vi } from "vitest";
import { registerNavigationEvents } from "../../../apps/extension/src/background/navigation-events";
import type { PinnedSession } from "../../../packages/route-registry/session";
import { LIVE_ROUTE_ID, LIVE_VERSION } from "../../../packages/page-model";
import { readFileSync } from "node:fs";
import { createVisionService } from "../../../apps/extension/src/background/vision-service";
import { fixture } from "../../integration/nlp/fixtures";
import { interpretRequest } from "../../../packages/nlp/interpret";
import { beginJourney } from "../../../packages/goal-planner/task-journey";
import type {
  CaptureMetadata,
  RecognitionInput,
} from "../../../packages/vision/contracts";

const dependencies = vi.hoisted(() => ({
  cancelInferenceHost: vi.fn(),
  browserOcr: vi.fn(),
  localNlp: vi.fn(),
  backendOcr: vi.fn(),
  presentationVisible: vi.fn(),
  getPrivateSetting: vi.fn(),
}));
vi.mock("../../../apps/extension/src/platform/inference-host", () => ({
  cancelInferenceHost: dependencies.cancelInferenceHost,
}));
vi.mock("../../../apps/extension/src/inference/client", () => ({
  browserOcr: dependencies.browserOcr,
  localNlp: dependencies.localNlp,
}));
vi.mock("../../../apps/extension/src/platform/backend-client", () => ({
  backendOcr: dependencies.backendOcr,
}));
vi.mock("../../../apps/extension/src/background/ui-transport", () => ({
  presentationVisible: dependencies.presentationVisible,
}));
vi.mock("../../../apps/extension/src/platform/private-settings", () => ({
  getPrivateSetting: dependencies.getPrivateSetting,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function nativeEvents() {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const event = (name: string) => ({
    addListener: (fn: (...args: any[]) => void) => {
      const callbacks = listeners.get(name) || [];
      callbacks.push(fn);
      listeners.set(name, callbacks);
    },
  });
  const controller = new AbortController();
  const session: PinnedSession = {
    sessionId: crypto.randomUUID(),
    tabId: 7,
    documentId: "native-pinned-document",
    origin: "https://example.test",
    routeId: LIVE_ROUTE_ID,
    routeVersion: LIVE_VERSION,
  };
  const context: Parameters<typeof registerNavigationEvents>[0] = {
    session,
    visionJob: controller,
    captureWindowId: () => 4,
    cancelVision: vi.fn(() => {
      controller.abort();
      context.visionJob = undefined;
    }),
    // Keep routine work pending: capture cancellation must not wait for it.
    enqueue: vi.fn(() => new Promise<never>(() => {})),
    save: vi.fn(async () => {}),
    live: () => true,
    ledgerNavigationEvent: false,
    startFrames: vi.fn(async () => {}),
    navigationStarts: new Map(),
    inScope: () => true,
    stopSession: vi.fn(async () => {}),
    attachSession: vi.fn(async () => session),
  };
  vi.stubGlobal("chrome", {
    tabs: {
      onZoomChange: event("zoom"),
      onActivated: event("activated"),
      onRemoved: event("removed"),
      onReplaced: event("replaced"),
      onDetached: event("detached"),
      onAttached: event("attached"),
      onUpdated: event("updated"),
    },
    windows: {
      onFocusChanged: event("focus"),
      onBoundsChanged: event("bounds"),
    },
    permissions: { onRemoved: event("permission") },
    webNavigation: {
      onHistoryStateUpdated: event("history"),
      onCompleted: event("completed"),
      onBeforeNavigate: event("before"),
      onCommitted: event("committed"),
    },
  });
  registerNavigationEvents(context);
  return {
    controller,
    context,
    emit: (name: string, args: unknown[]) => {
      for (const listener of listeners.get(name) || []) listener(...args);
    },
  };
}

test.each([
  ["zoom", [{ tabId: 7 }]],
  ["activated", [{ tabId: 8, windowId: 4 }]],
  ["focus", [9]],
  ["bounds", [{ id: 4 }]],
  ["removed", [7]],
  ["replaced", [12, 7]],
  ["detached", [7]],
  ["attached", [7]],
  ["updated", [7, { status: "loading" }, {}]],
  ["history", [{ tabId: 7, frameId: 0 }]],
  ["before", [{ tabId: 7, frameId: 1 }]],
  ["committed", [{ tabId: 7, frameId: 1 }]],
  ["permission", [{ origins: ["https://example.test/*"] }]],
] as const)(
  "%s fences a pinned image before pending journey work",
  (event, args) => {
    const app = nativeEvents();
    app.emit(event, [...args]);
    expect(app.controller.signal.aborted).toBe(true);
    expect(app.context.cancelVision).toHaveBeenCalledOnce();
    expect(app.context.visionJob).toBeUndefined();
  },
);

test("unrelated tab events do not inspect a tab or cancel the authorized window capture", () => {
  const app = nativeEvents();
  app.emit("zoom", [{ tabId: 8 }]);
  app.emit("activated", [{ tabId: 8, windowId: 9 }]);
  app.emit("bounds", [{ id: 9 }]);
  app.emit("focus", [4]);
  app.emit("detached", [8]);
  app.emit("replaced", [7, 8]);
  expect(app.context.cancelVision).not.toHaveBeenCalled();
  expect(app.controller.signal.aborted).toBe(false);
});

function visionApp() {
  const page = fixture();
  const request = interpretRequest("Locate an unavailable visual control");
  const journey = beginJourney(request.original, page.origin);
  const context: Parameters<typeof createVisionService>[0] = {
    visionJob: undefined,
    lastVisionKey: "",
    goalGeneration: 3,
    lastCapture: 0,
    knownSites: new Map(),
    save: vi.fn(async () => {}),
    acceptView: vi.fn(async () => {}),
    originOf: (url) => url && new URL(url).origin,
    session: {
      sessionId: crypto.randomUUID(),
      tabId: 7,
      documentId: "native-capture-document",
      origin: page.origin,
      routeId: LIVE_ROUTE_ID,
      routeVersion: LIVE_VERSION,
      view: {
        routeId: LIVE_ROUTE_ID,
        routeVersion: LIVE_VERSION,
        status: "running",
        instruction: "Find a control",
        verifiedSteps: 0,
        confidence: 0,
        history: [],
        page,
        request,
        journey,
        controls: page.controls,
        goalPlan: {
          goal: request.original,
          status: "unresolved",
          confidence: 0,
          source: "semantics",
          issue: "no-match",
          steps: [],
          reason: "No matching live control",
        },
      },
    },
  };
  const tab = { id: 7, windowId: 4, url: page.origin + "/", active: true };
  const image = readFileSync("tests/fixtures/vision/light.png").toString(
    "base64",
  );
  const scanId = crypto.randomUUID();
  let metadata: CaptureMetadata;
  let current = true;
  const messages: string[] = [];
  const api = {
    runtime: { getURL: () => "chrome-extension://capture-test/" },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
      getZoom: vi.fn(async () => 1.25),
      query: vi.fn(async () => [{ ...tab }]),
      captureVisibleTab: vi.fn(async () => "data:image/png;base64," + image),
      sendMessage: vi.fn(async (_tab: number, message: any) => {
        messages.push(message.type);
        if (message.type === "PREPARE_CAPTURE") {
          metadata = {
            version: 1,
            captureId: message.captureId,
            scanId,
            observationRevision: page.revision,
            viewportRevision: 2,
            at: Date.now(),
            masks: [],
            masking: { version: 1, complete: true },
            viewport: {
              width: 640,
              height: 180,
              scrollX: 0,
              scrollY: 0,
              devicePixelRatio: 1.25,
              visualViewport: {
                width: 640,
                height: 180,
                scale: 1,
                offsetLeft: 0,
                offsetTop: 0,
                pageLeft: 0,
                pageTop: 0,
              },
            },
          };
          return { metadata, view: structuredClone(context.session!.view) };
        }
        return { current, viewportRevision: 2 };
      }),
    },
    windows: {
      get: vi.fn(async () => ({ id: 4, focused: true, state: "normal" })),
    },
    webNavigation: {
      getAllFrames: vi.fn(async () => [
        { frameId: 0, documentId: "native-capture-document" },
      ]),
    },
    permissions: { contains: vi.fn(async () => true) },
  };
  vi.stubGlobal("chrome", api);
  dependencies.presentationVisible.mockResolvedValue(true);
  dependencies.cancelInferenceHost.mockResolvedValue(undefined);
  dependencies.getPrivateSetting.mockResolvedValue({ backend: true });
  dependencies.browserOcr.mockImplementation(async (message) => {
    expect(messages.at(-1)).toBe("RESTORE_CAPTURE");
    if (message.prepareNavigation)
      return {
        image,
        width: 640,
        height: 180,
        maskedAtMs: Date.now(),
        captureId: message.metadata.captureId,
        scanId: message.metadata.scanId,
        observationRevision: message.metadata.observationRevision,
        viewportRevision: message.metadata.viewportRevision,
        source: {
          kind: "viewport",
          cssBounds: { x: 0, y: 0, width: 640, height: 180 },
          captureCssBounds: message.captureCssBounds,
          pixelBounds: { x: 0, y: 0, width: 640, height: 180 },
          bitmapWidth: 640,
          bitmapHeight: 180,
          scaleX: 1,
          scaleY: 1,
          devicePixelRatio: 1.25,
          browserZoom: message.browserZoom,
        },
        masking: {
          version: 1,
          complete: true,
          maskedBeforeTransform: true,
          maskedRegions: 0,
        },
      };
    if (message.prepareOnly)
      return {
        ...message.stamp,
        image,
        width: 640,
        height: 180,
        cssWidth: 640,
        cssHeight: 180,
      };
    const {
      image: _image,
      width: _width,
      height: _height,
      cssWidth: _cssWidth,
      cssHeight: _cssHeight,
      ...stamp
    } = message.prepared;
    return {
      ...stamp,
      regions: [],
      engine: "tesseract-6.0.1-eng-fast",
      elapsedMs: 1,
    };
  });
  dependencies.localNlp.mockImplementation(async (input) => ({
    requestId: input.requestId,
    documentId: input.documentId,
    revision: input.revision,
    status: "unsupported",
    reason: "No unambiguous target",
    activity: {
      embedded: 0,
      cacheHits: 0,
      llmCalls: 0,
      modelRevision: "capture-test",
    },
  }));
  dependencies.backendOcr.mockImplementation(
    async (
      input: RecognitionInput,
      _signal: AbortSignal,
      guard: () => Promise<void>,
    ) => {
      await guard();
      const {
        image: _image,
        width: _width,
        height: _height,
        cssWidth: _cssWidth,
        cssHeight: _cssHeight,
        ...stamp
      } = input;
      return {
        ...stamp,
        regions: [],
        engine: "tesseract-6.0.1-eng-fast",
        elapsedMs: 1,
      };
    },
  );
  const service = createVisionService(context);
  return {
    context,
    service,
    api,
    messages,
    invalidate: () => {
      current = false;
    },
    run: () => service.attemptVision(context.session!.sessionId, request.id),
  };
}

test("capture restores its token before OCR, uses actual native zoom and reads protected vision settings", async () => {
  const app = visionApp();
  await app.run();
  expect(dependencies.localNlp).toHaveBeenCalledOnce();
  expect(dependencies.getPrivateSetting).toHaveBeenCalledWith("vision");
  expect(dependencies.browserOcr.mock.calls[0][0]).toMatchObject({
    browserZoom: 1.25,
    captureCssBounds: { x: 0, y: 0, width: 640, height: 180 },
  });
  expect(app.api.tabs.captureVisibleTab).toHaveBeenCalledWith(4, {
    format: "png",
  });
  expect(app.api.windows.get).toHaveBeenCalledWith(4, { populate: false });
  expect(
    app.api.tabs.query.mock.calls.every(
      ([query]: any[]) => query.windowId === 4 && query.active === true,
    ),
  ).toBe(true);
  expect(app.context.visionJob).toBeUndefined();
  expect(app.service.captureWindowId()).toBeUndefined();
  expect(app.messages).not.toContain("GET_PAGE");
});

test("a capture-time tab/window ABA cancellation discards local pixels before processing", async () => {
  const app = visionApp();
  app.api.tabs.captureVisibleTab.mockImplementation(async () => {
    app.service.cancelVision();
    return "data:image/png;base64,discarded-local-only";
  });
  await app.run();
  expect(dependencies.browserOcr).not.toHaveBeenCalled();
  expect(dependencies.backendOcr).not.toHaveBeenCalled();
  expect(app.messages.at(-1)).toBe("RESTORE_CAPTURE");
});

test("a late privacy change after backend preparation blocks both upload and stale local fallback", async () => {
  const app = visionApp();
  let posts = 0;
  dependencies.backendOcr.mockImplementation(async (_input, _signal, guard) => {
    app.invalidate();
    await guard();
    posts++;
  });
  await app.run();
  expect(posts).toBe(0);
  expect(dependencies.browserOcr).toHaveBeenCalledOnce();
  expect(dependencies.localNlp).not.toHaveBeenCalled();
});

test("a page replacement during the final native await cannot pass the egress guard", async () => {
  const app = visionApp();
  let posts = 0;
  dependencies.backendOcr.mockImplementation(async (_input, _signal, guard) => {
    app.api.windows.get.mockImplementationOnce(async () => {
      app.context.session!.view!.page = {
        ...app.context.session!.view!.page!,
        revision: 99,
      };
      return { id: 4, focused: true, state: "normal" };
    });
    await guard();
    posts++;
  });
  await app.run();
  expect(posts).toBe(0);
  expect(dependencies.localNlp).not.toHaveBeenCalled();
});

test("a tab in an unfocused pinned window is rejected before viewport capture", async () => {
  const app = visionApp();
  app.api.windows.get.mockResolvedValue({
    id: 4,
    focused: false,
    state: "normal",
  });
  await app.run();
  expect(app.api.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(dependencies.browserOcr).not.toHaveBeenCalled();
});

test("repeated recovery requests share one cancellable capture throttle timer", async () => {
  vi.useFakeTimers();
  const app = visionApp();
  app.context.lastCapture = Date.now();
  for (let index = 0; index < 20; index++) await app.run();
  expect(app.api.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
  app.service.cancelVision();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(2500);
  expect(app.api.tabs.captureVisibleTab).not.toHaveBeenCalled();
});

test("a zoom change after the native span starts cannot produce an image", async () => {
  const app = visionApp();
  app.api.tabs.getZoom.mockResolvedValueOnce(1.25).mockResolvedValue(2);
  await app.run();
  expect(app.api.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(dependencies.browserOcr).not.toHaveBeenCalled();
});

test.each(["firefox-gutter", "pinch", "pan"] as const)(
  "%s is rejected before native capture until its source plane is verified",
  async (profile) => {
    const app = visionApp();
    if (profile === "firefox-gutter")
      app.api.runtime.getURL = () => "moz-extension://capture-test/";
    const send = app.api.tabs.sendMessage.getMockImplementation()!;
    app.api.tabs.sendMessage.mockImplementation(async (tab, message) => {
      const reply = await send(tab, message);
      if (
        message.type === "PREPARE_CAPTURE" &&
        "metadata" in reply &&
        reply.metadata
      ) {
        const visual = reply.metadata.viewport.visualViewport;
        if (profile === "firefox-gutter") visual.width -= 12;
        else if (profile === "pinch") {
          visual.scale = 2;
          visual.width /= 2;
          visual.height /= 2;
        } else {
          visual.offsetLeft = 10;
          visual.pageLeft = 10;
          visual.width -= 10;
        }
      }
      return reply;
    });
    await app.run();
    expect(app.api.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(dependencies.browserOcr).not.toHaveBeenCalled();
    expect(app.context.session!.view!.instruction).not.toMatch(
      /renewed capture access/,
    );
  },
);

test("masked navigation pixels retain actual native context without fabricated request generations", async () => {
  const app = visionApp();
  let beforeSend: (() => Promise<void>) | undefined;
  const consume = vi.fn(async (capture, guard) => {
    beforeSend = guard;
    expect(capture.native).toEqual({
      kind: "browser",
      version: 1,
      frameId: 0,
      tabId: 7,
      windowId: 4,
      documentId: "native-capture-document",
    });
    expect(capture.viewport.browserZoom).toBe(1.25);
    expect(capture.pixels).not.toHaveProperty("stamp");
    expect(capture.pixels).not.toHaveProperty("requestGeneration");
    expect(capture.pixels.maskedAtMs).toBeGreaterThanOrEqual(
      capture.capturedAtMs,
    );
    expect(capture.page.revision).toBe(capture.pixels.observationRevision);
    expect(capture.signal.aborted).toBe(false);
    await guard();
  });
  await app.service.withMaskedNavigation(
    app.context.session!.sessionId,
    app.context.session!.view!.request!.id,
    { consume },
  );
  expect(consume).toHaveBeenCalledOnce();
  expect(dependencies.localNlp).not.toHaveBeenCalled();
  expect(dependencies.backendOcr).not.toHaveBeenCalled();
  await expect(beforeSend!()).rejects.toThrow();
});
