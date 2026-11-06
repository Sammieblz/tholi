// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("../../../apps/extension/src/platform/api", () => ({
  api: { runtime: { sendMessage: transport.sendMessage } },
}));
import { WidgetRegistration } from "../../../apps/extension/src/ui/app/WidgetRegistration";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function mount() {
  await act(async () =>
    root.render(
      createElement(WidgetRegistration, {
        children: createElement("p", null, "Authorized guidance"),
      }),
    ),
  );
}

it("announces registration failure without exposing raw errors and retries through the existing document owner", async () => {
  transport.sendMessage
    .mockRejectedValueOnce(new Error("PRIVATE_REGISTRATION_SENTINEL"))
    .mockResolvedValueOnce({ ok: true });
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "UI_REGISTRATION_FAILED",
  );
  expect(container.textContent).not.toContain("PRIVATE_REGISTRATION_SENTINEL");
  expect(container.textContent).not.toContain("Authorized guidance");
  const retry = container.querySelector("button")!;
  expect(retry.type).toBe("button");
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click());
  expect(container.textContent).toBe("Authorized guidance");
  expect(transport.sendMessage.mock.calls).toEqual([
    [{ type: "UI_REGISTER" }],
    [{ type: "UI_REGISTER" }],
  ]);
});

it("requires an affirmative registration result and ignores completion after its view is removed", async () => {
  let finishOld!: (result: unknown) => void;
  transport.sendMessage
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ ok: true, error: "PRIVATE_REPLY_SENTINEL" });
  await mount();
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Connecting",
  );
  expect(container.querySelector("button")?.disabled).toBe(true);
  act(() => root.unmount());
  root = createRoot(container);
  await mount();
  await act(async () => finishOld({ ok: true }));
  expect(container.textContent).not.toContain("Authorized guidance");
  expect(container.textContent).not.toContain("PRIVATE_REPLY_SENTINEL");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
