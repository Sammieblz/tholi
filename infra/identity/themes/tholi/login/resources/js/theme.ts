// Presentation only. Never inspect fields, forms, auth parameters or session data.
const root = document.documentElement;
let dark = matchMedia("(prefers-color-scheme: dark)").matches;
try {
  const preference = sessionStorage.getItem("tholi-identity-theme");
  if (preference === "light" || preference === "dark")
    dark = preference === "dark";
} catch {
  /* Appearance never gates authentication. */
}
const apply = () => {
  root.dataset.tholiTheme = dark ? "dark" : "light";
  root.classList.toggle("pf-v5-theme-dark", dark);
  const button = document.getElementById("tholi-identity-theme");
  if (button) {
    button.textContent = dark ? "Light" : "Dark";
    button.setAttribute("aria-label", `Use ${dark ? "light" : "dark"} theme`);
  }
};
apply();
document.addEventListener("DOMContentLoaded", () => {
  apply();
  document
    .getElementById("tholi-identity-theme")
    ?.addEventListener("click", () => {
      dark = !dark;
      try {
        sessionStorage.setItem("tholi-identity-theme", dark ? "dark" : "light");
      } catch {
        /* Optional presentation preference. */
      }
      apply();
    });
});
