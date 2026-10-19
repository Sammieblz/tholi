export const refusalCases = [
  "missing",
  "ambiguous-context",
  "duplicate-controls",
  "consequential",
  "unknown-edit-effect",
  "implicit-submit",
];
export const negativeGoals: Record<string, string> = {
  missing: "Unknown feature",
  "ambiguous-context": "Settings",
  "duplicate-controls": "Help",
  consequential: "Delete account",
  "unknown-edit-effect": "Edit draft",
  "implicit-submit": "Continue publication",
  "unrelated-popup": "Categories",
  "unrelated-action": "Feedback",
  "stale-target": "Show search",
};
