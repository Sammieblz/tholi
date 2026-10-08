import { routeSchema } from "../../packages/route-schema";
import { demoRoute } from "./cancellation";
export const billingRoute = routeSchema.parse({
  ...demoRoute,
  id: "demo.billing.overview",
  taskId: "billing.locate",
  title: "Find billing details",
  description: "Account → billing overview",
  safetyNote:
    "A read-only route. Navigator stops when billing details are visible.",
  completionInstruction:
    "You reached Billing. Your plan and billing details are visible; no account settings were changed.",
  startStates: ["home", "account", "profile", "login", "billing"],
  milestones: ["Account", "Billing details"],
  milestoneStates: { home: 0, profile: 0, account: 0, billing: 1 },
  states: demoRoute.states
    .filter((s) =>
      ["home", "account", "profile", "login", "billing"].includes(s.id),
    )
    .map((s) => (s.id === "billing" ? { ...s, behavior: "success" } : s)),
  transitions: demoRoute.transitions.filter((t) =>
    ["open-account", "open-billing", "return-account"].includes(t.id),
  ),
  successStates: ["billing"],
});
