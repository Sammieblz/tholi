// Normalize task wording, not site URLs, selectors, or control IDs. Keep any
// explicit qualifiers so account types/providers still have to match the page.
export function taskWords(text: string) {
  return text
    .toLowerCase()
    .replace(
      /\b(?:log[ -]?in|sign[ -]?in|log on)(?:\s+(?:to|into))?(?:\s+(?:my|your|the|an?|existing))?\s+account\b/g,
      "login",
    )
    .replace(/\b(?:log[ -]?in|sign[ -]?in|log on)\b/g, "login")
    .replace(
      /\b(?:create|register|open)\s+(?:(?:an?|new|your|my|the)\s+)*account\b/g,
      "register",
    )
    .replace(/\b(?:sign[ -]?up|registration)\b/g, "register");
}
export function authenticationIntent(
  text: string,
): "login" | "register" | undefined {
  const words = taskWords(text);
  const login = /\blogin\b/.test(words),
    register = /\bregister\b/.test(words);
  return login !== register ? (login ? "login" : "register") : undefined;
}
