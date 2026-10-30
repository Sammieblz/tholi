import { api, type Runtime, type Tabs } from "../platform/api";
import { hostPermissionPattern } from "../platform/site-access";
import { pageSnapshotSchema } from "../../../../packages/page-model/index";
import type { PinnedSession } from "../../../../packages/route-registry/session";
import type { PageSnapshot } from "../../../../packages/page-model";
import {
  browserPerceptionSchema,
  discoveryPerceptionSchema,
  type BrowserPerception,
  type RegionObservationRequest,
} from "../../../../packages/page-discovery/perception";
type Frame = {
  frameId: number;
  documentId: string;
  origin: string;
  parentFrameId: number;
};
// Native sender, scan, grant and epoch checks stay with their callers. This
// shared decoder only validates the paired structural payload and its origin.
function parseFrameObservation(raw: unknown, origin: string) {
  if (!raw || typeof raw !== "object") return;
  const value = raw as { page?: unknown; perception?: unknown };
  const page = pageSnapshotSchema.safeParse(value.page);
  if (!page.success || page.data.origin !== origin) return;
  const parsed = discoveryPerceptionSchema.safeParse(value.perception);
  return {
    page: page.data,
    perception:
      parsed.success && parsed.data.pageRevision === page.data.revision
        ? parsed.data
        : undefined,
  };
}
let observationEpoch = 0;
export function invalidatePagePerception() {
  observationEpoch++;
}
let scope:
  | {
      sessionId: string;
      tabId: number;
      nonce: string;
      frames: Map<number, Frame>;
      observations: Map<number, { scanId: string; pageRevision: number }>;
      unavailableFrames: number;
    }
  | undefined;
const visibility = new Map<
  number,
  { visible: boolean; inViewport: boolean; placement: string }
