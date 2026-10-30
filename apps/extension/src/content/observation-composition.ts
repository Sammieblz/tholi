import { presented } from "../../../../packages/page-discovery/index";
import {
  hash,
  type PageControl,
  type PageSnapshot,
} from "../../../../packages/page-model/index";
import type { SessionView } from "../../../../packages/shared-types/index";
import { frameElement } from "./frame-visibility";
import {
  controlDependencies,
  unambiguousControls,
} from "../../../../packages/goal-planner/model-context";
import type {
  BrowserPerception,
  ComposedDiscoveryPerception,
  DiscoveryPerception,
} from "../../../../packages/page-discovery/perception";

interface Context {
  frames: Map<
    number,
    {
      documentId: string;
      tabId: number;
      parentFrameId: number;
      page: PageSnapshot;
      perception?: DiscoveryPerception;
    }
  >;
  compositionStarted: boolean;
  frameVisibilityStates: Map<
    number,
    {
      documentId: string;
      visible: boolean;
      inViewport: boolean;
      placement: PageControl["placement"];
    }
  >;
  view: SessionView;
  compositionFingerprint: string;
  compositionRevision: number;
  frameOmissions: BrowserPerception["omissions"];
}

export function compose(
  context: Context,
  local: PageSnapshot,
  localPerception?: DiscoveryPerception,
): { page: PageSnapshot; perception?: ComposedDiscoveryPerception } {
  if (localPerception?.pageRevision !== local.revision)
    localPerception = undefined;
  const omitted = {
    ...context.frameOmissions,
    reasons: [...context.frameOmissions.reasons],
  };
  const frames = new Map(context.frames);
  // A descendant without its actual parent has unknown context. Do not turn an
  // inaccessible parent into a top-level frame or retain an old scan pair.
  for (const [id, frame] of frames) {
    const seen = new Set<number>([id]);
    let parent = frame.parentFrameId;
    let valid =
      !!frame.perception &&
      frame.perception.pageRevision === frame.page.revision;
    while (valid && parent !== 0) {
      const ancestor = context.frames.get(parent);
      if (
        !ancestor ||
        !ancestor.perception ||
        ancestor.perception.pageRevision !== ancestor.page.revision ||
        seen.has(parent)
      ) {
        valid = false;
        break;
      }
      seen.add(parent);
      parent = ancestor.parentFrameId;
    }
    if (!valid) {
      frames.delete(id);
      omitted.frames++;
      omitted.controls += frame.page.controls.length;
      omitted.partial = true;
      if (!omitted.reasons.includes("partial-scan"))
        omitted.reasons.push("partial-scan");
    }
  }
  if (
    !frames.size &&
    !context.compositionStarted &&
    !omitted.frames &&
    !localPerception
  )
    return { page: local };
  context.compositionStarted = true;
  const modal = [
    ...document.querySelectorAll<HTMLElement>(
      "dialog[open],[role=dialog][aria-modal=true]",
    ),
  ]
    .filter((e) => presented(e))
    .at(-1);
  const all = [
    ...local.controls,
    ...[...frames].flatMap(([frameId, f]) =>
      f.page.controls.map((c) => {
        const v = context.frameVisibilityStates.get(frameId),
          element = frameElement(frameId),
          shown =
            v?.documentId === f.documentId &&
            v.visible &&
            (!modal || (!!element && modal.contains(element)));
        return {
          ...c,
          visible: c.visible && shown,
          inViewport: c.inViewport && shown && v.inViewport,
          sectionVisible: c.sectionVisible && shown && v.inViewport,
          placement: !v?.inViewport ? v?.placement : c.placement,
          surfaceId: `frame-${frameId}/${c.surfaceId || "page"}`,
          reference: {
            frameId,
            documentId: f.documentId,
            tabId: f.tabId,
            controlId: c.id,
          },
        };
      }),
    ),
  ];
  const target = context.view.request?.tasks[context.view.request.active],
    tokens = (target?.desiredValue || target?.target || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
  all.sort(
    (a, b) =>
      Number(b.id === context.view.selectedControlId) -
        Number(a.id === context.view.selectedControlId) ||
      tokens.filter((t) => b.label.toLowerCase().includes(t)).length -
        tokens.filter((t) => a.label.toLowerCase().includes(t)).length ||
      Number(b.inViewport) - Number(a.inViewport) ||
      Number(a.group === "Page links") - Number(b.group === "Page links"),
  );
  const unique = unambiguousControls(all);
  const byId = new Map(unique.controls.map((control) => [control.id, control]));
  const selected = new Map<string, PageControl>();
  let budgetLimited = false;
  let invalidRelationships = false;
  const selectedRegions = new Map<number, Set<string>>();
  const regionMaps = new Map<
    number,
    Map<string, DiscoveryPerception["regions"][number]>
  >();
  const metadata = new Map<
    number,
    Map<string, DiscoveryPerception["controls"][number]>
  >();
  const pairs = new Map<number, DiscoveryPerception>();
  if (localPerception) pairs.set(0, localPerception);
  for (const [id, frame] of frames) pairs.set(id, frame.perception!);
  for (const [id, pair] of pairs) {
    regionMaps.set(
      id,
      new Map(pair.regions.map((region) => [region.id, region])),
    );
    metadata.set(
      id,
      new Map(pair.controls.map((control) => [control.controlId, control])),
    );
  }
  for (const candidate of unique.controls) {
    if (selected.has(candidate.id)) continue;
    const bundle = controlDependencies(candidate, byId, false);
    if (!bundle) {
      invalidRelationships = true;
      continue;
    }
    const added = bundle.filter((control) => !selected.has(control.id));
    const regionBundle = new Map<number, Set<string>>();
    let valid = true;
    for (const control of added) {
      const frameId = control.reference?.frameId || 0;
      let regionId = metadata.get(frameId)?.get(control.id)?.regionId;
      const seen = new Set<string>();
      while (regionId) {
        const region = regionMaps.get(frameId)?.get(regionId);
        if (!region || seen.has(regionId) || seen.size >= 16) {
          valid = false;
          break;
        }
        seen.add(regionId);
        if (!selectedRegions.get(frameId)?.has(regionId)) {
          let ids = regionBundle.get(frameId);
          if (!ids) regionBundle.set(frameId, (ids = new Set()));
          ids.add(regionId);
        }
        regionId = region.parentId;
      }
      if (!valid) break;
    }
    const regionCount =
      [...selectedRegions.values()].reduce((n, ids) => n + ids.size, 0) +
      [...regionBundle.values()].reduce((n, ids) => n + ids.size, 0);
    if (!valid) {
      invalidRelationships = true;
      omitted.hierarchyTruncated = true;
      continue;
    }
    if (selected.size + added.length > 600 || regionCount > 100) {
      budgetLimited = true;
      continue;
    }
    for (const control of added) selected.set(control.id, control);
    for (const [frameId, ids] of regionBundle) {
      let current = selectedRegions.get(frameId);
      if (!current) selectedRegions.set(frameId, (current = new Set()));
      for (const id of ids) current.add(id);
    }
  }
  const controls = [...selected.values()];
  omitted.controls += all.length - controls.length;
  omitted.partial ||= all.length !== controls.length;
  if (
    unique.ambiguousControls &&
    !omitted.reasons.includes("ambiguous-control")
  )
    omitted.reasons.push("ambiguous-control");
  if (budgetLimited && !omitted.reasons.includes("budget"))
    omitted.reasons.push("budget");
  if (invalidRelationships && !omitted.reasons.includes("not-eligible"))
    omitted.reasons.push("not-eligible");
  const fingerprint = hash(
    local.fingerprint +
      "|" +
      [...frames]
        .map(
          ([id, f]) =>
            id +
            ":" +
            f.documentId +
            ":" +
            f.parentFrameId +
            ":" +
            f.page.fingerprint +
            ":" +
            JSON.stringify(context.frameVisibilityStates.get(id)),
        )
        .join("|") +
      "|" +
      JSON.stringify(omitted),
  );
  const freshness = hash(
    fingerprint +
      "|" +
      local.revision +
      "|" +
      [...frames].map(([id, f]) => id + ":" + f.page.revision).join("|"),
  );
  if (freshness !== context.compositionFingerprint) {
    context.compositionFingerprint = freshness;
    context.compositionRevision =
      Math.max(
        context.compositionRevision,
        local.revision,
        context.view.page?.revision || 0,
      ) + 1;
  }
  const coverage = [
    ...(local.coverage || []),
    ...[...frames].flatMap(([id, f]) =>
      (f.page.coverage || []).map((s) => ({
        ...s,
        surfaceId: `frame-${id}/${s.surfaceId}`,
      })),
    ),
  ]
    .map((s) => {
      const projected = controls.filter(
        (c) => c.surfaceId === s.surfaceId,
      ).length;
      return {
        ...s,
        projected,
        omitted: Math.max(0, s.indexed - projected),
        complete: s.complete && projected === s.indexed,
      };
    })
    .slice(0, 100);
  const page: PageSnapshot = {
    ...local,
    controls,
    coverage,
    fingerprint,
    stateKey: local.pageKey + ":" + fingerprint,
    revision: context.compositionRevision,
    partial:
      local.partial ||
      omitted.partial ||
      [...frames.values()].some((f) => f.page.partial),
    busy: local.busy || [...frames.values()].some((f) => f.page.busy),
    indexedControls: [
      local,
      ...[...frames.values()].map((frame) => frame.page),
    ].every((source) => source.indexedControls !== undefined)
      ? Math.min(
          5000,
          local.indexedControls! +
            [...frames.values()].reduce(
              (n, f) => n + f.page.indexedControls!,
              0,
            ),
        )
      : undefined,
    signals: [
      ...(local.signals || []),
      ...[...frames]
        .filter(([id]) => context.frameVisibilityStates.get(id)?.visible)
        .flatMap(([id, f]) =>
          (f.page.signals || []).map((s) => ({
            ...s,
            frameId: id,
            documentId: f.documentId,
          })),
        ),
    ].slice(0, 30),
  };
  if (!localPerception) return { page };
  const coverageReport: BrowserPerception["coverage"] = [];
  const boundedPairs = new Map<number, DiscoveryPerception>();
  for (const [frameId, pair] of pairs) {
    const sourcePage = frameId === 0 ? local : frames.get(frameId)!.page;
    const ids = selectedRegions.get(frameId) || new Set<string>();
    const controlMetadata = pair.controls.filter((control) => {
      const selectedControl = selected.get(control.controlId);
      return (
        selectedControl && (selectedControl.reference?.frameId || 0) === frameId
      );
    });
    const regions = pair.regions.filter((region) => ids.has(region.id));
    const droppedRegions = pair.regions.length - regions.length;
    const droppedReferences = pair.controls.length - controlMetadata.length;
    omitted.regions += pair.omissions.regions + droppedRegions;
    omitted.partial ||= droppedRegions > 0 || droppedReferences > 0;
    for (const reason of pair.omissions.reasons)
      if (!omitted.reasons.includes(reason)) omitted.reasons.push(reason);
    if (droppedRegions > 0 && !omitted.reasons.includes("not-eligible"))
      omitted.reasons.push("not-eligible");
    coverageReport.push({
      frameId,
      indexedControls: sourcePage.indexedControls ?? null,
      snapshotControls: sourcePage.controls.length,
      ...pair.omissions,
      controlRegions: pair.omissions.controlRegions + droppedReferences,
    });
    boundedPairs.set(frameId, { ...pair, regions, controls: controlMetadata });
  }
  omitted.hierarchyTruncated ||= [...pairs.values()].some(
    (pair) => pair.omissions.hierarchyTruncated,
  );
  omitted.partial ||= [...pairs.values()].some(
    (pair) => pair.omissions.partial,
  );
  const perception: ComposedDiscoveryPerception = {
    pageRevision: page.revision,
    root: boundedPairs.get(0)!,
    frames: [...frames].map(([frameId, frame]) => ({
      frameId,
      parentFrameId: frame.parentFrameId,
      documentId: frame.documentId,
      perception: boundedPairs.get(frameId)!,
    })),
    coverage: coverageReport,
    omissions: omitted,
  };
  return { page, perception };
}
