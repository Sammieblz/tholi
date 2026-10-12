import type { TaskIntent } from "../navigation-core/contracts";
export function canonicalGoal(task: TaskIntent): string {
  return task.operation === "choose" && task.desiredValue
    ? `Change ${task.target} to ${task.desiredValue}`
    : task.target;
}
