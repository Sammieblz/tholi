import type { ReactNode } from "react";
import type {
  ConversationMessage,
  GuidancePresentation,
} from "../presentation";
export interface UIPreferences {
  mode: "guide" | "conversation";
  surface: "sidebar" | "widget";
  advanced: boolean;
}
export const defaultPreferences: UIPreferences = {
  mode: "guide",
  surface: "sidebar",
  advanced: false,
};
export type GuidanceProps = {
  presentation: GuidancePresentation;
  preferences: UIPreferences;
  onPreferences: (p: UIPreferences) => void;
  draft: string;
  onDraft: (v: string) => void;
  onSubmit: () => void;
  messages: ConversationMessage[];
  logo: string;
  active: boolean;
  paused: boolean;
  pending: boolean;
  disabled?: boolean;
  error?: string;
  verifiedSteps?: number;
  onCommand: (type: string) => void;
  primary?: ReactNode;
  details?: ReactNode;
  advanced?: ReactNode;
  widget?: boolean;
  onExpand?: () => void;
  onMoveAside?: () => void;
  children?: ReactNode;
};
