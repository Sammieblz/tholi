import type { PoolClient } from "pg";
import { RepositoryError } from "./contracts";

/** Existing identity writes prune only expired ephemeral proofs, never sessions. */
export async function cleanupExpiredIdentity(
  client: Pick<PoolClient, "query">,
  now: Date,
) {
  for (const table of [
    "identity_flows",
    "identity_brokers",
    "identity_logout_events",
  ] as const)
    await client.query(
      `DELETE FROM tholi.${table} WHERE ctid IN (
      SELECT ctid FROM tholi.${table} WHERE expires_at <= $1 ORDER BY expires_at LIMIT 100
    )`,
      [now],
    );
}

/** Worker capability is narrower than the privileged identity adapter's cleanup. */
export async function pruneExpiredIdentityBrokers(
  client: Pick<PoolClient, "query">,
  batch: number,
): Promise<number> {
  if (!Number.isInteger(batch) || batch < 1 || batch > 100)
    throw new RepositoryError(
      "INVALID_INPUT",
      "Use a bounded identity cleanup batch.",
    );
  return (
    await client.query<{ count: number }>(
      "SELECT tholi.prune_expired_brokers($1) AS count",
      [batch],
    )
  ).rows[0].count;
}
