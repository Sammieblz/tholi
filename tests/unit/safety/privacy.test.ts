// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../../../packages/privacy-redaction/index";
describe("sensitive field exclusion", () => {
  it("never reads password/OTP/payment/token values or nested editable text", () => {
    document.body.innerHTML =
      '<button>Account <input type="password" value="SENTINEL_PASSWORD"><input autocomplete="one-time-code" value="SENTINEL_OTP"><input name="credit-card" value="SENTINEL_PAYMENT"><span contenteditable>SENTINEL_MESSAGE</span><span data-sensitive="true">SENTINEL_TOKEN</span></button>';
    const button = document.querySelector("button")!;
    expect(safeName(button)).toBe("Account");
    for (const input of document.querySelectorAll("input")) {
      expect(isSensitiveElement(input)).toBe(true);
      expect(safeName(input)).toBe("");
    }
    expect(JSON.stringify(safeName(button))).not.toContain("SENTINEL");
  });
  it("excludes secrets referenced by accessible name", () => {
    document.body.innerHTML =
      '<input id="otp" autocomplete="one-time-code" value="SENTINEL_OTP"><button aria-labelledby="otp">Continue</button>';
    expect(safeName(document.querySelector("button")!)).toBe("Continue");
  });
  it("redacts token-like values, card digits, email and URLs", () => {
    const s = sanitizeText(
      "Bearer abcdefghijklmnopqrstuvwxyz123456 4242 4242 4242 4242 person@example.com https://example.com/private",
    );
    expect(s).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(s).not.toContain("4242");
    expect(s).not.toContain("person@example.com");
    expect(s).not.toContain("https://");
  });
});

import { BrowserAdapter } from "../../../packages/browser-adapter/index";
import { vi } from "vitest";
it("observes checkbox-button metadata without reading its value or sensitive variants", () => {
  document.body.innerHTML =
    '<input type="checkbox" role="button" id="menu" aria-label="Contents" value="SENTINEL_VALUE" style="opacity:0"><label for="menu" aria-hidden="true">Menu</label><input type="checkbox" role="button" id="otp-menu" aria-label="Sensitive" value="SENTINEL_SECRET"><label for="otp-menu">Secret</label>';
  const rectangle = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 40,
    bottom: 40,
    width: 40,
    height: 40,
    toJSON: () => ({}),
  };
  const input = document.querySelector<HTMLInputElement>("#menu")!;
  const label = document.querySelector("label")!;
  const getter = vi.spyOn(input, "value", "get").mockImplementation(() => {
    throw new Error("Field value was read");
  });
  vi.spyOn(input, "getBoundingClientRect").mockReturnValue(rectangle);
  vi.spyOn(label, "getBoundingClientRect").mockReturnValue(rectangle);
  const snapshot = new BrowserAdapter().snapshot();
  expect(snapshot.landmarks).toHaveLength(1);
  expect(snapshot.landmarks[0].name).toBe("Contents");
  expect(JSON.stringify(snapshot)).not.toContain("SENTINEL");
  expect(getter).not.toHaveBeenCalled();
  input.hidden = true;
  expect(new BrowserAdapter().snapshot().landmarks).toHaveLength(0);
  vi.restoreAllMocks();
});

it("Firefox stores private backend credentials outside content-accessible local storage", async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  const localSet = vi.fn();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("browser", {
    runtime: { getURL: () => "moz-extension://test/" },
    storage: { local: { set: localSet, get: async () => ({}) } },
  });
  try {
    const settings =
      await import("../../../apps/extension/src/platform/private-settings");
    const backend = {
      url: "http://127.0.0.1:8787",
      token: "SYNTHETIC_PRIVATE_TOKEN",
      enabled: false,
    };
    await settings.setPrivateSetting("backend", backend);
    expect(await settings.getPrivateSetting("backend")).toEqual(backend);
    expect(localSet).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
