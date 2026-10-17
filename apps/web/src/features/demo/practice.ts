import type { UIPreferences } from "../../../../../packages/ui/guidance/types";
export type Task = "settings" | "spanish";
export const initialPreferences: UIPreferences = {
  mode: "guide",
  surface: "sidebar",
  advanced: false,
};
export const goals: Record<Task, string> = {
  settings: "Show me my account settings",
  spanish: "Change my language to Spanish",
};
