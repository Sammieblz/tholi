import { afterEach, expect, it, vi } from "vitest";
import { PageCoach } from "../apps/extension/src/page-coach";
import { PageDiscovery } from "../packages/page-discovery";
import { interpretRequest } from "../packages/nlp/interpret";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it.each([
  "matching",
  "no interaction",
  "unrelated dialog",
  "collapsed",
  "occluded",
  "consequential",
  "other task",
  "desired value",
  "other frame",
])("pending detached picker: %s", async (scenario) => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  const rect = {
    x: 20,
    y: 20,
    top: 20,
    bottom: 50,
    left: 20,
    right: 220,
    width: 200,
    height: 30,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    rect,
  ] as any);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect,
  );
  document.body.innerHTML =
    '<button aria-haspopup="dialog" aria-expanded="false">Languages</button>';
  const original = PageDiscovery.prototype.snapshot;
  vi.spyOn(PageDiscovery.prototype, "snapshot").mockImplementation(function (
    this: PageDiscovery,
  ) {
    const page = original.call(this);
    if (document.getElementById("picker")) {
      page.partial = true;
      // Model a bounded projection omitting the obscured opener, while its
      // actual DOM node remains connected and its checkbox remains unchanged.
      for (const control of page.controls) {
        if (control.label === "Languages") this.bindings.delete(control.id);
        if (control.role === "combobox") {
          if (scenario === "occluded") control.occluded = true;
          if (scenario === "consequential") control.risk = "consequential";
          if (scenario === "other frame")
            control.reference = { frameId: 2 } as any;
        }
      }
      page.controls = page.controls.filter(
        (control) => control.label !== "Languages",
      );
    }
    return page;
  });
  const coach = new PageCoach(vi.fn());
  coach.start();
  const reply = coach.goal("Change language", coach.view.page!.revision);
  expect(reply).not.toHaveProperty("error");
  expect(coach.view.goalPlan?.status).toBe("guiding");
  const request = interpretRequest("Change language");
  coach.view.request = request;
  coach.view.journey!.requestTaskId =
    scenario === "other task" ? "old-task" : request.tasks[0].id;
  if (scenario === "desired value") request.tasks[0].desiredValue = "French";
  try {
    if (scenario !== "no interaction")
      document
        .querySelector("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const dialog = document.createElement("div");
    dialog.id = "picker";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute(
      "aria-label",
      scenario === "unrelated dialog" ? "Notifications" : "Languages",
    );
    dialog.innerHTML = `<input type="search" role="combobox" aria-label="Search languages" aria-expanded="${scenario !== "collapsed"}">`;
    document.body.append(dialog);
    coach.getPage();
    await vi.waitFor(() => {
      const page = coach.getPage();
      expect(
        page?.controls.some((control) => control.role === "combobox"),
      ).toBe(true);
    });
    expect(coach.view.verifiedSteps).toBe(scenario === "matching" ? 1 : 0);
    expect(coach.view.goalPlan?.status).not.toBe("completed");
    expect(coach.view.request?.status).not.toBe("completed");
    if (scenario === "matching") {
      expect(coach.view.goalPlan?.status).toBe("awaiting-choice");
      expect(coach.view.liveDiagnostics?.events.at(-1)).toMatchObject({
        outcome: "verified",
        evidence: "related-controls-added",
      });
    }
  } finally {
    coach.stop();
  }
});