>();
export async function stopFrames() {
  invalidatePagePerception();
  const old = scope;
  scope = undefined;
  if (old)
    await Promise.allSettled(
      [...old.frames.values()].map((f) =>
        api.tabs.sendMessage(
          old.tabId,
          {
            type: "FRAME_STOP",
            sessionId: old.sessionId,
            nonce: old.nonce,
            ...f,
          },
          { frameId: f.frameId },
        ),
      ),
    );
}
export async function startFrames(
  session: PinnedSession,
  visible = true,
  presentationRevision = 0,
) {
  await stopFrames();
  visibility.clear();
  const current = (scope = {
    sessionId: session.sessionId,
    tabId: session.tabId,
    nonce: crypto.randomUUID(),
    frames: new Map<number, Frame>(),
    observations: new Map<number, { scanId: string; pageRevision: number }>(),
    unavailableFrames: 0,
  });
  const available = (
    (await api.webNavigation.getAllFrames({ tabId: session.tabId })) || []
  ).filter((f) => f.frameId !== 0);
  const allowed: typeof available = [],
    missing = new Set<string>();
  for (const frame of available) {
    if (!/^https?:/.test(frame.url)) continue;
    const origin = new URL(frame.url).origin;
    if (
      origin === session.origin ||
      (await api.permissions.contains({
        origins: [hostPermissionPattern(origin)],
      }))
    )
      allowed.push(frame);
    else missing.add(origin);
  }
  const admitted: typeof allowed = [];
  const retained = new Set<number>([0]);
  // Admit actual parent chains, independent of getAllFrames ordering. Root is
  // one of the sixteen frames, not an extra unbudgeted observation.
  while (admitted.length < 15) {
    const next = allowed.find(
      (frame) =>
        !retained.has(frame.frameId) && retained.has(frame.parentFrameId),
    );
    if (!next) break;
    admitted.push(next);
    retained.add(next.frameId);
  }
  for (const frame of admitted) {
    if (scope !== current) return;
    if (frame.parentFrameId !== 0 && !current.frames.has(frame.parentFrameId))
      continue;
    try {
      const injected = await api.scripting.executeScript({
        target: { tabId: session.tabId, frameIds: [frame.frameId] },
        files: ["frame-agent.js"],
      });
      if (!injected[0]?.documentId || scope !== current) continue;
      current.frames.set(frame.frameId, {
        frameId: frame.frameId,
        documentId: injected[0].documentId,
        origin: new URL(frame.url).origin,
        parentFrameId: frame.parentFrameId,
      });
    } catch {
      missing.add(new URL(frame.url).origin);
    }
  }
  const omittedFrames = available.length - current.frames.size;
  current.unavailableFrames = omittedFrames;
  const omissions: BrowserPerception["omissions"] = {
    frames: omittedFrames,
    regions: 0,
    controls: 0,
    hierarchyTruncated: false,
    partial: omittedFrames > 0,
    reasons: omittedFrames
      ? [missing.size ? "inaccessible-frame" : "unsupported"]
      : [],
  };
  if (allowed.length > 15 && !omissions.reasons.includes("budget"))
    omissions.reasons.push("budget");
  const mainLimit = current.frames.size
    ? Math.max(1000, Math.floor(5000 / (current.frames.size + 1)))
    : 5000;
  await api.tabs
    .sendMessage(session.tabId, {
      type: "FRAME_ACCESS",
      sessionId: session.sessionId,
      origins: [...missing].slice(0, 16),
      limit: mainLimit,
      nonce: current.nonce,
      omissions,
    })
    .catch(() => {});
  const limit = current.frames.size
    ? Math.floor((5000 - mainLimit) / current.frames.size)
    : 0;
  for (const f of current.frames.values()) {
    if (scope !== current) return;
    try {
      await api.tabs.sendMessage(
        session.tabId,
        {
          type: "FRAME_START",
          sessionId: session.sessionId,
          nonce: current.nonce,
          ...f,
          limit,
          presentationVisible: visible,
          presentationRevision,
        },
        { frameId: f.frameId },
      );
    } catch {
      missing.add(f.origin);
    }
  }
}
export async function setFramePresentation(
  session: PinnedSession,
  visible: boolean,
  revision: number,
) {
  if (scope?.sessionId !== session.sessionId) return;
  const current = scope;
  await Promise.allSettled(
    [...current.frames.values()].map((frame) =>
      api.tabs.sendMessage(
        session.tabId,
        {
          type: "FRAME_PRESENTATION",
          sessionId: session.sessionId,
          nonce: current.nonce,
          ...frame,
          visible,
          revision,
        },
        { frameId: frame.frameId },
      ),
    ),
  );
}
export async function frameVisibilityMessage(
  raw: any,
  sender: Runtime.MessageSender,
  session?: PinnedSession,
) {
  if (
    !scope ||
    !session ||
    scope.sessionId !== session.sessionId ||
    scope.tabId !== session.tabId ||
    sender.id !== api.runtime.id ||
    sender.tab?.id !== scope.tabId ||
    raw.sessionId !== scope.sessionId ||
    raw.nonce !== scope.nonce
  )
    return;
  const frame = scope.frames.get(raw.frameId);
  if (
    !frame ||
    frame.documentId !== raw.documentId ||
    (sender.frameId || 0) !== frame.parentFrameId
  )
    return;
  if (
    frame.parentFrameId === 0
      ? sender.documentId !== session.documentId
      : sender.documentId !== scope.frames.get(frame.parentFrameId)?.documentId
  )
    return;
  if (
    typeof raw.visible !== "boolean" ||
    typeof raw.inViewport !== "boolean" ||
    !["above", "below", "left", "right", "viewport"].includes(raw.placement)
  )
    return;
  visibility.set(frame.frameId, {
    visible: raw.visible,
    inViewport: raw.inViewport,
    placement: raw.placement,
  });
  for (const f of scope.frames.values()) {
    let current: Frame | undefined = f,
      shown = true,
      inViewport = true,
      placement = "viewport";
    while (current) {
      const v = visibility.get(current.frameId);
      shown &&= v?.visible === true;
      inViewport &&= v?.inViewport === true;
      if (v?.placement && v.placement !== "viewport") placement = v.placement;
      current = scope.frames.get(current.parentFrameId);
    }
    await api.tabs
      .sendMessage(session.tabId, {
        type: "FRAME_VISIBILITY_PARENT",
        sessionId: session.sessionId,
        frameId: f.frameId,
        documentId: f.documentId,
        visible: shown,
        inViewport,
        placement,
      })
      .catch(() => {});
  }
}
export function frameMessage(
  raw: any,
  sender: Runtime.MessageSender,
  session?: PinnedSession,
) {
  if (
    !scope ||
    !session ||
    scope.sessionId !== session.sessionId ||
    scope.tabId !== session.tabId ||
    raw.sessionId !== scope.sessionId ||
    raw.nonce !== scope.nonce ||
    sender.id !== api.runtime.id ||
    sender.tab?.id !== scope.tabId
  )
    return;
  const frame = scope.frames.get(sender.frameId || 0);
  if (
    !frame ||
    frame.documentId !== sender.documentId ||
    frame.documentId !== raw.documentId
  )
    return;
  const pair = parseFrameObservation(raw, frame.origin);
  if (!pair) return;
  if (raw.type === "FRAME_OBSERVATION") {
    if (pair.perception)
      scope.observations.set(frame.frameId, {
        scanId: pair.perception.scanId,
        pageRevision: pair.perception.pageRevision,
      });
    else scope.observations.delete(frame.frameId);
  }
  return { frame, ...pair };
}

