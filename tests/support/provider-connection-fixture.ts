import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  providerConnectionSchema,
  type ProviderConnection,
  type ProviderId,
} from "../../packages/navigation-core/contracts-providers";

/** Public metadata only. Browser and component fixtures never invent a readable key DTO. */
export function providerConnectionMetadataFixture(
  provider: ProviderId = "openai",
  overrides: Partial<ProviderConnection> = {},
): ProviderConnection {
  const definition = getProviderDefinition(provider);
  const number = { openai: "1", anthropic: "2", openrouter: "3" }[provider];
  return providerConnectionSchema.parse({
    id: `00000000-0000-4000-8000-00000000007${number}`,
    provider,
    model: definition.model,
    catalogRevision: PROVIDER_CATALOG_REVISION,
    routingPolicyVersion: definition.routingPolicyVersion,
    policyDigest: "a".repeat(64),
    status: "active",
    revision: "1",
    createdAt: "2026-11-05T12:00:00.000Z",
    updatedAt: "2026-11-05T12:00:00.000Z",
    verifiedAt: null,
    ...overrides,
  });
}
