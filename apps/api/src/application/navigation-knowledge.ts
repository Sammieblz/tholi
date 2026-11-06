import { bm25 } from "../../../../packages/nlp/retrieval";
import {
  NAVIGATION_KNOWLEDGE_LIMITS,
  navigationKnowledgeQuerySchema,
  navigationKnowledgeStateKey,
  navigationKnowledgeControlKey,
  navigationKnowledgeContextSchema,
  type NavigationKnowledgeContext,
  type NavigationKnowledgeQuery,
  type RetrievedNavigationKnowledge,
  type SavedNavigationKnowledge,
} from "../../../../packages/navigation-core/contracts-navigation-knowledge";

export interface NavigationKnowledgeCandidate {
  id: string;
  revision: string;
  updatedAt: string;
  data: SavedNavigationKnowledge;
}

/** Pure ranking shared by the saved-data HTTP operation and later inference use. */
export async function rankNavigationKnowledge(
  raw: NavigationKnowledgeQuery,
  records: readonly NavigationKnowledgeCandidate[],
  signal: AbortSignal,
  now = Date.now(),
): Promise<
  Omit<RetrievedNavigationKnowledge, "contextDigest" | "snapshotDigest">
> {
  const query = navigationKnowledgeQuerySchema.parse(raw);
  signal.throwIfAborted();
  const currentState = await navigationKnowledgeStateKey(
    await Promise.all(query.controls.map(navigationKnowledgeControlKey)),
  );
  signal.throwIfAborted();
  const bounded = records.slice(0, NAVIGATION_KNOWLEDGE_LIMITS.candidates);
  const paths: {
    fact: NavigationKnowledgeContext["facts"][number];
    text: string;
    source: RetrievedNavigationKnowledge["sources"][number];
    stable: string;
  }[] = [];
  let stale = 0;
  const fresh = (value: string) => {
    const time = Date.parse(value);
    return (
      Number.isFinite(time) &&
      time <= now + NAVIGATION_KNOWLEDGE_LIMITS.clockSkewMs &&
      time >= now - NAVIGATION_KNOWLEDGE_LIMITS.freshMs
    );
  };
  for (const record of bounded) {
    signal.throwIfAborted();
    const graph = record.data;
    if (graph.origin !== query.origin || !fresh(record.updatedAt)) {
      stale++;
      continue;
    }
    const states = new Map(graph.states.map((state) => [state.key, state]));
    const controls = new Map(
      graph.controls.map((control) => [control.key, control]),
    );
    const start = states.get(currentState);
    if (!start || !fresh(start.observedAt)) {
      stale++;
      continue;
    }
    const queue: {
      state: string;
      visited: string[];
      edges: SavedNavigationKnowledge["edges"];
    }[] = [{ state: start.key, visited: [start.key], edges: [] }];
    let considered = 0;
    while (
      queue.length &&
      considered < NAVIGATION_KNOWLEDGE_LIMITS.edges &&
      paths.length < NAVIGATION_KNOWLEDGE_LIMITS.candidates
    ) {
      const route = queue.shift()!;
      if (route.edges.length >= NAVIGATION_KNOWLEDGE_LIMITS.steps) continue;
      for (const edge of graph.edges) {
        if (
          edge.from !== route.state ||
          route.visited.includes(edge.to) ||
          edge.failures >= edge.successes ||
          !fresh(edge.observedAt) ||
          !fresh(states.get(edge.to)?.observedAt ?? "")
        )
          continue;
        const control = controls.get(edge.control);
        if (!control) continue;
        considered++;
        const edges = [...route.edges, edge];
        const steps = edges.map((step) => {
          const target = controls.get(step.control)!;
          return {
            role: target.role,
            label: target.label,
            kind: target.kind,
            operation: step.operation,
          };
        });
        paths.push({
          fact: {
            kind: "observed-route",
            steps,
            observedAt: new Date(
              Math.min(...edges.map((step) => Date.parse(step.observedAt))),
            ).toISOString(),
            successes: Math.min(...edges.map((step) => step.successes)),
            failures: Math.max(...edges.map((step) => step.failures)),
          },
          text: [
            ...steps.map((step) => step.label),
            ...states
              .get(edge.to)!
              .controls.map((key) => controls.get(key)!.label),
          ].join(" "),
          source: { artifactId: record.id, revision: record.revision },
          stable: JSON.stringify([
            record.id,
            edges.map((step) => [step.from, step.to, step.control]),
          ]),
        });
        if (
          considered >= NAVIGATION_KNOWLEDGE_LIMITS.edges ||
          paths.length >= NAVIGATION_KNOWLEDGE_LIMITS.candidates
        )
          break;
        queue.push({
          state: edge.to,
          visited: [...route.visited, edge.to],
          edges,
        });
      }
    }
  }
  const scores = bm25(
    query.query,
    paths.map((path) => path.text),
  );
  const ranked = paths
    .map((path, index) => ({
      ...path,
      score:
        (scores[index] * path.fact.successes) /
        (path.fact.successes + path.fact.failures) /
        Math.sqrt(path.fact.steps.length),
    }))
    .filter((path) => path.score > 0)
    .sort((a, b) => b.score - a.score || a.stable.localeCompare(b.stable));
  const facts: NavigationKnowledgeContext["facts"] = [];
  const sources = new Map<
    string,
    RetrievedNavigationKnowledge["sources"][number]
  >();
  const seen = new Set<string>();
  let budget = false;
  for (const path of ranked) {
    signal.throwIfAborted();
    const key = JSON.stringify(path.fact.steps);
    if (seen.has(key)) continue;
    const context = { version: 1 as const, facts: [...facts, path.fact] };
    if (
      !navigationKnowledgeContextSchema.safeParse(context).success ||
      new TextEncoder().encode(JSON.stringify(context)).byteLength >
        query.maxContextBytes
    ) {
      budget = true;
      continue;
    }
    facts.push(path.fact);
    sources.set(path.source.artifactId, path.source);
    seen.add(key);
    if (facts.length === NAVIGATION_KNOWLEDGE_LIMITS.facts) break;
  }
  return {
    context: facts.length ? { version: 1, facts } : null,
    sources: [...sources.values()],
    siteSettings: null,
    diagnostics: {
      candidates: bounded.length,
      selected: facts.length,
      omitted: Math.max(0, bounded.length - sources.size),
      reason: facts.length
        ? "matched"
        : budget
          ? "budget"
          : stale
            ? "stale"
            : "empty",
    },
  };
}
