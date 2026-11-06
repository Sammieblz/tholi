import { z } from "zod";
import {
  navigationProposalSchema,
  NAVIGATION_LIMITS,
} from "../../../../packages/navigation-core/contracts-navigation";

const budgetDefaults = Object.freeze({
  maxInputTokens: 32768,
  maxOutputTokens: 2048,
  maxResponseBytes: 32768,
  maxImages: NAVIGATION_LIMITS.maxImages,
  maxImageBytes: NAVIGATION_LIMITS.maxImageBytes,
  maxImagePixels: NAVIGATION_LIMITS.maxImagePixels,
});
export const MODEL_LIMITS = Object.freeze({
  ...budgetDefaults,
  maxDeadlineMs: NAVIGATION_LIMITS.maxLifetimeMs,
});
export const modelBudgetSchema = z
  .object({
    maxInputTokens: z
      .number()
      .int()
      .positive()
      .max(MODEL_LIMITS.maxInputTokens),
    maxOutputTokens: z
      .number()
      .int()
      .positive()
      .max(MODEL_LIMITS.maxOutputTokens),
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .max(MODEL_LIMITS.maxResponseBytes),
    maxImages: z.number().int().nonnegative().max(MODEL_LIMITS.maxImages),
    maxImageBytes: z.number().int().positive().max(MODEL_LIMITS.maxImageBytes),
    maxImagePixels: z
      .number()
      .int()
      .positive()
      .max(MODEL_LIMITS.maxImagePixels),
  })
  .strict();
export type ModelBudget = z.infer<typeof modelBudgetSchema>;
export function resolveModelBudget(
  input: Partial<ModelBudget> = {},
): ModelBudget {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ModelError("BUDGET_EXCEEDED");
  const parsed = modelBudgetSchema.safeParse({ ...budgetDefaults, ...input });
  if (!parsed.success) throw new ModelError("BUDGET_EXCEEDED");
  return parsed.data;
}

const tokens = z.number().int().nonnegative().safe();
const modelId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
/** Version 1 keeps its historical output-versus-thought accounting unchanged. */
export const legacyModelUsageSchema = z
  .object({
    provider: z.enum(["fake", "vertex"]),
    source: z.enum(["fake", "measured"]),
    model: modelId,
    promptTokens: tokens,
    outputTokens: tokens,
    thoughtTokens: tokens,
    cachedTokens: tokens,
    totalTokens: tokens,
  })
  .strict()
  .superRefine((usage, context) => {
    if (
      (usage.provider === "fake") !== (usage.source === "fake") ||
      usage.cachedTokens > usage.promptTokens ||
      usage.totalTokens !==
        usage.promptTokens + usage.outputTokens + usage.thoughtTokens ||
      (usage.source === "fake" && usage.totalTokens !== 0)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid measured model usage.",
      });
  });

/** Output includes reasoning once. Null means that a provider did not report a breakdown. */
export const modelUsageV2Schema = z
  .object({
    version: z.literal(2),
    provider: z.enum(["fake", "vertex", "openai", "anthropic", "openrouter"]),
    source: z.enum(["fake", "measured"]),
    model: modelId,
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadInputTokens: tokens.nullable(),
    cacheWriteInputTokens: tokens.nullable(),
    reasoningOutputTokens: tokens.nullable(),
    totalTokens: tokens,
  })
  .strict()
  .superRefine((usage, context) => {
    if (
      (usage.provider === "fake") !== (usage.source === "fake") ||
      (usage.cacheReadInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0) >
        usage.inputTokens ||
      (usage.reasoningOutputTokens ?? 0) > usage.outputTokens ||
      usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
      (usage.source === "fake" && usage.totalTokens !== 0)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid measured model usage.",
      });
  });
export const modelUsageSchema = z.union([
  legacyModelUsageSchema,
  modelUsageV2Schema,
]);
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type ModelUsageV2 = z.infer<typeof modelUsageV2Schema>;

/** One totals owner prevents double-counting reasoning across historical formats. */
export function modelUsageTotals(usage: ModelUsage) {
  return "version" in usage
    ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
    : {
        inputTokens: usage.promptTokens,
        outputTokens: usage.outputTokens + usage.thoughtTokens,
      };
}

export function normalizeModelUsage(usage: ModelUsage): ModelUsageV2 {
  if ("version" in usage) return modelUsageV2Schema.parse(usage);
  return modelUsageV2Schema.parse({
    version: 2,
    provider: usage.provider,
    source: usage.source,
    model: usage.model,
    ...modelUsageTotals(usage),
    cacheReadInputTokens: usage.cachedTokens,
    cacheWriteInputTokens: null,
    reasoningOutputTokens: usage.thoughtTokens,
    totalTokens: usage.totalTokens,
  });
}

/** Provider output supplies a proposal, never browser identity or generations. */
export const modelProposalSchema = navigationProposalSchema;
export const modelResponseSchema = z
  .object({ proposal: z.unknown(), usage: modelUsageSchema })
  .strict();

const errorMessages = {
  INVALID_INPUT: "The model observation is invalid.",
  INVALID_OUTPUT: "The model proposal is invalid.",
  INVALID_USAGE: "The model usage report is invalid.",
  UNKNOWN_REFERENCE: "The model referenced an unknown target.",
  INELIGIBLE_REFERENCE: "The model referenced an ineligible target.",
  STALE_CONTEXT: "The model request context changed.",
  DEADLINE_EXCEEDED: "The model deadline expired.",
  CANCELLED: "The model request was cancelled.",
  THROTTLED: "The model provider is temporarily rate limited.",
  UNAVAILABLE: "The model provider is unavailable.",
  BUDGET_EXCEEDED: "The model request exceeds its budget.",
  CONFIGURATION: "The model configuration is invalid.",
  PROVIDER_ERROR: "The model provider could not complete the request.",
} as const;
export type ModelErrorCode = keyof typeof errorMessages;
export const modelErrorCodeSchema = z.enum(
  Object.keys(errorMessages) as [ModelErrorCode, ...ModelErrorCode[]],
);
export type ModelOutcome = "not-sent" | "unknown" | "reported";
export class ModelError extends Error {
  readonly code: ModelErrorCode;
  readonly outcome: ModelOutcome;
  readonly usage?: ModelUsage;
  readonly retryAfterMs?: number;
  constructor(
    code: ModelErrorCode,
    options: {
      outcome?: ModelOutcome;
      usage?: ModelUsage;
      retryAfterMs?: number;
    } = {},
  ) {
    super(errorMessages[code]);
    this.name = "ModelError";
    this.code = code;
    this.outcome = options.outcome || "not-sent";
    const usage = modelUsageSchema.safeParse(options.usage);
    if (usage.success) this.usage = usage.data;
    if (
      options.retryAfterMs !== undefined &&
      Number.isInteger(options.retryAfterMs) &&
      options.retryAfterMs >= 0 &&
      options.retryAfterMs <= 60000
    )
      this.retryAfterMs = options.retryAfterMs;
  }
}

export { awaitAbortableOperation as awaitModelOperation } from "../../../../packages/navigation-core/abort";
