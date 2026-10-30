// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const events = vi.hoisted(() => ({ track: vi.fn(), go: vi.fn() }));
vi.mock("../../../apps/web/src/features/preferences", () => ({
  usePreferences: () => ({ trackEvent: events.track }),
}));
vi.mock("../../../apps/web/src/app/router", () => ({
  useRouter: () => ({ go: events.go }),
  SiteLink: () => null,
}));
vi.mock("../../../apps/web/src/features/demo/Demo", () => ({
  Demo: () => null,
}));
import { OnboardingPage } from "../../../apps/web/src/features/onboarding/OnboardingPage";
import { StoreLink } from "../../../apps/web/src/features/downloads/downloads";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (element) => element.textContent === text,
  )!;
it("records an explicit onboarding finish, never skip, installation or practice success", () => {
  act(() => root.render(createElement(OnboardingPage)));
  act(() => button("Skip onboarding").click());
  expect(events.go).toHaveBeenCalledWith("/download");
  expect(events.track).not.toHaveBeenCalled();
  act(() => button("Try the demonstration").click());
  act(() => button("Finish onboarding").click());
  expect(events.track.mock.calls).toEqual([[{ name: "onboarding_complete" }]]);
});
it("records the actual store listing link click without claiming installation", () => {
  act(() => root.render(createElement(StoreLink, { target: "firefox" })));
  const link = container.querySelector("a")!;
  link.addEventListener("click", (event) => event.preventDefault());
  act(() => link.click());
  expect(link.href).toBe(
    "https://addons.mozilla.org/en-US/firefox/addon/tholi/",
  );
  expect(events.track.mock.calls).toEqual([
    [{ name: "store_listing_opened", browser: "firefox" }],
  ]);
});
