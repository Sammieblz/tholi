import type { Theme } from "../../../../../packages/ui/page-theme";
let settle = 0;
export function applyAppearance(theme?: Theme) {
  const root = document.documentElement;
  if (root.dataset.tholiTheme === theme) return;
  // Change foreground and background together, keeping press/movement motion.
  root.dataset.tholiThemeSwitching = "";
  if (theme) root.dataset.tholiTheme = theme;
  else delete root.dataset.tholiTheme;
  cancelAnimationFrame(settle);
  settle = requestAnimationFrame(() => {
    settle = requestAnimationFrame(() => {
      delete root.dataset.tholiThemeSwitching;
    });
  });
}
