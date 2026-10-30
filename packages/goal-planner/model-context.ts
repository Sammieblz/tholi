import type { PageControl, PageSnapshot, TaskJourney } from "../page-model";
import { goalScore } from "./index";
import { sanitizeGoal, sanitizeText } from "../privacy-redaction";
import {
  NAVIGATION_LIMITS,
  NAVIGATION_PROTOCOL,
  NAVIGATION_CONTRACT_VERSION,
  navigationObservationSchema,
  navigationProjectionBytes,
  nativeReferenceKey,
  serializedUtf8Bytes,
  type NavigationContext,
  type NavigationControlReference,
  type NavigationObservation,
  type NavigationStamp,
} from "../navigation-core/contracts-navigation";
import {
  browserPerceptionSchema,
  type BrowserPerception,
} from "../page-discovery/perception";

// Only the user's goal and independently verified summaries leave the journey.
export function buildNavigationContext(
  rawGoal: string,
  task?: Pick<TaskJourney, "progress">,
): NavigationContext {
  return {
    goal: sanitizeGoal(rawGoal),
    verifiedProgress: (task?.progress || [])
      .map((step) => ({ label: sanitizeText(step.label), kind: step.kind }))
      .filter((step) => step.label.length > 0)
      .slice(-NAVIGATION_LIMITS.maxProgress),
  };
}

export type ProjectionReason =
  | "budget"
  | "inaccessible-frame"
  | "privacy"
  | "unsupported"
  | "not-eligible"
  | "partial-scan"
  | "hierarchy-truncated"
  | "ambiguous-control"
  | "missing-perception"
  | "stale-perception"
  | "invalid-perception";
/** Content-free diagnostics stay beside the prompt, never inside its budget. */
export interface ProjectionReport {
  version: 1;
  format: "legacy" | "navigation";
  status: "ready" | "unavailable";
  counts: {
    indexedCandidates: number | null;
    snapshotControls: number | null;
    composedControls: number;
    rankedControls: number | null;
    projectedControls: number | null;
    composedRegions: number | null;
    projectedRegions: number | null;
    composedFrames: number | null;
    projectedFrames: number | null;
    compositionOmittedControls: number | null;
    modelOmittedControls: number | null;
  };
  projectionBytes: number | null;
  partial: boolean;
  reasons: ProjectionReason[];
}

/** Bare IDs are public identifiers. An ambiguous group cannot be renamed. */
export function unambiguousControls(controls: readonly PageControl[]) {
  const counts = new Map<string, number>();
  for (const control of controls)
    counts.set(control.id, (counts.get(control.id) || 0) + 1);
  const ambiguous = new Set(
    [...counts].filter(([, count]) => count > 1).map(([id]) => id),
  );
  const blocked = new Set(ambiguous);
  const dependents = new Map<string, Set<string>>();
  for (const control of controls)
    for (const id of control.revealIds) {
      let entries = dependents.get(id);
      if (!entries) dependents.set(id, (entries = new Set()));
      entries.add(control.id);
    }
  const queue = [...ambiguous];
  for (let index = 0; index < queue.length; index++) {
    for (const id of dependents.get(queue[index]) || [])
      if (!blocked.has(id)) {
        blocked.add(id);
        queue.push(id);
      }
  }
  const kept = controls.filter((control) => !blocked.has(control.id));
  const ambiguousControls = controls.filter((control) =>
    ambiguous.has(control.id),
  ).length;
  return {
    controls: kept,
    ambiguousControls,
    dependentControls: controls.length - kept.length - ambiguousControls,
  };
}

const pageFrameKey = (control: PageControl) =>
  control.reference
    ? JSON.stringify([
        control.reference.tabId,
        control.reference.frameId,
        control.reference.documentId,
      ])
    : "root";
