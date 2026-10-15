import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuidanceApp } from "../packages/ui/guidance";
import type { GuidanceProps } from "../packages/ui/guidance/types";
import { present } from "../packages/ui/presentation";
import { wayfinderMarkup, updateWayfinder } from "../packages/ui/wayfinder";
import type { SessionView } from "../packages/shared-types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const base = (): GuidanceProps => ({
  presentation: {
    phase: "guiding",
    stepId: "request|control",
    title: "Your next step",
    instruction: "Open the account menu.",
    destination: "Account settings",
    warning: false,
    busy: false,
  },
  preferences: { mode: "guide", surface: "sidebar", advanced: false },
  onPreferences: vi.fn(),
  draft: "",
  onDraft: vi.fn(),
  onSubmit: vi.fn(),
  messages: [],
  logo: "/logo.png",
  active: true,
  paused: false,
  pending: false,
  onCommand: vi.fn(),
});
async function render(props: GuidanceProps) {
  if (!root) {
    document.body.innerHTML = '<div id="mount"></div>';
    root = createRoot(document.getElementById("mount")!);
  }
  await act(async () => root!.render(createElement(GuidanceApp, props)));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shared guidance keeps controls reachable and outcomes honest", () => {
  it("keeps the composer outside secondary scrolling and decisions above the journey", async () => {
    await render({
      ...base(),
      attention: createElement("button", {}, "Allow website access"),
      error: "Chrome needs your activation.",
    });
    const body = document.querySelector(".tholi-body")!;
    const composer = document.querySelector(".tholi-composer")!;
    const attention = document.querySelector(".tholi-attention")!;
    expect(body.contains(composer)).toBe(false);
    expect(
      attention.compareDocumentPosition(
        document.querySelector(".tholi-workspace")!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(attention.textContent).toContain("Allow website access");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Chrome needs your activation.",
    );
  });
  it("arrival offers a new destination even when an old active flag remains", async () => {
    const props = base();
    props.presentation = {
      ...props.presentation,
      phase: "arrived",
      title: "Arrived",
      instruction: "The requested outcome is verified.",
    };
    props.onNewDestination = vi.fn();
    await render(props);
    expect(
      document.querySelector('[aria-label="Pause navigation"]'),
    ).toBeNull();
    const next = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "New destination",
    )!;
    expect(next).toBeTruthy();
    await act(async () => next.click());
    expect(props.onNewDestination).toHaveBeenCalledOnce();
    expect(
      document.querySelector(".tholi-wayfinder")?.getAttribute("data-state"),
    ).toBe("arrived");
  });
  it("makes Conversation transcript-first and keeps Enter safe for composition", async () => {
    const props = {
      ...base(),
      draft: "Show me the language control",
      preferences: { ...base().preferences, mode: "conversation" as const },
      messages: [
        {
          id: "u1",
          role: "user" as const,
          text: "Account settings please",
          at: 1,
        },
      ],
    };
    await render(props);
    expect(document.querySelector(".tholi-current")).toBeNull();
    expect(document.querySelector(".tholi-messages")?.textContent).toContain(
      "Account settings please",
    );
    expect(
      document.querySelector('[aria-label="Navigation status"]')?.textContent,
    ).toContain("Open the account menu.");
    const input = document.querySelector("textarea")!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it("retains the marker DOM when geometry-only presentation snapshots arrive", async () => {
    const props = base();
    await render(props);
    const marker = document.querySelector(".tholi-wayfinder svg");
    await render({ ...props, presentation: { ...props.presentation } });
    expect(document.querySelector(".tholi-wayfinder svg")).toBe(marker);
  });
  it("preserves the SVG through terminal states and never re-arms a morph on visibility updates", async () => {
    const props = base();
    await render(props);
    const marker = document.querySelector<HTMLElement>(".tholi-wayfinder")!;
    const svg = marker.querySelector("svg");
    await render({
      ...props,
      presentation: { ...props.presentation, phase: "arrived" },
    });
    expect(marker.querySelector("svg")).toBe(svg);
    expect(marker.dataset.state).toBe("arrived");
    expect(marker.dataset.morph).toBe("true");
    updateWayfinder(marker, "arrived", false);
    updateWayfinder(marker, "arrived", true);
    expect(marker.dataset.morph).toBe("true");
    expect(marker.querySelector("svg")).toBe(svg);
    updateWayfinder(marker, "guiding");
    expect(marker.dataset.morph).toBe("false");
    updateWayfinder(marker, "unresolved", false);
    expect(marker.dataset.morph).toBe("false");
    updateWayfinder(marker, "unresolved", true);
    expect(marker.dataset.morph).toBe("false");
    expect(marker.querySelectorAll(".wf-terminal .wf-piece")).toHaveLength(2);
    expect(marker.querySelector(".wf-check,.wf-cross")).toBeNull();
  });
  it("keeps the route visible in both modes without replaying its nodes on polling", async () => {
    const props = {
      ...base(),
      progress: {
        journeyId: "one",
        verified: 1,
        recentLabels: ["Account menu"],
        next: [
          {
            id: "settings",
            label: "Account settings",
            evidence: "live" as const,
          },
        ],
        complete: true,
        arrived: false,
      },
    };
    await render(props);
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Account settings");
    expect(
      document.querySelector(".tholi-route-steps")?.getAttribute("data-moving"),
    ).toBe("true");
    expect(
      document
        .querySelector('[data-state="destination"]')
        ?.getAttribute("data-checked"),
    ).toBe("false");
    await render({
      ...props,
      progress: { ...props.progress },
      presentation: { ...props.presentation },
    });
    expect(document.querySelector('[aria-current="step"]')).toBe(current);
    await render({
      ...props,
      preferences: { ...props.preferences, mode: "conversation" },
    });
    expect(document.querySelector('[aria-current="step"]')).toBe(current);
    await render({
      ...props,
      presentation: { ...props.presentation, phase: "paused" },
    });
    expect(
      document.querySelector(".tholi-route-steps")?.getAttribute("data-moving"),
    ).toBe("false");
    await render({
      ...props,
      progress: { ...props.progress, next: [], arrived: true },
      presentation: { ...props.presentation, phase: "arrived" },
    });
    expect(
      document
        .querySelector('[data-state="destination"]')
        ?.getAttribute("data-checked"),
    ).toBe("true");
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });
  it("keeps Stop available while a route query is pending", async () => {
    const props = { ...base(), pending: true };
    await render(props);
    const stop = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Stop",
    )!;
    expect(stop.disabled).toBe(false);
    await act(async () => stop.click());
    expect(props.onCommand).toHaveBeenCalledWith("STOP");
  });
  it("settles idle breathing while a destination is being composed", async () => {
    const props = base();
    await render({
      ...props,
      draft: "Find settings",
      presentation: { ...props.presentation, phase: "idle" },
    });
    expect(
      document.querySelector(".tholi-wayfinder")?.getAttribute("data-animate"),
    ).toBe("false");
  });
  it("embeds without a nested main or privileged settings", async () => {
    await render({ ...base(), embedded: true, hideSettings: true });
    expect(document.querySelector("main")).toBeNull();
    expect(
      document.querySelector('[aria-label="Tholi practice guide"]')?.tagName,
    ).toBe("SECTION");
    expect(document.querySelector('[aria-label="Tholi settings"]')).toBeNull();
  });
  it("keeps the composer and draft mounted while a compact decision opens its full details", async () => {
    vi.stubGlobal("innerWidth", 240);
    vi.stubGlobal("innerHeight", 150);
    const props = {
      ...base(),
      widget: true,
      draft: "Retain my destination",
      attentionRequired: true,
      onExpand: vi.fn(),
      attention: createElement(
        "section",
        {},
        createElement("h2", {}, "Which settings?"),
        createElement("button", {}, "Account settings"),
      ),
    };
    await render(props);
    const input = document.querySelector("textarea")!;
    expect(input.value).toBe("Retain my destination");
    expect(
      document.querySelector(".tholi-app")?.getAttribute("data-density"),
    ).toBe("minimal");
    expect(props.onExpand).not.toHaveBeenCalled();
    await act(async () =>
      (
        document.querySelector(".tholi-attention-trigger") as HTMLButtonElement
      ).click(),
    );
    expect(props.onExpand).toHaveBeenCalledExactlyOnceWith(false);
    await render({ ...props, presentation: { ...props.presentation } });
    expect(document.querySelector("textarea")).toBe(input);
    expect(document.body.textContent).toContain("Which settings?");
  });
  it("does not repeat an instruction already present in a required decision", async () => {
    const props = base();
    await render({
      ...props,
      attentionRequired: true,
      attention: createElement("p", {}, props.presentation.instruction),
    });
    expect(document.querySelector(".tholi-current")).toBeNull();
    expect(
      document.querySelector('[aria-label="Navigation status"]')?.textContent,
    ).toBe(props.presentation.instruction);
  });
});

