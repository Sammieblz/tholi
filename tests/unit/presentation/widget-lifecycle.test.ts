import type { Runtime } from "../../../apps/extension/src/platform/api";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PinnedSession } from "../../../packages/route-registry/session";
import { dockIntent } from "../../../apps/extension/src/ui/widget/presentation-state";
import { contentMessageSchema } from "../../../packages/route-schema/index";
import { fixture } from "../../integration/nlp/fixtures";
import { interpretRequest } from "../../../packages/nlp/interpret";
import { beginJourney } from "../../../packages/goal-planner/task-journey";
import { navigationModelObservation } from "../../support/navigation-model-fixture";

const id = "6692779e-ad63-4da7-82cd-a878c1ae23e1";
function environment(seed: Record<string, unknown> = {}) {
  const local: Record<string, unknown> = {
    tholiPreferences: {
      surface: "widget",
      mode: "conversation",
      advanced: false,
    },
  };
  const stored: Record<string, unknown> = { ...seed };
  const storage = (data: Record<string, unknown>) => ({
    get: vi.fn(async () => ({ ...data })),
    set: vi.fn(async (next: Record<string, unknown>) =>
      Object.assign(data, next),
    ),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
    setAccessLevel: vi.fn(async () => {}),
  });
  const closed = vi.fn();
  const api = {
    runtime: {
      id: "tholi-test",
      getURL: (path: string) => "chrome-extension://tholi-test/" + path,
      onConnect: { addListener: vi.fn() },
    },
    storage: { local: storage(local), session: storage(stored) },
    tabs: {
      sendMessage: vi.fn(
        async (
          _tabId: number,
          _message: any,
          _options?: unknown,
        ): Promise<any> => ({ ok: true }),
      ),
      get: vi.fn(async () => ({ windowId: 4 })),
    },
    webNavigation: {
      getFrame: vi.fn(async () => ({
        documentId: "document-a",
        url: "https://example.com/",
      })),
    },
    sidePanel: {
      open: vi.fn(async () => {}),
      onClosed: { addListener: closed },
    },
  };
  const session = {
    sessionId: id,
    tabId: 7,
    documentId: "document-a",
    origin: "https://example.com",
    routeId: "navigator.live",
    routeVersion: "1.0.0",
    view: {
      status: "running",
      instruction: "Open Settings",
      verifiedSteps: 3,
      history: [],
      confidence: 0.9,
    },
  } as unknown as PinnedSession;
  const sender = {
    id: api.runtime.id,
    tab: { id: 7, windowId: 4 },
    frameId: 0,
    documentId: "document-a",
  } as Runtime.MessageSender;
  vi.stubGlobal("chrome", api);
  return { api, session, sender, stored, closed };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document
    .querySelectorAll("[data-tholi-ui]")
    .forEach((element) => element.remove());
});

it("account RPC accepts only the exact privileged panel and never waits for journey work", async () => {
  const { api, session, sender } = environment();
  const listen = vi.fn();
  Object.assign(api.runtime, { onMessage: { addListener: listen } });
  const auth =
    await import("../../../apps/extension/src/platform/service-auth");
  const operation = vi
    .spyOn(auth, "serviceAuthCommand")
    .mockResolvedValue({ configured: false });
  const { registerMessages } =
    await import("../../../apps/extension/src/background/message-router");
  const enqueue = vi.fn(() => new Promise(() => {}));
  registerMessages({ session, enqueue } as any);
  const handle = listen.mock.calls[0][0];
  for (const untrusted of [
    sender,
    { ...sender, url: api.runtime.getURL("widget.html") },
    {
      ...sender,
      id: "other-extension",
      url: api.runtime.getURL("sidepanel.html"),
    },
    { ...sender, url: api.runtime.getURL("sidepanel.html") + "?spoof=1" },
  ]) {
    const respond = vi.fn();
    handle({ type: "AUTH_STATUS" }, untrusted, respond);
    expect(respond.mock.calls[0][0].error).toBeTruthy();
  }
  expect(operation).not.toHaveBeenCalled();
  const respond = vi.fn();
  expect(
    handle(
      { type: "AUTH_STATUS" },
      { ...sender, url: api.runtime.getURL("sidepanel.html") },
      respond,
    ),
  ).toBe(true);
  await vi.waitFor(() =>
    expect(respond).toHaveBeenCalledWith({ configured: false }),
  );
  expect(enqueue).not.toHaveBeenCalled();
});

it("private service proposals cannot enter through public background messages", async () => {
  const { api, session, sender } = environment();
  const listen = vi.fn();
  Object.assign(api.runtime, { onMessage: { addListener: listen } });
  const { registerMessages } =
    await import("../../../apps/extension/src/background/message-router");
  const enqueue = vi.fn();
  registerMessages({ session, enqueue } as any);
  const handle = listen.mock.calls[0][0];
  for (const source of [
    sender,
    { ...sender, url: api.runtime.getURL("sidepanel.html") },
  ]) {
    const respond = vi.fn();
    handle(
      { type: "APPLY_NAVIGATION_PROPOSAL", sessionId: session.sessionId },
      source,
      respond,
    );
    expect(respond.mock.calls[0][0].error).toContain("background journey");
  }
  expect(enqueue).not.toHaveBeenCalled();
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
});

it("page observation preserves authored recovery messages without exposing browser errors", async () => {
  const { api, session, sender } = environment();
  const listen = vi.fn();
  Object.assign(api.runtime, { onMessage: { addListener: listen } });
  const frames =
    await import("../../../apps/extension/src/background/frame-coordinator");
  const unavailable = "This region is unavailable in the current scan.";
  vi.spyOn(frames, "observePinnedPage")
    .mockRejectedValueOnce(new frames.PageObservationError(unavailable))
    .mockRejectedValueOnce(new Error("browser-private-error-sentinel"));
  const { registerMessages } =
    await import("../../../apps/extension/src/background/message-router");
  registerMessages({
    session,
    goalGeneration: 0,
    live: () => true,
    activeTab: async () => ({ id: session.tabId, windowId: 4 }),
    enqueue: async (operation: () => Promise<unknown>) => operation(),
  } as any);
  const handle = listen.mock.calls[0][0];
  for (const error of [
    unavailable,
    "The native page observation changed. Observe the page again.",
  ]) {
    const respond = vi.fn();
    handle(
      { type: "GET_PAGE" },
      { ...sender, url: api.runtime.getURL("sidepanel.html") },
      respond,
    );
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ error }));
  }
});

