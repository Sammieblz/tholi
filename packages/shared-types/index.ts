export interface Landmark {
  id: string;
  role: string;
  name: string;
  context: string;
  visible: boolean;
  enabled: boolean;
}
export interface UIState {
  platform: "web" | "windows" | "macos" | "linux";
  application: string;
  origin: string;
  pathname: string;
  landmarks: Landmark[];
  modal: boolean;
}
export interface Localization {
  stateId?: string;
  confidence: number;
  reason: string;
  scores: { id: string; score: number; rejected: boolean; reasons: string[] }[];
}
export interface LocatedTarget {
  id?: string;
  confidence: number;
  reason: string;
  candidates: {
    id: string;
    score: number;
    rejected: boolean;
    reasons: string[];
  }[];
}
export type SessionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "paused"
  | "checkpoint"
  | "rerouting"
  | "stopped"
  | "boundary"
  | "completed";
export interface Diagnostics {
  localization?: Localization;
  target?: LocatedTarget;
  transitionId?: string;
  expected: string[];
  transitions: {
    transitionId: string;
    from: string;
    expected: string[];
    observed?: string;
    outcome: "waiting" | "verified" | "deviated" | "timeout";
  }[];
}
export interface SessionView {
  diagnostics?: Diagnostics;
  status: SessionStatus;
  stateId?: string;
  instruction: string;
  verifiedSteps: number;
  confidence: number;
  reason?: string;
  routeId: string;
  routeVersion: string;
  history: string[];
}
export interface NavigationAdapter {
  observe(callback: () => void): () => void;
  snapshot(): UIState;
  locate(target: import("../route-schema").Target): LocatedTarget;
  guide(id: string, instruction: string): void;
  clearGuidance(): void;
}
