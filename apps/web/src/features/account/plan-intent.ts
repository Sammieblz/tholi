import {
  servicePlanIntentSchema,
  type ServiceAuthIntent,
} from "../../../../../packages/navigation-core/contracts-service";

type PlanIntent = NonNullable<ServiceAuthIntent["planIntent"]>;
const key = "tholi.plan-intent.v1";

/** Navigation preference only. No credentials, entitlement or processing consent. */
export function readPlanIntent(search: string): PlanIntent | undefined {
  const query = new URLSearchParams(search);
  if (
    ["plan", "planId", "planVersion"].some(
      (name) => query.getAll(name).length > 1,
    )
  )
    return;
  const mode = query.get("plan");
  if (!mode) return;
  const result = servicePlanIntentSchema.safeParse({
    mode,
    ...(query.has("planId") ? { planId: query.get("planId") } : {}),
    ...(query.has("planVersion")
      ? {
          planVersion: /^[1-9][0-9]{0,9}$/.test(query.get("planVersion")!)
            ? Number(query.get("planVersion"))
            : NaN,
        }
      : {}),
  });
  return result.success ? result.data : undefined;
}
export function planIntentQuery(intent: PlanIntent | undefined) {
  return intent
    ? new URLSearchParams({
        plan: intent.mode,
        ...(intent.mode === "paid"
          ? { planId: intent.planId, planVersion: String(intent.planVersion) }
          : {}),
      }).toString()
    : "";
}
export function rememberPlanIntent(intent: PlanIntent | undefined) {
  try {
    if (intent)
      sessionStorage.setItem(
        key,
        JSON.stringify(servicePlanIntentSchema.parse(intent)),
      );
    else sessionStorage.removeItem(key);
  } catch {
    /* Account and local installation work when storage is unavailable. */
  }
}
export function pendingPlanIntent() {
  try {
    const result = servicePlanIntentSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? "null"),
    );
    return result.success ? result.data : undefined;
  } catch {
    return;
  }
}
export function planAccountPath(intent: PlanIntent | undefined) {
  return intent && intent.mode !== "local"
    ? `/account/billing?${planIntentQuery(intent)}`
    : "/account";
}
