import type { NavigationModel } from "../capabilities";
import {
  ModelError,
  modelUsageV2Schema,
  type ModelErrorCode,
  type ModelUsageV2,
} from "../application/model-contracts";
import { providerRoutingPolicyDigest } from "../application/provider-connections";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  providerApiKeySchema,
  providerConnectionSelectionSchema,
  type ProviderConnectionSelection,
} from "../../../../packages/navigation-core/contracts-providers";
import { NAVIGATION_LIMITS } from "../../../../packages/navigation-core/contracts-navigation";
import {
  createModelHttp,
  checkModelHttpResponse,
  modelRecord as record,
} from "./model-http";
import {
  CUSTOMER_PROVIDER_ENDPOINTS,
  CUSTOMER_PROVIDER_COUNT_ENDPOINTS,
} from "./provider-network";
import {
  customerNavigationResponseSchema,
  navigationPrompt,
  parseCustomerNavigationDecision,
} from "./model-prompt";

export interface CustomerNavigationModelDependencies {
  withCredential<T>(
    signal: AbortSignal,
    work: (apiKey: string) => Promise<T>,
  ): Promise<T>;
  beforeSend(signal: AbortSignal, stage: "count" | "generate"): Promise<void>;
  fetch?: typeof fetch;
}
const counter = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
function nullableCounter(value: unknown) {
  return value === undefined || value === null ? null : value;
}

/** Required totals are never guessed; optional provider breakdowns remain explicitly unknown. */
function measuredUsage(
  selection: ProviderConnectionSelection,
  result: Record<string, unknown>,
): ModelUsageV2 | undefined {
  if (!record(result.usage)) return;
  const raw = result.usage;
  const common = {
    version: 2,
    provider: selection.provider,
    source: "measured",
    model: selection.model,
  };
  let value: unknown;
  if (selection.provider === "anthropic") {
    // Anthropic reports uncached, cache-write and cache-read input as disjoint quantities.
    const read = raw.cache_read_input_tokens,
      write = raw.cache_creation_input_tokens;
    if (
      !counter(raw.input_tokens) ||
      !counter(raw.output_tokens) ||
      !counter(read) ||
      !counter(write)
    )
      return;
    const inputTokens = raw.input_tokens + read + write;
    value = {
      ...common,
      inputTokens,
      outputTokens: raw.output_tokens,
      cacheReadInputTokens: read,
      cacheWriteInputTokens: write,
      reasoningOutputTokens: null,
      totalTokens: inputTokens + raw.output_tokens,
    };
  } else if (selection.provider === "openai") {
    value = {
      ...common,
      inputTokens: raw.input_tokens,
      outputTokens: raw.output_tokens,
      cacheReadInputTokens: nullableCounter(
        record(raw.input_tokens_details)
          ? raw.input_tokens_details.cached_tokens
          : undefined,
      ),
      cacheWriteInputTokens: null,
      reasoningOutputTokens: nullableCounter(
        record(raw.output_tokens_details)
          ? raw.output_tokens_details.reasoning_tokens
          : undefined,
      ),
      totalTokens: raw.total_tokens,
    };
  } else {
    value = {
      ...common,
      inputTokens: raw.prompt_tokens,
      outputTokens: raw.completion_tokens,
      cacheReadInputTokens: nullableCounter(
        record(raw.prompt_tokens_details)
          ? raw.prompt_tokens_details.cached_tokens
          : undefined,
      ),
      cacheWriteInputTokens: nullableCounter(
        record(raw.prompt_tokens_details)
          ? raw.prompt_tokens_details.cache_write_tokens
          : undefined,
      ),
      reasoningOutputTokens: nullableCounter(
        record(raw.completion_tokens_details)
          ? raw.completion_tokens_details.reasoning_tokens
          : undefined,
      ),
      totalTokens: raw.total_tokens,
    };
  }
  const parsed = modelUsageV2Schema.safeParse(value);
  return parsed.success && parsed.data.inputTokens > 0
    ? parsed.data
    : undefined;
}

