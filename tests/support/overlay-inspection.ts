import { expect, type CDPSession } from "@playwright/test";
export async function inspectOverlay(cdp: CDPSession) {
  const { root } = await cdp.send("DOM.getDocument", {
    depth: 0,
    pierce: true,
  });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#internet-navigator-overlay",
  });
  if (!nodeId) return undefined;
  const { node } = await cdp.send("DOM.describeNode", {
    nodeId,
    depth: 4,
    pierce: true,
  });
  const nodes: any[] = [];
  const visit = (n: any) => {
    nodes.push(n);
    for (const child of [...(n.children || []), ...(n.shadowRoots || [])])
      visit(child);
  };
  visit(node);
  const attr = (n: any, name: string) => {
    const i = n.attributes?.indexOf(name);
    return i >= 0 ? n.attributes[i + 1] : undefined;
  };
  const find = (cls: string) => nodes.find((n) => attr(n, "class") === cls);
  const geometry = async (cls: string) => {
    const n = find(cls);
    if (!n) return undefined;
    const result = await cdp
      .send("DOM.getBoxModel", { backendNodeId: n.backendNodeId })
      .catch(() => undefined);
    if (!result) return undefined; // The target can disappear while the worker clears guidance.
    const { model } = result;
    const q = model.border;
    return {
      left: q[0],
      top: q[1],
      right: q[4],
      bottom: q[5],
      width: model.width,
      height: model.height,
    };
  };
  const arrow = find("arrow");
  const text = (n: any): string =>
    n.nodeType === 3 ? n.nodeValue : (n.children || []).map(text).join("");
  return {
    halo: await geometry("halo"),
    tip: await geometry("tip"),
    arrow: arrow ? text(arrow) : undefined,
    ariaHidden: attr(node, "aria-hidden"),
    pointerEvents: (
      await cdp.send("CSS.getComputedStyleForNode", { nodeId })
    ).computedStyle.find((p) => p.name === "pointer-events")?.value,
  };
}
export async function aligned(
  cdp: CDPSession,
  target: () => Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>,
) {
  await expect
    .poll(
      async () => {
        try {
          const overlay = await inspectOverlay(cdp),
            r = await target();
          if (!r || !overlay?.halo) return Infinity;
          return Math.max(
            Math.abs(overlay.halo.left - (r.x - 5)),
            Math.abs(overlay.halo.top - (r.y - 5)),
            Math.abs(overlay.halo.right - (r.x + r.width + 5)),
            Math.abs(overlay.halo.bottom - (r.y + r.height + 5)),
          );
        } catch {
          return Infinity;
        }
      },
      { timeout: 10000 },
    )
    .toBeLessThan(1.5);
}
