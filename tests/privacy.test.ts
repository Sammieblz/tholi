import { describe, it, expect } from "vitest";
import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../packages/privacy-redaction";
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