describe("wayfinder reflects evidence rather than a confidence decoration", () => {
  const view = (goalPlan: unknown) =>
    ({
      status: "running",
      instruction: "Finding evidence.",
      verifiedSteps: 0,
      routeId: "navigator.live",
      routeVersion: "1",
      history: [],
      confidence: 0.2,
      goalPlan,
    }) as SessionView;
  it("keeps active recovery searching and uses an X only after settled recovery", () => {
    expect(
      present(view({ status: "unresolved", recoveryStage: "priority" })).marker,
    ).toBe("planning");
    expect(
      present(view({ status: "unresolved", recoveryStage: "waiting" })).marker,
    ).toBe("unresolved");
    expect(
      present(view({ status: "unresolved", recoveryStage: "waiting" })).title,
    ).toBe("No clear route yet");
    expect(
      present(view({ status: "unresolved", budgetPending: true })).marker,
    ).toBe("planning");
    expect(present(view({ status: "completed" })).marker).not.toBe("arrived");
  });
  it("has no percentage and does not interpolate caller markup", () => {
    const markup = wayfinderMarkup({
      state: "planning",
      instance: '\" onload=\"alert(1)',
    });
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    expect(holder.querySelector("[onload]")).toBeNull();
    expect(holder.querySelector('[role="progressbar"]')).toBeNull();
    expect(markup).not.toContain("aria-valuenow");
  });
});