it.each([
  "guide",
  "unavailable",
  "mutated",
  "status-error",
  "status-invalid",
  "suggestion",
  "coalesced",
  "queued-cancel",
] as const)(
  "explicit service enrichment keeps the local queue available and handles %s without a second provider",
  async (scenario) => {
    const { api, session, sender } = environment();
    const page = { ...fixture(), origin: session.origin! };
    Object.assign(api.tabs, {
      get: vi.fn(async () => ({
        id: 7,
        windowId: 4,
        url: session.origin + "/",
      })),
    });
    Object.assign(api, { permissions: { contains: vi.fn(async () => true) } });
    const auth =
      await import("../../../apps/extension/src/platform/service-auth");
    const selection = {
      configured: true,
      profile: "fake",
      enabled: true,
      images: false,
    };
    const configuration = vi
      .spyOn(auth, "serviceAuthCommand")
      .mockResolvedValue(selection);
    if (scenario === "status-error")
      configuration.mockRejectedValue(
        new Error("synthetic settings unavailable"),
      );
    if (scenario === "status-invalid")
      configuration.mockResolvedValue({ configured: true });
    const local = await import("../../../apps/extension/src/inference/client");
    const planning = vi
      .spyOn(local, "localNlp")
      .mockImplementation(async (input, _site, suggestions) => {
        if (suggestions) return [];
        const request = interpretRequest(input.text);
        request.id = input.requestId;
        return {
          requestId: input.requestId,
          documentId: input.documentId,
          revision: input.revision,
          contextRevision: input.contextRevision,
          protocolVersion: 2,
          status: "unsupported",
          request,
          reason: "No local match.",
          activity: {
            embedded: 0,
            cacheHits: 0,
            llmCalls: 0,
            modelRevision: "test",
          },
        };
      });
    const backend =
      await import("../../../apps/extension/src/platform/backend-client");
    const legacy = vi.spyOn(backend, "backendNlp").mockResolvedValue(undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = {
      ...navigationModelObservation().native,
      tabId: 7,
      windowId: 4,
      documentId: session.documentId!,
    };
    const frames =
      await import("../../../apps/extension/src/background/frame-coordinator");
    vi.spyOn(frames, "observePinnedPage").mockImplementation(async () => {
      const view = structuredClone({ ...session.view!, page });
      return {
        view,
        page: structuredClone(page),
        viewportRevision: 1,
        start: {
          epoch: 1,
          zoom: 1,
          tabId: 7,
          windowId: 4,
          documentId: session.documentId!,
        },
        perception: {
          version: 1,
          pageRevision: page.revision,
          native,
          frames: [
            {
              native,
              viewport: navigationModelObservation().frames[0].viewport,
              scanId: crypto.randomUUID(),
              pageRevision: page.revision,
            },
          ],
          regions: [],
          controlRegions: page.controls.map((control) => ({
            reference: { ...native, controlId: control.id },
          })),
          coverage: [
            {
              frameId: 0,
              indexedControls: page.controls.length,
              snapshotControls: page.controls.length,
              regions: 0,
              controlRegions: 0,
              hierarchyTruncated: false,
              partial: false,
              reasons: [],
            },
          ],
          omissions: {
            frames: 0,
            regions: 0,
            controls: 0,
            hierarchyTruncated: false,
            partial: false,
            reasons: [],
          },
        },
      };
    });
    const remote = vi
      .spyOn(backend, "backendNavigation")
      .mockImplementation(async (input, _current, beforeSend) => {
        await beforeSend();
        await gate;
        if (scenario === "unavailable")
          throw new Error("synthetic service unavailable");
        return {
          requestId: input.requestId,
          status: "completed",
          replayed: false,
          decision: {
            protocol: input.observation.protocol,
            version: input.observation.version,
            native: input.observation.native,
            stamp: input.observation.stamp,
            decision: {
              kind: "guide",
              reference: input.observation.controls[0].reference,
              message: "Use the current control.",
            },
          },
        };
      });
    api.tabs.sendMessage.mockImplementation(async (_tab, message) => {
      if (message.type === "GET_PAGE")
        return { page: structuredClone(page), view: session.view };
      if (message.type === "INSTALL_REQUEST") {
        const request = message.result.request;
        return {
          view: {
            ...session.view!,
            page,
            controls: page.controls,
            request,
            journey: {
              ...beginJourney(request.original, session.origin!),
              requestTaskId: request.tasks[request.active].id,
            },
          },
        };
      }
      if (message.type === "APPLY_NAVIGATION_PROPOSAL")
        return { view: session.view };
      return { ok: true };
    });
    let queue: Promise<unknown> = Promise.resolve();
    let queueGate: Promise<void> | undefined;
    let releaseQueue: (() => void) | undefined;
    let releaseConfiguration: (() => void) | undefined;
    const context = {
      goalGeneration: 0,
      session,
      enqueue: <T>(operation: () => Promise<T>): Promise<T> => {
        const next = queue.then(async () => {
          if (queueGate) await queueGate;
          return operation();
        });
        queue = next.catch(() => {});
        return next;
      },
      live: () => true,
      inScope: () => true,
      knownSites: new Map(),
      knownTasks: new Map(),
      suspended: [],
      attemptVision: vi.fn(),
      acceptView: async (view: any) => {
        session.view = view;
      },
      save: vi.fn(),
      remember: vi.fn(),
    };
    const { createJourneyService } =
      await import("../../../apps/extension/src/background/journey-service");
    const service = createJourneyService(context);
    await service.handleNlp(
      scenario === "suggestion"
        ? { type: "NLP_SUGGEST", text: "Find the amber compass", requestId: id }
        : {
            type: "SET_GOAL",
            goal: "Find the amber compass",
            revision: page.revision,
            sessionId: id,
            documentId: session.documentId,
          },
      { ...sender, url: api.runtime.getURL("sidepanel.html") },
    );
    try {
      if (
        scenario === "status-error" ||
        scenario === "status-invalid" ||
        scenario === "suggestion"
      ) {
        expect(planning).toHaveBeenCalledOnce();
        expect(legacy).not.toHaveBeenCalled();
        expect(remote).not.toHaveBeenCalled();
        expect(context.attemptVision).not.toHaveBeenCalled();
        if (scenario !== "suggestion")
          expect(session.view!.request?.original).toBe(
            "Find the amber compass",
          );
        return;
      }
      if (scenario === "queued-cancel") {
        queueGate = new Promise<void>((resolve) => {
          releaseQueue = resolve;
        });
        await vi.waitFor(() =>
          expect(session.view!.serviceNavigation?.state).toBe("pending"),
        );
        auth.cancelServiceInference();
        await vi.waitFor(() =>
          expect(session.view!.serviceNavigation).toMatchObject({
            state: "error",
            code: "CANCELLED",
          }),
        );
        releaseQueue!();
        queueGate = undefined;
        await queue;
        expect(remote).not.toHaveBeenCalled();
        expect(planning).toHaveBeenCalledOnce();
        return;
      }
      if (scenario === "coalesced") {
        const request = session.view!.request!;
        await Promise.all(
          [1, 2].map(() =>
            service.handleNlp(
              { type: "NLP_REPLAN", sessionId: id, request },
              { ...sender, url: "https://example.com/" },
            ),
          ),
        );
        const configurationGate = new Promise<void>((resolve) => {
          releaseConfiguration = resolve;
        });
        configuration.mockImplementation(async () => {
          await configurationGate;
          return selection;
        });
        await vi.waitFor(() =>
          expect(configuration.mock.calls.length).toBeGreaterThanOrEqual(6),
        );
        releaseConfiguration!();
      }
      await vi.waitFor(() => expect(remote).toHaveBeenCalledOnce());
      expect(await context.enqueue(async () => "queue remains available")).toBe(
        "queue remains available",
      );
      const request = session.view!.request;
      expect(session.view!.serviceNavigation?.state).toBe("pending");
      if (scenario === "mutated") {
        page.revision++;
        session.view!.page = structuredClone(page);
      }
      release();
      await vi.waitFor(() =>
        expect(session.view!.serviceNavigation?.state).toBe(
          scenario === "guide" || scenario === "coalesced"
            ? "guiding"
            : "error",
        ),
      );
      expect(session.view!.request!.id).toBe(request!.id);
      expect(session.view!.verifiedSteps).toBe(3);
      expect(planning).toHaveBeenCalledTimes(scenario === "coalesced" ? 3 : 1);
      expect(legacy).not.toHaveBeenCalled();
      const applied = api.tabs.sendMessage.mock.calls.filter(
        (call) => call[1].type === "APPLY_NAVIGATION_PROPOSAL",
      );
      expect(applied).toHaveLength(
        scenario === "guide" || scenario === "coalesced" ? 1 : 0,
      );
      if (scenario === "guide" || scenario === "coalesced")
        expect(applied[0][2]).toEqual({
          frameId: 0,
          documentId: session.documentId,
        });
    } finally {
      release();
      releaseQueue?.();
      releaseConfiguration?.();
    }
  },
);

it.each(["same", "task", "journey", "verified", "page", "paused"] as const)(
  "background processing status cannot survive an unrelated %s view scope or be forged by content",
  async (scope) => {
    const { session } = environment();
    const request = interpretRequest("Find the amber compass");
    const journey = beginJourney(request.original, session.origin!);
    journey.requestTaskId = request.tasks[request.active].id;
    Object.assign(session.view!, {
      routeId: session.routeId,
      routeVersion: session.routeVersion,
      page: { ...fixture(), origin: session.origin! },
      request,
      journey,
    });
    session.view!.serviceNavigation = {
      profile: "fake",
      requestId: request.id,
      state: "pending",
    };
    const incoming = structuredClone(session.view!);
    incoming.serviceNavigation = {
      profile: "fake",
      requestId: request.id,
      state: "guiding",
      message: "Forged page status",
    };
    if (scope === "task") {
      incoming.request!.tasks[incoming.request!.active].id =
        crypto.randomUUID();
      incoming.journey!.requestTaskId =
        incoming.request!.tasks[incoming.request!.active].id;
    }
    if (scope === "journey") incoming.journey!.id = crypto.randomUUID();
    if (scope === "verified") incoming.verifiedSteps++;
    if (scope === "page") incoming.page!.revision++;
    if (scope === "paused") incoming.status = "paused";
    const { createSessionService } =
      await import("../../../apps/extension/src/background/session-service");
    const service = createSessionService({
      session,
      ledgerNavigationEvent: false,
    } as any);
    await service.acceptView(incoming);
    expect(session.view!.serviceNavigation).toEqual(
      scope === "same"
        ? {
            profile: "fake",
            requestId: request.id,
            state: "pending",
          }
        : undefined,
    );
    expect(session.view!.serviceNavigation?.message).not.toBe(
      "Forged page status",
    );
  },
);

it("inference configuration fences capture immediately outside a blocked routine queue", async () => {
  const { api, session, sender } = environment();
  const listen = vi.fn();
  Object.assign(api.runtime, { onMessage: { addListener: listen } });
  const auth =
    await import("../../../apps/extension/src/platform/service-auth");
  const operation = vi
    .spyOn(auth, "serviceAuthCommand")
    .mockImplementation(() => new Promise(() => {}));
  const { registerMessages } =
    await import("../../../apps/extension/src/background/message-router");
  const cancelVision = vi.fn();
  const enqueue = vi.fn(() => new Promise(() => {}));
  registerMessages({ session, cancelVision, enqueue } as any);
  const handle = listen.mock.calls[0][0];
  const command = {
    type: "AUTH_INFERENCE_CONFIGURE",
    profile: "fake",
    enabled: false,
    images: false,
  };
  handle(command, sender, vi.fn());
  expect(cancelVision).not.toHaveBeenCalled();
  expect(operation).not.toHaveBeenCalled();
  handle(
    command,
    { ...sender, url: api.runtime.getURL("sidepanel.html") },
    vi.fn(),
  );
  expect(cancelVision).toHaveBeenCalledOnce();
  expect(operation).toHaveBeenCalledWith(command);
  expect(enqueue).not.toHaveBeenCalled();
});

type AccountMessage = {
  type: string;
  enabled?: boolean;
  images?: boolean;
};
function inferenceReply(enabled = false, images = false) {
  return {
    configured: true,
    profile: "fake",
    enabled,
    images,
    serverConsentUpdated: true,
  };
}
function pendingAccountReply<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function accountReply() {
  return {
    configured: true,
    origin: "https://service.example.test",
    account: {
      id,
      workspaceId: "00000000-0000-4000-8000-000000000002",
      revision: "1",
    },
    session: {
      id,
      clientId: "extension-chromium",
      clientKind: "extension",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
}
async function withAccountSettings(
  options: {
    initial?: { enabled: boolean; images: boolean };
    reply?: (message: AccountMessage) => unknown;
  },
  verify: (fixture: {
    container: HTMLDivElement;
    local: HTMLInputElement;
    connected: HTMLInputElement;
    images: HTMLInputElement;
    events: string[];
    request: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
  }) => Promise<void>,
) {
  const { api } = environment();
  const events: string[] = [];
  const request = vi.fn(async () => {
    events.push("permission");
    return true;
  });
  Object.assign(api, { permissions: { request } });
  const rpc = vi.fn(async (message: AccountMessage) => {
    const supplied = options.reply?.(message);
    if (supplied !== undefined) return supplied;
    if (message.type === "AUTH_STATUS") return accountReply();
    if (message.type === "AUTH_INFERENCE_STATUS")
      return inferenceReply(options.initial?.enabled, options.initial?.images);
    if (message.type === "AUTH_INFERENCE_CONFIGURE") {
      events.push(message.enabled ? "enable" : "disable");
      return inferenceReply(!!message.enabled, !!message.images);
    }
    throw new Error("Unexpected fixture command");
  });
  Object.assign(api.runtime, { sendMessage: rpc });
  const { AccountSettings } =
    await import("../../../apps/extension/src/ui/features/account/AccountSettings");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const reactGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousAct = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => root.render(createElement(AccountSettings)));
    const fieldset = container.querySelector<HTMLFieldSetElement>(
      ".tholi-inference-settings",
    )!;
    expect(fieldset).not.toBeNull();
    await verify({
      container,
      local: fieldset.querySelector<HTMLInputElement>('input[value="local"]')!,
      connected: fieldset.querySelector<HTMLInputElement>(
        'input[value="connected"]',
      )!,
      images: fieldset.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      )!,
      events,
      request,
      rpc,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
}

it("inference choices keep native access in the enabling gesture, preserve the current choice if it throws and withdraw without another grant", async () => {
  await withAccountSettings(
    {},
    async ({ container, local, connected, images, events, request, rpc }) => {
      for (const control of [local, connected, images]) {
        const described = control.getAttribute("aria-describedby")!;
        expect(document.getElementById(described)?.textContent).toBeTruthy();
      }
      expect(container.textContent).toContain(
        "separate image-transmission consent",
      );
      expect(container.textContent).toContain(
        "authorizes sanitized page-context transmission",
      );
      expect(
        container.querySelectorAll(".tholi-inference-settings button"),
      ).toHaveLength(0);
      await act(async () => {
        connected.click();
        expect(request).toHaveBeenCalledOnce();
        expect(events).toEqual(["permission"]);
      });
      expect(events).toEqual(["permission", "enable"]);
      expect(request).toHaveBeenCalledWith({
        origins: ["https://service.example.test/*"],
      });
      const beforeFailure = rpc.mock.calls.length;
      request.mockImplementationOnce(() => {
        throw new Error("Native request unavailable");
      });
      await act(async () => images.click());
      expect(connected.checked).toBe(true);
      expect(images.checked).toBe(false);
      expect(rpc.mock.calls).toHaveLength(beforeFailure);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "processing choice is unchanged",
      );
      request.mockResolvedValueOnce(false);
      await act(async () => images.click());
      expect(connected.checked).toBe(true);
      expect(images.checked).toBe(false);
      expect(rpc.mock.calls).toHaveLength(beforeFailure);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "access was not granted",
      );
      await act(async () => local.click());
      expect(events).toEqual(["permission", "enable", "disable"]);
      expect(request).toHaveBeenCalledTimes(3);
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "withdrawal is confirmed",
      );
      expect(local.checked).toBe(true);
    },
  );
});

