import { PageDiscovery } from "../../../packages/page-discovery";
import { planTask } from "../../../packages/goal-planner/task-journey";
// Independent DOM collector, without extension grants or coach activation.
(globalThis as any).__authProbe = (task: Parameters<typeof planTask>[1]) => {
  const page = new PageDiscovery().snapshot();
  const plan = planTask(page, task);
  return {
    plan,
    target: page.controls.find((c) => c.id === plan.steps[0]?.controlId),
    controls: page.controls
      .filter((c) => c.form || c.kind === "focus")
      .map((c) => ({
        label: c.label,
        kind: c.kind,
        form: c.form,
        context: c.context,
        structure: c.structure,
      })),
  };
};
