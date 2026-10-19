import { api } from "../../platform/api";
import {
  contrastPageTheme,
  observePageTheme,
  type Theme,
} from "../../../../../packages/ui/page-theme";
const key = "__tholiPageAppearance";
type State = { theme: Theme; stop?: () => void };
const scope = globalThis as typeof globalThis & { [key]?: State };
export function startPageAppearance() {
  if (scope[key]) return;
  const state: State = { theme: contrastPageTheme() };
  scope[key] = state;
  const applySurfaces = () =>
    document
      .querySelectorAll<HTMLElement>(
        "[data-tholi-ui],#internet-navigator-overlay",
      )
      .forEach((element) => {
        if (element.dataset.tholiTheme !== state.theme)
          element.dataset.tholiTheme = state.theme;
      });
  const start = () => {
    state.stop?.();
    state.stop = observePageTheme((theme) => {
      state.theme = theme;
      applySurfaces();
      if (window === window.top)
        void api.runtime
          .sendMessage({ type: "PAGE_THEME_CHANGED" })
          .catch(() => {});
    });
  };
  api.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== api.runtime.id || raw?.type !== "READ_PAGE_THEME") return;
    applySurfaces();
    respond({ theme: state.theme });
  });
  start();
  window.addEventListener("pagehide", () => {
    state.stop?.();
    state.stop = undefined;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
}
