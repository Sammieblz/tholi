import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const clock = z.number().int().nonnegative().safe();
const caseId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export const OPERATOR_EVALUATION_LIMITS = Object.freeze({
  maxPlanBytes: 256 * 1024,
  maxApprovalBytes: 8192,
  maxApprovalLifetimeMs: 3600000,
  allowanceUsdMicros: 4900000,
  maxInputTokens: 32768,
  maxOutputTokens: 2048,
  maxGenerations: 324,
});
export const operatorEvaluationArmSchema = z.enum([
  "local",
  "structured",
  "multimodal",
]);
export const operatorEvaluationBindingSchema = z
  .object({
    planSha256: sha256,
    trialId: z.string().uuid(),
    generation: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();
export type OperatorEvaluationBinding = z.infer<
  typeof operatorEvaluationBindingSchema
>;

const scopeUrl = z
  .string()
  .min(1)
  .max(2048)
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return (
        !url.username &&
        !url.password &&
        !url.hash &&
        url.origin + url.pathname + url.search === raw &&
        ((url.protocol === "https:" &&
          ["en.wikipedia.org", "github.com"].includes(url.hostname)) ||
          (url.protocol === "http:" && url.hostname === "127.0.0.1"))
      );
    } catch {
      return false;
    }
  }, "Evaluation scope must be an exact public or loopback URL without credentials or fragments.");