it.each(["Local", "images"])(
  "temporary operator evaluation is labelled honestly and %s withdrawal uses the existing Local owner",
  async (action) => {
    await withAccountSettings(
      {
        reply: (message) =>
          message.type === "AUTH_INFERENCE_STATUS"
            ? {
                configured: true,
                profile: "operator-evaluation",
                enabled: true,
                images: true,
                evaluation: {
                  profile: "operator-evaluation",
                  planSha256: "a".repeat(64),
                  provider: "vertex",
                  runtimeManifestSha256: "b".repeat(64),
                  expiresAtMs: Date.now() + 60000,
                  trialId: crypto.randomUUID(),
                  arm: "multimodal",
                },
              }
            : undefined,
      },
      async ({ container, local, connected, images, request, rpc }) => {
        expect(container.textContent).toContain(
          "Temporary operator evaluation",
        );
        expect(container.textContent).toContain("Vertex, multimodal");
        expect(connected.checked).toBe(false);
        expect(
          container.querySelector<HTMLInputElement>(
            'input[value="operator-evaluation"]',
          )?.checked,
        ).toBe(true);
        await act(async () => (action === "Local" ? local : images).click());
        expect(rpc).toHaveBeenLastCalledWith({
          type: "AUTH_INFERENCE_CONFIGURE",
          profile: "fake",
          enabled: false,
          images: false,
        });
        expect(local.checked).toBe(true);
        expect(container.textContent).not.toContain(
          "Temporary operator evaluation",
        );
        expect(request).not.toHaveBeenCalled();
      },
    );
  },
);

