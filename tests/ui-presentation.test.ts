import { describe, it, expect, vi, afterEach } from "vitest";
import {
  present,
  conversationCommand,
  appendMessage,
  explainStep,
  clarificationReply,
} from "../packages/ui/presentation";
import type { SessionView } from "../packages/shared-types";
import { GuidanceOverlay } from "../packages/overlay-ui";
const view = (more: Partial<SessionView> = {}): SessionView => ({
  status: "running",
  instruction: "Open the account menu.",
  verifiedSteps: 0,
  confidence: 0.8,
  routeId: "navigator.live",
  routeVersion: "1.0.0",
  history: [],
  ...more,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.querySelectorAll("[data-tholi-ui]").forEach((n) => n.remove());
});
describe("Tholi presentation preserves engine evidence", () => {
  it("does not celebrate an entry point or an active queue", () => {
    expect(
      present(
        view({
          goalPlan: {
            goal: "Deploy",
            status: "completed",
            source: "semantics",
            confidence: 1,
            reason: "Entry point visible",
            steps: [],
          },
        }),
      ).phase,
    ).not.toBe("arrived");
    expect(present(view({ status: "completed" })).phase).toBe("arrived");
  });
  it("geometry revisions do not replay an instruction", () => {
    const a = present(view({ selectedControlId: "w0123456789abcdef-1" })),
      b = present(
        view({ selectedControlId: "w0123456789abcdef-1", confidence: 0.9 }),
      );
    expect(a.stepId).toBe(b.stepId);
    expect(present(view({ verifiedSteps: 1 })).stepId).not.toBe(a.stepId);
  });
  it("does not announce arrival while a completed request is paused or stopped", () => {
    const completed = {
      request: { id: "request", status: "completed" },
      goalPlan: { status: "completed" },
    } as Partial<SessionView>;
    expect(present(view({ ...completed, status: "paused" })).phase).toBe(
      "paused",
    );
    expect(present(view({ ...completed, status: "stopped" })).phase).toBe(
      "idle",
    );
  });
  it("matches only one grounded clarification reply and retains negation", () => {
    const choices = [
      { id: "account", label: "Account settings" },
      { id: "project", label: "Project settings" },
    ];
    expect(
      clarificationReply(
        "I mean account settings, please".replace(",", ""),
        choices,
      ),
    ).toBe("account");
    expect(clarificationReply("Not account settings", choices)).toBeUndefined();
    expect(clarificationReply("Settings", choices)).toBeUndefined();
    expect(
      clarificationReply("Account settings", [...choices, choices[0]]),
    ).toBeUndefined();
  });
  it("authentication does not introduce an expiry or read values", () => {
    expect(
      present(
        view({
          page: { screen: { kind: "two-factor" } } as SessionView["page"],
        }),
      ).phase,
    ).toBe("authentication");
  });
  it("explicit conversation commands do not become destinations", () => {
    expect(conversationCommand("Pause navigation please")).toBe("PAUSE");
    expect(conversationCommand("Pause the video")).toBeUndefined();
    expect(conversationCommand("Please pause navigation")).toBe("PAUSE");
    expect(conversationCommand("Why this step?")).toBe("WHY");
    expect(conversationCommand("Find the stop button")).toBeUndefined();
    expect(explainStep()).toContain("isn’t a selected route");
  });
  it("keeps at most 80 session messages and deduplicates polling", () => {
    let rows = [] as ReturnType<typeof appendMessage>;
    for (let i = 0; i < 90; i++)
      rows = appendMessage(rows, {
        id: String(i),
        role: "guide",
        text: "step",
        at: i,
      });
    expect(rows).toHaveLength(80);
    expect(appendMessage(rows, rows[0])).toBe(rows);
  });
});
describe("highlight lifecycle", () => {
  function setup() {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
      this: Element,
      init,
    ) {
      return attach.call(this, { ...init, mode: "open" });
    });
    const target = document.createElement("button");
    target.textContent = "Account";
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 30,
      top: 30,
      right: 130,
      bottom: 70,
      width: 100,
      height: 40,
      x: 30,
      y: 30,
      toJSON() {},
    });
    const animate = vi.fn((_frames: unknown, _options: unknown) => ({
      cancel: vi.fn(),
    }));
    if (!HTMLElement.prototype.animate)
      HTMLElement.prototype.animate = (() => ({ cancel() {} })) as any;
    vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(
      animate as any,
    );
    const overlay = new GuidanceOverlay();
    overlay.show(target, "Open Account");
    return {
      target,
      overlay,
      animate,
      root: document.querySelector("#internet-navigator-overlay")!,
    };
  }
  it("runs exactly four glow cycles once and retains nodes during geometry refresh", () => {
    const { target, overlay, animate, root } = setup(),
      halo = root.shadowRoot!.querySelector(".halo");
    vi.advanceTimersByTime(4000);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1]).toMatchObject({
      iterations: 4,
      duration: 1200,
    });
    overlay.show(target, "Open Account");
    expect(root.shadowRoot!.querySelector(".halo")).toBe(halo);
    vi.advanceTimersByTime(10000);
    expect(animate).toHaveBeenCalledTimes(1);
    overlay.clear();
  });
  it("cancels the reminder on interaction and suppresses review encouragement", () => {
    const { overlay, animate, target } = setup();
    window.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(4000);
    expect(animate).not.toHaveBeenCalled();
    overlay.show(target, "Review before canceling", {
      attention: false,
      warning: true,
    });
    vi.advanceTimersByTime(8000);
    expect(animate).not.toHaveBeenCalled();
    overlay.clear();
  });
});
