import type { SessionView } from "../shared-types";

export type PresentationPhase =
  | "idle"
  | "initializing"
  | "planning"
  | "guiding"
  | "verifying"
  | "authentication"
  | "clarification"
  | "access"
  | "recovering"
  | "review"
  | "paused"
  | "arrived";
export interface GuidancePresentation {
  phase: PresentationPhase;
  stepId: string;
  title: string;
  instruction: string;
  destination?: string;
  warning: boolean;
  busy: boolean;
}
export function present(
  view?: SessionView,
  pending?: string,
  access?: boolean,
): GuidancePresentation {
  const destination = view?.request?.original || view?.journey?.goal;
  let phase: PresentationPhase = "idle";
  if (pending) phase = pending === "Starting" ? "initializing" : "planning";
  else if (view?.status === "stopped") phase = "idle";
  else if (view?.status === "paused" || view?.status === "checkpoint")
    phase = "paused";
  else if (
    view?.status === "completed" ||
    (view?.request?.status === "completed" &&
      view.goalPlan?.status === "completed")
  )
    phase = "arrived";
  else if (access || view?.continuationOrigin) phase = "access";
  else if (
    ["credentials", "two-factor", "authorization"].includes(
      view?.page?.screen?.kind || "",
    )
  )
    phase = "authentication";
  else if (view?.clarification || view?.goalPlan?.status === "awaiting-choice")
    phase = "clarification";
  else if (
    view?.status === "boundary" ||
    ["consequential", "unknown-effect"].includes(view?.goalPlan?.issue || "") ||
    view?.journey?.workflow?.status === "review"
  )
    phase = "review";
  else if (view?.status === "waiting") phase = "verifying";
  else if (
    view?.goalPlan?.recoveryStage ||
    view?.goalPlan?.status === "unresolved" ||
    view?.status === "rerouting"
  )
    phase = "recovering";
  else if (
    view?.selectedControlId ||
    (view?.status === "running" && view.routeId !== "navigator.live")
  )
    phase = "guiding";
  const titles: Record<PresentationPhase, string> = {
    idle: "Your next step, made clear",
    initializing: "Getting ready",
    planning: "Finding your next step",
    guiding: "Your next step",
    verifying: "Checking the website",
    authentication: "Sign in on the website",
    clarification: "One quick question",
    access: "Website access needed",
    recovering: "Finding a way forward",
    review: "Review this step",
    paused: "Paused",
    arrived: "Arrived",
  };
  const instruction = pending
    ? `${pending}. Your destination stays with you.`
    : phase === "idle"
      ? view?.status === "stopped"
        ? view.instruction
        : "Tell Tholi what you want to do. You stay in control of every click."
      : phase === "authentication"
        ? "Complete sign-in or verification on the website. I’ll keep your destination and continue afterward."
        : view?.instruction || "Checking the current screen.";
  // Document/geometry revisions must not replay a step's attention animation.
  const stepId = [
    view?.request?.id || view?.journey?.id || view?.routeId || "idle",
    phase,
    view?.selectedControlId || view?.stateId || "",
    view?.verifiedSteps || 0,
    instruction,
  ].join("|");
  return {
    phase,
    stepId,
    title: view?.status === "stopped" ? "Stopped" : titles[phase],
    instruction,
    destination,
    warning: ["review", "access", "clarification"].includes(phase),
    busy: ["initializing", "planning", "verifying"].includes(phase),
  };
}
export interface ConversationMessage {
  id: string;
  role: "user" | "guide";
  text: string;
  at: number;
}
export function appendMessage(
  messages: ConversationMessage[],
  message: ConversationMessage,
) {
  return messages.some((m) => m.id === message.id)
    ? messages
    : [...messages, message].slice(-80);
}
export function conversationCommand(
  text: string,
): "PAUSE" | "RESUME" | "STOP" | "WHY" | undefined {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/^(?:can|could|would) you\s+/, "")
    .replace(/\s+(?:please|for me)$/, "");
  if (
    /^(?:please )?pause(?: (?:the )?(?:navigation|task|guidance))?$/.test(value)
  )
    return "PAUSE";
  if (/^(?:please )?(?:resume|continue)(?: navigation| the task)?$/.test(value))
    return "RESUME";
  if (/^(?:please )?stop(?: navigation| the task)?$/.test(value)) return "STOP";
  if (
    /^(?:why|why this step|why are you suggesting this|explain this step)$/.test(
      value,
    )
  )
    return "WHY";
}
export function explainStep(view?: SessionView) {
  return (
    view?.goalPlan?.reason ||
    view?.reason ||
    "There isn’t a selected route to explain yet. Tell me the destination you want to reach."
  );
}
export function clarificationReply(
  text: string,
  choices: { id: string; label: string }[],
) {
  if (/\b(?:not|without|except|avoid|don't)\b/i.test(text)) return;
  const clean = (v: string) =>
    v
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/, " ")
      .trim();
  const value = clean(text)
    .replace(/^(?:actually[, ]*|i (?:mean|meant)\s+|the\s+)/, " ")
    .trim()
    .replace(/\s+(?:please|option)$/, " ")
    .trim();
  const matches = choices.filter((c) => clean(c.label) === value);
  return matches.length === 1 ? matches[0].id : undefined;
}