it.each(["native access", "service consent"])(
  "Local immediately fences a pending first enable during %s and ignores its late result",
  async (phase) => {
    const enable = pendingAccountReply();
    const access = pendingAccountReply<boolean>();
    await withAccountSettings(
      {
        reply: (message) =>
          phase === "service consent" &&
          message.type === "AUTH_INFERENCE_CONFIGURE" &&
          message.enabled
            ? enable.promise
            : undefined,
      },
      async ({ container, local, connected, request, rpc }) => {
        if (phase === "native access")
          request.mockImplementationOnce(() => access.promise);
        await act(async () => connected.click());
        expect(connected.checked).toBe(true);
        expect(local.disabled).toBe(false);
        await act(async () => {
          local.click();
          expect(rpc).toHaveBeenLastCalledWith({
            type: "AUTH_INFERENCE_CONFIGURE",
            profile: "fake",
            enabled: false,
            images: false,
          });
        });
        await act(async () => {
          access.resolve(true);
          enable.resolve(inferenceReply(true));
        });
        expect(local.checked).toBe(true);
        expect(connected.checked).toBe(false);
        expect(request).toHaveBeenCalledOnce();
        if (phase === "native access")
          expect(
            rpc.mock.calls.some(
              ([message]) =>
                message.type === "AUTH_INFERENCE_CONFIGURE" && message.enabled,
            ),
          ).toBe(false);
        expect(
          container.querySelector('[role="status"]')?.textContent,
        ).toContain("withdrawal is confirmed");
      },
    );
  },
);

it.each([
  { type: "AUTH_STATUS", metadataFails: false },
  { type: "AUTH_INFERENCE_STATUS", metadataFails: false },
  { type: "AUTH_STATUS", metadataFails: true },
])(
  "Local fences initial $type, refreshes only account metadata and keeps its acknowledgement when metadataFails=$metadataFails",
  async ({ type, metadataFails }) => {
    const read = pendingAccountReply();
    let firstRead = true;
    let accountReads = 0;
    await withAccountSettings(
      {
        reply: (message) => {
          if (message.type === "AUTH_STATUS") {
            accountReads++;
            if (metadataFails && accountReads > 1)
              return { error: "Metadata unavailable" };
          }
          if (message.type === type && firstRead) {
            firstRead = false;
            return read.promise;
          }
          return undefined;
        },
      },
      async ({ container, local, connected, request, rpc }) => {
        expect(local.checked).toBe(true);
        expect(local.disabled).toBe(false);
        expect(connected.disabled).toBe(true);
        await act(async () => local.click());
        expect(
          rpc.mock.calls.filter(
            ([message]) => message.type === "AUTH_INFERENCE_CONFIGURE",
          ),
        ).toEqual([
          [
            {
              type: "AUTH_INFERENCE_CONFIGURE",
              profile: "fake",
              enabled: false,
              images: false,
            },
          ],
        ]);
        await act(async () =>
          read.resolve(
            type === "AUTH_STATUS"
              ? accountReply()
              : inferenceReply(true, true),
          ),
        );
        expect(local.checked).toBe(true);
        expect(connected.checked).toBe(false);
        expect(request).not.toHaveBeenCalled();
        expect(accountReads).toBe(2);
        if (metadataFails) {
          expect(
            container.querySelector('[role="alert"]')?.textContent,
          ).toContain("account details could not be refreshed");
          expect(
            container.querySelector('[role="status"]')?.textContent,
          ).toContain("Browser transmission is off");
        } else {
          expect(container.textContent).toContain("Signed in");
          expect(connected.disabled).toBe(false);
        }
        if (type === "AUTH_STATUS")
          expect(
            rpc.mock.calls.some(
              ([message]) => message.type === "AUTH_INFERENCE_STATUS",
            ),
          ).toBe(false);
      },
    );
  },
);

