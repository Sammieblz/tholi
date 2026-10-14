import { safeName } from "../privacy-redaction";
import type { PageSnapshot } from "../page-model";
import { visible } from "../browser-adapter";

export function presentedMetadataField(field: Element): boolean {
  if (
    field.getAttribute("type") === "hidden" ||
    field.closest('[hidden],[inert],[aria-hidden="true"]')
  )
    return false;
  for (
    let parent: Element | null = field;
    parent;
    parent =
      parent.parentElement || (parent.getRootNode() as ShadowRoot).host || null
  ) {
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

// Metadata only: no input.value, editor contents or credential text is read.
export function authenticationStage(
  root: ParentNode,
  heading = "",
): "credentials" | "two-factor" | undefined {
  const fields = [...root.querySelectorAll<HTMLInputElement>("input")].filter(
    presentedMetadataField,
  );
  const hints = fields.map((e) =>
    ["type", "autocomplete", "name", "id", "aria-label", "placeholder"]
      .map((a) => e.getAttribute(a) || "")
      .join(" "),
  );
  if (
    hints.some((h) =>
      /one-time-code|otp|2fa|verification.?code|security.?code|passcode/i.test(
        h,
      ),
    ) ||
    (/two.step|two.factor|verification|verify your identity|enter.*code/i.test(
      heading,
    ) &&
      fields.some(
        (e) =>
          e.getAttribute("inputmode") === "numeric" ||
          e.getAttribute("maxlength") === "1",
      ))
  )
    return "two-factor";
  const authActions = [
    ...root.querySelectorAll("button,input[type=submit],[role=button]"),
  ]
    .slice(0, 12)
    .map((button) => safeName(button))
    .join(" ");
  if (
    hints.some((h) => /password|current-password/i.test(h)) ||
    (hints.some((h) => /username|email/i.test(h)) &&
      /sign.?in|log.?in|create account|register|authentication/i.test(
        heading + " " + authActions,
      ))
  )
    return "credentials";
}

export function discoverScreen(
  roots: ParentNode[],
  controls: PageSnapshot["controls"],
  busy: boolean,
  signals: PageSnapshot["signals"] = [],
): NonNullable<PageSnapshot["screen"]> {
  let credentialScreen = false;
  for (const root of roots) {
    for (const form of [...root.querySelectorAll("form")].slice(0, 30)) {
      if (!visible(form)) continue;
      const headingElement = form.querySelector(
        'h1,h2,legend,[role="heading"]',
      );
      const heading = headingElement ? safeName(headingElement) : "";
      const stage = authenticationStage(form, heading);
      if (stage === "two-factor")
        return { kind: stage, evidence: "field-metadata" };
      credentialScreen ||= stage === "credentials";
    }
    // Some verification widgets are not enclosed in a native form.
    const otp = root.querySelector('input[autocomplete="one-time-code"]');
    const scope =
      otp?.closest(
        "main,[role=main],dialog,[role=dialog],section,[role=group]",
      ) || otp?.parentElement;
    const verificationContext =
      scope &&
      [
        scope.getAttribute("aria-label") || "",
        ...[
          ...scope.querySelectorAll(
            "h1,h2,legend,[role=heading],button,[role=button]",
          ),
        ]
          .slice(0, 20)
          .map((e) => safeName(e)),
      ].join(" ");
    if (
      otp &&
      !otp.closest('[hidden],[inert],[aria-hidden="true"]') &&
      visible(otp) &&
      /two.?step|two.?factor|verification|verify(?: your identity| identity| code)?\b|enter.*code/i.test(
        verificationContext || "",
      )
    )
      return { kind: "two-factor", evidence: "field-metadata" };
  }
  if (
    credentialScreen ||
    controls.some((c) => c.visible && c.form?.authentication)
  )
    return { kind: "credentials", evidence: "form-metadata" };
  if (
    controls.some(
      (c) =>
        c.visible && /authorize|approve access|allow access/i.test(c.label),
    )
  )
    return { kind: "authorization", evidence: "control-metadata" };
  if (!busy) {
    const review = roots.some((root) =>
      [...root.querySelectorAll('h1,h2,[role="heading"]')]
        .slice(0, 20)
        .some(
          (heading) =>
            visible(heading) &&
            /^(?:review|confirm) (?:your |the )?(?:cancellation|membership|subscription|changes|deployment|order)\b/i.test(
              safeName(heading),
            ),
        ),
    );
    if (review) return { kind: "review", evidence: "bounded-heading" };
    if (
      signals?.some((s) =>
        /\b(?:cancelled|canceled|deployed|created|failed|successfully|will end|has ended)\b/i.test(
          s.text,
        ),
      )
    )
      return { kind: "outcome", evidence: "bounded-status" };
  }
  return {
    kind: busy ? "loading" : "normal",
    evidence: busy ? "busy-state" : "live-controls",
  };
}
