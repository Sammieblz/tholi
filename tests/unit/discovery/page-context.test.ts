// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { PageDiscovery } from "../../../packages/page-discovery/index";
import { planGoal, inspectGoal } from "../../../packages/goal-planner/index";
import {
  buildModelProjection,
  controlDependencies,
  modelContext,
  unambiguousControls,
} from "../../../packages/goal-planner/model-context";
import { mergeObservation } from "../../../packages/site-memory/index";
import { pageSnapshotSchema } from "../../../packages/page-model/index";
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
afterEach(() => vi.restoreAllMocks());
it("distinguishes an exact requested section from a section with extra context qualifiers", () => {
  fixture(
    '<main><div><h2>Plot</h2><a title="Edit section: Plot" href="/edit/plot">edit</a></div><div><h2>Plot inspirations</h2><a title="Edit section: Plot inspirations" href="/edit/inspirations">edit</a></div></main>',
  );
  const page = new PageDiscovery().snapshot();
  const plan = planGoal(page, "Edit Plot");
  expect(plan.status).toBe("guiding");
  expect(
    page.controls.find((c) => c.id === plan.steps[0].controlId)?.destination
      ?.path,
  ).toBe("/edit/plot");
  expect(
    page.controls.find(
      (c) =>
        c.id === planGoal(page, "Edit Plot inspirations").steps[0].controlId,
    )?.destination?.path,
  ).toBe("/edit/inspirations");
});
it("collects hierarchical headings and named regions without borrowing an unrelated footer's purpose", () => {
  fixture(
    '<main aria-label="Research"><h1>Paper</h1><section><h2>Methods</h2><section><h3>Participants</h3><nav aria-label="Section actions"><a href="/edit/participants">Edit</a></nav></section></section></main><footer><button>Edit</button></footer>',
  );
  const page = pageSnapshotSchema.parse(new PageDiscovery().snapshot());
  const edit = page.controls.find((c) => c.kind === "navigation")!;
  expect(edit.structure).toEqual({
    regions: [
      { role: "main", name: "Research" },
      { role: "navigation", name: "Section actions" },
    ],
    headings: [
      { level: 1, label: "Paper" },
      { level: 2, label: "Methods" },
      { level: 3, label: "Participants" },
    ],
  });
  expect(edit.scope).toBe("section");
  const plan = planGoal(page, "Edit Methods Participants");
  expect(plan.steps.at(-1)?.controlId).toBe(edit.id);
  expect(
    page.controls.find((c) => c.kind === "action")!.structure?.headings,
  ).toEqual([]);
});
it("context changes invalidate current control signatures and update local memory without saving placement", () => {
  fixture(
    '<main><h1>Research</h1><h2 id="topic">Methods</h2><a href="/edit">Edit</a></main>',
  );
  const discovery = new PageDiscovery(),
    before = discovery.snapshot();
  const old = before.controls.find((c) => c.label === "Edit")!;
  document.getElementById("topic")!.textContent = "Findings";
  const after = discovery.snapshot(),
    current = after.controls.find((c) => c.label === "Edit")!;
  expect(current.signature).not.toBe(old.signature);
  expect(after.revision).toBeGreaterThan(before.revision);
  const saved = mergeObservation(mergeObservation(undefined, before), after);
  expect(
    saved.pages[0].controls.find((c) => c.signature === old.signature)?.active,
  ).toBe(false);
  expect(
    saved.pages[0].controls
      .find((c) => c.signature === current.signature)
      ?.structure?.headings.at(-1)?.label,
  ).toBe("Findings");
  expect(JSON.stringify(saved)).not.toContain('"placement"');
});
it("retrieves a late control and its opener under a bounded context rather than taking the first controls", () => {
  fixture(
    `${Array.from({ length: 260 }, (_, i) => `<button>Command ${i}</button>`).join("")}<div><button aria-controls="languages" aria-expanded="false">Translations</button><div id="languages" hidden><a href="/fr?private=SENTINEL_QUERY">French language</a></div></div><button>Delete account</button>`,
  );
  const page = new PageDiscovery().snapshot(),
    input = modelContext(page, "French language");
  expect(input.controls.length).toBeLessThanOrEqual(96);
  expect(
    new TextEncoder().encode(JSON.stringify(input)).length,
  ).toBeLessThanOrEqual(24000);
  const target = input.controls.find((c) => c.label === "French language")!;
  expect(target).toBeTruthy();
  expect(target.revealIds).toHaveLength(1);
  expect(input.controls.find((c) => c.id === target.revealIds[0])?.label).toBe(
    "Translations",
  );
  expect(target.destination).toEqual({ sameOrigin: true, path: "/fr" });
  expect(input.page.omittedControls).toBeGreaterThan(0);
  expect(JSON.stringify(input)).not.toContain("SENTINEL_QUERY");
});
it("admits complete transitive opener bundles inside the whole UTF-8 context budget", () => {
  fixture(
    `${Array.from({ length: 180 }, (_, index) => `<button>${"選択項目".repeat(25)} ${index}</button>`).join("")}<button>Open tools</button><button>Open preferences</button><button>French language</button>`,
  );
  const page = new PageDiscovery().snapshot();
  const outer = page.controls.find(
    (control) => control.label === "Open tools",
  )!;
  const middle = page.controls.find(
    (control) => control.label === "Open preferences",
  )!;
  const target = page.controls.find(
    (control) => control.label === "French language",
  )!;
  middle.revealIds = [outer.id];
  target.revealIds = [middle.id];
  const { context, report } = buildModelProjection(page, "French language");
  const retained = new Set(context.controls.map((control) => control.id));
  expect(retained.has(target.id)).toBe(true);
  expect(retained.has(middle.id)).toBe(true);
  expect(retained.has(outer.id)).toBe(true);
  expect(
    context.controls.every((control) =>
      control.revealIds.every((id) => retained.has(id)),
    ),
  ).toBe(true);
  const bytes = new TextEncoder().encode(JSON.stringify(context)).length;
  expect(bytes).toBeLessThanOrEqual(24000);
  expect(report.projectionBytes).toBe(bytes);
  expect(report.counts.modelOmittedControls).toBe(
    page.controls.length - context.controls.length,
  );
  expect(report.reasons).toContain("budget");
  expect(JSON.stringify(context)).not.toContain('"projectionBytes"');
});
it("omits every ambiguous ID group and transitive dependent instead of choosing a frame", () => {
  fixture(
    "<button>Open</button><button>Preferences</button><button>Language</button><button>Help</button>",
  );
  const [opener, middle, target, safe] = new PageDiscovery().snapshot()
    .controls;
  middle.revealIds = [opener.id];
  target.revealIds = [middle.id];
  const duplicate = {
    ...opener,
    reference: {
      tabId: 3,
      frameId: 9,
      documentId: "different-native-document",
      controlId: opener.id,
    },
  };
  const result = unambiguousControls([opener, duplicate, middle, target, safe]);
  expect(result.controls.map((control) => control.id)).toEqual([safe.id]);
  expect(result.ambiguousControls).toBe(2);
  expect(result.dependentControls).toBe(2);
  expect(opener.id).toBe(duplicate.id);
});
it("rejects cyclic, missing and cross-frame opener closure without rewriting references", () => {
  fixture(
    "<button>Open</button><button>Preferences</button><button>Help</button>",
  );
  const [opener, target, safe] = new PageDiscovery().snapshot().controls;
  const byId = new Map(
    [opener, target, safe].map((control) => [control.id, control]),
  );
  target.revealIds = [opener.id];
  opener.revealIds = [target.id];
  expect(controlDependencies(target, byId)).toBeUndefined();
  opener.revealIds = [];
  target.revealIds = ["w0000000000000000-999"];
  expect(controlDependencies(target, byId)).toBeUndefined();
  target.revealIds = [opener.id];
  target.reference = {
    tabId: 4,
    frameId: 7,
    documentId: "native-child",
    controlId: target.id,
  };
  expect(controlDependencies(target, byId)).toBeUndefined();
  expect(controlDependencies(safe, byId)).toEqual([safe]);
});
it.each([{ ids: [] }, { ids: ["w0000000000000000-999"] }])(
  "falls back to a clear semantic route after invalid model IDs %j",
  ({ ids }) => {
    fixture('<a href="/edit">Edit</a>');
    const page = new PageDiscovery().snapshot();
    expect(
      planGoal(page, "Edit", undefined, {
        controlIds: ids,
        confidence: 0.9,
      }).steps.at(-1)?.label,
    ).toBe("Edit");
  },
);
it("grounds a paraphrased intent in declared navigation and carries it to a fresh matching control", () => {
  fixture('<nav aria-label="Article"><a href="/edit">Edit</a></nav>');
  const first = new PageDiscovery().snapshot(),
    id = first.controls[0].id;
  const intent = {
    target: "Edit",
    context: "",
    scope: "page" as const,
    operation: "navigate" as const,
  };
  const plan = planGoal(first, "Modify this article", undefined, {
    controlIds: [id],
    confidence: 0.9,
    intent,
  });
  expect(plan).toMatchObject({
    source: "on-device",
    status: "guiding",
    interpretation: intent,
  });
  const fresh = new PageDiscovery().snapshot();
  expect(fresh.controls[0].id).not.toBe(id);
  const replan = inspectGoal(
    fresh,
    plan.goal,
    undefined,
    undefined,
    plan.interpretation,
  ).plan;
  expect(replan.steps[0].controlId).toBe(fresh.controls[0].id);
});
it("retains a page-level opener for a section-scoped interpreted target", () => {
  fixture(
    '<nav><button aria-controls="section-menu" aria-expanded="false">Article tools</button></nav><section><h2>Methods</h2><div id="section-menu" hidden><a href="/methods/help">Help</a></div></section>',
  );
  const page = new PageDiscovery().snapshot(),
    target = page.controls.find((c) => c.label === "Help")!,
    opener = page.controls.find((c) => c.label === "Article tools")!;
  expect(target.scope).toBe("section");
  expect(opener.scope).toBe("page");
  const plan = planGoal(page, "Assistance Methods", undefined, {
    controlIds: [opener.id, target.id],
    confidence: 0.9,
    intent: {
      target: "Help",
      context: "Methods",
      scope: "section",
      operation: "navigate",
    },
  });
  expect(plan).toMatchObject({ status: "guiding", source: "on-device" });
  expect(plan.steps.map((s) => s.controlId)).toEqual([opener.id, target.id]);
});
it("rejects invented section context and an interpretation that drops a clear user qualifier", () => {
  fixture(
    '<nav><a href="/edit">Edit</a></nav><section><h2>Plot</h2><a href="/plot/edit">Edit</a></section>',
  );
  const page = new PageDiscovery().snapshot(),
    primary = page.controls.find((c) => c.scope === "page")!;
  const section = page.controls.find(
    (c) => c.label === "Edit" && c.scope === "section",
  )!;
  const plan = planGoal(page, "Edit Plot", undefined, {
    controlIds: [primary.id],
    confidence: 0.99,
    intent: {
      target: "Edit",
      context: "",
      scope: "page",
      operation: "navigate",
    },
  });
  expect(plan.steps.at(-1)?.controlId).toBe(section.id);
  const invented = planGoal(page, "Modify article", undefined, {
    controlIds: [section.id],
    confidence: 0.99,
    intent: {
      target: "Edit",
      context: "Plot",
      scope: "section",
      operation: "navigate",
    },
  });
  expect(invented.status).toBe("unresolved");
});
it("does not let AI bypass a committing boundary, resolve a tied purpose arbitrarily, or invent an effect", () => {
  fixture(
    '<button>Publish changes</button><a href="/preview">Preview</a><button>Help</button><button>Help</button>',
  );
  const page = new PageDiscovery().snapshot(),
    preview = page.controls.find((c) => c.label === "Preview")!;
  expect(
    planGoal(page, "Publish changes", undefined, {
      controlIds: [preview.id],
      confidence: 1,
      intent: {
        target: "Preview",
        context: "",
        scope: "any",
        operation: "navigate",
      },
    }).issue,
  ).toBe("consequential");
  const help = page.controls.find((c) => c.label === "Help")!;
  expect(
    planGoal(page, "Get assistance", undefined, {
      controlIds: [help.id],
      confidence: 1,
      intent: {
        target: "Help",
        context: "",
        scope: "any",
        operation: "locate",
      },
    }).status,
  ).toBe("unresolved");
  expect(
    planGoal(page, "Get assistance", undefined, {
      controlIds: [help.id],
      confidence: 1,
      intent: {
        target: "Help",
        context: "",
        scope: "any",
        operation: "navigate",
      },
    }).status,
  ).toBe("unresolved");
});
