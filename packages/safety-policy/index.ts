import type { Route, Transition } from "../route-schema";
export function allowedOrigin(route: Route, origin: string): boolean {
  return route.origins.includes(origin);
}
export function guidancePolicy(transition: Transition): {
  allowed: boolean;
  reason: string;
} {
  if (transition.actor !== "user")
    return { allowed: false, reason: "Coach mode requires user actions." };
  if (transition.risk === "high-stakes" || transition.risk === "unauthorized")
    return { allowed: false, reason: "This task is outside supported scope." };
  if (transition.risk === "consequential")
    return {
      allowed: false,
      reason:
        "Consequential action: Navigator stops here. You remain in control.",
    };
  return { allowed: true, reason: "User-controlled guidance." };
}
