import type { PoolClient } from "pg";
import { z } from "zod";
import type {
  IdentityContact,
  IdentityContactQuery,
} from "../application/identity-contracts";

const querySchema = z
  .object({
    after: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(100),
    identityId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (query) => !query.after || !query.identityId,
    "Select an exact contact or a page.",
  );

/** Caller retains one authorized SQL transaction; this projection grants no identity authority. */
export async function readIdentityContactsOnClient(
  client: Pick<PoolClient, "query">,
  accountId: string,
  raw: IdentityContactQuery = {},
): Promise<IdentityContact[]> {
  z.string().uuid().parse(accountId);
  const query = querySchema.parse(raw);
  const result = await client.query<IdentityContact>(
    `SELECT identity_id AS "identityId",email AS "verifiedEmail" FROM tholi.identity_delivery_contacts
     WHERE account_id=$1 AND ($2::uuid IS NULL OR identity_id=$2) AND ($3::uuid IS NULL OR identity_id>$3)
     ORDER BY identity_id LIMIT $4`,
    [accountId, query.identityId ?? null, query.after ?? null, query.limit],
  );
  return result.rows;
}
