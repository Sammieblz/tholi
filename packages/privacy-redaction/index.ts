const sensitiveWords =
  /password|passcode|one.?time|otp|2fa|token|secret|authorization|credit.?card|card.?number|cvv|cvc|bank.?account|routing.?number|payment|passkey/i;
// Goals are supplied deliberately by the user. Validate before redaction; never
// silently cut off a qualifier, negation or an ordered task.
export function sanitizeGoal(value: string): string {
  if (value.length > 1000)
    throw new Error("Requests must be 1,000 characters or fewer.");
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/(?:Bearer\s+)[A-Za-z0-9_.-]+/gi, "[redacted]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();
}
export function isSensitiveElement(element: Element): boolean {
  const input = element as HTMLInputElement;
  const hint = [
    "type",
    "name",
    "id",
    "autocomplete",
    "aria-label",
    "placeholder",
  ]
    .map((a) => element.getAttribute(a) || "")
    .join(" ");
  return (
    input.type === "password" ||
    sensitiveWords.test(hint) ||
    element.closest('[data-sensitive="true"]') !== null
  );
}
export function sanitizeText(value: string): string {
  return value
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .trim()
    .slice(0, 160);
}
// Read structure only. Never read input.value, textareas, editable user content or document-wide text.
export function safeName(element: Element): string {
  if (
    isSensitiveElement(element) ||
    element.matches("input, textarea, [contenteditable]") ||
    element.closest('[contenteditable], [data-sensitive="true"]')
  )
    return "";
  const root = element.getRootNode() as Document | ShadowRoot;
  const refs = element
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => root.getElementById(id))
    .filter(
      (e): e is HTMLElement =>
        !!e &&
        !isSensitiveElement(e) &&
        !e.matches("input,textarea,[contenteditable]"),
    );
  if (refs?.length) return sanitizeText(refs.map((e) => safeText(e)).join(" "));
  const aria = element.getAttribute("aria-label");
  if (aria) return sanitizeText(aria);
  return sanitizeText(safeText(element));
}
function safeText(element: Element): string {
  const chunks: string[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType === 3) chunks.push(node.textContent || "");
    else if (
      node instanceof Element &&
      !isSensitiveElement(node) &&
      !node.matches(
        'input,select,option,textarea,script,style,[contenteditable],[role="textbox"],[hidden],[aria-hidden="true"]',
      )
    )
      chunks.push(safeText(node));
  }
  return chunks.join(" ").replace(/\s+/g, " ");
}