async function nativeSnapshot(tabId: number) {
  const [tab, zoom, frames] = await Promise.all([
    api.tabs.get(tabId),
    api.tabs.getZoom(tabId),
    api.webNavigation.getAllFrames({ tabId }),
  ]);
  return {
    tab,
    zoom,
    frames: new Map((frames || []).map((frame) => [frame.frameId, frame])),
  };
}

export async function beginPageObservation(
  session: PinnedSession,
  tab: Pick<Tabs.Tab, "id" | "windowId">,
) {
  const epoch = observationEpoch;
  if (
    !session.documentId ||
    tab.id !== session.tabId ||
    tab.windowId === undefined
  )
    return;
  const current = await nativeSnapshot(session.tabId);
  if (
    epoch !== observationEpoch ||
    current.tab.windowId !== tab.windowId ||
    current.frames.get(0)?.documentId !== session.documentId
  )
    return;
  return {
    epoch,
    zoom: current.zoom,
    tabId: session.tabId,
    windowId: tab.windowId,
    documentId: session.documentId,
  };
}
type ObservationStart = NonNullable<
  Awaited<ReturnType<typeof beginPageObservation>>
>;

/** Refresh only existing authorized frame agents, under the same native span. */
export async function refreshPerceptionFrames(
  session: PinnedSession,
  start: ObservationStart,
  exceptFrameId?: number,
) {
  const current = scope;
  if (
    !current ||
    current.sessionId !== session.sessionId ||
    !current.frames.size
  )
    return start.epoch === observationEpoch;
  const pairs = await Promise.all(
    [...current.frames.values()]
      .filter((frame) => frame.frameId !== exceptFrameId)
      .map(async (frame) => {
        if (
          frame.origin !== session.origin &&
          !(await api.permissions.contains({
            origins: [hostPermissionPattern(frame.origin)],
          }))
        )
          return;
        const reply = await api.tabs
          .sendMessage(
            session.tabId,
            {
              type: "FRAME_SCAN",
              sessionId: session.sessionId,
              nonce: current.nonce,
              documentId: frame.documentId,
            },
            { frameId: frame.frameId },
          )
          .catch(() => undefined);
        const pair = parseFrameObservation(reply, frame.origin);
        if (!pair?.perception) return;
        return { frame, page: pair.page, perception: pair.perception };
      }),
  );
  if (
    scope !== current ||
    start.epoch !== observationEpoch ||
    pairs.some((pair) => !pair)
  )
    return false;
  for (const pair of pairs) {
    if (!pair) return false;
    current.observations.set(pair.frame.frameId, {
      scanId: pair.perception.scanId,
      pageRevision: pair.perception.pageRevision,
    });
    await api.tabs.sendMessage(
      session.tabId,
      {
        type: "FRAME_OBSERVATION_PARENT",
        sessionId: session.sessionId,
        frameId: pair.frame.frameId,
        parentFrameId: pair.frame.parentFrameId,
        documentId: pair.frame.documentId,
        tabId: session.tabId,
        page: pair.page,
        perception: pair.perception,
        deferRefresh: true,
      },
      { frameId: 0 },
    );
  }
  return scope === current && start.epoch === observationEpoch;
}

