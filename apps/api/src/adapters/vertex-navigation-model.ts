import { z } from "zod";
import { createHash } from "node:crypto";
import type { NavigationModel, ServiceRequestContext } from "../capabilities";
import {
  ModelError,
  modelProposalSchema,
  modelUsageSchema,
  modelUsageTotals,
  type ModelErrorCode,
  type ModelUsage,
} from "../application/model-contracts";
import { NAVIGATION_LIMITS } from "../../../../packages/navigation-core/contracts-navigation";
import {
  createModelHttp,
  checkModelHttpResponse,
  modelRecord as record,
} from "./model-http";
import {
  navigationPrompt,
  navigationPromptProvenance,
  navigationProposalProviderSchema as proposalSchema,
} from "./model-prompt";

const optionsSchema = z
  .object({
    api: z.literal("v1"),
    project: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
    location: z.enum(["global", "us", "eu"]),
    model: z.literal("gemini-3.8-flash"),
    retentionProfile: z.literal("provider-default-acknowledged"),
  })
  .strict();
export type VertexModelOptions = z.infer<typeof optionsSchema>;
export function validateVertexModelOptions(input: unknown): VertexModelOptions {
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) throw new ModelError("CONFIGURATION");
  return parsed.data;
}
export interface VertexModelDependencies {
  accessToken(signal: AbortSignal): Promise<string>;
  beforeSend(
    signal: AbortSignal,
    phase: "count" | "generate",
    requestSha256: string,
  ): Promise<void>;
  authorizeGeneration(
    signal: AbortSignal,
    budget: { inputTokens: number; maxOutputTokens: number },
  ): Promise<void>;
  fetch?: typeof fetch;
}
const hosts = {
  global: "https://aiplatform.googleapis.com",
  us: "https://aiplatform.us.rep.googleapis.com",
  eu: "https://aiplatform.eu.rep.googleapis.com",
} as const;
/** Preserves the original source-owned Vertex prompt/proposal provenance. */
export const vertexNavigationProvenance = navigationPromptProvenance;