function responseText(
  selection: ProviderConnectionSelection,
  result: Record<string, unknown>,
  failure: (code: ModelErrorCode) => Error,
): string {
  if (result.model !== selection.model) throw failure("INVALID_OUTPUT");
  if (selection.provider === "openai") {
    if (result.status === "incomplete") throw failure("BUDGET_EXCEEDED");
    if (
      result.status !== "completed" ||
      result.error != null ||
      !Array.isArray(result.output)
    )
      throw failure("PROVIDER_ERROR");
    const messages = result.output.filter(
      (item) => record(item) && item.type === "message",
    );
    if (
      result.output.some(
        (item) =>
          !record(item) ||
          !["message", "reasoning"].includes(String(item.type)),
      ) ||
      messages.length !== 1
    )
      throw failure("INVALID_OUTPUT");
    const message = messages[0];
    if (
      !record(message) ||
      message.role !== "assistant" ||
      message.status !== "completed" ||
      !Array.isArray(message.content) ||
      message.content.length !== 1 ||
      !record(message.content[0])
    )
      throw failure("INVALID_OUTPUT");
    const content = message.content[0];
    if (content.type === "refusal") throw failure("PROVIDER_ERROR");
    if (content.type !== "output_text" || typeof content.text !== "string")
      throw failure("INVALID_OUTPUT");
    return content.text;
  }
  if (selection.provider === "anthropic") {
    if (result.stop_reason === "max_tokens") throw failure("BUDGET_EXCEEDED");
    if (
      result.type !== "message" ||
      result.role !== "assistant" ||
      result.stop_reason !== "end_turn" ||
      !Array.isArray(result.content)
    )
      throw failure("PROVIDER_ERROR");
    const texts = result.content.filter(
      (item) => record(item) && item.type === "text",
    );
    if (
      result.content.some(
        (item) =>
          !record(item) ||
          !["text", "thinking", "redacted_thinking"].includes(
            String(item.type),
          ),
      ) ||
      texts.length !== 1 ||
      !record(texts[0]) ||
      typeof texts[0].text !== "string"
    )
      throw failure("INVALID_OUTPUT");
    return texts[0].text;
  }
  // Require a reported upstream proof as well as request-side provider restrictions.
  if (
    typeof result.provider !== "string" ||
    result.provider.toLowerCase() !== "anthropic"
  )
    throw failure("INVALID_OUTPUT");
  if (
    result.error != null ||
    !Array.isArray(result.choices) ||
    result.choices.length !== 1 ||
    !record(result.choices[0])
  )
    throw failure("PROVIDER_ERROR");
  const choice = result.choices[0];
  if (choice.finish_reason === "length") throw failure("BUDGET_EXCEEDED");
  if (
    choice.finish_reason !== "stop" ||
    !record(choice.message) ||
    choice.message.role !== "assistant" ||
    typeof choice.message.content !== "string" ||
    choice.message.tool_calls != null ||
    choice.message.function_call != null ||
    choice.message.refusal != null
  )
    throw failure("INVALID_OUTPUT");
  return choice.message.content;
}

