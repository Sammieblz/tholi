import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  providerConnectionSchema,
  PROVIDER_CONNECTION_LIMITS,
  type ProviderConnection,
} from "../../../../packages/navigation-core/contracts-providers";
import { serviceRevisionSchema } from "../../../../packages/navigation-core/contracts-service";
import {
  ProviderSecretError,
  sealedProviderSecretSchema,
  type ProviderConnectionRecord,
  type ProviderConnectionStore,
  type ProviderConnectionWrite,
} from "../application/provider-connections";
import { RepositoryError } from "./contracts";
import { withTransaction } from "./postgres";

const identifier = z.string().uuid();
const writeSchema = providerConnectionSchema
  .omit({ createdAt: true, updatedAt: true, verifiedAt: true })
  .extend({
    accountId: identifier,
    sealedKey: sealedProviderSecretSchema,
    status: z.literal("active"),
  })
  .strict();
export const providerConnectionMetadataColumns = `id,provider,model_id AS "model",catalog_revision AS "catalogRevision",
  routing_policy_version AS "routingPolicyVersion",encode(policy_digest,'hex') AS "policyDigest",status,
  revision::text,created_at AS "createdAt",updated_at AS "updatedAt",verified_at AS "verifiedAt"`;
export type ProviderConnectionMetadataRow = Omit<
  ProviderConnection,
  "createdAt" | "updatedAt" | "verifiedAt"
> & {
  createdAt: Date | string;
  updatedAt: Date | string;
  verifiedAt: Date | string | null;
};
type CredentialRow = ProviderConnectionMetadataRow & {
  accountId: string;
  sealedKey: unknown;
};
const instant = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : value;
/** This projection is also the only provider-connection account-export view. */
export function providerConnectionMetadataRow(
  row: ProviderConnectionMetadataRow,
): ProviderConnection {
  return providerConnectionSchema.parse({
    id: row.id,
    provider: row.provider,
    model: row.model,
    catalogRevision: row.catalogRevision,
    routingPolicyVersion: row.routingPolicyVersion,
    policyDigest: row.policyDigest,
    status: row.status,
    revision: row.revision,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    verifiedAt: row.verifiedAt === null ? null : instant(row.verifiedAt),
  });
}
const changed = () =>
  new RepositoryError(
    "CONFLICT",
    "The provider connection is unavailable or has changed.",
  );

/** Same application pool and transaction-local account scope, never a second store. */
export class PostgresProviderConnections implements ProviderConnectionStore {
  constructor(private readonly pool: Pool) {}