it("image withdrawal fences a pending first image enable without requesting another grant", async () => {
  const enable = pendingAccountReply();
  await withAccountSettings(
    {
      initial: { enabled: true, images: false },
      reply: (message) =>
        message.type === "AUTH_INFERENCE_CONFIGURE" && message.images
          ? enable.promise
          : undefined,
    },
    async ({ connected, images, request, rpc }) => {
      await act(async () => images.click());
      expect(images.checked).toBe(true);
      expect(images.disabled).toBe(false);
      await act(async () => {
        images.click();
        expect(rpc).toHaveBeenLastCalledWith({
          type: "AUTH_INFERENCE_CONFIGURE",
          profile: "fake",
          enabled: true,
          images: false,
        });
      });
      await act(async () => enable.resolve(inferenceReply(true, true)));
      expect(connected.checked).toBe(true);
      expect(images.checked).toBe(false);
      expect(request).toHaveBeenCalledOnce();
    },
  );
});

it.each(["stale enabled read", "failed withdrawal read"])(
  "processing failure recovery handles %s without claiming an unconfirmed choice",
  async (scenario) => {
    const recovery = pendingAccountReply();
    let reads = 0;
    await withAccountSettings(
      {
        initial: {
          enabled: scenario === "failed withdrawal read",
          images: false,
        },
        reply: (message) => {
          if (message.type === "AUTH_INFERENCE_STATUS" && ++reads > 1)
            return recovery.promise;
          if (
            message.type === "AUTH_INFERENCE_CONFIGURE" &&
            (scenario === "failed withdrawal read"
              ? !message.enabled
              : message.enabled)
          )
            return { error: "test failure" };
          return undefined;
        },
      },
      async ({ local, connected, images, container }) => {
        await act(async () =>
          (scenario === "failed withdrawal read" ? local : connected).click(),
        );
        expect(reads).toBe(2);
        if (scenario === "failed withdrawal read") {
          await act(async () =>
            recovery.reject(new Error("Status unavailable")),
          );
          expect(local.checked).toBe(false);
          expect(connected.checked).toBe(true);
          expect(
            container.querySelector('[role="alert"]')?.textContent,
          ).toContain("last confirmed choice is shown");
          expect(
            container.querySelector('[role="status"]')?.textContent,
          ).not.toContain("transmission is off");
          return;
        }
        await act(async () => local.click());
        await act(async () => recovery.resolve(inferenceReply(true, true)));
        expect(local.checked).toBe(true);
        expect(connected.checked).toBe(false);
        expect(images.checked).toBe(false);
        expect(container.querySelector('[role="alert"]')?.textContent).toBe("");
        expect(
          container.querySelector('[role="status"]')?.textContent,
        ).toContain("withdrawal is confirmed");
      },
    );
  },
);

it.each(["AUTH_REFRESH", "AUTH_CONFIGURE"])(
  "a completed old %s operation cannot reload enabled choices after Local",
  async (type) => {
    const operation = pendingAccountReply();
    await withAccountSettings(
      {
        initial: { enabled: true, images: false },
        reply: (message) =>
          message.type === type ? operation.promise : undefined,
      },
      async ({ container, local, connected, rpc }) => {
        const action = [...container.querySelectorAll("button")].find(
          (button) =>
            button.textContent ===
            (type === "AUTH_REFRESH" ? "Renew session" : "Save service origin"),
        )!;
        await act(async () => action.click());
        await act(async () => local.click());
        const readCount = rpc.mock.calls.filter(
          ([message]) => message.type === "AUTH_STATUS",
        ).length;
        await act(async () => operation.resolve({ ok: true }));
        expect(
          rpc.mock.calls.filter(([message]) => message.type === "AUTH_STATUS"),
        ).toHaveLength(readCount);
        expect(local.checked).toBe(true);
        expect(connected.checked).toBe(false);
      },
    );
  },
);

it("Pause and Stop bypass a blocked routine queue and unresponsive page without accepting stale controls", async () => {
  const { api, session, sender } = environment();
  const listen = vi.fn();
  Object.assign(api.runtime, { onMessage: { addListener: listen } });
  const local = await import("../../../apps/extension/src/inference/client");
  const cancel = vi.spyOn(local, "cancelNlp").mockResolvedValue();
  api.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
  const save = vi.fn(async () => {});
  const context = {
    session,
    goalGeneration: 0,
    ready: Promise.resolve(),
    save,
    enqueue: vi.fn(() => new Promise(() => {})),
    cancelVision: vi.fn(),
    navigationStarts: new Map(),
  };
  const { createSessionService } =
    await import("../../../apps/extension/src/background/session-service");
  const service = createSessionService(context as any);
  const { registerMessages } =
    await import("../../../apps/extension/src/background/message-router");
  registerMessages({
    ...context,
    interruptSession: service.interruptSession,
  } as any);
  const handle = listen.mock.calls[0][0];
  const panel = { ...sender, url: api.runtime.getURL("sidepanel.html") };
  for (const type of ["PAUSE", "STOP"]) {
    session.view!.status = "running";
    session.view!.request = { id, status: "active" } as any;
    const respond = vi.fn();
    handle({ type, sessionId: id, documentId: "document-a" }, panel, respond);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
    expect(context.enqueue).not.toHaveBeenCalled();
    expect(session.view!.status).toBe(type === "PAUSE" ? "paused" : "stopped");
    expect(session.view!.request!.status).toBe(
      type === "PAUSE" ? "paused" : "canceled",
    );
    expect(session.view!.page).toBeUndefined();
  }
  expect(cancel).toHaveBeenCalledTimes(2);
  const stale = vi.fn();
  handle({ type: "STOP", sessionId: id, documentId: "older" }, panel, stale);
  expect(stale.mock.calls[0][0].error).toBeTruthy();
  expect(cancel).toHaveBeenCalledTimes(2);
});

