// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compose } from "../../../apps/extension/src/content/observation-composition";
import {
  beginPageObservation,
  bindPagePerception,
  frameMessage,
  invalidatePagePerception,
  refreshPerceptionFrames,
  startFrames,
  stopFrames,
} from "../../../apps/extension/src/background/frame-coordinator";
import { PageDiscovery } from "../../../packages/page-discovery";
import {
  browserPerceptionSchema,
  discoveryPerceptionSchema,
  type DiscoveryPerception,
} from "../../../packages/page-discovery/perception";
import {
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  pageSnapshotSchema,
  type PageControl,
  type PageSnapshot,
} from "../../../packages/page-model";
import type { PinnedSession } from "../../../packages/route-registry/session";
import type { Runtime } from "../../../apps/extension/src/platform/api";
import { fixture } from "../../integration/nlp/fixtures";

const session: PinnedSession = {
  sessionId: "6692779e-ad63-4da7-82cd-a878c1ae23e1",
  tabId: 7,
  documentId: "native-document-root",
  origin: "https://example.test",
  routeId: LIVE_ROUTE_ID,
  routeVersion: LIVE_VERSION,
};
const tab = { id: 7, windowId: 4 };
const zeroOmissions = () => ({
  frames: 0,
  regions: 0,
  controls: 0,
  hierarchyTruncated: false,
  partial: false,
  reasons: [],
});
type Context = Parameters<typeof compose>[0];
type Pair = { page: PageSnapshot; perception: DiscoveryPerception };

function control(index: number, extra: Partial<PageControl> = {}): PageControl {
  return {
    ...fixture().controls[0],
    id: `w0000000000000000-${index}`,
    label: `Control ${index}`,
    signature: `signature-${index}`,
    ...extra,
  };
}
function pair(controls: PageControl[], regionCount = 0, indexed = true): Pair {
  const page: PageSnapshot = {
    ...fixture(),
    controls,
    indexedControls: indexed ? controls.length : undefined,
  };
  const regions = Array.from({ length: regionCount }, (_, index) => ({
    id: `region-${index}`,
    role: "region",
    label: `Region ${index}`,
  }));
  return {
    page,
    perception: discoveryPerceptionSchema.parse({
      version: 1,
      scanId: crypto.randomUUID(),
      pageRevision: page.revision,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollX,
        scrollY,
        devicePixelRatio,
        visualViewport: {
          offsetLeft: 0,
          offsetTop: 0,
          pageLeft: scrollX,
          pageTop: scrollY,
          width: innerWidth,
          height: innerHeight,
          scale: 1,
        },
      },
      regions,
      controls: controls.map((item, index) => ({
        controlId: item.id,
        regionId: regions.length
          ? regions[index % regions.length].id
          : undefined,
      })),
      omissions: {
        regions: 0,
        controlRegions: 0,
        hierarchyTruncated: false,
        partial: false,
        reasons: [],
      },
    }),
  };
}
function context(): Context {
  return {
    frames: new Map(),
    compositionStarted: false,
    frameVisibilityStates: new Map(),
    view: {
      status: "running",
      instruction: "Choose a destination",
      verifiedSteps: 0,
      confidence: 0,
      routeId: LIVE_ROUTE_ID,
      routeVersion: LIVE_VERSION,
      history: [],
    },
    compositionFingerprint: "",
    compositionRevision: 0,
    frameOmissions: zeroOmissions(),
  };
}
function addFrame(
  owner: Context,
  frameId: number,
  source: Pair,
  parentFrameId = 0,
) {
  const documentId = `native-document-${frameId}`;
  owner.frames.set(frameId, {
    ...source,
    documentId,
    parentFrameId,
    tabId: session.tabId,
  });
  owner.frameVisibilityStates.set(frameId, {
    documentId,
    visible: true,
    inViewport: true,
    placement: "viewport",
  });
}
function browserEnvironment(
  children = [{ frameId: 1, parentFrameId: 0, url: "https://embedded.test/" }],
) {
  const nativeFrames = [
    {
      frameId: 0,
      parentFrameId: -1,
      url: `${session.origin}/`,
      documentId: session.documentId,
    },
    ...children.map((frame) => ({
      ...frame,
      documentId: `native-document-${frame.frameId}`,
    })),
  ];
  const api = {
    runtime: { id: "tholi-test" },
    tabs: {
      get: vi.fn(async () => ({ ...tab })),
      getZoom: vi.fn(async () => 1.25),
      sendMessage: vi.fn(
        async (
          _tabId: number,
          _message: any,
          _options?: unknown,
        ): Promise<unknown> => ({
          ok: true,
        }),
      ),
    },
    webNavigation: { getAllFrames: vi.fn(async () => nativeFrames) },
    permissions: { contains: vi.fn(async () => true) },
    scripting: {
      executeScript: vi.fn(
        async (details: { target: { frameIds: number[] } }) => [
          { documentId: `native-document-${details.target.frameIds[0]}` },
        ],
      ),
    },
  };
  vi.stubGlobal("chrome", api);
  return { api, nativeFrames };
}
async function acceptedChild() {
  const environment = browserEnvironment();
  await startFrames(session);
  const access = environment.api.tabs.sendMessage.mock.calls.find(
    ([, message]) => message.type === "FRAME_ACCESS",
  )![1];
  const root = pair([control(1)], 1);
  const child = pair([control(2)], 1);
  child.page.origin = "https://embedded.test";
  const accepted = frameMessage(
    {
      type: "FRAME_OBSERVATION",
      sessionId: session.sessionId,
      nonce: access.nonce,
      documentId: "native-document-1",
      ...child,
    },
    {
      id: environment.api.runtime.id,
      tab,
      frameId: 1,
      documentId: "native-document-1",
    } as Runtime.MessageSender,
    session,
  );
  expect(accepted?.perception).toBeDefined();
  const owner = context();
  addFrame(owner, 1, child);
  const composed = compose(owner, root.page, root.perception);
  return { ...environment, composed };
}