  private async scoped<T>(
    accountId: string,
    signal: AbortSignal,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    identifier.parse(accountId);
    signal.throwIfAborted();
    try {
      return await withTransaction(
        this.pool,
        async (client) => {
          signal.throwIfAborted();
          // All credential operations lock the account before a connection, matching
          // account deletion and inference dispatch. No network work occurs here.
          const account = await client.query(
            "SELECT id FROM tholi.accounts WHERE id=$1 AND status='active' FOR SHARE",
            [accountId],
          );
          if (!account.rowCount)
            throw new RepositoryError(
              "FORBIDDEN",
              "The account is unavailable.",
            );
          const result = await work(client);
          signal.throwIfAborted();
          return result;
        },
        { accountId },
      );
    } catch (error) {
      if (
        error instanceof RepositoryError ||
        error instanceof ProviderSecretError ||
        signal.aborted
      )
        throw error;
      const code = (error as { code?: unknown })?.code;
      if (code === "42501")
        throw new RepositoryError("FORBIDDEN", "The account is unavailable.");
      if (code === "23505" || code === "22003" || code === "40001")
        throw changed();
      if (code === "23514" || code === "22023")
        throw new RepositoryError(
          "INVALID_INPUT",
          "The provider connection is invalid.",
        );
      // Driver errors can contain submitted ciphertext and must remain private.
      throw new ProviderSecretError();
    }
  }
  list(accountId: string, signal: AbortSignal) {
    return this.scoped(accountId, signal, async (client) => {
      const result = await client.query<ProviderConnectionMetadataRow>(
        `SELECT ${providerConnectionMetadataColumns} FROM tholi.provider_connections WHERE account_id=$1 ORDER BY provider LIMIT $2`,
        [accountId, PROVIDER_CONNECTION_LIMITS.connections],
      );
      return result.rows.map(providerConnectionMetadataRow);
    });
  }
  read(accountId: string, connectionId: string, signal: AbortSignal) {
    identifier.parse(connectionId);
    return this.scoped(accountId, signal, async (client) => {
      const result = await client.query<CredentialRow>(
        `SELECT ${providerConnectionMetadataColumns},account_id AS "accountId",sealed_key AS "sealedKey"
          FROM tholi.provider_connections WHERE account_id=$1 AND id=$2`,
        [accountId, connectionId],
      );
      const row = result.rows[0];
      if (!row) return;
      return {
        ...providerConnectionMetadataRow(row),
        accountId: row.accountId,
        sealedKey:
          row.sealedKey === null
            ? null
            : sealedProviderSecretSchema.parse(row.sealedKey),
      } satisfies ProviderConnectionRecord;
    });
  }
  create(accountId: string, raw: ProviderConnectionWrite, signal: AbortSignal) {
    const input = writeSchema.parse(raw);
    if (input.accountId !== accountId || input.revision !== "1")
      throw new RepositoryError(
        "INVALID_INPUT",
        "The provider connection is invalid.",
      );
    return this.scoped(accountId, signal, async (client) => {
      const result = await client.query<ProviderConnectionMetadataRow>(
        `INSERT INTO tholi.provider_connections(id,account_id,provider,model_id,catalog_revision,routing_policy_version,policy_digest,sealed_key)
         VALUES($1,$2,$3,$4,$5,$6,decode($7,'hex'),$8::jsonb) RETURNING ${providerConnectionMetadataColumns}`,
        [
          input.id,
          accountId,
          input.provider,
          input.model,
          input.catalogRevision,
          input.routingPolicyVersion,
          input.policyDigest,
          JSON.stringify(input.sealedKey),
        ],
      );
      if (!result.rows[0]) throw changed();
      return providerConnectionMetadataRow(result.rows[0]);
    });
  }
  replace(
    accountId: string,
    raw: ProviderConnectionWrite,
    expectedRevision: string,
    signal: AbortSignal,
  ) {
    const input = writeSchema.parse(raw);
    serviceRevisionSchema.parse(expectedRevision);
    if (
      input.accountId !== accountId ||
      BigInt(input.revision) !== BigInt(expectedRevision) + 1n
    )
      throw new RepositoryError(
        "INVALID_INPUT",
        "The provider connection is invalid.",
      );
    return this.scoped(accountId, signal, async (client) => {
      const result = await client.query<ProviderConnectionMetadataRow>(
        `UPDATE tholi.provider_connections SET model_id=$4,catalog_revision=$5,routing_policy_version=$6,policy_digest=decode($7,'hex'),
          sealed_key=$8::jsonb,status='active',revision=revision+1,verified_at=NULL,updated_at=clock_timestamp()
         WHERE account_id=$1 AND id=$2 AND revision=$3 AND provider=$9 RETURNING ${providerConnectionMetadataColumns}`,
        [
          accountId,
          input.id,
          expectedRevision,
          input.model,
          input.catalogRevision,
          input.routingPolicyVersion,
          input.policyDigest,
          JSON.stringify(input.sealedKey),
          input.provider,
        ],
      );
      if (!result.rows[0]) throw changed();
      return providerConnectionMetadataRow(result.rows[0]);
    });
  }
  remove(
    accountId: string,
    connectionId: string,
    expectedRevision: string,
    signal: AbortSignal,
  ) {
    identifier.parse(connectionId);
    serviceRevisionSchema.parse(expectedRevision);
    return this.scoped(accountId, signal, async (client) => {
      const current = await client.query<ProviderConnectionMetadataRow>(
        `SELECT ${providerConnectionMetadataColumns} FROM tholi.provider_connections WHERE account_id=$1 AND id=$2 FOR UPDATE`,
        [accountId, connectionId],
      );
      if (!current.rows[0] || current.rows[0].revision !== expectedRevision)
        throw changed();
      if (current.rows[0].status === "removed")
        return providerConnectionMetadataRow(current.rows[0]);
      const result = await client.query<ProviderConnectionMetadataRow>(
        `UPDATE tholi.provider_connections SET sealed_key=NULL,status='removed',revision=revision+1,verified_at=NULL,updated_at=clock_timestamp()
         WHERE account_id=$1 AND id=$2 AND revision=$3 RETURNING ${providerConnectionMetadataColumns}`,
        [accountId, connectionId, expectedRevision],
      );
      if (!result.rows[0]) throw changed();
      return providerConnectionMetadataRow(result.rows[0]);
    });
  }
  markVerified(
    accountId: string,
    connectionId: string,
    expectedRevision: string,
    policyDigest: string,
    signal: AbortSignal,
  ) {
    identifier.parse(connectionId);
    serviceRevisionSchema.parse(expectedRevision);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(policyDigest);
    return this.scoped(accountId, signal, async (client) => {
      const result = await client.query<{ verified: boolean }>(
        "SELECT tholi.mark_provider_connection_verified($1,$2,decode($3,'hex')) AS verified",
        [connectionId, expectedRevision, policyDigest],
      );
      return result.rows[0]?.verified === true;
    });
  }
}
