// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { PageDiscovery } from "../../../packages/page-discovery/index";
import { IncrementalControlIndex } from "../../../packages/page-discovery/incremental";
import { planGoal } from "../../../packages/goal-planner/index";
import { mergeObservation } from "../../../packages/site-memory/index";
import {
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  hash,
  type PageSnapshot,
} from "../../../packages/page-model/index";
import {
  validPinnedView,
  restoreSession,
} from "../../../packages/route-registry/session";
import { modelProposalSchema } from "../../../packages/page-model/index";
import { visible } from "../../../packages/browser-adapter/index";
import { clippedRect } from "../../../packages/browser-adapter/geometry";
import { discoveryPerceptionSchema } from "../../../packages/page-discovery/perception";
function fixture(html: string) {
  document.body.innerHTML = html;
  const rect = {
    x: 10,
    y: 10,
    top: 10,
    left: 10,
    right: 110,
    bottom: 40,
    width: 100,
    height: 30,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? ([] as any) : ([rect] as any);
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function actualViewport() {
  vi.stubGlobal("visualViewport", {
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: scrollX,
    pageTop: scrollY,
    width: innerWidth,
    height: innerHeight,
    scale: 1,
  });
}
it("pairs current region hierarchy and actual scrollers without exporting field values or closed roots", () => {
  fixture(
    '<main aria-label="Workspace"><div id="scroll" style="overflow:auto"><div role="menu" aria-label="Preferences">' +
      "<div>".repeat(20) +
      '<button>Open preferences</button><input aria-label="Search" value="private editable sentinel"><input type="password" value="secret password sentinel">' +
      "</div>".repeat(20) +
      '</div></div><div id="closed-host"></div></main>',
  );
  actualViewport();
  const scroller = document.getElementById("scroll")!;
  for (const [key, value] of Object.entries({
    clientWidth: 100,
    clientHeight: 30,
    scrollWidth: 100,
    scrollHeight: 300,
  }))
    Object.defineProperty(scroller, key, { configurable: true, value });
  document
    .getElementById("closed-host")!
    .attachShadow({ mode: "closed" }).innerHTML =
    "<button>Closed application secret</button>";
  const discovery = new PageDiscovery(),
    pair = discovery.snapshotWithPerception(),
    perception = discoveryPerceptionSchema.parse(pair.perception),
    menu = perception.regions.find((region) => region.role === "menu")!,
    scroll = perception.regions.find((region) => region.scroll)!,
    main = perception.regions.find((region) => region.role === "main")!;
  expect(scroll).toMatchObject({
    parentId: main.id,
    role: "scroll-container",
    scroll: {
      horizontal: false,
      vertical: true,
      clientHeight: 30,
      scrollHeight: 300,
    },
  });
  expect(menu).toMatchObject({ parentId: scroll.id, label: "Preferences" });
  const control = pair.page.controls.find(
    (control) => control.label === "Open preferences",
  )!;
  expect(
    perception.controls.find((reference) => reference.controlId === control.id),
  ).toMatchObject({
    regionId: menu.id,
    bounds: { x: 10, y: 10, width: 100, height: 30 },
  });
  expect(JSON.stringify(pair)).not.toMatch(
    /private editable sentinel|secret password sentinel|Closed application secret/,
  );
  expect(JSON.stringify(pair.page)).not.toMatch(
    /scanId|browserZoom|parentId|scrollHeight/,
  );
  expect(pair.page).not.toHaveProperty("viewport");
  expect(perception.viewport).not.toHaveProperty("browserZoom");
  expect(perception.omissions.hierarchyTruncated).toBe(false);
  expect(discovery.getPerception(pair.page)).toBe(pair.perception);
  expect(
    discovery.observeRegion(menu.id, perception.scanId, pair.page.revision),
  ).toBeUndefined();
});
it("keeps region refresh read-only and rejects old scans, detached regions and unavailable viewport evidence", () => {
  fixture(
    '<main aria-label="Workspace"><div role="menu" aria-label="Preferences"><button>Choose appearance</button></div></main>',
  );
  actualViewport();
  const discovery = new PageDiscovery(),
    stop = discovery.observe(() => {}),
    click = vi.fn();
  document.querySelector("button")!.addEventListener("click", click);
  try {
    const first = discovery.snapshotWithPerception(),
      second = discovery.snapshotWithPerception();
    expect(second.page.revision).toBe(first.page.revision);
    expect(second.perception!.scanId).not.toBe(first.perception!.scanId);
    expect(discovery.getPerception(first.page)).toBeUndefined();
    const menu = second.perception!.regions.find(
      (region) => region.role === "menu",
    )!;
    expect(
      discovery.observeRegion(
        menu.id,
        first.perception!.scanId,
        first.page.revision,
      ),
    ).toBeUndefined();
    expect(
      discovery.observeRegion(
        "unknown-region",
        second.perception!.scanId,
        second.page.revision,
      ),
    ).toBeUndefined();
    const fresh = discovery.observeRegion(
      menu.id,
      second.perception!.scanId,
      second.page.revision,
    )!;
    expect(fresh.perception!.scanId).not.toBe(second.perception!.scanId);
    expect(click).not.toHaveBeenCalled();
    document.querySelector('[role="menu"]')!.remove();
    expect(
      discovery.observeRegion(
        menu.id,
        fresh.perception!.scanId,
        fresh.page.revision,
      ),
    ).toBeUndefined();
    vi.stubGlobal("visualViewport", undefined);
    expect(discovery.snapshotWithPerception().perception).toBeUndefined();
    expect(discovery.snapshot().controls).toBeInstanceOf(Array);
  } finally {
    stop();
  }
});
it("reports bounded region omissions without dangling parents or inventing a clipped element as a scroller", () => {
  fixture(
    '<main aria-label="Workspace">' +
      Array.from(
        { length: 110 },
        (_, index) =>
          `<section aria-label="Group ${index}"><button>Item ${index}</button></section>`,
      ).join("") +
      '<div id="clip" style="overflow:hidden"><button>Clipped action</button></div></main>',
  );
  actualViewport();
  const clip = document.getElementById("clip")!;
  for (const [key, value] of Object.entries({
    clientWidth: 100,
    clientHeight: 30,
    scrollWidth: 100,
    scrollHeight: 300,
  }))
    Object.defineProperty(clip, key, { configurable: true, value });
  const perception = discoveryPerceptionSchema.parse(
    new PageDiscovery().snapshotWithPerception().perception,
  );
  expect(perception.regions).toHaveLength(100);
  expect(perception.omissions).toMatchObject({
    partial: true,
    regions: 11,
    controlRegions: 11,
  });
  expect(perception.omissions.reasons).toContain("budget");
  const ids = new Set(perception.regions.map((region) => region.id));
  expect(
    perception.regions.every(
      (region) => !region.parentId || ids.has(region.parentId),
    ),
  ).toBe(true);
  expect(perception.regions.some((region) => region.scroll)).toBe(false);
});
it("reports unknown ancestry beyond the DOM or region-depth budget without inventing a root", () => {
  actualViewport();
  for (const [tag, depth] of [
    ["div", 65],
    ["section", 17],
  ] as const) {
    fixture(
      `<main aria-label="Workspace">${`<${tag}>`.repeat(depth)}<button>Choose appearance</button>${`</${tag}>`.repeat(depth)}</main>`,
    );
    const pair = new PageDiscovery().snapshotWithPerception(),
      perception = discoveryPerceptionSchema.parse(pair.perception);
    expect(pair.page.controls).toHaveLength(1);
    expect(perception.omissions).toMatchObject({
      hierarchyTruncated: true,
      partial: true,
      controlRegions: 1,
    });
    expect(perception.omissions.reasons).toContain("unsupported");
    expect(perception.regions).toEqual([]);
    expect(perception.controls[0].regionId).toBeUndefined();
  }
});
it("ignores Tholi's own roots and unrelated text churn without missing website controls or receipts", async () => {
  vi.useFakeTimers();
  fixture(
    '<main><h1>Prime membership</h1><p id="receipt">Membership active</p><button aria-describedby="description">Manage membership</button><span id="description">Your benefits</span><span id="ticker">1</span></main>',
  );
  const notify = vi.fn(),
    index = new IncrementalControlIndex();
  index.start(notify);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    notify.mockClear();
    const widget = document.createElement("div");
    widget.dataset.tholiUi = "";
    const shadow = widget.attachShadow({ mode: "open" });
    shadow.innerHTML = "<button>Pause</button>";
    document.body.append(widget);
    for (let i = 0; i < 8; i++) {
      document.getElementById("ticker")!.textContent = String(i);
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(index.roots.has(shadow)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(
      new PageDiscovery()
        .snapshot()
        .controls.some((control) => control.label === "Pause"),
    ).toBe(false);
    document.getElementById("description")!.textContent =
      "Choose membership options";
    await vi.advanceTimersByTimeAsync(300);
    expect(notify).toHaveBeenCalledOnce();
    expect(
      [...index.dirty].some(
        (control) => control.textContent === "Manage membership",
      ),
    ).toBe(true);
    document.getElementById("receipt")!.textContent =
      "Your membership will end on your renewal date.";
    await vi.advanceTimersByTimeAsync(300);
    expect(notify).toHaveBeenCalledTimes(2);
    const button = document.createElement("button");
    button.textContent = "End membership";
    document.querySelector("main")!.append(button);
    await vi.advanceTimersByTimeAsync(300);
    expect(index.elements.has(button)).toBe(true);
    expect(notify.mock.calls.length).toBeGreaterThan(1);
  } finally {
    index.stop();
    vi.useRealTimers();
  }
});
it("preserves real headings and ARIA footer links under dense navigation", () => {
  fixture(
    `<main><h1>Catalogue</h1><nav>${Array.from({ length: 900 }, (_, i) => `<a href="/related/${i}">Related item ${i}</a>`).join("")}</nav><h2 id="references">References</h2></main><div role="contentinfo"><a href="/privacy">Privacy policy</a></div>`,
  );
  const page = new PageDiscovery().snapshot();
  expect(page.partial).toBe(true);
  expect(page.controls).toHaveLength(600);
  expect(
    page.controls.some((c) => c.role === "heading" && c.label === "References"),
  ).toBe(true);
  const policy = page.controls.find((c) => c.label === "Privacy policy")!;
  expect(policy).toMatchObject({
    visible: true,
    enabled: true,
    context: "Footer",
    scope: "page",
  });
  expect(policy.structure?.headings).toEqual([]);
  expect(policy.structure?.regions.some((r) => r.role === "contentinfo")).toBe(
    true,
  );
});
it("refuses broken or misleading fragment links instead of inventing sections", () => {
  for (const body of [
    "",
    '<span id="references"></span>',
    '<h2 id="references">Privacy policy</h2>',
  ]) {
    fixture(
      `<nav><a href="#references">References</a></nav>${body}<footer><a href="/privacy">Privacy policy</a></footer>`,
    );
    const page = new PageDiscovery().snapshot();
    expect(page.controls.find((c) => c.label === "References")?.enabled).toBe(
      false,
    );
    expect(planGoal(page, "Help me find references").status).toBe("unresolved");
  }
});
it.each(["auto", "scroll", "hidden", "clip"])(
  "respects %s clipping without discarding document scroll targets",
  (overflow) => {
    fixture(
      `<nav style="overflow:${overflow}"><a href="/item">Clipped item</a><h2>References</h2></nav><footer><a href="/privacy">Privacy policy</a></footer>`,
    );
    const link = document.querySelector("nav a") as HTMLElement;
    const heading = document.querySelector("h2") as HTMLElement;
    const rect = (top: number) => ({
      x: 10,
      y: top,
      top,
      left: 10,
      right: 110,
      bottom: top + 30,
      width: 100,
      height: 30,
      toJSON: () => ({}),
    });
    let top = 70;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return rect(this === link ? top : this === heading ? 30 : 10);
      },
    );
    expect(visible(link)).toBe(false);
    expect(
      new PageDiscovery()
        .snapshot()
        .controls.find((c) => c.label === "Clipped item")?.visible,
    ).toBe(false);
    top = 30;
    expect(clippedRect(link)).toMatchObject({
      top: 30,
      bottom: 40,
      height: 10,
    });
    expect(
      new PageDiscovery()
        .snapshot()
        .controls.find((c) => c.label === "References")?.sectionVisible,
    ).toBe(false);
    expect(visible(document.querySelector("footer a")!)).toBe(true);
  },
);
it.each([
  ["Change language", "37 languages", "Change language variant"],
  ["Show category", "Categories (12)", "Change category ordering"],
  ["Find address", "Addresses", "Address history"],
])(
  "chooses the primary live control for %s rather than a qualified hidden alternative",
  (goal, label, alternative) => {
    fixture(
      `<div><button aria-haspopup="menu" aria-expanded="false" aria-controls="choices">${label}</button><div id="choices" hidden><button>Other choice</button></div><div><button aria-controls="other" aria-expanded="false">More tools</button><div id="other" hidden><button>${alternative}</button></div></div><button hidden>${label}</button></div>`,
    );
    const page = new PageDiscovery().snapshot();
    const plan = planGoal(page, goal);
    expect(plan.status).toBe("guiding");
    expect(plan.steps.map((s) => s.label)).toEqual([label]);
  },
);
it("preserves explicit qualifiers and leaves genuinely ambiguous controls unresolved", () => {
  fixture(
    '<button aria-haspopup="true">Languages</button><div><button aria-controls="variants" aria-expanded="false">More tools</button><div id="variants" hidden><button>Change language variant</button></div></div>',
  );
  expect(
    planGoal(
      new PageDiscovery().snapshot(),
      "Change language variant",
    ).steps.map((s) => s.label),
  ).toEqual(["More tools", "Change language variant"]);
  fixture(
    '<nav aria-label="Account"><button>Languages</button></nav><nav aria-label="Document"><button>Languages</button></nav>',
  );
  const page = new PageDiscovery().snapshot();
  expect(planGoal(page, "Change language").status).toBe("unresolved");
  const plan = planGoal(page, "Change account language");
  expect(
    page.controls.find((c) => c.id === plan.steps[0]?.controlId)?.context,
  ).toBe("Account");
});
it("does not invent reveal routes across sibling menus or native details boundaries", () => {
  fixture(
    '<div><button aria-haspopup="menu" aria-controls="choices">Languages (7)</button><div id="choices" hidden><a href="/translated">French</a></div><details><summary>More controls</summary><button>Change language variant</button></details><button hidden>Languages (7)</button></div>',
  );
  const page = new PageDiscovery().snapshot();
  expect(
    page.controls.find((c) => c.label === "Languages (7)" && !c.visible)
      ?.revealIds,
  ).toEqual([]);
  expect(
    planGoal(page, "Show me how to change language").steps.map((s) => s.label),
  ).toEqual(["Languages (7)"]);
  expect(
    planGoal(page, "Change language variant").steps.map((s) => s.label),
  ).toEqual(["More controls", "Change language variant"]);
});
it("keeps identical buttons ambiguous while coalescing links to the same section", () => {
  fixture("<section><button>Help</button><button>Help</button></section>");
  expect(planGoal(new PageDiscovery().snapshot(), "Help").status).toBe(
    "unresolved",
  );
  fixture(
    '<nav><a href="#references">References</a><a href="#references">References</a></nav><h2 id="references">References</h2>',
  );
  expect(
    planGoal(new PageDiscovery().snapshot(), "Find references").status,
  ).toBe("completed");
});
it("grounds a collapsed search field in its local search landmark without site selectors", () => {
  fixture(
    '<div role="search"><a href="/search">Search</a><form><input type="search" aria-label="Search catalogue" hidden><button hidden>Search</button></form></div><input type="search" aria-label="Search catalogue" hidden>',
  );
  const page = new PageDiscovery().snapshot();
  const plan = planGoal(page, "Show search");
  expect(plan.steps.map((s) => s.label)).toEqual([
    "Search",
    "Search catalogue",
  ]);
  expect(
    page.controls
      .filter((c) => c.kind === "focus")
      .map((c) => c.revealIds.length),
  ).toEqual([1, 0]);
});
it("does not select the opposite preference when the requested value is unavailable", () => {
  fixture(
    '<fieldset><legend>Text</legend><input type="radio" id="small"><label for="small">Small</label><input type="radio" id="large" disabled><label for="large">Large</label></fieldset>',
  );
  expect(
    planGoal(new PageDiscovery().snapshot(), "Make text larger").status,
  ).toBe("unresolved");
  document.getElementById("large")!.removeAttribute("disabled");
  const page = new PageDiscovery().snapshot();
  expect(planGoal(page, "Make text smaller").steps[0].label).toBe(
    "Text: Small",
  );
  expect(planGoal(page, "Make text larger").steps[0].label).toBe("Text: Large");
});
it("coalesces duplicate destinations while keeping different query destinations distinct", () => {
  fixture(
    '<nav aria-label="Suggested"><a href="/translated?locale=fr">French</a></nav><nav aria-label="All choices"><a href="/translated?locale=fr">French</a></nav>',
  );
  const discovery = new PageDiscovery();
  const before = discovery.snapshot();
  expect(planGoal(before, "French").status).toBe("guiding");
  expect(planGoal(before, "French").steps).toHaveLength(1);
  const stored = mergeObservation(undefined, before);
  expect(stored.pages[0].controls.every((c) => !("navigationKey" in c))).toBe(
    true,
  );
  expect(JSON.stringify(stored)).not.toContain("locale=fr");
  document
    .querySelectorAll("a")[1]
    .setAttribute("href", "/translated?locale=en");
  const after = discovery.snapshot();
  expect(planGoal(after, "French").status).toBe("unresolved");
  expect(after.revision).toBeGreaterThan(before.revision);
});
it("preserves help as a real control and qualifier while accepting polite goal phrasing", () => {
  fixture(
    "<button>Help</button><button>Languages</button><button>Language help</button>",
  );
  const page = new PageDiscovery().snapshot();
  expect(planGoal(page, "Help").steps[0].label).toBe("Help");
  expect(planGoal(page, "Help me change language").steps[0].label).toBe(
    "Languages",
  );
  expect(planGoal(page, "Language help").steps[0].label).toBe("Language help");
});
it("uses authored accessibility descriptions for icon controls and preserves field privacy", () => {
  fixture(
    '<button aria-haspopup="listbox" aria-label="🌐" aria-describedby="purpose" aria-description="Unrelated fallback" title="Unrelated tooltip"></button><p id="purpose" hidden>Choose the document language</p><input id="private-field" value="SENTINEL_FIELD"><button aria-label="Help" aria-describedby="private-field"></button><select id="private-select"><option>SENTINEL_SELECTION</option></select><button aria-label="More help" aria-describedby="private-select"></button>',
  );
  const field = document.getElementById("private-field") as HTMLInputElement;
  vi.spyOn(field, "value", "get").mockImplementation(() => {
    throw new Error("Field value was read");
  });
  const page = new PageDiscovery().snapshot();
  const plan = planGoal(page, "How do I change the document language?");
  const chosen = page.controls.find((c) => c.id === plan.steps[0]?.controlId);
  expect(chosen?.label).toBe("🌐");
  expect(chosen?.description).toBe("Choose the document language");
  expect(chosen?.kind).toBe("expand");
  expect(chosen?.popup).toBe("listbox");
  expect(JSON.stringify(page)).not.toContain("SENTINEL");
});
it("rescans description changes and resolves popup relationships within their own shadow root", () => {
  fixture('<div id="component"></div>');
  const root = document
    .getElementById("component")!
    .attachShadow({ mode: "open" });
  root.innerHTML =
    '<a href="#" role="button" aria-haspopup="menu" aria-expanded="false" aria-controls="items" aria-describedby="purpose">🌐</a><span id="purpose">Change language</span><div id="items" hidden><button>Language variant</button></div>';
  const discovery = new PageDiscovery();
  const before = discovery.snapshot();
  const opener = before.controls.find((c) => c.label === "🌐")!;
  expect(opener.kind).toBe("expand");
  expect(
    before.controls.find((c) => c.label === "Language variant")?.revealIds,
  ).toEqual([opener.id]);
  root.getElementById("purpose")!.textContent = "Change currency";
  const after = discovery.snapshot();
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.controls.find((c) => c.id === opener.id)?.signature).not.toBe(
    opener.signature,
  );
  expect(planGoal(after, "Change currency").steps[0].label).toBe("🌐");
  const stored = mergeObservation(mergeObservation(undefined, before), after);
  expect(
    stored.pages[0].controls.find((c) => c.signature === opener.signature)
      ?.active,
  ).toBe(false);
});
it("checks model suggestions against a stronger grounded control match", () => {
  fixture(
    '<input type="checkbox" role="button" aria-haspopup="true" id="primary" aria-label="Languages"><label for="primary">Languages</label><div><button aria-controls="other" aria-expanded="false">More tools</button><div id="other" hidden><button>Change language variant</button></div></div>',
  );
  const page = new PageDiscovery().snapshot();
  const primary = page.controls.find((c) => c.label === "Languages")!;
  expect(primary.kind).toBe("expand");
  expect(primary.expanded).toBe(false);
  const misleading = planGoal(page, "Change language", undefined, {
    controlIds: [
      page.controls.find((c) => c.label === "More tools")!.id,
      page.controls.find((c) => c.label === "Change language variant")!.id,
    ],
    confidence: 0.99,
  });
  expect(misleading.source).toBe("semantics");
  expect(misleading.steps.map((s) => s.controlId)).toEqual([primary.id]);
  const indirect = planGoal(page, "Change language", undefined, {
    controlIds: [
      page.controls.find((c) => c.label === "More tools")!.id,
      primary.id,
    ],
    confidence: 0.99,
  });
  expect(indirect.steps.map((s) => s.controlId)).toEqual([primary.id]);
  expect(
    planGoal(page, "Change language", undefined, {
      controlIds: [primary.id],
      confidence: 0.9,
    }).source,
  ).toBe("on-device");
});
it("recognizes a detached, focused popup by its live purpose without trusting an unchanged checkbox", () => {
  fixture(
    '<input type="checkbox" role="button" aria-haspopup="true" id="opener" aria-label="Languages (8)"><label for="opener">Languages (8)</label>',
  );
  const discovery = new PageDiscovery();
  const before = discovery.snapshot();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Languages");
  dialog.innerHTML =
    '<input type="search" aria-label="Search languages"><a href="/translated">French</a>';
  document.body.append(dialog);
  dialog.querySelector("input")!.focus();
  const after = discovery.snapshot();
  expect(after.controls[0].checked).toBe(false);
  expect(after.controls[0].expanded).toBe(true);
  expect(after.controls[0].signature).toBe(before.controls[0].signature);
  expect(planGoal(after, "Change language").status).toBe("awaiting-choice");
});
it("does not associate an unrelated new dialog with the selected popup control", () => {
  fixture(
    '<button aria-haspopup="dialog" aria-expanded="false">Languages</button><div role="dialog" aria-label="Notifications"><input type="search" aria-label="Search notifications"></div>',
  );
  document.querySelector("input")!.focus();
  const page = new PageDiscovery().snapshot();
  expect(page.controls.find((c) => c.label === "Languages")?.expanded).toBe(
    false,
  );
  expect(planGoal(page, "Change language").status).toBe("guiding");
});
it("applies consequential-action checks to accessibility descriptions", () => {
  fixture(
    '<button aria-label="Continue" aria-description="Delete account"></button>',
  );
  const page = new PageDiscovery().snapshot();
  expect(page.controls[0].risk).toBe("consequential");
  expect(planGoal(page, "Delete account").status).toBe("unresolved");
  expect(planGoal(page, "Delete account").issue).toBe("consequential");
});
it.each([
  ['<a href="/document?action=edit">Edit</a>', "ordinary", undefined],
  [
    '<a href="/editor" title="Edit this document">Edit</a>',
    "ordinary",
    undefined,
  ],
  [
    '<button type="button" aria-haspopup="dialog" aria-controls="editor">Edit</button><div id="editor" hidden></div>',
    "ordinary",
    undefined,
  ],
  [
    '<button type="button">Edit</button>',
    "consequential",
    "unknown-edit-effect",
  ],
  [
    '<button type="button" aria-description="Edit and immediately save changes">Edit</button>',
    "consequential",
    "commit",
  ],
  [
    '<a href="/document?action=publish">Continue</a>',
    "consequential",
    "commit",
  ],
  ['<a href="/delete/record">Continue</a>', "consequential", "commit"],
  [
    '<a href="/document?action=edit">Publish changes</a>',
    "consequential",
    "commit",
  ],
  [
    '<form method="post" action="/edit"><button>Continue</button></form>',
    "consequential",
    "form-submit",
  ],
  [
    '<form id="editor" method="post" action="/edit"></form><button form="editor">Continue</button>',
    "consequential",
    "form-submit",
  ],
  [
    '<form method="post" action="/edit"><button type="button" aria-haspopup="dialog">Edit</button></form>',
    "ordinary",
    undefined,
  ],
  [
    '<form method="post" action="/edit"><button formmethod="get">Preview</button></form>',
    "ordinary",
    undefined,
  ],
  [
    '<form method="get" action="/publish"><button>Continue</button></form>',
    "consequential",
    "commit",
  ],
  [
    '<form method="get" action="/preview"><button formaction="/submit">Continue</button></form>',
    "consequential",
    "commit",
  ],
  [
    '<form method="get" action="/publish"><button type="button" aria-haspopup="dialog">Preview</button></form>',
    "ordinary",
    undefined,
  ],
])(
  "classifies the individual interaction from declared structure: %s",
  (html, risk, riskReason) => {
    fixture(html);
    const control = new PageDiscovery().snapshot().controls[0];
    expect(control.risk).toBe(risk);
    expect(control.riskReason).toBe(riskReason);
  },
);
it("keeps editor fields and section navigation usable despite committing siblings or form endpoints", () => {
  fixture(
    '<form method="post" action="/edit"><h2>Publish document</h2><input aria-label="Draft title"><button type="submit">Publish changes</button></form><nav aria-label="Delete history"><a href="#help">Help</a></nav><h2 id="help">Delete history</h2>',
  );
  const page = new PageDiscovery().snapshot();
  expect(page.controls.find((c) => c.label === "Draft title")?.risk).toBe(
    "ordinary",
  );
  expect(page.controls.find((c) => c.label === "Help")?.risk).toBe("ordinary");
  expect(page.controls.find((c) => c.label === "Delete history")?.risk).toBe(
    "ordinary",
  );
  expect(page.controls.find((c) => c.label === "Publish changes")?.risk).toBe(
    "consequential",
  );
  expect(planGoal(page, "Draft title").status).toBe("guiding");
});
it("uses page scope for an unqualified edit goal and heading context for a specified section", () => {
  fixture(
    '<nav><a href="/editor">Edit</a></nav><main><div><h2>Plot</h2><span><a href="/editor?section=1">edit</a></span></div><div><h2>Background</h2><span><a href="/editor?section=2">edit</a></span></div></main>',
  );
  const page = new PageDiscovery().snapshot();
  const primary = page.controls.find((c) => c.label === "Edit")!;
  const plot = page.controls.find(
    (c) => c.label === "edit" && c.context === "Plot",
  )!;
  expect(primary.scope).toBe("page");
  expect(plot.scope).toBe("section");
  for (const goal of ["Edit", "How do I edit this page?"])
    expect(planGoal(page, goal).steps.map((s) => s.controlId)).toEqual([
      primary.id,
    ]);
  expect(
    planGoal(page, "Edit section Plot").steps.map((s) => s.controlId),
  ).toEqual([plot.id]);
  const proposal = { controlIds: [primary.id], confidence: 0.9 };
  expect(planGoal(page, "Edit", undefined, proposal).source).toBe("on-device");
});
it("reports an opaque edit effect honestly and rescans when a form changes to POST", () => {
  fixture("<form><button>Edit</button></form>");
  const discovery = new PageDiscovery();
  const before = discovery.snapshot();
  expect(planGoal(before, "Edit").issue).toBe("unknown-effect");
  document.querySelector("form")!.method = "post";
  const after = discovery.snapshot();
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.controls[0].riskReason).toBe("form-submit");
  expect(planGoal(after, "Edit").issue).toBe("consequential");
});
it("discovers semantic fields, labels, menus, preferences, and open shadow roots without site selectors", () => {
  fixture(
    '<h1>Unseen website</h1><button aria-controls="prefs" aria-expanded="false">Appearance</button><fieldset id="prefs" hidden><legend>Color</legend><input type="radio" id="d"><label for="d">Dark</label></fieldset><input type="search" aria-label="Find articles"><div id="component"></div>',
  );
  document
    .getElementById("component")!
    .attachShadow({ mode: "open" }).innerHTML = "<button>Help</button>";
  const page = new PageDiscovery().snapshot();
  expect(page.controls.find((c) => c.label === "Color: Dark")?.visible).toBe(
    false,
  );
  expect(
    page.controls.find((c) => c.label === "Color: Dark")?.revealIds,
  ).toEqual([page.controls.find((c) => c.label === "Appearance")!.id]);
  expect(page.controls.find((c) => c.label === "Find articles")?.kind).toBe(
    "focus",
  );
  expect(page.controls.some((c) => c.label === "Help")).toBe(true);
  expect(
    planGoal(page, "switch to dark mode").steps.map((s) => s.label),
  ).toEqual(["Appearance", "Color: Dark"]);
});
it("never reads field values, select values or editable text during discovery", () => {
  fixture(
    '<label for="s">Search</label><input id="s" type="search"><input type="password" value="SENTINEL_PASSWORD"><textarea aria-label="Comment">SENTINEL_COMMENT</textarea><select aria-label="Language"><option value="SENTINEL_OPTION">English</option></select><div contenteditable><button>SENTINEL_EDITABLE</button></div>',
  );
  const field = document.querySelector<HTMLInputElement>("#s")!;
  vi.spyOn(field, "value", "get").mockImplementation(() => {
    throw new Error("Field value was read");
  });
  const page = new PageDiscovery().snapshot();
  expect(JSON.stringify(page)).not.toContain("SENTINEL");
  expect(page.controls.map((c) => c.label)).toEqual([
    "Search",
    "Comment",
    "Language",
  ]);
});
it("preserves signatures across ID/class replacement but invalidates document control IDs and revision", () => {
  fixture('<button id="random-one" class="old">Help</button>');
  const discovery = new PageDiscovery(),
    before = discovery.snapshot();
  document.body.innerHTML =
    '<button id="entirely-new" class="changed">Help</button>';
  const after = discovery.snapshot();
  expect(after.controls[0].signature).toBe(before.controls[0].signature);
  expect(after.controls[0].id).not.toBe(before.controls[0].id);
  expect(after.revision).toBeGreaterThan(before.revision);
});
it("rejects ambiguity, unsafe actions and invented model IDs", () => {
  fixture(
    '<nav aria-label="Account"><button>Settings</button></nav><nav aria-label="Display"><button>Settings</button></nav><button>Delete account</button>',
  );
  const page = new PageDiscovery().snapshot();
  expect(planGoal(page, "Settings").status).toBe("unresolved");
  expect(planGoal(page, "Delete account").status).toBe("unresolved");
  expect(
    planGoal(page, "Settings", undefined, {
      controlIds: ["w0000000000000000-999"],
      confidence: 1,
    }).status,
  ).toBe("unresolved");
  expect(
    modelProposalSchema.safeParse({ controlIds: ["#button"], confidence: 1 })
      .success,
  ).toBe(false);
});
it("does not confuse a visible section link with an arrived destination", () => {
  fixture(
    '<nav><button aria-expanded="false">Toggle References subsection</button><a href="#sources">References</a></nav><h2 id="sources">References</h2>',
  );
  vi.spyOn(
    document.getElementById("sources")!,
    "getBoundingClientRect",
  ).mockReturnValue({
    x: 0,
    y: 2000,
    top: 2000,
    bottom: 2030,
    left: 0,
    right: 100,
    width: 100,
    height: 30,
    toJSON: () => ({}),
  });
  const page = new PageDiscovery().snapshot();
  expect(planGoal(page, "find references").status).toBe("guiding");
  expect(planGoal(page, "find references").steps[0].label).toBe("References");
});
it("updates memory versions, separates inferred and observed edges, and invalidates removed controls", () => {
  fixture('<button>Help</button><a href="/next?token=SENTINEL_QUERY">Next</a>');
  const discovery = new PageDiscovery(),
    before = discovery.snapshot();
  const first = mergeObservation(undefined, before, undefined, 1000);
  expect(first.transitions[0].evidence).toBe("inferred");
  expect(JSON.stringify(first)).not.toContain("SENTINEL_QUERY");
  expect(JSON.stringify(first)).not.toContain(before.controls[0].id);
  const same = mergeObservation(first, before, undefined, 2000);
  expect(same.version).toBe(first.version);
  document.body.innerHTML = "<button>About</button>";
  const after = discovery.snapshot();
  const changed = mergeObservation(
    first,
    after,
    {
      from: before.stateKey,
      to: after.stateKey,
      signature: before.controls[0].signature,
      label: "Help",
    },
    3000,
  );
  expect(changed.pages[0].version).toBe(2);
  expect(
    changed.pages[0].controls.find((c) => c.label === "Help")?.active,
  ).toBe(false);
  expect(changed.transitions.some((t) => t.evidence === "observed")).toBe(true);
  expect(first.pages[0].version).toBe(1);
});
it("does not retire unseen controls after a partial scan and bounds retained pages", () => {
  fixture("<button>Help</button>");
  const page = new PageDiscovery().snapshot();
  const first = mergeObservation(undefined, page, undefined, 1000);
  const partial = mergeObservation(
    first,
    { ...page, controls: [], partial: true },
    undefined,
    2000,
  );
  expect(partial.pages[0].controls[0].active).toBe(true);
  let site = first;
  for (let i = 0; i < 110; i++)
    site = mergeObservation(
      site,
      { ...page, pageKey: hash(String(i)) },
      undefined,
      3000 + i,
    );
  expect(site.pages).toHaveLength(100);
});
it("plans across learned transitions while refusing inferred edges as verified routes", () => {
  fixture('<a href="/settings">Settings</a>');
  const start = new PageDiscovery().snapshot();
  const destination: PageSnapshot = {
    ...start,
    pageKey: "destination",
    stateKey: "destination:open",
    controls: [
      {
        ...start.controls[0],
        label: "Language",
        kind: "select",
        signature: "lang",
      },
    ],
  };
  let site = mergeObservation(undefined, start);
  site = mergeObservation(site, destination, {
    from: start.stateKey,
    to: destination.stateKey,
    signature: start.controls[0].signature,
    label: "Settings",
  });
  expect(planGoal(start, "Language", site).source).toBe("memory");
  site.transitions = site.transitions.map((t) => ({
    ...t,
    evidence: "inferred",
  }));
  expect(planGoal(start, "Language", site).status).toBe("unresolved");
});
it("pins generic sessions to their origin and rejects forged page and control lists", () => {
  fixture("<button>Help</button>");
  const page = new PageDiscovery().snapshot();
  const pin = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    tabId: 1,
    routeId: LIVE_ROUTE_ID,
    routeVersion: LIVE_VERSION,
    origin: page.origin,
  };
  const view = {
    ...pin,
    status: "running",
    stateId: "choosing",
    instruction: "Choose",
    verifiedSteps: 0,
    confidence: 1,
    history: ["choosing"],
    page,
    controls: page.controls,
  };
  const { sessionId, tabId, origin, ...clean } = view;
  expect(validPinnedView(pin, clean)).toBeDefined();
  expect(restoreSession({ ...pin, view: clean })).toBeDefined();
  expect(
    validPinnedView({ ...pin, origin: "https://another.example" }, clean),
  ).toBeUndefined();
  expect(
    validPinnedView(pin, {
      ...clean,
      controls: [page.controls[0], page.controls[0]],
    }),
  ).toBeUndefined();
});