beforeEach(() => {
  vi.stubGlobal("visualViewport", {
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: scrollX,
    pageTop: scrollY,
    width: innerWidth,
    height: innerHeight,
    scale: 1,
  });
});
afterEach(async () => {
  await stopFrames();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("binds a real discovery pair to measured zoom and the pinned native document", async () => {
  const { api } = browserEnvironment([]);
  document.body.innerHTML =
    '<main aria-label="Workspace"><button>Help</button></main>';
  const rectangle = new DOMRect(10, 10, 100, 30);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rectangle,
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    rectangle,
  ] as unknown as DOMRectList);
  const root = new PageDiscovery().snapshotWithPerception();
  expect(root.perception).toBeDefined();
  const composed = compose(context(), root.page, root.perception);
  const bound = await bindPagePerception(
    session,
    tab,
    composed.page,
    composed.perception,
  );
  expect(browserPerceptionSchema.safeParse(bound).success).toBe(true);
  expect(bound?.native).toEqual({
    kind: "browser",
    version: 1,
    windowId: tab.windowId,
    tabId: tab.id,
    frameId: 0,
    documentId: session.documentId,
  });
  expect(bound?.frames[0].viewport.browserZoom).toBe(1.25);
  expect(bound?.controlRegions[0].reference.documentId).toBe(
    session.documentId,
  );
  expect(api.tabs.getZoom).toHaveBeenCalledWith(session.tabId);
  expect(api.webNavigation.getAllFrames).toHaveBeenCalledWith({
    tabId: session.tabId,
  });
});

it("omits every ambiguous cross-frame ID and its dependent controls without renaming survivors", () => {
  const duplicate = control(1);
  const survivor = control(9);
  const root = pair([
    duplicate,
    control(2, { revealIds: [duplicate.id] }),
    survivor,
  ]);
  const child = pair([
    { ...duplicate },
    control(3, { revealIds: [duplicate.id] }),
  ]);
  const owner = context();
  addFrame(owner, 1, child);
  const composed = compose(owner, root.page, root.perception);
  expect(composed.page.controls.map((item) => item.id)).toEqual([survivor.id]);
  expect(composed.perception?.omissions.controls).toBe(4);
  expect(composed.perception?.omissions.reasons).toContain("ambiguous-control");
  expect(pageSnapshotSchema.safeParse(composed.page).success).toBe(true);
});

it("keeps a late opener atomically when the global 600-control composition budget fills", () => {
  const opener = control(601, { inViewport: false });
  const target = control(1, { revealIds: [opener.id] });
  const root = pair([
    target,
    ...Array.from({ length: 598 }, (_, index) => control(index + 2)),
    opener,
  ]);
  const owner = context();
  owner.view.selectedControlId = target.id;
  addFrame(owner, 1, pair([control(602)]));
  const composed = compose(owner, root.page, root.perception);
  const retained = new Set(composed.page.controls.map((item) => item.id));
  expect(retained.size).toBe(600);
  expect(retained.has(target.id)).toBe(true);
  expect(retained.has(opener.id)).toBe(true);
  expect(
    composed.page.controls.every((item) =>
      item.revealIds.every((id) => retained.has(id)),
    ),
  ).toBe(true);
  expect(composed.perception?.omissions.controls).toBe(1);
  expect(composed.perception?.omissions.reasons).toContain("budget");
});