/** Bind ephemeral layout only to the pinned native tab, never URLs as identity. */
export async function bindPagePerception(
  session: PinnedSession,
  tab: Pick<Tabs.Tab, "id" | "windowId">,
  page: PageSnapshot,
  raw: unknown,
  start?: ObservationStart,
): Promise<BrowserPerception | undefined> {
  if (
    !session.documentId ||
    tab.id !== session.tabId ||
    tab.windowId === undefined ||
    !raw ||
    typeof raw !== "object"
  )
    return;
  const value = raw as Record<string, unknown>;
  if (
    value.pageRevision !== page.revision ||
    !Array.isArray(value.frames) ||
    value.frames.length > 15
  )
    return;
  const local = discoveryPerceptionSchema.safeParse(value.root);
  if (!local.success) return;
  if (
    start &&
    (start.epoch !== observationEpoch ||
      start.tabId !== session.tabId ||
      start.windowId !== tab.windowId ||
      start.documentId !== session.documentId)
  )
    return;
  const capturedScope = scope;
  const {
    tab: currentTab,
    zoom,
    frames: actualFrames,
  } = await nativeSnapshot(session.tabId);
  if (currentTab.windowId !== tab.windowId || scope !== capturedScope) return;
  if (start && zoom !== start.zoom) return;
  if (actualFrames.get(0)?.documentId !== session.documentId) return;
  const native = {
    kind: "browser" as const,
    version: 1 as const,
    windowId: tab.windowId,
    tabId: session.tabId,
    frameId: 0,
    documentId: session.documentId,
  };
  const frames: BrowserPerception["frames"] = [
    {
      native,
      viewport: { ...local.data.viewport, browserZoom: zoom },
      scanId: local.data.scanId,
      pageRevision: local.data.pageRevision,
    },
  ];
  const pairs = [{ frameId: 0, native, perception: local.data }];
  for (const item of value.frames) {
    if (
      !item ||
      typeof item !== "object" ||
      !capturedScope ||
      capturedScope.sessionId !== session.sessionId ||
      capturedScope.tabId !== session.tabId
    )
      return;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.frameId !== "number") return;
    const frame = capturedScope.frames.get(candidate.frameId);
    const observed = capturedScope.observations.get(candidate.frameId);
    const live = actualFrames.get(candidate.frameId);
    const parsed = discoveryPerceptionSchema.safeParse(candidate.perception);
    if (
      !frame ||
      !observed ||
      !live ||
      !parsed.success ||
      candidate.documentId !== frame.documentId ||
      candidate.parentFrameId !== frame.parentFrameId ||
      live.documentId !== frame.documentId ||
      live.parentFrameId !== frame.parentFrameId ||
      observed.scanId !== parsed.data.scanId ||
      observed.pageRevision !== parsed.data.pageRevision
    )
      return;
    if (
      frame.origin !== session.origin &&
      !(await api.permissions.contains({
        origins: [hostPermissionPattern(frame.origin)],
      }))
    )
      return;
    const reference = {
      ...native,
      frameId: frame.frameId,
      documentId: frame.documentId,
    };
    frames.push({
      native: reference,
      parentFrameId: frame.parentFrameId,
      scanId: parsed.data.scanId,
      pageRevision: parsed.data.pageRevision,
      viewport: { ...parsed.data.viewport, browserZoom: zoom },
    });
    pairs.push({
      frameId: frame.frameId,
      native: reference,
      perception: parsed.data,
    });
  }
  if (scope !== capturedScope) return;
  if (
    pairs.reduce((n, pair) => n + pair.perception.regions.length, 0) > 100 ||
    pairs.reduce((n, pair) => n + pair.perception.controls.length, 0) > 600
  )
    return;
  const allowedControls = new Map(
    page.controls.map((control) => [control.id, control]),
  );
  const regions: BrowserPerception["regions"] = [];
  const controlRegions: BrowserPerception["controlRegions"] = [];
  for (const pair of pairs) {
    const prefix = `f${pair.frameId}:`;
    regions.push(
      ...pair.perception.regions.map((region) => ({
        ...region,
        id: prefix + region.id,
        parentId: region.parentId ? prefix + region.parentId : undefined,
        frameId: pair.frameId,
      })),
    );
    for (const control of pair.perception.controls) {
      const selected = allowedControls.get(control.controlId);
      if (
        !selected ||
        (selected.reference?.frameId || 0) !== pair.frameId ||
        (selected.reference &&
          (selected.reference.documentId !== pair.native.documentId ||
            selected.reference.tabId !== pair.native.tabId))
      )
        return;
      controlRegions.push({
        reference: { ...pair.native, controlId: control.controlId },
        regionId: control.regionId ? prefix + control.regionId : undefined,
        bounds: control.bounds,
      });
    }
  }
  const parsed = browserPerceptionSchema.safeParse({
    version: 1,
    pageRevision: page.revision,
    native,
    frames,
    regions,
    controlRegions,
    coverage: value.coverage,
    omissions: value.omissions,
  });
  if (!parsed.success) return;
  const origins = [
    ...new Set(
      value.frames.map(
        (item) =>
          capturedScope?.frames.get((item as { frameId: number }).frameId)
            ?.origin,
      ),
    ),
  ].filter((origin): origin is string => !!origin && origin !== session.origin);
  const [latest, grants] = await Promise.all([
    nativeSnapshot(session.tabId),
    Promise.all(
      origins.map((origin) =>
        api.permissions.contains({ origins: [hostPermissionPattern(origin)] }),
      ),
    ),
  ]);
  if (
    scope !== capturedScope ||
    latest.tab.windowId !== native.windowId ||
    latest.zoom !== zoom ||
    grants.some((granted) => !granted) ||
    (start && start.epoch !== observationEpoch)
  )
    return;
  for (const frame of frames) {
    const current = latest.frames.get(frame.native.frameId);
    if (
      !current ||
      current.documentId !== frame.native.documentId ||
      (frame.native.frameId !== 0 &&
        current.parentFrameId !== frame.parentFrameId)
    )
      return;
    if (frame.native.frameId !== 0) {
      const scan = capturedScope?.observations.get(frame.native.frameId);
      if (
        scan?.scanId !== frame.scanId ||
        scan.pageRevision !== frame.pageRevision
      )
        return;
    }
  }
  parsed.data.omissions.frames = Math.max(
    parsed.data.omissions.frames,
    [...latest.frames.keys()].filter((frameId) => frameId !== 0).length -
      value.frames.length,
    capturedScope?.sessionId === session.sessionId
      ? capturedScope.unavailableFrames +
          capturedScope.frames.size -
          value.frames.length
      : 0,
  );
  if (parsed.data.omissions.frames) {
    parsed.data.omissions.partial = true;
    if (!parsed.data.omissions.reasons.includes("partial-scan"))
      parsed.data.omissions.reasons.push("partial-scan");
  }
  return parsed.data;
}