/** Shared by composition and model projection; no browser or DOM authority. */
export function controlDependencies(
  candidate: PageControl,
  byId: ReadonlyMap<string, PageControl>,
  requireEnabled = true,
): PageControl[] | undefined {
  const complete = new Map<string, PageControl>();
  const pending = new Set<string>();
  const frame = pageFrameKey(candidate);
  const stack = [{ control: candidate, exit: false }];
  while (stack.length) {
    const { control, exit } = stack.pop()!;
    if (exit) {
      pending.delete(control.id);
      complete.set(control.id, control);
      continue;
    }
    if (pending.has(control.id)) return;
    if (complete.has(control.id)) continue;
    if ((requireEnabled && !control.enabled) || pageFrameKey(control) !== frame)
      return;
    pending.add(control.id);
    stack.push({ control, exit: true });
    for (const id of [...control.revealIds].reverse()) {
      const opener = byId.get(id);
      if (!opener) return;
      stack.push({ control: opener, exit: false });
    }
  }
  return [...complete.values()];
}

function controlEvidence(control: PageControl) {
  return {
    label: sanitizeText(control.label),
    role: sanitizeText(control.role).slice(0, 40),
    description: control.description
      ? sanitizeText(control.description) || undefined
      : undefined,
    context: sanitizeText(control.context) || undefined,
    scope: control.scope,
    popup: control.popup,
    placement: control.placement,
    checked: control.checked,
    selected: control.selected,
    expanded: control.expanded,
    options: control.options
      ?.map((option) => ({
        label: sanitizeText(option.label),
        selected: option.selected,
        enabled: option.enabled,
      }))
      .filter((option) => option.label.length > 0),
  };
}