it.each([
  { type: "SET_VISION", backend: false },
  {
    type: "SET_BACKEND",
    enabled: false,
    url: "https://api.example.test",
    token: "",
  },
])("$type cancels capture before a blocked settings write", async (command) => {
  const { api, session, sender } = environment();
  const listen = vi.fn();
  Object.assign(api.runtime, { onMessage: { addListener: listen } });
  const { registerMessages } =
    await import("../../../apps/extension/src/background/message-router");
  const active = new AbortController();
  const cancelVision = vi.fn(() => active.abort());
  const enqueue = vi.fn(() => {
    expect(active.signal.aborted).toBe(true);
    return new Promise(() => {});
  });
  registerMessages({ session, enqueue, cancelVision } as any);
  const handle = listen.mock.calls[0][0];
  handle(
    command,
    { ...sender, url: api.runtime.getURL("sidepanel.html") },
    vi.fn(),
  );
  expect(cancelVision).toHaveBeenCalledOnce();
  expect(enqueue).toHaveBeenCalledOnce();
});

it("scan churn retains submitted intent but suggestions cannot install a task", async () => {
  const { api, session, sender } = environment();
  const page = { ...fixture(), revision: 1 };
  const local = await import("../../../apps/extension/src/inference/client");
  const backend =
    await import("../../../apps/extension/src/platform/backend-client");
  vi.spyOn(backend, "backendNlp").mockResolvedValue(undefined);
  const planning = vi
    .spyOn(local, "localNlp")
    .mockImplementation(async (input) => {
      page.revision++;
      return {
        requestId: input.requestId,
        documentId: input.documentId,
        revision: input.revision,
      };
    });
  api.tabs.sendMessage.mockImplementation(
    async (_tab: number, message: any) => {
      if (message.type === "GET_PAGE")
        return { page: structuredClone(page), view: session.view };
      if (message.type === "INSTALL_REQUEST")
        return {
          view: { ...session.view, page, request: message.result.request },
        };
      return { ok: true };
    },
  );
  const context = {
    goalGeneration: 0,
    session,
    enqueue: async <T>(operation: () => Promise<T>) => operation(),
    live: () => true,
    inScope: () => true,
    knownSites: new Map(),
    knownTasks: new Map(),
    suspended: [],
    attemptVision: vi.fn(),
    acceptView: async (view: any) => {
      session.view = view;
    },
    save: vi.fn(),
    remember: vi.fn(),
  };
  const { createJourneyService } =
    await import("../../../apps/extension/src/background/journey-service");
  const service = createJourneyService(context);
  const panel = { ...sender, url: api.runtime.getURL("sidepanel.html") };
  const suggestion = await service.handleNlp(
    { type: "NLP_SUGGEST", text: "Open Help", requestId: id },
    panel,
  );
  expect(suggestion).toMatchObject({ suggestions: [] });
  expect(session.view!.request).toBeUndefined();
  expect(
    api.tabs.sendMessage.mock.calls.some(
      (call: any) => call[1]?.type === "INSTALL_REQUEST",
    ),
  ).toBe(false);
  planning.mockClear();
  const reply = await service.handleNlp(
    {
      type: "SET_GOAL",
      goal: "Open Help",
      revision: 0,
      sessionId: id,
      documentId: "document-a",
    },
    panel,
  );
  expect(planning).toHaveBeenCalledTimes(2);
  expect(reply).not.toHaveProperty("error");
  expect(session.view!.request?.original).toBe("Open Help");
  expect(session.view!.verifiedSteps).toBe(3);
});

it.each(["already running", "arrives during foreground"])(
  "background continuation %s cannot replace foreground intent",
  async (scenario) => {
    const { api, session, sender } = environment();
    const page = { ...fixture(), revision: 1 };
    const oldRequest = interpretRequest("Open old destination");
    session.view!.request = oldRequest;
    const local = await import("../../../apps/extension/src/inference/client");
    const backend =
      await import("../../../apps/extension/src/platform/backend-client");
    vi.spyOn(backend, "backendNlp").mockResolvedValue(undefined);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const planning = vi
      .spyOn(local, "localNlp")
      .mockImplementation(async (input) => {
        if (first) {
          first = false;
          await gate;
        }
        page.revision++;
        return {
          requestId: input.requestId,
          documentId: input.documentId,
          revision: input.revision,
        };
      });
    api.tabs.sendMessage.mockImplementation(
      async (_tab: number, message: any) => {
        if (message.type === "GET_PAGE")
          return { page: structuredClone(page), view: session.view };
        if (message.type === "INSTALL_REQUEST")
          return {
            view: { ...session.view, page, request: message.result.request },
          };
        return { ok: true };
      },
    );
    const context = {
      goalGeneration: 0,
      session,
      enqueue: async <T>(operation: () => Promise<T>) => operation(),
      live: () => true,
      inScope: () => true,
      knownSites: new Map(),
      knownTasks: new Map(),
      suspended: [],
      attemptVision: vi.fn(),
      acceptView: async (view: any) => {
        session.view = view;
      },
      save: vi.fn(),
      remember: vi.fn(),
    };
    const { createJourneyService } =
      await import("../../../apps/extension/src/background/journey-service");
    const service = createJourneyService(context);
    const panel = { ...sender, url: api.runtime.getURL("sidepanel.html") };
    const content = { ...sender, url: "https://example.com/" };
    const background = () =>
      service
        .handleNlp(
          { type: "NLP_REPLAN", sessionId: id, request: oldRequest },
          content,
        )
        .then(
          (value) => ({ value, error: undefined }),
          (error: Error) => ({ value: undefined, error }),
        );
    const foreground = () =>
      service.handleNlp(
        {
          type: "SET_GOAL",
          goal: "Open new destination",
          revision: 0,
          sessionId: id,
          documentId: "document-a",
        },
        panel,
      );
    try {
      if (scenario === "already running") {
        const older = background();
        await vi.waitFor(() => expect(planning).toHaveBeenCalledOnce());
        const current = await foreground();
        release!();
        expect((await older).error?.message).toMatch(/foreground destination/);
        expect(current).toMatchObject({
          view: { request: { original: "Open new destination" } },
        });
      } else {
        const current = foreground();
        await vi.waitFor(() => expect(planning).toHaveBeenCalledOnce());
        const reads = api.tabs.sendMessage.mock.calls.length;
        expect((await background()).error?.message).toMatch(
          /foreground destination/,
        );
        expect(api.tabs.sendMessage.mock.calls).toHaveLength(reads);
        release!();
        expect(await current).toMatchObject({
          view: { request: { original: "Open new destination" } },
        });
      }
      const intents = api.tabs.sendMessage.mock.calls
        .map((call: any) => call[1].planningIntent)
        .filter(Boolean);
      expect(intents).toHaveLength(2);
      expect(intents[0]).toMatchObject({ phase: "begin" });
      expect(intents[1]).toEqual({ id: intents[0].id, phase: "end" });
      expect(session.view!.request?.original).toBe("Open new destination");
      expect(session.view!.verifiedSteps).toBe(3);
    } finally {
      release!();
    }
  },
);

