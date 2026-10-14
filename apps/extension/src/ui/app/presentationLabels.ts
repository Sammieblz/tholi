import type { GoalPlan } from "../../../../../packages/page-model";
export function unresolvedTitle(plan: GoalPlan) {
  switch (plan.issue) {
    case "consequential":
      return "Review required";
    case "unknown-effect":
      return "Control effect unclear";
    case "ambiguous":
      return "Choose a matching control";
    case "no-match":
      return "No clear route found";
    default:
      return "More context needed";
  }
}
