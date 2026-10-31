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
export const modelUsageSchema = z
  .object({
    provider: z.enum(["fake", "vertex"]),
    source: z.enum(["fake", "measured"]),
    model: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
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
export type ModelUsage = z.infer<typeof modelUsageSchema>;

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