it("assistance requires opt-in, the current document and a visible active surface", async () => {
  const { api, session, sender } = environment();
  Object.assign(api.tabs, {
    query: vi.fn(async () => [{ id: session.tabId }]),
  });
  Object.assign(session.view!, {
    request: { id, status: "active" },
    page: { revision: 3 },
    selectedControlId: "w0000000000000000-0",
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  const panel = { ...sender, url: api.runtime.getURL("sidepanel.html") };
  const command = {
    type: "UI_ASSIST_STEP",
    sessionId: id,
    documentId: "document-a",
    requestId: id,
    revision: 3,
    controlId: "w0000000000000000-0",
  };
  expect(await ui.uiMessage(command, panel, session)).toEqual({
    assisted: false,
  });
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  await api.storage.local.set({
    tholiPreferences: {
      mode: "guide",
      surface: "widget",
      advanced: false,
      assisted: true,
    },
  });
  await expect(
    ui.uiMessage({ ...command, documentId: "stale" }, panel, session),
  ).rejects.toThrow("Stale assistance");
  expect(
    await ui.uiMessage({ ...command, revision: 2 }, panel, session),
  ).toEqual({ assisted: false });
  await ui.uiMessage({ type: "UI_MINIMIZE", sessionId: id }, sender, session);
  api.tabs.sendMessage.mockClear();
  expect(await ui.uiMessage(command, panel, session)).toEqual({
    assisted: false,
  });
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  await ui.uiMessage({ type: "UI_RESTORE", sessionId: id }, sender, session);
  api.tabs.sendMessage.mockClear();
  await ui.uiMessage(command, panel, session);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    session.tabId,
    { ...command, type: "ASSIST_STEP" },
    { frameId: 0 },
  );
  session.view!.status = "paused";
  api.tabs.sendMessage.mockClear();
  expect(await ui.uiMessage(command, panel, session)).toEqual({
    assisted: false,
  });
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
});

it("dismisses the launcher without erasing the task and stays hidden after worker restart", async () => {
  const { api, session, sender, stored } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  const before = structuredClone(session);
  await expect(
    ui.uiMessage(
      { type: "UI_DISMISS", sessionId: id },
      { ...sender, documentId: "old-document" },
      session,
    ),
  ).rejects.toThrow("Trusted");
  await expect(
    ui.uiMessage(
      { type: "UI_DISMISS", sessionId: "old-task" },
      sender,
      session,
    ),
  ).rejects.toThrow("older task");
  await ui.uiMessage({ type: "UI_DISMISS", sessionId: id }, sender, session);
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "hidden",
  });
  expect(await ui.presentationVisible(session)).toBe(false);
  expect(session).toEqual(before);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "UNMOUNT_WIDGET" }),
    { frameId: 0 },
  );
  vi.resetModules();
  api.tabs.sendMessage.mockClear();
  const restarted =
    await import("../../../apps/extension/src/background/ui-transport");
  await restarted.mountWidget(session, true);
  expect(await restarted.presentationVisible(session)).toBe(false);
  expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "MOUNT_WIDGET" }),
    expect.anything(),
  );
  await restarted.uiMessage(
    { type: "UI_RESTORE", sessionId: id },
    sender,
    session,
  );
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "expanded",
  });
  expect(session).toEqual(before);
});

function launcherFixture() {
  const host = document.createElement("div");
  host.dataset.tholiUi = "";
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<button class="launcher" aria-expanded="false">Open Tholi</button><div class="launcher-actions" hidden><button class="launcher-open">Open Tholi</button><button class="launcher-remove">Remove</button></div>';
  return {
    host,
    root,
    launcher: root.querySelector<HTMLButtonElement>(".launcher")!,
    actions: root.querySelector<HTMLElement>(".launcher-actions")!,
  };
}

it("a double-click reveals removal without restoring first; a single click restores once", async () => {
  vi.useFakeTimers();
  const { bindLauncherControls } =
    await import("../../../apps/extension/src/ui/widget/launcher-controls");
  const { host, root, launcher, actions } = launcherFixture();
  const open = vi.fn(),
    remove = vi.fn(async () => {});
  const dispose = bindLauncherControls(host, root, open, remove, false);
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  vi.advanceTimersByTime(100);
  launcher.dispatchEvent(new MouseEvent("click", { detail: 2 }));
  launcher.dispatchEvent(new MouseEvent("dblclick", { detail: 2 }));
  vi.advanceTimersByTime(500);
  expect(open).not.toHaveBeenCalled();
  expect(actions.hidden).toBe(false);
  expect(root.activeElement).toBe(root.querySelector(".launcher-remove"));
  root.querySelector<HTMLButtonElement>(".launcher-remove")!.click();
  expect(remove).toHaveBeenCalledOnce();
  root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  vi.advanceTimersByTime(400);
  expect(open).toHaveBeenCalledOnce();
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  dispose();
  vi.advanceTimersByTime(500);
  expect(open).toHaveBeenCalledOnce();
});

it("launcher controls support keyboard and context activation without delaying native sidebar opening", async () => {
  const { bindLauncherControls } =
    await import("../../../apps/extension/src/ui/widget/launcher-controls");
  const { host, root, launcher, actions } = launcherFixture();
  const open = vi.fn();
  const dispose = bindLauncherControls(host, root, open, async () => {}, true);
  launcher.dispatchEvent(new MouseEvent("click", { detail: 1 }));
  expect(open).toHaveBeenCalledOnce();
  root.dispatchEvent(
    new KeyboardEvent("keydown", { key: "F10", shiftKey: true }),
  );
  expect(actions.hidden).toBe(false);
  expect(launcher.getAttribute("aria-expanded")).toBe("true");
  root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(actions.hidden).toBe(true);
  expect(root.activeElement).toBe(launcher);
  launcher.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }));
  expect(actions.hidden).toBe(false);
  dispose();
});

it("minimizes to a launcher without pausing or replacing a journey, then restores fresh guidance", async () => {
  const { api, session, sender, stored } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  const before = structuredClone(session);
  await ui.uiMessage({ type: "UI_MINIMIZE", sessionId: id }, sender, session);
  expect(session).toEqual(before);
  expect(stored.tholiSurfacePresentation).toMatchObject({
    sessionId: id,
    visibility: "launcher",
    surface: "widget",
  });
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "PRESENTATION_CHANGED", visible: false }),
    { frameId: 0 },
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "MOUNT_WIDGET", visibility: "launcher" }),
    { frameId: 0 },
  );
  await ui.uiMessage({ type: "UI_RESTORE", sessionId: id }, sender, session);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "PRESENTATION_CHANGED", visible: true }),
    { frameId: 0 },
  );
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "expanded",
  });
  expect(session).toEqual(before);
});

it("restores a minimized presentation after worker module restart", async () => {
  const { api, session } = environment({
    tholiSurfacePresentation: {
      sessionId: id,
      surface: "widget",
      visibility: "launcher",
      revision: 6,
    },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await Promise.all([
    ui.mountWidget(session, true),
    ui.mountWidget(session),
    ui.mountWidget(session),
  ]);
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1);
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "MOUNT_WIDGET", visibility: "launcher" }),
    { frameId: 0 },
  );
  expect((await ui.getSurfacePresentation(session))?.revision).toBe(6);
});