/** One explicit v1 REST adapter. Composition owns ADC and experiment permits. */
export function createVertexNavigationModel(
  input: VertexModelOptions,
  dependencies: VertexModelDependencies,
): NavigationModel {
  const options = Object.freeze(validateVertexModelOptions(input));
  if (
    typeof dependencies?.accessToken !== "function" ||
    typeof dependencies.beforeSend !== "function" ||
    typeof dependencies.authorizeGeneration !== "function" ||
    (dependencies.fetch !== undefined &&
      typeof dependencies.fetch !== "function")
  )
    throw new ModelError("CONFIGURATION");
  const fetcher = dependencies.fetch || fetch;
  const resource = `projects/${options.project}/locations/${options.location}/publishers/google/models/${options.model}`;
  const endpoint = `${hosts[options.location]}/${options.api}/${resource}`;
  return {
    async infer(input, context: ServiceRequestContext) {
      let dispatched = false,
        usage: ModelUsage | undefined;
      const failure = (code: ModelErrorCode, retryAfterMs?: number) =>
        new ModelError(code, {
          outcome: usage ? "reported" : dispatched ? "unknown" : "not-sent",
          usage,
          retryAfterMs,
        });
      const http = createModelHttp(context, failure);
      const { signal, current, within } = http;
      let stage: "credentials" | "count" | "authorization" | "generation" =
        "credentials";
      try {
        const prompt = navigationPrompt(input, failure);
        const { observation, systemInstruction } = prompt;
        const budget = { data: prompt.budget };
        const body = {
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt.text },
                ...observation.images.map((image) => ({
                  inlineData: { mimeType: "image/png", data: image.image },
                })),
              ],
            },
          ],
          systemInstruction,
          generationConfig: {
            candidateCount: 1,
            maxOutputTokens: budget.data.maxOutputTokens,
            thinkingConfig: { thinkingLevel: "LOW" },
            // Google v1 REST Discovery: legacy responseSchema fields are deprecated.
            responseFormat: [
              {
                text: { mimeType: "APPLICATION_JSON", schema: proposalSchema },
              },
            ],
          },
        };
        const generateBody = JSON.stringify(body),
          countBody = JSON.stringify({ model: resource, ...body });
        if (
          Buffer.byteLength(generateBody) >
            NAVIGATION_LIMITS.maxEnvelopeBytes ||
          Buffer.byteLength(countBody) > NAVIGATION_LIMITS.maxEnvelopeBytes
        )
          throw failure("BUDGET_EXCEEDED");
        const credentials = async () => {
          stage = "credentials";
          const token = await within(() => dependencies.accessToken(signal));
          if (
            typeof token !== "string" ||
            token.length > 8192 ||
            !/^[A-Za-z0-9._~+/-]+=*$/.test(token)
          )
            throw failure("CONFIGURATION");
          return token;
        };
        const post = async (
          method: "countTokens" | "generateContent",
          requestBody: string,
          token: string,
        ) => {
          await within(() =>
            dependencies.beforeSend(
              signal,
              method === "countTokens" ? "count" : "generate",
              createHash("sha256").update(requestBody).digest("hex"),
            ),
          );
          current();
          const response = await within(() => {
            current();
            if (method === "generateContent") dispatched = true;
            return fetcher(`${endpoint}:${method}`, {
              method: "POST",
              redirect: "error",
              credentials: "omit",
              signal,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "x-goog-user-project": options.project,
              },
              body: requestBody,
            });
          });
          checkModelHttpResponse(response, failure);
          return http.json(response, budget.data.maxResponseBytes);
        };
        const firstToken = await credentials();
        stage = "count";
        const count = await post("countTokens", countBody, firstToken);
        if (
          !record(count) ||
          !Number.isSafeInteger(count.totalTokens) ||
          (count.totalTokens as number) <= 0
        )
          throw failure("INVALID_USAGE");
        if ((count.totalTokens as number) > budget.data.maxInputTokens)
          throw failure("BUDGET_EXCEEDED");
        stage = "authorization";
        await within(() =>
          dependencies.authorizeGeneration(signal, {
            inputTokens: count.totalTokens as number,
            maxOutputTokens: budget.data.maxOutputTokens,
          }),
        );
        const token = await credentials();
        current();
        stage = "generation";
        const result = await post("generateContent", generateBody, token);
        if (!record(result)) throw failure("INVALID_OUTPUT");
        const reported = result.usageMetadata;
        if (record(reported)) {
          if (
            result.modelVersion !== undefined &&
            result.modelVersion !== options.model
          )
            throw failure("INVALID_USAGE");
          const parsed = modelUsageSchema.safeParse({
            provider: "vertex",
            source: "measured",
            model: options.model,
            promptTokens: reported.promptTokenCount,
            outputTokens: reported.candidatesTokenCount ?? 0,
            thoughtTokens: reported.thoughtsTokenCount ?? 0,
            cachedTokens: reported.cachedContentTokenCount ?? 0,
            totalTokens: reported.totalTokenCount,
          });
          if (
            !parsed.success ||
            (reported.toolUsePromptTokenCount !== undefined &&
              reported.toolUsePromptTokenCount !== 0) ||
            modelUsageTotals(parsed.data).inputTokens === 0
          )
            throw failure("INVALID_USAGE");
          usage = parsed.data;
        }
        if (
          record(result.promptFeedback) &&
          result.promptFeedback.blockReason &&
          result.promptFeedback.blockReason !== "BLOCKED_REASON_UNSPECIFIED"
        )
          throw failure("PROVIDER_ERROR");
        if (
          !Array.isArray(result.candidates) ||
          result.candidates.length !== 1 ||
          !record(result.candidates[0])
        )
          throw failure("INVALID_OUTPUT");
        const candidate = result.candidates[0];
        if (candidate.finishReason === "MAX_TOKENS")
          throw failure("BUDGET_EXCEEDED");
        if (
          candidate.finishReason !== "STOP" ||
          (Array.isArray(candidate.safetyRatings) &&
            candidate.safetyRatings.some(
              (rating) => record(rating) && rating.blocked === true,
            ))
        )
          throw failure("PROVIDER_ERROR");
        if (!usage) throw failure("INVALID_USAGE");
        if (
          modelUsageTotals(usage).inputTokens > budget.data.maxInputTokens ||
          modelUsageTotals(usage).outputTokens > budget.data.maxOutputTokens
        )
          throw failure("BUDGET_EXCEEDED");
        if (
          !record(candidate.content) ||
          !Array.isArray(candidate.content.parts) ||
          !candidate.content.parts.length
        )
          throw failure("INVALID_OUTPUT");
        const texts: string[] = [];
        for (const part of candidate.content.parts) {
          if (
            !record(part) ||
            typeof part.text !== "string" ||
            part.thought === true ||
            Object.keys(part).some(
              (key) => !["text", "thought", "thoughtSignature"].includes(key),
            )
          )
            throw failure("INVALID_OUTPUT");
          texts.push(part.text);
        }
        let proposal: unknown;
        try {
          proposal = JSON.parse(texts.join(""));
        } catch {
          throw failure("INVALID_OUTPUT");
        }
        const parsed = modelProposalSchema.safeParse(proposal);
        if (!parsed.success) throw failure("INVALID_OUTPUT");
        current();
        return { proposal: parsed.data, usage };
      } catch (error) {
        current();
        if (error instanceof ModelError)
          throw failure(error.code, error.retryAfterMs);
        throw failure(
          stage === "credentials"
            ? "CONFIGURATION"
            : stage === "authorization"
              ? "PROVIDER_ERROR"
              : "UNAVAILABLE",
        );
      } finally {
        http.close();
      }
    },
  };
}