it("retains actual frame ancestry while excluding missing-parent and stale descendant observations", () => {
  const owner = context();
  const root = pair([control(1)], 0, false);
  addFrame(owner, 1, pair([control(2)]));
  addFrame(owner, 2, pair([control(3)], 0, false), 1);
  addFrame(owner, 3, pair([control(4)]), 99);
  const stale = pair([control(5)]);
  stale.perception.pageRevision++;
  addFrame(owner, 4, stale, 2);
  addFrame(owner, 5, pair([control(6)]), 4);
  const composed = compose(owner, root.page, root.perception);
  expect(
    composed.perception?.frames.map((frame) => [
      frame.frameId,
      frame.parentFrameId,
    ]),
  ).toEqual([
    [1, 0],
    [2, 1],
  ]);
  expect(composed.page.controls.map((item) => item.id)).toEqual([
    control(1).id,
    control(2).id,
    control(3).id,
  ]);
  expect(composed.perception?.omissions.frames).toBe(3);
  expect(composed.perception?.omissions.controls).toBe(3);
  expect(composed.page.indexedControls).toBeUndefined();
  expect(
    composed.perception?.coverage
      .filter((item) => item.indexedControls === null)
      .map((item) => item.frameId),
  ).toEqual([0, 2]);
});

it("bounds region and control metadata globally across frame pairs and reports actual omissions", () => {
  const root = pair(
    Array.from({ length: 60 }, (_, index) => control(index + 1)),
    60,
  );
  const owner = context();
  addFrame(
    owner,
    1,
    pair(
      Array.from({ length: 60 }, (_, index) => control(index + 61)),
      60,
    ),
  );
  const composed = compose(owner, root.page, root.perception);
  const pairs = [
    composed.perception!.root,
    ...composed.perception!.frames.map((frame) => frame.perception),
  ];
  expect(pairs.reduce((total, item) => total + item.regions.length, 0)).toBe(
    100,
  );
  expect(pairs.reduce((total, item) => total + item.controls.length, 0)).toBe(
    100,
  );
  expect(composed.page.controls).toHaveLength(100);
  expect(composed.perception?.omissions).toMatchObject({
    controls: 20,
    regions: 20,
    partial: true,
  });
  expect(
    composed.perception?.coverage.map((item) => item.snapshotControls),
  ).toEqual([60, 60]);
  expect(composed.perception?.omissions.reasons).toContain("budget");
});

it("rejects child scans that disagree with the coordinator or lose their current origin grant", async () => {
  const { api, composed } = await acceptedChild();
  expect(
    await bindPagePerception(session, tab, composed.page, composed.perception),
  ).toBeDefined();
  const stale = structuredClone(composed.perception!);
  stale.frames[0].perception.scanId = crypto.randomUUID();
  expect(
    await bindPagePerception(session, tab, composed.page, stale),
  ).toBeUndefined();
  api.permissions.contains.mockResolvedValue(false);
  expect(
    await bindPagePerception(session, tab, composed.page, composed.perception),
  ).toBeUndefined();
});

it("rejects native document or window changes and never substitutes a URL for missing identity", async () => {
  const { api, nativeFrames } = browserEnvironment([]);
  const root = pair([control(1)]);
  const composed = compose(context(), root.page, root.perception);
  nativeFrames[0].documentId = undefined;
  expect(
    await bindPagePerception(session, tab, composed.page, composed.perception),
  ).toBeUndefined();
  nativeFrames[0].documentId = session.documentId;
  api.tabs.get.mockResolvedValue({ ...tab, windowId: 9 });
  expect(
    await bindPagePerception(session, tab, composed.page, composed.perception),
  ).toBeUndefined();
});

it("invalidates a pending native binding when its frame scope stops during the zoom lookup", async () => {
  const { api, composed } = await acceptedChild();
  let release!: (zoom: number) => void;
  api.tabs.getZoom.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = bindPagePerception(
    session,
    tab,
    composed.page,
    composed.perception,
  );
  await stopFrames();
  release(1.25);
  expect(await pending).toBeUndefined();
});