/** One request-scoped adapter; no retries, endpoint overrides, tools, fallback or cached keys. */
export function createCustomerNavigationModel(
  raw: ProviderConnectionSelection,
  dependencies: CustomerNavigationModelDependencies,
): NavigationModel {
  const parsed = providerConnectionSelectionSchema.safeParse(raw);
  if (
    !parsed.success ||
    typeof dependencies?.withCredential !== "function" ||
    typeof dependencies.beforeSend !== "function" ||
    (dependencies.fetch !== undefined &&
      typeof dependencies.fetch !== "function")
  )
    throw new ModelError("CONFIGURATION");
  const selection = Object.freeze(parsed.data),
    definition = getProviderDefinition(selection.provider);
  if (
    selection.catalogRevision !== PROVIDER_CATALOG_REVISION ||
    selection.model !== definition.model ||
    selection.routingPolicyVersion !== definition.routingPolicyVersion ||
    selection.policyDigest !== providerRoutingPolicyDigest(selection.provider)
  )
    throw new ModelError("CONFIGURATION");
  const fetcher = dependencies.fetch ?? fetch;
  return {
    async infer(input, context) {
      let dispatched = false,
        usage: ModelUsageV2 | undefined;
      const failure = (code: ModelErrorCode, retryAfterMs?: number) =>
        new ModelError(code, {
          outcome: usage ? "reported" : dispatched ? "unknown" : "not-sent",
          usage,
          retryAfterMs,
        });
      const http = createModelHttp(context, failure),
        { signal, current, within } = http;
      let stage: "credentials" | "count" | "generate" = "credentials";
      try {
        const prompt = navigationPrompt(input, failure),
          { budget, observation } = prompt;
        const system =
          prompt.systemInstruction.parts[0].text +
          " The output is an object with a single decision property matching the supplied schema.";
        const imageUrl = (image: (typeof observation.images)[number]) =>
          `data:image/png;base64,${image.image}`;
        const schema = customerNavigationResponseSchema;
        let body: Record<string, unknown>,
          countBody: Record<string, unknown> | undefined;
        if (definition.provider === "openai") {
          const shared = {
            model: definition.model,
            instructions: system,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt.text },
                  ...observation.images.map((image) => ({
                    type: "input_image",
                    image_url: imageUrl(image),
                    detail: "high",
                  })),
                ],
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "navigation_decision",
                strict: true,
                schema,
              },
            },
          };
          body = {
            ...shared,
            stream: definition.requestPolicy.stream,
            store: definition.requestPolicy.store,
            reasoning: definition.requestPolicy.reasoning,
            max_output_tokens: budget.maxOutputTokens,
          };
          countBody = shared;
        } else if (definition.provider === "anthropic") {
          const shared = {
            model: definition.model,
            system,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt.text },
                  ...observation.images.map((image) => ({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: image.image,
                    },
                  })),
                ],
              },
            ],
            thinking: definition.requestPolicy.thinking,
            output_config: {
              effort: definition.requestPolicy.effort,
              format: { type: "json_schema", schema },
            },
          };
          body = {
            ...shared,
            stream: definition.requestPolicy.stream,
            max_tokens: budget.maxOutputTokens,
          };
          countBody = shared;
        } else {
          body = {
            model: definition.model,
            stream: definition.requestPolicy.stream,
            n: definition.requestPolicy.n,
            reasoning: definition.requestPolicy.reasoning,
            provider: definition.requestPolicy.provider,
            max_tokens: budget.maxOutputTokens,
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: [
                  { type: "text", text: prompt.text },
                  ...observation.images.map((image) => ({
                    type: "image_url",
                    image_url: { url: imageUrl(image) },
                  })),
                ],
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "navigation_decision",
                strict: true,
                schema,
              },
            },
          };
          // This fixed Anthropic-only profile has no router count endpoint. Reserve a
          // deliberately conservative local ceiling, not guessed measured usage:
          // one token per UTF-8 text/schema byte, 4096 framing, 16384 per image.
          const ceiling =
            Buffer.byteLength(
              JSON.stringify({ system, content: prompt.content, schema }),
            ) +
            4096 +
            observation.images.length * 16384;
          if (ceiling > budget.maxInputTokens) throw failure("BUDGET_EXCEEDED");
        }
        const serialized = JSON.stringify(body),
          serializedCount = countBody ? JSON.stringify(countBody) : undefined;
        if (
          Buffer.byteLength(serialized) > NAVIGATION_LIMITS.maxEnvelopeBytes ||
          (serializedCount &&
            Buffer.byteLength(serializedCount) >
              NAVIGATION_LIMITS.maxEnvelopeBytes)
        )
          throw failure("BUDGET_EXCEEDED");
        const post = async (phase: "count" | "generate", payload: string) => {
          stage = "credentials";
          return within(() =>
            dependencies.withCredential(signal, async (rawKey) => {
              const key = providerApiKeySchema.safeParse(rawKey);
              if (!key.success) throw failure("CONFIGURATION");
              await within(() => dependencies.beforeSend(signal, phase));
              current();
              stage = phase;
              const endpoint =
                phase === "generate"
                  ? CUSTOMER_PROVIDER_ENDPOINTS[selection.provider]
                  : CUSTOMER_PROVIDER_COUNT_ENDPOINTS[
                      selection.provider as "openai" | "anthropic"
                    ];
              const response = await within(() => {
                current();
                if (phase === "generate") dispatched = true;
                return fetcher(endpoint, {
                  method: "POST",
                  redirect: "error",
                  credentials: "omit",
                  signal,
                  headers:
                    selection.provider === "anthropic"
                      ? {
                          "Content-Type": "application/json",
                          "x-api-key": key.data,
                          "anthropic-version":
                            getProviderDefinition("anthropic").requestPolicy
                              .anthropicVersion,
                        }
                      : {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${key.data}`,
                        },
                  body: payload,
                });
              });
              checkModelHttpResponse(response, failure);
              const result = await http.json(response, budget.maxResponseBytes);
              if (phase === "generate" && record(result))
                usage = measuredUsage(selection, result);
              return result;
            }),
          );
        };
        if (serializedCount) {
          const count = await post("count", serializedCount);
          if (
            !record(count) ||
            !counter(count.input_tokens) ||
            count.input_tokens <= 0
          )
            throw failure("INVALID_USAGE");
          if (count.input_tokens > budget.maxInputTokens)
            throw failure("BUDGET_EXCEEDED");
        }
        const result = await post("generate", serialized);
        if (!record(result)) throw failure("INVALID_OUTPUT");
        // Capture charge evidence before finish, identity, content and response proof.
        usage = measuredUsage(selection, result);
        if (!usage) throw failure("INVALID_USAGE");
        if (
          usage.inputTokens > budget.maxInputTokens ||
          usage.outputTokens > budget.maxOutputTokens
        )
          throw failure("BUDGET_EXCEEDED");
        const text = responseText(selection, result, failure);
        let proposal: unknown;
        try {
          proposal = parseCustomerNavigationDecision(text);
        } catch {
          throw failure("INVALID_OUTPUT");
        }
        current();
        return { proposal, usage };
      } catch (error) {
        current();
        if (error instanceof ModelError)
          throw failure(error.code, error.retryAfterMs);
        throw failure(
          stage === "credentials" ? "CONFIGURATION" : "UNAVAILABLE",
        );
      } finally {
        http.close();
      }
    },
  };
}
