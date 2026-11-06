import type { MemoryControl, MemoryPage, SiteMemory } from "../page-model";
import { sanitizeSavedText } from "../privacy-redaction";
import {
  navigationProjectionBytes,
  NAVIGATION_LIMITS,
  type NavigationObservation,
} from "./contracts-navigation";
import {
  NAVIGATION_KNOWLEDGE_LIMITS,
  navigationKnowledgeControlKey,
  navigationKnowledgeControlIdentity,
  navigationKnowledgeControlSchema,
  navigationKnowledgeStateKey,
  savedNavigationKnowledgeSchema,
  navigationKnowledgeQuerySchema,
  type SavedNavigationKnowledge,
  type NavigationKnowledgeControl,
} from "./contracts-navigation-knowledge";

export function navigationKnowledgeOperationForControl(
  control: Pick<MemoryControl, "kind">,
) {
  if (control.kind === "navigation") return "navigate" as const;
  if (["expand", "section", "toggle"].includes(control.kind))
    return "reveal" as const;
  if (["choice", "select"].includes(control.kind)) return "choose" as const;
  return undefined;
}

function uniqueKnowledgeControls<
  T extends Pick<MemoryControl, "role" | "label" | "kind" | "risk">,
>(source: readonly T[]) {
  const selected = new Map<
    string,
    {
      control: T;
      descriptor: NavigationKnowledgeControl;
      action: NonNullable<
        ReturnType<typeof navigationKnowledgeOperationForControl>
      >;
    }[]
  >();
  for (const control of source) {
    const action = navigationKnowledgeOperationForControl(control);
    if (control.risk !== "ordinary" || !action) continue;
    const parsed = navigationKnowledgeControlSchema.safeParse({
      role: control.role,
      label: control.label,
      kind: control.kind === "navigation" ? "navigation" : "control",
    });
    if (parsed.success) {
      const key = navigationKnowledgeControlIdentity(parsed.data);
      const group = selected.get(key) ?? [];
      group.push({ control, descriptor: parsed.data, action });
      selected.set(key, group);
    }
  }
  return [...selected.values()].flatMap((group) =>
    group.length === 1 ? group : [],
  );
}
export function projectNavigationKnowledgeControls(
  source: readonly Pick<MemoryControl, "role" | "label" | "kind" | "risk">[],
) {
  const unique = uniqueKnowledgeControls(source);
  return unique.length <= NAVIGATION_KNOWLEDGE_LIMITS.controls
    ? unique.map((item) => item.descriptor)
    : [];
}

// Hidden or unavailable controls do not define the actionable structural state.
// Offscreen controls remain members; viewport geometry is never persisted.
function availableKnowledgeControl(
  control: Pick<MemoryControl, "visible" | "enabled" | "occluded">,
) {
  return control.visible && control.enabled && !control.occluded;
}

export function navigationKnowledgeQueryFromObservation(
  observation: NavigationObservation,
  origin: string,
) {
  return navigationKnowledgeQuerySchema.parse({
    origin,
    query: sanitizeSavedText(observation.context.goal, 1000),
    controls:
      observation.omissions.controls ||
      observation.omissions.reasons.includes("partial-scan")
        ? []
        : projectNavigationKnowledgeControls(
            observation.controls.filter(availableKnowledgeControl),
          ),
    maxContextBytes: Math.min(
      NAVIGATION_KNOWLEDGE_LIMITS.contextBytes,
      Math.max(
        0,
        NAVIGATION_LIMITS.maxProjectionBytes -
          navigationProjectionBytes(observation),
      ),
    ),
  });
}