/** A region refresh has observation authority only. It cannot reveal a menu. */
export async function refreshFrameRegion(
  session: PinnedSession,
  request: RegionObservationRequest,
) {
  const current = scope;
  const frame = current?.frames.get(request.native.frameId);
  const observed = current?.observations.get(request.native.frameId);
  if (
    !current ||
    current.sessionId !== session.sessionId ||
    current.tabId !== session.tabId ||
    !frame ||
    frame.documentId !== request.native.documentId ||
    !observed ||
    observed.scanId !== request.scanId ||
    observed.pageRevision !== request.pageRevision
  )
    return false;
  if (
    frame.origin !== session.origin &&
    !(await api.permissions.contains({
      origins: [hostPermissionPattern(frame.origin)],
    }))
  )
    return false;
  const live = await api.webNavigation.getFrame({
    tabId: session.tabId,
    frameId: frame.frameId,
  });
  if (
    scope !== current ||
    live?.documentId !== frame.documentId ||
    live.parentFrameId !== frame.parentFrameId
  )
    return false;
  const prefix = `f${frame.frameId}:`;
  if (!request.regionId.startsWith(prefix)) return false;
  const reply = await api.tabs.sendMessage(
    session.tabId,
    {
      type: "FRAME_SCAN",
      sessionId: session.sessionId,
      nonce: current.nonce,
      documentId: frame.documentId,
      regionObservation: {
        ...request,
        regionId: request.regionId.slice(prefix.length),
      },
    },
    { frameId: frame.frameId },
  );
  if (reply?.error || scope !== current) return false;
  const pair = parseFrameObservation(reply, frame.origin);
  const after = await api.webNavigation.getFrame({
    tabId: session.tabId,
    frameId: frame.frameId,
  });
  if (
    scope !== current ||
    after?.documentId !== frame.documentId ||
    after.parentFrameId !== frame.parentFrameId ||
    !pair?.perception
  )
    return false;
  current.observations.set(frame.frameId, {
    scanId: pair.perception.scanId,
    pageRevision: pair.perception.pageRevision,
  });
  await api.tabs.sendMessage(
    session.tabId,
    {
      type: "FRAME_OBSERVATION_PARENT",
      sessionId: session.sessionId,
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      documentId: frame.documentId,
      tabId: session.tabId,
      page: pair.page,
      perception: pair.perception,
      deferRefresh: true,
    },
    { frameId: 0 },
  );
  return true;
}
export async function routeFrameGuide(raw: any, session: PinnedSession) {
  const f = scope?.frames.get(raw.reference?.frameId);
  if (
    !scope ||
    scope.sessionId !== session.sessionId ||
    !f ||
    f.documentId !== raw.reference.documentId
  )
    return { error: "Frame document changed. Replan using fresh evidence." };
  return api.tabs.sendMessage(
    session.tabId,
    {
      ...raw,
      type: "FRAME_GUIDE",
      sessionId: session.sessionId,
      nonce: scope.nonce,
      documentId: f.documentId,
      controlId: raw.reference.controlId,
    },
    { frameId: f.frameId },
  );
}
export async function clearFrames(session: PinnedSession) {
  if (scope?.sessionId === session.sessionId)
    await Promise.allSettled(
      [...scope.frames.values()].map((f) =>
        api.tabs.sendMessage(
          session.tabId,
          {
            type: "FRAME_CLEAR",
            sessionId: session.sessionId,
            nonce: scope!.nonce,
            ...f,
          },
          { frameId: f.frameId },
        ),
      ),
    );
}
