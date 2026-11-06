import { randomUUID } from "node:crypto";
import {
  ProviderConnectionService,
  type ProviderConnectionStore,
  type ProviderConnectionRecord,
} from "../../apps/api/src/application/provider-connections";
import { createProviderSecretCipher } from "../../apps/api/src/adapters/provider-secrets";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
} from "../../packages/navigation-core/contracts-providers";
import { RepositoryError } from "../../apps/api/src/database/contracts";

/** Shared Node-only in-memory persistence for domain and authenticated HTTP contracts. */
export const providerTestKeyring = {
  version: 1 as const,
  activeVersion: "test-v1",
  keys: { "test-v1": Buffer.alloc(32, 81).toString("base64url") },
};
export const providerTestContext = () => ({
  requestId: randomUUID(),
  deadlineAt: Date.now() + 10000,
  signal: new AbortController().signal,
});
export function providerConnectionStoreFixture(accountId = randomUUID()) {
  const principal = { accountId },
    records = new Map<string, ProviderConnectionRecord>();
  const conflict = () => {
    throw new RepositoryError("CONFLICT", "Changed.");
  };
  const store: ProviderConnectionStore = {
    async list(accountId) {
      return [...records.values()]
        .filter((row) => row.accountId === accountId)
        .map((row) => ({ ...row }));
    },
    async read(accountId, id) {
      const row = records.get(id);
      return row?.accountId === accountId ? structuredClone(row) : undefined;
    },
    async create(accountId, record) {
      if (
        [...records.values()].some(
          (row) =>
            row.accountId === accountId && row.provider === record.provider,
        )
      )
        return conflict();
      const now = new Date().toISOString();
      const row = {
        ...record,
        createdAt: now,
        updatedAt: now,
        verifiedAt: null,
      };
      records.set(row.id, row);
      return { ...row };
    },
    async replace(accountId, record, expectedRevision) {
      const prior = records.get(record.id);
      if (
        !prior ||
        prior.accountId !== accountId ||
        prior.revision !== expectedRevision
      )
        return conflict();
      const row = {
        ...record,
        createdAt: prior.createdAt,
        updatedAt: new Date().toISOString(),
        verifiedAt: null,
      };
      records.set(row.id, row);
      return { ...row };
    },
    async remove(accountId, id, expectedRevision) {
      const prior = records.get(id);
      if (
        !prior ||
        prior.accountId !== accountId ||
        prior.revision !== expectedRevision
      )
        return conflict();
      if (prior.status !== "removed")
        records.set(id, {
          ...prior,
          sealedKey: null,
          status: "removed",
          revision: String(BigInt(prior.revision) + 1n),
          verifiedAt: null,
        });
      return { ...records.get(id)! };
    },
    async markVerified(accountId, id, revision, digest) {
      const prior = records.get(id);
      if (
        !prior ||
        prior.accountId !== accountId ||
        prior.revision !== revision ||
        prior.policyDigest !== digest ||
        prior.status !== "active"
      )
        return false;
      prior.verifiedAt = new Date().toISOString();
      return true;
    },
  };
  const cipher = createProviderSecretCipher(providerTestKeyring),
    service = new ProviderConnectionService(store, cipher);
  const create = () =>
    service.create(
      principal,
      {
        provider: "openai",
        model: getProviderDefinition("openai").model,
        catalogRevision: PROVIDER_CATALOG_REVISION,
        apiKey: "synthetic-provider-key",
      },
      providerTestContext(),
    );
  return { principal, records, store, cipher, service, create };
}
