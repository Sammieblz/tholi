/** Private navigation and static metadata share the same canonical destinations. */
export const ACCOUNT_SECTIONS = [
  {
    path: "/account",
    label: "Overview",
    title: "Your Tholi account",
    description:
      "Review your Tholi account, saved items and current allowance.",
  },
  {
    path: "/account/data",
    label: "Saved data",
    title: "Saved data",
    description:
      "Review and manage data explicitly saved to your Tholi account.",
  },
  {
    path: "/account/credits",
    label: "Credits and usage",
    title: "Credits and usage",
    description:
      "Review your available credits, usage, current limits and storage allowance.",
  },
  {
    path: "/account/security",
    label: "Security",
    title: "Account and security",
    description:
      "Manage your profile, sessions, privacy, exports and account deletion.",
  },
  {
    path: "/account/billing",
    label: "Plans",
    title: "Plans and billing",
    description:
      "Review server-confirmed plan availability and account allowances.",
  },
] as const;
const accountPaths = new Set<string>([
  "/signin",
  "/signup",
  "/welcome",
  ...ACCOUNT_SECTIONS.map((section) => section.path),
]);
export const accountAliases = Object.freeze({ "/welcome": "/account" });

/** Account bookmarks share one canonical client route, including static aliases. */
export function accountPath(path: string) {
  const canonical = path.replace(/\/+$/, "").replace(/\.html$/, "");
  return accountPaths.has(canonical) ? canonical : undefined;
}
