import type { ReactNode } from "react";
import type { RouteProgress } from "../route-progress";
import type { WidgetLayoutAction } from "../widget-density";
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
  progress?: RouteProgress;
  onCommand: (type: string) => void;
  primary?: ReactNode;
  details?: ReactNode;
  advanced?: ReactNode;
  widget?: boolean;
  onExpand?: (focusComposer?: boolean) => void;
  onMoveAside?: () => void;
  onWidgetLayout?: (action: WidgetLayoutAction) => void;
  onDock?: () => void;
  onMinimize?: () => void;
  onNewDestination?: () => void;
  onResetSession?: () => void;
  /** Render inside an isolated product demonstration without a second main landmark. */
  embedded?: boolean;
  hideSettings?: boolean;
  showHeader?: boolean;
  /** Blocking decisions stay in the attention region, outside secondary scrolling. */
  attention?: ReactNode;
  attentionRequired?: boolean;
  notice?: { id: string; text: string; tone?: "info" | "success" };
  children?: ReactNode;
};