function prepare(
  page: PageSnapshot,
  rawGoal: string,
  task: TaskJourney | undefined,
  rawPerception: BrowserPerception | undefined,
) {
  const context = buildNavigationContext(rawGoal, task);
  const reasons = new Set<ProjectionReason>();
  let perception: BrowserPerception | undefined;
  if (!rawPerception) reasons.add("missing-perception");
  else {
    const parsed = browserPerceptionSchema.safeParse(rawPerception);
    if (!parsed.success) reasons.add("invalid-perception");
    else if (parsed.data.pageRevision !== page.revision)
      reasons.add("stale-perception");
    else perception = parsed.data;
  }
  const unambiguous = unambiguousControls(page.controls);
  if (unambiguous.ambiguousControls) reasons.add("ambiguous-control");
  if (page.partial || perception?.omissions.partial)
    reasons.add("partial-scan");
  if (perception) {
    for (const reason of perception.omissions.reasons) reasons.add(reason);
    if (perception.omissions.hierarchyTruncated)
      reasons.add("hierarchy-truncated");
  }
  const terms = context.goal.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  // Preserve the existing generic ranker. Closure and admission change, not scores.
  const ranked = unambiguous.controls
    .filter((control) => control.enabled)
    .map((control, index) => {
      const text = [
        control.label,
        control.description,
        control.context,
        ...(control.structure?.headings.map((heading) => heading.label) || []),
        ...(control.structure?.regions.map((region) => region.name) || []),
      ]
        .join(" ")
        .toLowerCase();
      return {
        control,
        index,
        score:
          goalScore(context.goal, control) * 100 +
          terms.filter((term) => text.includes(term)).length * 3 +
          Number(control.kind !== "navigation" && control.kind !== "section") *
            5 +
          Number(control.scope === "page") * 4 +
          Number(!!control.popup) * 3 +
          Number(control.inViewport),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const metadata = new Map<
    string,
    BrowserPerception["controlRegions"][number]
  >();
  const ambiguousMetadata = new Set<string>();
  for (const evidence of perception?.controlRegions || []) {
    const id = evidence.reference.controlId;
    if (metadata.has(id) || ambiguousMetadata.has(id)) {
      metadata.delete(id);
      ambiguousMetadata.add(id);
      reasons.add("ambiguous-control");
    } else metadata.set(id, evidence);
  }
  const frames = new Map(
    perception?.frames.map((frame) => [frame.native.frameId, frame]),
  );
  const regions = new Map(
    perception?.regions.map((region) => [region.id, region]),
  );
  const byId = new Map(
    unambiguous.controls.map((control) => [control.id, control]),
  );
  const evidence = new Map(
    unambiguous.controls.map((control) => [control, controlEvidence(control)]),
  );
  const reference = (
    control: PageControl,
  ): NavigationControlReference | undefined => {
    const evidence = metadata.get(control.id);
    if (!perception || !evidence) return;
    const expected = control.reference
      ? frames.get(control.reference.frameId)?.native
      : perception.native;
    if (
      !expected ||
      nativeReferenceKey(expected) !== nativeReferenceKey(evidence.reference)
    )
      return;
    if (
      control.reference &&
      (control.reference.tabId !== expected.tabId ||
        control.reference.documentId !== expected.documentId)
    )
      return;
    return evidence.reference;
  };
  return {
    page,
    context,
    task,
    perception,
    reasons,
    ranked,
    metadata,
    frames,
    regions,
    byId,
    evidence,
    reference,
  };
}
type Prepared = ReturnType<typeof prepare>;
type Frame = NavigationObservation["frames"][number];
type Region = NavigationObservation["regions"][number];
interface Selection {
  controls: PageControl[];
  regions: Region[];
  frames: Frame[];
}

function select<T>(
  prepared: Prepared,
  render: (selection: Selection) => T,
  size: (wire: T) => number,
) {
  const root = prepared.perception?.frames.find(
    (frame) => frame.native.frameId === 0,
  );
  const empty = (): Selection => ({
    controls: [],
    regions: [],
    frames: root ? [root] : [],
  });
  let selected = empty();
  const admitted: Selection[] = [];
  const merge = (left: Selection, right: Selection): Selection => ({
    controls: [
      ...new Map(
        [...left.controls, ...right.controls].map((control) => [
          control.id,
          control,
        ]),
      ).values(),
    ],
    regions: [
      ...new Map(
        [...left.regions, ...right.regions].map((region) => [
          region.id,
          region,
        ]),
      ).values(),
    ],
    frames: [
      ...new Map(
        [...left.frames, ...right.frames].map((frame) => [
          frame.native.frameId,
          frame,
        ]),
      ).values(),
    ],
  });
  for (const { control } of prepared.ranked) {
    if (selected.controls.some((existing) => existing.id === control.id))
      continue;
    const dependencies = controlDependencies(control, prepared.byId);
    if (!dependencies) {
      prepared.reasons.add("not-eligible");
      continue;
    }
    const bundle: Selection = {
      controls: dependencies,
      regions: [],
      frames: [],
    };
    let valid = true;
    for (const dependency of dependencies) {
      if (!prepared.evidence.get(dependency)!.label) {
        prepared.reasons.add("privacy");
        valid = false;
        break;
      }
      if (!prepared.perception) continue;
      const reference = prepared.reference(dependency);
      if (!reference) {
        valid = false;
        break;
      }
      let frame = prepared.frames.get(reference.frameId);
      const frameIds = new Set<number>();
      while (frame) {
        if (frameIds.has(frame.native.frameId)) {
          valid = false;
          break;
        }
        frameIds.add(frame.native.frameId);
        bundle.frames.push(frame);
        if (frame.parentFrameId === undefined) break;
        frame = prepared.frames.get(frame.parentFrameId);
        if (!frame) valid = false;
      }
      let regionId = prepared.metadata.get(dependency.id)?.regionId;
      const regionIds = new Set<string>();
      while (regionId) {
        const region = prepared.regions.get(regionId);
        if (
          !region ||
          region.frameId !== reference.frameId ||
          regionIds.has(regionId)
        ) {
          valid = false;
          break;
        }
        regionIds.add(regionId);
        bundle.regions.push(region);
        regionId = region.parentId;
      }
    }
    if (!valid) {
      prepared.reasons.add("not-eligible");
      continue;
    }
    const next = merge(selected, bundle);
    if (
      next.controls.length > NAVIGATION_LIMITS.maxControls ||
      next.regions.length > NAVIGATION_LIMITS.maxRegions ||
      next.frames.length > NAVIGATION_LIMITS.maxFrames ||
      size(render(next)) > NAVIGATION_LIMITS.maxProjectionBytes
    ) {
      prepared.reasons.add("budget");
      continue;
    }
    admitted.push(bundle);
    selected = next;
  }
  // Later omission reasons and counter digits also belong to the whole budget.
  while (
    size(render(selected)) > NAVIGATION_LIMITS.maxProjectionBytes &&
    admitted.length
  ) {
    prepared.reasons.add("budget");
    admitted.pop();
    selected = admitted.reduce(merge, empty());
  }
  return { selected, wire: render(selected) };
}

function report(
  prepared: Prepared,
  selection: Selection,
  format: ProjectionReport["format"],
  bytes: number | null,
  ready = true,
): ProjectionReport {
  const perception = prepared.perception;
  // Count only observed pre-composition controls. Unscanned frame contents are
  // unknown; their frame omissions must never become estimated control counts.
  const snapshotControls = perception
    ? prepared.page.controls.length + perception.omissions.controls
    : null;
  return {
    version: 1,
    format,
    status: ready ? "ready" : "unavailable",
    counts: {
      indexedCandidates: prepared.page.indexedControls ?? null,
      snapshotControls,
      composedControls: prepared.page.controls.length,
      rankedControls: prepared.ranked.length,
      projectedControls: ready ? selection.controls.length : null,
      composedRegions: perception?.regions.length ?? null,
      projectedRegions: perception && ready ? selection.regions.length : null,
      composedFrames: perception?.frames.length ?? null,
      projectedFrames: perception && ready ? selection.frames.length : null,
      compositionOmittedControls: perception?.omissions.controls ?? null,
      modelOmittedControls: ready
        ? prepared.page.controls.length - selection.controls.length
        : null,
    },
    projectionBytes: bytes,
    partial: prepared.page.partial || perception?.omissions.partial === true,
    reasons: [...prepared.reasons],
  };
}

function packedLegacy(prepared: Prepared, control: PageControl) {
  const metadata = prepared.metadata.get(control.id);
  return {
    id: control.id,
    ...prepared.evidence.get(control)!,
    structure: control.structure
      ? {
          regions: control.structure.regions.map((region) => ({
            role: sanitizeText(region.role).slice(0, 40),
            name: sanitizeText(region.name),
          })),
          headings: control.structure.headings.map((heading) => ({
            level: heading.level,
            label: sanitizeText(heading.label),
          })),
        }
      : undefined,
    form: control.form,
    kind: control.kind,
    visible: control.visible,
    revealIds: control.revealIds,
    risk: control.risk,
    riskReason: control.riskReason,
    targetLanguage: control.targetLanguage,
    destination: control.destination
      ? {
          sameOrigin: control.destination.origin === prepared.page.origin,
          path: control.destination.path,
        }
      : undefined,
    reference: prepared.reference(control),
    regionId: metadata?.regionId,
    bounds: metadata?.bounds,
  };
}

export function buildModelProjection(
  page: PageSnapshot,
  rawGoal: string,
  task?: TaskJourney,
  perception?: BrowserPerception,
) {
  const prepared = prepare(page, rawGoal, task, perception);
  const packed = new Map(
    [...prepared.byId.values()].map((control) => [
      control.id,
      packedLegacy(prepared, control),
    ]),
  );
  const render = (selection: Selection) => ({
    goal: prepared.context.goal,
    task: task
      ? {
          id: task.id,
          strategy: task.strategy,
          status: task.status,
          reroutes: task.reroutes,
          verifiedProgress: prepared.context.verifiedProgress,
        }
      : undefined,
    page: {
      origin: page.origin,
      language: page.language,
      layout: page.layout,
      revision: page.revision,
      partialScan:
        page.partial || prepared.perception?.omissions.partial === true,
      discoveredControls: page.controls.length,
      omittedControls: page.controls.length - selection.controls.length,
      omissions: prepared.perception?.omissions,
    },
    controls: selection.controls.map((control) => packed.get(control.id)!),
    ...(prepared.perception
      ? {
          regions: selection.regions,
          frames: selection.frames.map(
            ({ native, parentFrameId, viewport }) => ({
              native,
              parentFrameId,
              viewport,
            }),
          ),
        }
      : {}),
  });
  const { selected, wire } = select(prepared, render, serializedUtf8Bytes);
  return {
    context: wire,
    report: report(prepared, selected, "legacy", serializedUtf8Bytes(wire)),
  };
}

export function modelContext(
  page: PageSnapshot,
  rawGoal: string,
  task?: TaskJourney,
  perception?: BrowserPerception,
) {
  return buildModelProjection(page, rawGoal, task, perception).context;
}

export function buildNavigationObservation(
  page: PageSnapshot,
  rawGoal: string,
  input: {
    stamp: NavigationStamp;
    observedAtMs: number;
    deadlineAtMs: number;
    perception: BrowserPerception;
    images?: NavigationObservation["images"];
  },
  task?: TaskJourney,
): { observation: NavigationObservation | null; report: ProjectionReport } {
  const prepared = prepare(page, rawGoal, task, input.perception);
  if (!prepared.perception)
    return {
      observation: null,
      report: report(
        prepared,
        { controls: [], frames: [], regions: [] },
        "navigation",
        null,
        false,
      ),
    };
  const perception = prepared.perception;
  const render = (selection: Selection): NavigationObservation => ({
    protocol: NAVIGATION_PROTOCOL,
    version: NAVIGATION_CONTRACT_VERSION,
    stamp: input.stamp,
    native: perception.native,
    observedAtMs: input.observedAtMs,
    deadlineAtMs: input.deadlineAtMs,
    frames: selection.frames.map(({ native, parentFrameId, viewport }) => ({
      native,
      parentFrameId,
      viewport,
    })),
    regions: selection.regions,
    controls: selection.controls.map((control) => ({
      ...prepared.evidence.get(control)!,
      reference: prepared.reference(control)!,
      kind: control.kind,
      risk: control.risk,
      eligible: control.enabled && control.risk === "ordinary",
      visible: control.visible,
      enabled: control.enabled,
      occluded: control.occluded === true,
      inViewport: control.inViewport,
      regionId: prepared.metadata.get(control.id)?.regionId,
      bounds: prepared.metadata.get(control.id)?.bounds,
      revealIds: control.revealIds,
    })),
    omissions: {
      frames:
        perception.omissions.frames +
        perception.frames.length -
        selection.frames.length,
      regions:
        perception.omissions.regions +
        perception.regions.length -
        selection.regions.length,
      controls:
        perception.omissions.controls +
        page.controls.length -
        selection.controls.length,
      reasons: [
        ...new Set(
          [...prepared.reasons].map((reason) =>
            reason === "ambiguous-control"
              ? "not-eligible"
              : reason === "hierarchy-truncated"
                ? "partial-scan"
                : reason === "missing-perception" ||
                    reason === "stale-perception" ||
                    reason === "invalid-perception"
                  ? "unsupported"
                  : reason,
          ),
        ),
      ],
    },
    context: prepared.context,
    images: input.images || [],
  });
  const { selected, wire } = select(
    prepared,
    render,
    navigationProjectionBytes,
  );
  const parsed = navigationObservationSchema.safeParse(wire);
  if (!parsed.success) {
    prepared.reasons.add("unsupported");
    return {
      observation: null,
      report: report(prepared, selected, "navigation", null, false),
    };
  }
  return {
    observation: parsed.data,
    report: report(
      prepared,
      selected,
      "navigation",
      navigationProjectionBytes(parsed.data),
    ),
  };
}