/** Explicit source projection. It neither scans storage nor grants upload consent. */
export async function projectNavigationKnowledge(
  source: SiteMemory,
  now = Date.now(),
  notBefore = 0,
) {
  const controls = new Map<
    string,
    SavedNavigationKnowledge["controls"][number]
  >();
  const states = new Map<string, SavedNavigationKnowledge["states"][number]>();
  const local = new Map<
    string,
    {
      key: string;
      controls: Map<
        string,
        {
          key: string;
          operation: NonNullable<
            ReturnType<typeof navigationKnowledgeOperationForControl>
          >;
        }
      >;
    }
  >();
  const fresh = (time: number) =>
    Number.isFinite(time) &&
    time >= notBefore &&
    time <= now + NAVIGATION_KNOWLEDGE_LIMITS.clockSkewMs &&
    time >= now - NAVIGATION_KNOWLEDGE_LIMITS.retentionMs;
  const pages: MemoryPage[] = [...(source.states ?? []), ...source.pages]
    .filter((page) => page.complete === true && fresh(page.lastSeen))
    .sort((a, b) => b.lastSeen - a.lastSeen);
  for (const page of pages) {
    const projected = new Map<string, NavigationKnowledgeControl>();
    const signatures = new Map<
      string,
      {
        key: string;
        operation: NonNullable<
          ReturnType<typeof navigationKnowledgeOperationForControl>
        >;
      }
    >();
    const candidates = page.controls.filter(
      (control) =>
        control.active &&
        availableKnowledgeControl(control) &&
        !control.riskReason &&
        !control.form?.authentication &&
        !control.form?.stage,
    );
    for (const { control, descriptor, action } of uniqueKnowledgeControls(
      candidates,
    )) {
      const key = await navigationKnowledgeControlKey(descriptor);
      projected.set(key, descriptor);
      signatures.set(control.signature, { key, operation: action });
    }
    if (
      !projected.size ||
      projected.size > NAVIGATION_KNOWLEDGE_LIMITS.controls ||
      new Set([...controls.keys(), ...projected.keys()]).size >
        NAVIGATION_KNOWLEDGE_LIMITS.controls
    )
      continue;
    const key = await navigationKnowledgeStateKey([...projected.keys()]);
    if (!states.has(key) && states.size >= NAVIGATION_KNOWLEDGE_LIMITS.states)
      continue;
    for (const [controlKey, value] of projected)
      controls.set(controlKey, { key: controlKey, ...value });
    const previous = states.get(key);
    if (!previous || Date.parse(previous.observedAt) < page.lastSeen)
      states.set(key, {
        key,
        controls: [...projected.keys()].sort(),
        observedAt: new Date(page.lastSeen).toISOString(),
      });
    local.set(page.stateKey, { key, controls: signatures });
  }
  const edges = new Map<string, SavedNavigationKnowledge["edges"][number]>();
  for (const edge of [...source.transitions].sort(
    (a, b) => b.lastVerified - a.lastVerified,
  )) {
    if (
      !edge.active ||
      edge.evidence !== "observed" ||
      !edge.requiresFreshBinding ||
      !edge.action ||
      !fresh(edge.lastVerified)
    )
      continue;
    const from = local.get(edge.from),
      to = local.get(edge.to);
    const control = from?.controls.get(edge.signature);
    if (!from || !to || !control || from.key === to.key) continue;
    const key = JSON.stringify([
      from.key,
      to.key,
      control.key,
      control.operation,
    ]);
    if (edges.has(key)) continue;
    edges.set(key, {
      from: from.key,
      to: to.key,
      control: control.key,
      operation: control.operation,
      observedAt: new Date(edge.lastVerified).toISOString(),
      successes: notBefore
        ? 1
        : Math.min(1000000, Math.max(1, Math.floor(edge.samples ?? 1))),
      failures: notBefore
        ? 0
        : Math.min(1000000, Math.max(0, Math.floor(edge.failures ?? 0))),
    });
    if (edges.size === NAVIGATION_KNOWLEDGE_LIMITS.edges) break;
  }
  const graph = {
    normalizationVersion: 1 as const,
    origin: source.origin,
    controls: [...controls.values()].sort((a, b) => a.key.localeCompare(b.key)),
    states: [...states.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edges: [...edges.values()],
  };
  // Leave space for the approved metadata/wire wrapper without truncating a state.
  while (
    new TextEncoder().encode(JSON.stringify(graph)).byteLength >
      NAVIGATION_KNOWLEDGE_LIMITS.artifactBytes - 2048 &&
    graph.states.length
  ) {
    const oldest = [...graph.states].sort(
      (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
    )[0];
    graph.states = graph.states.filter((state) => state.key !== oldest.key);
    const retained = new Set(graph.states.map((state) => state.key));
    graph.edges = graph.edges.filter(
      (edge) => retained.has(edge.from) && retained.has(edge.to),
    );
    const used = new Set(graph.states.flatMap((state) => state.controls));
    graph.controls = graph.controls.filter((control) => used.has(control.key));
  }
  // The bound applies before any artifact wrapper or network upload is constructed.
  return savedNavigationKnowledgeSchema.parse(graph);
}
