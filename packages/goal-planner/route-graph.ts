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
type SearchNode = {
  state: string;
  cost: number;
  edge?: MemoryTransition;
  parent?: SearchNode;
};
const searches = new Map<
  string,
  { queue: SearchNode[]; best: Map<string, number> }
>();
// A priority heap avoids repeatedly sorting the graph or copying full paths.
function push(queue: SearchNode[], node: SearchNode) {
  queue.push(node);
  let i = queue.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (queue[parent].cost <= node.cost) break;
    queue[i] = queue[parent];
    i = parent;
  }
  queue[i] = node;
}
function pop(queue: SearchNode[]) {
  const first = queue[0],
    last = queue.pop()!;
  if (queue.length) {
    let i = 0;
    while (i * 2 + 1 < queue.length) {
      let child = i * 2 + 1;
      if (child + 1 < queue.length && queue[child + 1].cost < queue[child].cost)
        child++;
      if (queue[child].cost >= last.cost) break;
      queue[i] = queue[child];
      i = child;
    }
    queue[i] = last;
  }
  return first;
}
export function searchRoute(
  page: PageSnapshot,
  memory: SiteMemory,
  desired: Set<string>,
  strategy: RouteStrategy = "fastest",
  now = Date.now(),
  budget = 2000,
) {
  const key = [
    memory.origin,
    memory.version,
    page.stateKey,
    [...desired].sort().join(","),
    strategy,
  ].join("|");
  let search = searches.get(key);
  if (!search) {
    search = { queue: [{ state: page.stateKey, cost: 0 }], best: new Map() };
    searches.set(key, search);
  }
  while (searches.size > 8) searches.delete(searches.keys().next().value!);
  const adjacency = new Map<string, MemoryTransition[]>();
  for (const edge of memory.transitions)
    if (edge.active && edge.evidence === "observed")
      adjacency.set(edge.from, [...(adjacency.get(edge.from) || []), edge]);
  const start = performance.now();
  let expanded = 0;
  while (
    search.queue.length &&
    expanded < budget &&
    performance.now() - start < 25
  ) {
    const current = pop(search.queue);
    if ((search.best.get(current.state) ?? Infinity) <= current.cost) continue;
    search.best.set(current.state, current.cost);
    expanded++;
    if (current.edge && desired.has(current.state)) {
      const path: MemoryTransition[] = [];
      let node: SearchNode | undefined = current;
      while (node?.edge) {
        path.unshift(node.edge);
        node = node.parent;
      }
      searches.delete(key);
      // Revalidate the first edge after any incremental search continuation.
      if (
        !page.controls.some(
          (c) =>
            c.visible &&
            c.enabled &&
            c.risk === "ordinary" &&
            c.signature === path[0].signature,
        )
      )
        return { status: "missing" as const };
      return { status: "found" as const, path };
    }
    for (const edge of adjacency.get(current.state) || []) {
      if (
        !current.edge &&
        !page.controls.some(
          (c) =>
            c.visible &&
            c.enabled &&
            c.risk === "ordinary" &&
            c.signature === edge.signature,
        )
      )
        continue;
      const cost = current.cost + edgeCost(edge, strategy, now);
      if (cost < (search.best.get(edge.to) ?? Infinity))
        push(search.queue, { state: edge.to, cost, edge, parent: current });
    }
  }
  if (search.queue.length) return { status: "pending" as const };
  searches.delete(key);
  return { status: "missing" as const };
}
export function shortestRoute(
  page: PageSnapshot,
  memory: SiteMemory,
  desired: Set<string>,
  strategy: RouteStrategy = "fastest",
  now = Date.now(),
) {
  return searchRoute(page, memory, desired, strategy, now).path;
}