const evaluationCaseSchema = z
  .object({
    id: caseId,
    goal: z.string().min(1).max(1000),
    split: z.enum(["inspected-regression", "fresh-holdout", "synthetic"]),
    scope: z.object({ urls: z.array(scopeUrl).min(1).max(16) }).strict(),
    maxGenerations: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();
const trialSchema = z
  .object({
    id: z.string().uuid(),
    caseId,
    arm: operatorEvaluationArmSchema,
    repetition: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  })
  .strict();

/** Public admission declaration only. Outcome selectors and expected answers stay in the collector. */
export const operatorEvaluationPlanSchema = z
  .object({
    version: z.literal(1),
    profile: z.literal("operator-evaluation"),
    id: z.string().uuid(),
    provider: z.enum(["fake", "vertex"]),
    operator: z
      .object({
        accountId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        clientId: z.literal("extension-chromium"),
      })
      .strict(),
    createdAtMs: clock,
    expiresAtMs: clock,
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    hashes: z
      .object({
        sourceSha256: sha256,
        extensionBuildSha256: sha256,
        buildManifestSha256: sha256,
        runtimeManifestSha256: sha256,
        promptSha256: sha256,
        observationSchemaSha256: sha256,
        capturePolicySha256: sha256,
        protocolSha256: sha256,
        corpusSha256: sha256,
        holdoutSha256: sha256,
      })
      .strict(),
    model: z
      .object({
        api: z.literal("v1"),
        project: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
        location: z.literal("global"),
        id: z.enum(["tholi-deterministic-v1", "gemini-3.8-flash"]),
        retentionProfile: z.literal("provider-default-acknowledged"),
        priceRevision: z.string().min(1).max(100),
      })
      .strict(),
    budget: z
      .object({
        maxInputTokens: z.literal(OPERATOR_EVALUATION_LIMITS.maxInputTokens),
        maxOutputTokens: z.literal(OPERATOR_EVALUATION_LIMITS.maxOutputTokens),
        allowanceUsdMicros: z.literal(
          OPERATOR_EVALUATION_LIMITS.allowanceUsdMicros,
        ),
      })
      .strict(),
    maxGenerations: z.literal(OPERATOR_EVALUATION_LIMITS.maxGenerations),
    cases: z.array(evaluationCaseSchema).length(30),
    trials: z.array(trialSchema).length(270),
  })
  .strict()
  .superRefine((plan, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      plan.expiresAtMs <= plan.createdAtMs ||
      plan.expiresAtMs - plan.createdAtMs >
        OPERATOR_EVALUATION_LIMITS.maxApprovalLifetimeMs
    )
      fail("Evaluation lifetime exceeds its admission window.");
    if (
      (plan.provider === "fake") !==
      (plan.model.id === "tholi-deterministic-v1")
    )
      fail("The declared provider and exact model must match.");
    const cases = new Map(plan.cases.map((item) => [item.id, item]));
    if (cases.size !== plan.cases.length)
      fail("Evaluation case IDs must be unique.");
    for (const [split, expected] of [
      ["inspected-regression", 18],
      ["fresh-holdout", 6],
      ["synthetic", 6],
    ] as const)
      if (plan.cases.filter((item) => item.split === split).length !== expected)
        fail("Evaluation cohorts must retain their frozen denominators.");
    for (const item of plan.cases) {
      if (item.maxGenerations !== (item.split === "synthetic" ? 1 : 2))
        fail("Evaluation generation limits must match the declared cohort.");
      if (new Set(item.scope.urls).size !== item.scope.urls.length)
        fail("Evaluation scope URLs must be unique.");
      if (
        item.scope.urls.some((raw) => {
          try {
            return (
              (new URL(raw).hostname === "127.0.0.1") !==
              (item.split === "synthetic")
            );
          } catch {
            return false;
          }
        })
      )
        fail(
          "Synthetic controls and public cases must retain distinct scopes.",
        );
    }
    const ids = new Set<string>(),
      tuples = new Set<string>();
    let generations = 0;
    for (const trial of plan.trials) {
      const item = cases.get(trial.caseId);
      if (!item) fail("Every trial must name a declared case.");
      if (ids.has(trial.id)) fail("Evaluation trial IDs must be unique.");
      ids.add(trial.id);
      const tuple = `${trial.caseId}:${trial.arm}:${trial.repetition}`;
      if (tuples.has(tuple))
        fail("Evaluation repetitions cannot be substituted.");
      tuples.add(tuple);
      if (trial.arm !== "local") generations += item?.maxGenerations ?? 0;
    }
    if (generations !== plan.maxGenerations)
      fail(
        "Evaluation generation count must include every frozen provider trial.",
      );
  });
export type OperatorEvaluationPlan = z.infer<
  typeof operatorEvaluationPlanSchema
>;
export type OperatorEvaluationTrial = OperatorEvaluationPlan["trials"][number];

export const operatorEvaluationApprovalSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    planSha256: sha256,
    approvedAtMs: clock,
    expiresAtMs: clock,
    approvedData: z.literal(true),
    approvedSpending: z.literal(true),
    allowanceUsdMicros: z.literal(
      OPERATOR_EVALUATION_LIMITS.allowanceUsdMicros,
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.expiresAtMs > value.approvedAtMs &&
      value.expiresAtMs - value.approvedAtMs <=
        OPERATOR_EVALUATION_LIMITS.maxApprovalLifetimeMs,
    "Approval cannot renew or exceed the one-hour window.",
  );
export type OperatorEvaluationApproval = z.infer<
  typeof operatorEvaluationApprovalSchema
>;
export const operatorEvaluationMetadataSchema = z
  .object({
    profile: z.literal("operator-evaluation"),
    planSha256: sha256,
    provider: z.enum(["fake", "vertex"]),
    runtimeManifestSha256: sha256,
    expiresAtMs: clock,
  })
  .strict();
export type OperatorEvaluationMetadata = z.infer<
  typeof operatorEvaluationMetadataSchema
>;

/** Plan approvals bind original UTF-8 bytes; never hash reformatted parsed JSON. */
export async function operatorEvaluationSha256(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
/** Installed manifests are objects, so all clients use the same key ordering. */
export function operatorEvaluationManifestJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== null && prototype !== Object.prototype)
        throw new Error("The installed manifest must contain JSON data only.");
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return item;
  });
  if (
    !serialized ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    throw new Error("An installed manifest object is required.");
  return serialized;
}
export async function operatorEvaluationManifestSha256(
  value: unknown,
): Promise<string> {
  return operatorEvaluationSha256(operatorEvaluationManifestJson(value));
}