it.each(["zoom", "root-document", "parent", "grant"] as const)(
  "rejects a %s change appearing only in the final native binding check",
  async (change) => {
    const { api, nativeFrames, composed } = await acceptedChild();
    const finalFrames = nativeFrames.map((frame) => ({ ...frame }));
    if (change === "root-document")
      finalFrames[0].documentId = "native-document-replaced";
    if (change === "parent") finalFrames[1].parentFrameId = 99;
    api.webNavigation.getAllFrames.mockClear();
    api.webNavigation.getAllFrames
      .mockResolvedValueOnce(nativeFrames)
      .mockResolvedValueOnce(finalFrames);
    api.tabs.getZoom
      .mockResolvedValueOnce(1.25)
      .mockResolvedValueOnce(change === "zoom" ? 2 : 1.25);
    api.permissions.contains.mockClear();
    api.permissions.contains
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(change !== "grant");

    expect(
      await bindPagePerception(
        session,
        tab,
        composed.page,
        composed.perception,
      ),
    ).toBeUndefined();
    expect(api.webNavigation.getAllFrames).toHaveBeenCalledTimes(2);
    expect(api.tabs.getZoom).toHaveBeenCalledTimes(2);
    expect(api.permissions.contains).toHaveBeenCalledTimes(2);
    expect(await api.permissions.contains.mock.results[0].value).toBe(true);
    expect(await api.tabs.getZoom.mock.results[0].value).toBe(1.25);
    expect(
      (await api.webNavigation.getAllFrames.mock.results[0].value)[0]
        .documentId,
    ).toBe(session.documentId);
  },
);

it("rejects stable post-content zoom when it differs from the pre-content native observation", async () => {
  const { api, composed } = await acceptedChild();
  const start = await beginPageObservation(session, tab);
  expect(start?.zoom).toBe(1.25);
  api.tabs.getZoom.mockResolvedValue(2);
  expect(
    await bindPagePerception(
      session,
      tab,
      composed.page,
      composed.perception,
      start,
    ),
  ).toBeUndefined();
  expect(await api.tabs.getZoom.mock.results.at(-1)!.value).toBe(2);
});

it("rejects an invalidated native observation even after zoom returns to its original value", async () => {
  const { api, composed } = await acceptedChild();
  const original = await beginPageObservation(session, tab);
  api.tabs.getZoom.mockResolvedValue(2);
  invalidatePagePerception();
  const changed = await beginPageObservation(session, tab);
  api.tabs.getZoom.mockResolvedValue(1.25);
  invalidatePagePerception();
  const restored = await beginPageObservation(session, tab);
  expect([original?.zoom, changed?.zoom, restored?.zoom]).toEqual([
    1.25, 2, 1.25,
  ]);
  expect(restored!.epoch).toBeGreaterThan(original!.epoch);
  expect(
    await bindPagePerception(
      session,
      tab,
      composed.page,
      composed.perception,
      original,
    ),
  ).toBeUndefined();
});

it("refreshes only known authorized frame agents and forwards their fresh observation without acting on the page", async () => {
  const { api, nativeFrames, composed } = await acceptedChild();
  nativeFrames.push({
    frameId: 2,
    parentFrameId: 0,
    url: "https://unknown.test/",
    documentId: "native-document-2",
  });
  const start = await beginPageObservation(session, tab);
  const fresh = pair([control(2)], 1);
  fresh.page.origin = "https://embedded.test";
  api.tabs.sendMessage.mockClear();
  api.scripting.executeScript.mockClear();
  api.tabs.sendMessage.mockImplementation(async (_tabId, message) =>
    message.type === "FRAME_SCAN" ? fresh : { ok: true },
  );
  expect(await refreshPerceptionFrames(session, start!)).toBe(true);
  const calls = api.tabs.sendMessage.mock.calls;
  expect(calls.map(([, message]) => message.type)).toEqual([
    "FRAME_SCAN",
    "FRAME_OBSERVATION_PARENT",
  ]);
  expect(calls[0]).toEqual([
    session.tabId,
    expect.objectContaining({ documentId: "native-document-1" }),
    { frameId: 1 },
  ]);
  expect(calls[1]).toEqual([
    session.tabId,
    expect.objectContaining({
      parentFrameId: 0,
      documentId: "native-document-1",
      perception: fresh.perception,
    }),
    { frameId: 0 },
  ]);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(
    await bindPagePerception(session, tab, composed.page, composed.perception),
  ).toBeUndefined();
});

it("admits at most fifteen child frames in actual parent order and accounts for the native root", async () => {
  const children = Array.from({ length: 17 }, (_, index) => ({
    frameId: index + 1,
    parentFrameId: index,
    url: `${session.origin}/child-${index}`,
  })).reverse();
  const { api } = browserEnvironment(children);
  await startFrames(session);
  const starts = api.tabs.sendMessage.mock.calls
    .map(([, message]) => message)
    .filter((message) => message.type === "FRAME_START");
  expect(starts.map((message) => message.frameId)).toEqual(
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  expect(
    starts.every((message) => message.parentFrameId === message.frameId - 1),
  ).toBe(true);
  const access = api.tabs.sendMessage.mock.calls.find(
    ([, message]) => message.type === "FRAME_ACCESS",
  )![1];
  expect(access.omissions).toMatchObject({ frames: 2, partial: true });
  expect(access.omissions.reasons).toContain("budget");
});
