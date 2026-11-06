import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  providerConnectionSelection,
  type ProviderId,
} from "../../../packages/navigation-core/contracts-providers";
import { ProviderConnectionService } from "../../../apps/api/src/application/provider-connections";
import { PostgresProviderConnections } from "../../../apps/api/src/database/provider-connections";
import { createProviderSecretCipher } from "../../../apps/api/src/adapters/provider-secrets";

/** Synthetic secret, real crypto/SQL boundaries; this fixture makes no model call. */
export async function providerConnectionFixture(
  runtime: Pool,
  accountId: string,
  provider: ProviderId = "openai",
) {
  const service = new ProviderConnectionService(
    new PostgresProviderConnections(runtime),
    createProviderSecretCipher({
      version: 1,
      activeVersion: "synthetic-v1",
      keys: { "synthetic-v1": Buffer.alloc(32, 81).toString("base64url") },
    }),
  );
  const context = {
    requestId: randomUUID(),
    deadlineAt: Date.now() + 25000,
    signal: new AbortController().signal,
  };
  const connection = await service.create(
    { accountId },
    {
      provider,
      model: getProviderDefinition(provider).model,
      catalogRevision: PROVIDER_CATALOG_REVISION,
      apiKey: "synthetic-provider-fixture-key",
    },
    context,
  );
  return {
    service,
    connection,
    selection: providerConnectionSelection(connection),
    context,
  };
}
