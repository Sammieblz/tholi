import { applyAppearance } from "./apply-appearance";
/** Shares the session refresh trigger; owns no additional subscription or timer. */
export function createAppearanceReader(current: () => boolean) {
  let reading = false;
  return () => {
    if (reading) return;
    reading = true;
    void chrome.runtime
      .sendMessage({ type: "UI_APPEARANCE" })
      .then((reply) => {
        if (current() && !reply?.error)
          applyAppearance(
            reply?.appearance === "light" || reply?.appearance === "dark"
              ? reply.appearance
              : undefined,
          );
      })
      .catch(() => {})
      .finally(() => {
        reading = false;
      });
  };
}
