import { act, createElement, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, SiteLink, useRouter } from "../apps/web/src/app/router";

describe("website fragment navigation", () => {
  let root: Root;
  let container: HTMLDivElement;
  const scroll = vi.fn();
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  function Probe() {
    const { path, hash } = useRouter();
    return createElement(
      "main",
      null,
      createElement("h1", null, "Documentation"),
      createElement("output", null, `${path}|${hash}`),
      createElement(SiteLink, { to: "/docs/journeys#context" }, "Context"),
      createElement(SiteLink, { to: "/docs/security" }, "Security"),
      createElement("h2", { id: "context" }, "Context and continuity"),
    );
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (timer: number) =>
      clearTimeout(timer),
    );
    vi.stubGlobal("scrollTo", vi.fn());
    HTMLElement.prototype.scrollIntoView = scroll;
    history.replaceState({}, "", "/docs");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("keeps fragments out of route names and focuses their live heading", async () => {
    act(() => root.render(createElement(Router, null, createElement(Probe))));
    await settle();
    act(() =>
      container
        .querySelector<HTMLAnchorElement>('a[href="/docs/journeys#context"]')!
        .click(),
    );
    await settle();
    expect(container.querySelector("output")?.textContent).toBe(
      "/docs/journeys|#context",
    );
    expect(location.pathname).toBe("/docs/journeys");
    expect(location.hash).toBe("#context");
    expect(document.activeElement?.id).toBe("context");
    expect(scroll).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    });
  });
  it("supports direct fragment loads and browser Back", async () => {
    history.replaceState({}, "", "/docs/journeys#context");
    act(() => root.render(createElement(Router, null, createElement(Probe))));
    await settle();
    expect(document.activeElement?.id).toBe("context");
    act(() =>
      container
        .querySelector<HTMLAnchorElement>('a[href="/docs/security"]')!
        .click(),
    );
    await settle();
    expect(container.querySelector("output")?.textContent).toBe(
      "/docs/security|",
    );
    await act(async () => {
      history.back();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await settle();
    expect(container.querySelector("output")?.textContent).toBe(
      "/docs/journeys|#context",
    );
    expect(document.activeElement?.id).toBe("context");
  });
  it("waits for the real heading and fragment when a route is loaded lazily", async () => {
    history.replaceState({}, "", "/docs/journeys#late-context");
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const Article = lazy(async () => {
      await ready;
      return {
        default: () =>
          createElement(
            "article",
            null,
            createElement("h1", null, "Loaded article"),
            createElement("h2", { id: "late-context" }, "Late context"),
          ),
      };
    });
    act(() =>
      root.render(
        createElement(
          Router,
          null,
          createElement(
            "main",
            null,
            createElement(
              Suspense,
              {
                fallback: createElement(
                  "p",
                  { role: "status" },
                  "Loading documentation",
                ),
              },
              createElement(Article),
            ),
          ),
        ),
      ),
    );
    await settle();
    expect(container.querySelector("h1")).toBeNull();
    await act(async () => {
      release();
      await ready;
    });
    await settle();
    expect(document.activeElement?.id).toBe("late-context");
    expect(document.title).toBe("Loaded article | Tholi");
  });
});
