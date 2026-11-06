import { z } from "zod";
import { serviceRevisionSchema } from "./contracts-service";

export const PROVIDER_CATALOG_REVISION = "byok-catalog-v1";
export const PROVIDER_CONNECTION_LIMITS = Object.freeze({
  connections: 3,
  maxKeyBytes: 8192,
  maxBodyBytes: 16 * 1024,
});
export const providerIdSchema = z.enum(["openai", "anthropic", "openrouter"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Frozen versioned definitions may be referenced by immutable policy migrations. */
export const PROVIDER_CATALOG_V1 = Object.freeze({
  openai: Object.freeze({
    provider: "openai",
    label: "OpenAI",
    model: "gpt-5.6-terra",
    transport: "responses",
    routingPolicyVersion: "openai-direct-v1",
    upstream: "openai",
    images: true,
    structuredOutput: true,
    requestPolicy: Object.freeze({
      stream: false,
      store: false,
      reasoning: Object.freeze({ effort: "low" }),
      responseSchemaVersion: "navigation-proposal-v1",
      automaticRetries: 0,
    }),
  } as const),
  anthropic: Object.freeze({
    provider: "anthropic",
    label: "Anthropic",
    model: "claude-sonnet-5-5",
    transport: "messages",
    routingPolicyVersion: "anthropic-direct-v1",
    upstream: "anthropic",
    images: true,
    structuredOutput: true,
    requestPolicy: Object.freeze({
      stream: false,
      anthropicVersion: "2023-06-01",
      thinking: Object.freeze({ type: "adaptive" }),
      effort: "low",
      responseSchemaVersion: "navigation-proposal-v1",
      automaticRetries: 0,
    }),
  } as const),
  openrouter: Object.freeze({
    provider: "openrouter",
    label: "OpenRouter",
    model: "anthropic/claude-sonnet-5.5",
    transport: "chat-completions",
    routingPolicyVersion: "openrouter-anthropic-v1",
    upstream: "anthropic",
    images: true,
    structuredOutput: true,
    requestPolicy: Object.freeze({
      stream: false,
      n: 1,
      reasoning: Object.freeze({ effort: "low" }),
      provider: Object.freeze({
        only: Object.freeze(["anthropic"]),
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
      }),
      responseSchemaVersion: "navigation-proposal-v1",
      automaticRetries: 0,
    }),
  } as const),
});
export type ProviderDefinition =
  (typeof PROVIDER_CATALOG_V1)[keyof typeof PROVIDER_CATALOG_V1];
export function getProviderDefinition<P extends ProviderId>(
  provider: P,
): (typeof PROVIDER_CATALOG_V1)[P] {
  providerIdSchema.parse(provider);
  return PROVIDER_CATALOG_V1[provider];
}

const identifier = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const version = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const model = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Stored/enabled does not assert that a provider accepted or verified the key. */
export const providerConnectionSchema = z
  .object({
    id: identifier,
    provider: providerIdSchema,
    model,
    catalogRevision: version,
    routingPolicyVersion: version,
    policyDigest: digest,
    status: z.enum(["active", "disabled", "removed"]),
    revision: serviceRevisionSchema,
    createdAt: instant,
    updatedAt: instant,
    verifiedAt: instant.nullable(),
  })
  .strict();
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export const providerConnectionsSchema = z
  .object({
    catalogRevision: version,
    items: z
      .array(providerConnectionSchema)
      .max(PROVIDER_CONNECTION_LIMITS.connections),
  })
  .strict();

/** Secret input is deliberately absent from every metadata/read/export schema. */
export const providerApiKeySchema = z
  .string()
  .min(1)
  .max(PROVIDER_CONNECTION_LIMITS.maxKeyBytes)
  .regex(/^[\x21-\x7e]+$/);
export const providerConnectionCreateSchema = z
  .object({
    provider: providerIdSchema,
    apiKey: providerApiKeySchema,
    model,
    catalogRevision: version,
  })
  .strict();
export const providerConnectionReplaceSchema = z
  .object({
    expectedRevision: serviceRevisionSchema,
    apiKey: providerApiKeySchema.optional(),
    model,
    catalogRevision: version,
  })
  .strict();
export const providerConnectionRemoveSchema = z
  .object({
    expectedRevision: serviceRevisionSchema,
  })
  .strict();
export const providerConnectionParamsSchema = z
  .object({ connectionId: identifier })
  .strict();

/** A selector is a hint. Current server account and connection proof grant access. */
export const providerConnectionSelectionSchema = z
  .object({
    connectionId: identifier,
    provider: providerIdSchema,
    model,
    catalogRevision: version,
    routingPolicyVersion: version,
    policyDigest: digest,
    revision: serviceRevisionSchema,
  })
  .strict();
export type ProviderConnectionSelection = z.infer<
  typeof providerConnectionSelectionSchema
>;
export function providerConnectionSelection(
  connection: ProviderConnection,
): ProviderConnectionSelection {
  const value = providerConnectionSchema.parse(connection);
  return providerConnectionSelectionSchema.parse({
    connectionId: value.id,
    provider: value.provider,
    model: value.model,
    catalogRevision: value.catalogRevision,
    routingPolicyVersion: value.routingPolicyVersion,
    policyDigest: value.policyDigest,
    revision: value.revision,
  });
}
