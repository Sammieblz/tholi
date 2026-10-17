import { presented } from "../../../../packages/page-discovery/index";
import {
  hash,
  type PageControl,
  type PageSnapshot,
} from "../../../../packages/page-model/index";
import type { SessionView } from "../../../../packages/shared-types/index";
import { frameElement } from "./frame-visibility";

interface Context {
  frames: Map<
    number,
    { documentId: string; tabId: number; page: PageSnapshot }
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
}

export function compose(context: Context, local: PageSnapshot): PageSnapshot {
  if (!context.frames.size && !context.compositionStarted) return local;
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
    ...[...context.frames].flatMap(([frameId, f]) =>
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
  const controls = all.slice(0, 600),
    fingerprint = hash(
      local.fingerprint +
        "|" +
        [...context.frames]
          .map(
            ([id, f]) =>
              id +
              ":" +
              f.documentId +
              ":" +
              f.page.fingerprint +
              ":" +
              JSON.stringify(context.frameVisibilityStates.get(id)),
          )
          .join("|"),
    );
  const freshness = hash(
    fingerprint +
      "|" +
      local.revision +
      "|" +
      [...context.frames]
        .map(([id, f]) => id + ":" + f.page.revision)
        .join("|"),
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
    ...[...context.frames].flatMap(([id, f]) =>
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
  return {
    ...local,
    controls,
    coverage,
    fingerprint,
    stateKey: local.pageKey + ":" + fingerprint,
    revision: context.compositionRevision,
    partial:
      local.partial ||
      all.length > 600 ||
      [...context.frames.values()].some((f) => f.page.partial),
    busy: local.busy || [...context.frames.values()].some((f) => f.page.busy),
    indexedControls: Math.min(
      5000,
      (local.indexedControls || local.controls.length) +
        [...context.frames.values()].reduce(
          (n, f) => n + (f.page.indexedControls || f.page.controls.length),
          0,
        ),
    ),
    signals: [
      ...(local.signals || []),
      ...[...context.frames]
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
}
