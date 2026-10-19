/** Normalize ordinary interface phrases while preserving supplied names and URLs. */
export function normalizeIntentText(text: string): string {
  return text
    .split(
      /(https?:\/\/[^\s]+|`[^`]*`|"[^"\n]*"|“[^”\n]*”|(?<!\w)'[^'\n]+'(?!\w))/g,
    )
    .map((part, index) =>
      index % 2
        ? part
        : part
            .normalize("NFKC")
            .replace(/[‘’]/g, "'")
            .replace(
              /(?<![\p{L}\p{N}_./:@-])(sign|log)[\s\p{Pd}\u2212]+(in|up|out|on)(?![\p{L}\p{N}_./:@-])/giu,
              "$1 $2",
            )
            .replace(
              /\b(signin|signup|login|logout)\b/gi,
              (phrase) =>
                ({
                  signin: "sign in",
                  signup: "sign up",
                  login: "log in",
                  logout: "log out",
                })[phrase.toLowerCase()]!,
            )
            .replace(/\bweb[\p{Pd}\u2212]site\b/giu, "website")
            .replace(/\bset[\p{Pd}\u2212]up\b/giu, "set up")
            .replace(/\s+[—–]\s+/g, ", "),
    )
    .join("");
}
// Normalize task wording, not site URLs, selectors, or control IDs. Keep any
// explicit qualifiers so account types/providers still have to match the page.
export function taskWords(text: string) {
  return normalizeIntentText(text)
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
