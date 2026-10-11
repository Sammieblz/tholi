import type {
  PageSnapshot,
  SiteMemory,
  MemoryTransition,
  RouteStrategy,
} from "../page-model";

// Dijkstra over observed states. Predictions never grant eligibility to a
// control: the first edge must bind to an ordinary control on the live page.
export function edgeCost(
  edge: MemoryTransition,
  strategy: RouteStrategy,
  now = Date.now(),
) {
  const uncertainty =
    Math.min(5000, (Math.max(0, now - edge.lastVerified) / 86400000) * 100) +
    ((edge.samples || 1) < 2 ? 1000 : 0);
  return strategy === "fewest-clicks"
    ? 1
    : Math.max(500, edge.meanMs || 5000) + uncertainty;
}
export function shortestRoute(
  page: PageSnapshot,
  memory: SiteMemory,
  desired: Set<string>,
  strategy: RouteStrategy = "fastest",
  now = Date.now(),
) {
  const edges = memory.transitions.filter(
    (e) => e.active && e.evidence === "observed",
  );
  const queue: { state: string; path: MemoryTransition[]; cost: number }[] = [
    { state: page.stateKey, path: [], cost: 0 },
  ];
  const best = new Map<string, number>();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (
      (best.get(current.state) ?? Infinity) <= current.cost ||
      current.path.length > 12
    )
      continue;
    best.set(current.state, current.cost);
    if (current.path.length && desired.has(current.state)) return current.path;
    for (const edge of edges.filter((e) => e.from === current.state)) {
      if (
        !current.path.length &&
        !page.controls.some(
          (c) =>
            c.visible &&
            c.enabled &&
            c.risk === "ordinary" &&
            c.signature === edge.signature,
        )
      )
        continue;
      // Less recent/singly observed transitions carry a modest uncertainty cost.
      const cost = edgeCost(edge, strategy, now);
      queue.push({
        state: edge.to,
        path: [...current.path, edge],
        cost: current.cost + cost,
      });
    }
  }
  return undefined;
}