it("ignores a late mount after reset and clears presentation without deleting saved preferences", async () => {
  const { api, session, stored } = environment({
    tholiSurfacePresentation: {
      sessionId: id,
      surface: "widget",
      visibility: "launcher",
      revision: 2,
    },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.getSurfacePresentation(session);
  let current: PinnedSession | undefined = session;
  ui.watchNativePanels(() => current);
  const preferences = await api.storage.local.get();
  const late = ui.mountWidget(session);
  current = undefined;
  await expect(late).resolves.toBeUndefined();
  await ui.clearSurfacePresentation(session);
  expect(stored.tholiSurfacePresentation).toBeUndefined();
  expect(await api.storage.local.get()).toEqual(preferences);
});

it("rejects stale top-document and previous-session widget commands", async () => {
  const { session, sender } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await expect(
    ui.uiMessage(
      { type: "UI_MINIMIZE", sessionId: id },
      { ...sender, documentId: "old-document" },
      session,
    ),
  ).rejects.toThrow("Trusted");
  await expect(
    ui.uiMessage(
      { type: "UI_RESTORE", sessionId: "old-session" },
      sender,
      session,
    ),
  ).rejects.toThrow("older task");
});

it("starts native docking immediately and leaves the widget intact if Chrome rejects activation", async () => {
  const { api, session, sender, stored } = environment();
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.getSurfacePresentation(session);
  api.sidePanel.open.mockRejectedValueOnce(Error("User gesture required"));
  const attempt = ui.uiMessage(
    { type: "UI_DOCK", sessionId: id },
    sender,
    session,
  );
  expect(api.sidePanel.open).toHaveBeenCalledTimes(1);
  await expect(attempt).rejects.toThrow("User gesture");
  expect(stored.tholiSurfacePresentation).toMatchObject({
    surface: "widget",
    visibility: "expanded",
  });
  expect(api.tabs.sendMessage).not.toHaveBeenCalledWith(
    7,
    expect.objectContaining({ type: "UNMOUNT_WIDGET" }),
    expect.anything(),
  );
  const before = structuredClone(session);
  await ui.uiMessage({ type: "UI_DOCK", sessionId: id }, sender, session);
  expect(stored.tholiSurfacePresentation).toMatchObject({
    surface: "sidebar",
    visibility: "expanded",
  });
  expect(session).toEqual(before);
  expect((await api.storage.local.get()).tholiPreferences).toMatchObject({
    surface: "sidebar",
    mode: "conversation",
  });
});

it("minimizes only a matching window's native sidebar dismissal", async () => {
  const { api, session, stored, closed } = environment({
    tholiSurfacePresentation: {
      sessionId: id,
      surface: "sidebar",
      visibility: "expanded",
      revision: 0,
    },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await ui.getSurfacePresentation(session);
  ui.watchNativePanels(() => session);
  const listener = closed.mock.calls[0][0] as (info: {
    windowId: number;
  }) => void;
  listener({ windowId: 99 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stored.tholiSurfacePresentation).toMatchObject({
    visibility: "expanded",
  });
  listener({ windowId: 4 });
  await vi.waitFor(() =>
    expect(stored.tholiSurfacePresentation).toMatchObject({
      visibility: "launcher",
    }),
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ visibility: "launcher" }),
    { frameId: 0 },
  );
});

it("only offers docking within the final24 pixels", () => {
  expect(dockIntent(616, 360, 1000)).toBe(true);
  expect(dockIntent(615, 360, 1000)).toBe(false);
});

it("accepts presentation metadata in the strict document handshake without changing older clients", () => {
  const message = {
    type: "BEGIN_SESSION",
    sessionId: id,
    routeId: "navigator.live",
    routeVersion: "1.0.0",
  };
  expect(contentMessageSchema.safeParse(message).success).toBe(true);
  const current = contentMessageSchema.parse({
    ...message,
    presentationVisible: false,
    presentationRevision: 4,
  });
  expect(current).toMatchObject({
    presentationVisible: false,
    presentationRevision: 4,
  });
  expect(
    contentMessageSchema.safeParse({ ...message, presentationVisible: "false" })
      .success,
  ).toBe(false);
});

it("suppresses DOM and visual highlights while preserving the ability to restore", async () => {
  environment();
  const { GuidanceOverlay, setGuidanceVisible } =
    await import("../../../packages/overlay-ui/index");
  const { showVisual } =
    await import("../../../apps/extension/src/content/visual-guidance");
  const target = document.createElement("button");
  document.body.append(target);
  const overlay = new GuidanceOverlay();
  setGuidanceVisible(false);
  overlay.show(target, "Open Settings");
  expect(document.getElementById("internet-navigator-overlay")).toBeNull();
  expect(
    showVisual(
      { kind: "visual", box: { x: 1, y: 1, width: 30, height: 20 } } as never,
      0,
      Date.now(),
    ),
  ).toBe(false);
  expect(document.getElementById("navigator-visual-suggestion")).toBeNull();
  setGuidanceVisible(true);
  overlay.clear();
  target.remove();
});

it("Firefox requests the displayed origin in the click turn and rejects a changed active site", async () => {
  const order: string[] = [];
  let active = { id: 1, url: "https://expected.example:9443/" };
  const request = vi.fn(() => {
    order.push("request");
    return Promise.resolve(true);
  });
  vi.stubGlobal("browser", {
    runtime: { getURL: () => "moz-extension://test/" },
    permissions: { request },
    tabs: {
      query: async () => {
        order.push("query");
        return [active];
      },
    },
  });
  const { requestCurrentSiteAccess } =
    await import("../../../apps/extension/src/platform/site-access");
  const result = requestCurrentSiteAccess("https://expected.example:8443", 1);
  expect(order).toEqual(["request"]);
  await expect(result).rejects.toThrow("active website changed");
  expect(request).toHaveBeenCalledWith({
    origins: ["https://expected.example/*"],
  });
  expect(order).toEqual(["request", "query"]);
  active = { id: 2, url: "https://expected.example:8443/" };
  await expect(
    requestCurrentSiteAccess("https://expected.example:8443", 1),
  ).rejects.toThrow("active website changed");
});
it("Firefox sidebar handoff retains the widget when the browser rejects its user activation", async () => {
  const { api, session, sender } = environment();
  const open = vi.fn(async () => {
    throw Error("User action required");
  });
  vi.stubGlobal("browser", {
    ...api,
    runtime: {
      ...api.runtime,
      getURL: (path: string) => "moz-extension://tholi-test/" + path,
    },
    sidebarAction: { open, isOpen: async () => false },
  });
  const ui =
    await import("../../../apps/extension/src/background/ui-transport");
  await expect(ui.dockSidebar(sender, session)).rejects.toThrow(
    "User action required",
  );
  expect((await ui.getSurfacePresentation(session))?.surface).toBe("widget");
  expect(session.documentId).toBe("document-a");
});
