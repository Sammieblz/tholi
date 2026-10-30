import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  IDENTITY_CLOCK_TOLERANCE_SECONDS,
  type IdentityAccount,
  type IdentityBroker,
  type IdentityFlow,
  type IdentitySession,
  type IdentityStore,
  type ProviderIdentity,
  type RefreshResult,
} from "../application/identity-contracts";
import { RepositoryError } from "./contracts";
import { setDatabaseScope, withTransaction } from "./postgres";
import { provisionAccountOnClient } from "./repositories";
import { cleanupExpiredIdentity as cleanup } from "./identity-retention";

export class IdentityStoreError extends Error {
  readonly code = "IDENTITY_REVOKED";
  constructor() {
    super("The identity or session is unavailable.");
    this.name = "IdentityStoreError";
  }
}

function hash(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new RepositoryError(
      "INVALID_INPUT",
      "Use a SHA-256 credential hash.",
    );
  return Buffer.from(value, "hex");
}

function date(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new RepositoryError("INVALID_INPUT", "Use a valid timestamp.");
  return new Date(value.getTime());
}

// Serializes provider grants and logout markers, including logout concurrent
// with the first ever identity link. Ordinary authenticated traffic and refresh
// do not take this lock. No provider network operation runs in a transaction.
async function lockIssuer(client: PoolClient, issuer: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 30))", [
    issuer,
  ]);
}

async function lockAccount(client: PoolClient, accountId: string) {
  const result = await client.query<{ status: string }>(
    "SELECT status FROM tholi.accounts WHERE id = $1 FOR UPDATE",
    [accountId],
  );
  return result.rows[0]?.status === "active";
}

async function requireGrant(
  client: PoolClient,
  input: IdentityAccount & ProviderIdentity,
  now: Date,
) {
  if (!(await lockAccount(client, input.accountId)))
    throw new IdentityStoreError();
  const result = await client.query(
    `SELECT 1 FROM tholi.identity_links i
       JOIN tholi.workspaces w ON w.id = $4
       JOIN tholi.memberships m ON m.workspace_id = w.id AND m.account_id = i.account_id
      WHERE i.id = $1 AND i.account_id = $2 AND i.issuer = $3
        AND i.subject = $5 AND m.status = 'active'
        AND EXISTS (SELECT FROM tholi.accounts a WHERE a.id = i.account_id AND a.revision = $9
          AND (a.auth_grants_revoked_at IS NULL
            OR date_trunc('second', $7::timestamptz) > a.auth_grants_revoked_at))
        AND NOT EXISTS (
          SELECT FROM tholi.identity_logout_events e WHERE e.issuer = i.issuer
            AND e.expires_at > $6 AND e.issued_at >= $7
            AND (e.subject IS NULL OR e.subject = i.subject)
            AND (e.provider_session_id IS NULL OR e.provider_session_id = $8)
        )`,
    [
      input.identityId,
      input.accountId,
      input.issuer,
      input.workspaceId,
      input.subject,
      date(now),
      date(input.issuedAt),
      input.providerSessionId ?? null,
      input.revision,
    ],
  );
  if (!result.rowCount) throw new IdentityStoreError();
}

type SessionRow = Omit<IdentitySession, "providerSessionId"> & {
  providerSessionId: string | null;
};
const sessionColumns = `s.id, s.identity_id AS "identityId", s.account_id AS "accountId",
  s.workspace_id AS "workspaceId", a.revision::text AS revision,
  s.client_id AS "clientId", s.client_kind AS "clientKind",
  i.issuer AS "providerIssuer", i.subject AS "providerSubject",
  s.provider_session_id AS "providerSessionId", s.provider_issued_at AS "providerIssuedAt",
  encode(s.token_hash, 'hex') AS "accessHash", encode(r.token_hash, 'hex') AS "refreshHash",
  encode(s.csrf_hash, 'hex') AS "csrfHash", s.access_expires_at AS "accessExpiresAt",
  s.expires_at AS "expiresAt", s.created_at AS "createdAt", s.last_used_at AS "lastUsedAt"`;
const sessionJoins = `JOIN tholi.accounts a ON a.id = s.account_id
  JOIN tholi.identity_links i ON i.id = s.identity_id AND i.account_id = s.account_id
  JOIN tholi.memberships m ON m.workspace_id = s.workspace_id AND m.account_id = s.account_id
  JOIN tholi.session_refresh_tokens r ON r.session_id = s.id AND r.consumed_at IS NULL`;

function session(row: SessionRow): IdentitySession {
  return { ...row, providerSessionId: row.providerSessionId ?? undefined };
}

async function readSession(
  client: PoolClient,
  id: string,
): Promise<IdentitySession | null> {
  const result = await client.query<SessionRow>(
    `SELECT ${sessionColumns} FROM tholi.sessions s ${sessionJoins} WHERE s.id = $1`,
    [id],
  );
  return result.rows[0] ? session(result.rows[0]) : null;
}

/** Provider proof is verified by the identity application before this adapter. */
export class PostgresIdentityRepository implements IdentityStore {
  constructor(private readonly pool: Pool) {}

  async createFlow(flow: IdentityFlow): Promise<void> {
    flow = structuredClone(flow);
    await withTransaction(this.pool, async (client) => {
      await cleanup(client, new Date());
      await client.query(
        `INSERT INTO tholi.identity_flows
          (state_hash, browser_binding_hash, nonce_hash, sealed_verifier, client_id,
           redirect_uri, destination, client_state, code_challenge, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          hash(flow.stateHash),
          hash(flow.browserBindingHash),
          hash(flow.nonceHash),
          flow.sealedVerifier,
          flow.clientId,
          flow.redirectUri,
          flow.destination,
          flow.clientState ?? null,
          flow.codeChallenge ?? null,
          date(flow.expiresAt),
        ],
      );
    });
  }

  async consumeFlow(
    stateHash: string,
    browserBindingHash: string,
    now: Date,
  ): Promise<IdentityFlow | null> {
    const result = await this.pool.query<
      IdentityFlow & {
        clientState: string | null;
        codeChallenge: string | null;
      }
    >(
      `DELETE FROM tholi.identity_flows
        WHERE state_hash = $1 AND browser_binding_hash = $2 AND expires_at > $3
        RETURNING encode(state_hash,'hex') AS "stateHash",
          encode(browser_binding_hash,'hex') AS "browserBindingHash",
          encode(nonce_hash,'hex') AS "nonceHash", sealed_verifier AS "sealedVerifier",
          client_id AS "clientId", redirect_uri AS "redirectUri", destination,
          client_state AS "clientState", code_challenge AS "codeChallenge", expires_at AS "expiresAt"`,
      [hash(stateHash), hash(browserBindingHash), date(now)],
    );
    const row = result.rows[0];
    return row
      ? {
          ...row,
          clientState: row.clientState ?? undefined,
          codeChallenge: row.codeChallenge ?? undefined,
        }
      : null;
  }

  async resolveIdentity(identity: ProviderIdentity): Promise<IdentityAccount> {
    identity = structuredClone(identity);
    return withTransaction(this.pool, async (client) => {
      await lockIssuer(client, identity.issuer);
      const linked = await client.query<{ account_id: string }>(
        "SELECT account_id FROM tholi.identity_links WHERE issuer = $1 AND subject = $2",
        [identity.issuer, identity.subject],
      );
      if (linked.rows[0])
        await setDatabaseScope(client, {
          accountId: linked.rows[0].account_id,
        });
      const result = await client.query<IdentityAccount>(
        `SELECT i.id AS "identityId", a.id AS "accountId", w.id AS "workspaceId", a.revision::text
           FROM tholi.identity_links i JOIN tholi.accounts a ON a.id = i.account_id
           JOIN tholi.workspaces w ON w.owner_account_id = a.id AND w.kind = 'personal'
           JOIN tholi.memberships m ON m.workspace_id = w.id AND m.account_id = a.id
          WHERE i.issuer = $1 AND i.subject = $2 AND a.status = 'active'
            AND m.status = 'active' AND m.role = 'owner'`,
        [identity.issuer, identity.subject],
      );
      if (result.rows[0]) return result.rows[0];
      // A revoked account must not be replaced by a fresh identity/account.
      if (linked.rowCount) throw new IdentityStoreError();
      const scope = await provisionAccountOnClient(client, {
        accountId: randomUUID(),
        workspaceId: randomUUID(),
      });
      const identityId = randomUUID();
      await client.query(
        "INSERT INTO tholi.identity_links (id, account_id, issuer, subject) VALUES ($1,$2,$3,$4)",
        [identityId, scope.accountId, identity.issuer, identity.subject],
      );
      return { identityId, ...scope, revision: "1" };
    });
  }

  async createBroker(broker: IdentityBroker): Promise<void> {
    broker = structuredClone(broker);
    await withTransaction(this.pool, async (client) => {
      await lockIssuer(client, broker.issuer);
      await setDatabaseScope(client, broker);
      await requireGrant(client, broker, new Date());
      await cleanup(client, new Date());
      await client.query(
        `INSERT INTO tholi.identity_brokers
          (code_hash,identity_id,account_id,workspace_id,client_id,redirect_uri,
           code_challenge,provider_session_id,provider_issued_at,expires_at,account_revision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          hash(broker.codeHash),
          broker.identityId,
          broker.accountId,
          broker.workspaceId,
          broker.clientId,
          broker.redirectUri,
          broker.codeChallenge,
          broker.providerSessionId ?? null,
          date(broker.issuedAt),
          date(broker.expiresAt),
          broker.revision,
        ],
      );
    });
  }

  async consumeBroker(
    codeHash: string,
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    now: Date,
  ): Promise<IdentityBroker | null> {
    now = date(now);
    const parameters = [
      hash(codeHash),
      clientId,
      redirectUri,
      codeChallenge,
      date(now),
    ];
    return withTransaction(this.pool, async (client) => {
      const result = await client.query<
        IdentityBroker & { providerSessionId: string | null }
      >(
        `SELECT b.identity_id AS "identityId", b.account_id AS "accountId",
          b.workspace_id AS "workspaceId", b.account_revision::text AS revision, i.issuer, i.subject,
          b.provider_session_id AS "providerSessionId", b.provider_issued_at AS "issuedAt",
          encode(b.code_hash,'hex') AS "codeHash", b.client_id AS "clientId",
          b.redirect_uri AS "redirectUri", b.code_challenge AS "codeChallenge", b.expires_at AS "expiresAt"
         FROM tholi.identity_brokers b JOIN tholi.identity_links i ON i.id = b.identity_id
         WHERE b.code_hash = $1 AND b.client_id = $2 AND b.redirect_uri = $3
          AND b.code_challenge = $4 AND b.expires_at > $5`,
        parameters,
      );
      if (!result.rows[0]) return null;
      const broker = {
        ...result.rows[0],
        providerSessionId: result.rows[0].providerSessionId ?? undefined,
      };
      await lockIssuer(client, broker.issuer);
      await setDatabaseScope(client, broker);
      try {
        await requireGrant(client, broker, now);
      } catch (error) {
        if (error instanceof IdentityStoreError) return null;
        throw error;
      }
      const consumed = await client.query(
        `DELETE FROM tholi.identity_brokers WHERE code_hash = $1 AND client_id = $2
          AND redirect_uri = $3 AND code_challenge = $4 AND expires_at > $5 RETURNING code_hash`,
        parameters,
      );
      return consumed.rowCount ? broker : null;
    });
  }

  async createSession(value: IdentitySession): Promise<void> {
    value = structuredClone(value);
    await withTransaction(this.pool, async (client) => {
      await lockIssuer(client, value.providerIssuer);
      await setDatabaseScope(client, value);
      await requireGrant(
        client,
        {
          ...value,
          issuer: value.providerIssuer,
          subject: value.providerSubject,
          issuedAt: value.providerIssuedAt,
        },
        new Date(),
      );
      await client.query(
        `INSERT INTO tholi.sessions
          (id,account_id,token_hash,expires_at,created_at,identity_id,workspace_id,
           client_id,client_kind,provider_session_id,provider_issued_at,csrf_hash,access_expires_at,last_used_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          value.id,
          value.accountId,
          hash(value.accessHash),
          date(value.expiresAt),
          date(value.createdAt),
          value.identityId,
          value.workspaceId,
          value.clientId,
          value.clientKind,
          value.providerSessionId ?? null,
          date(value.providerIssuedAt),
          hash(value.csrfHash),
          date(value.accessExpiresAt),
          date(value.lastUsedAt),
        ],
      );
      await client.query(
        `INSERT INTO tholi.session_refresh_tokens (token_hash,session_id,created_at,expires_at)
          VALUES ($1,$2,$3,$4)`,
        [
          hash(value.refreshHash),
          value.id,
          date(value.createdAt),
          date(value.expiresAt),
        ],
      );
    });
  }

  async authenticateSession(
    accessHash: string,
    now: Date,
  ): Promise<IdentitySession | null> {
    now = date(now);
    const parameters = [hash(accessHash), date(now)];
    return withTransaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        accountId: string;
        workspaceId: string;
      }>(
        `SELECT s.id, s.account_id AS "accountId", s.workspace_id AS "workspaceId" FROM tholi.sessions s
         WHERE s.token_hash = $1 AND s.status = 'active' AND s.access_expires_at > $2
          AND s.expires_at > $2`,
        parameters,
      );
      const row = result.rows[0];
      if (!row) return null;
      await setDatabaseScope(client, row);
      if (!(await lockAccount(client, row.accountId))) {
        await this.revokeAccountSessions(client, row.accountId, now);
        return null;
      }
      if (
        !(
          await client.query(
            "SELECT 1 FROM tholi.memberships WHERE workspace_id = $1 AND account_id = $2 AND status = 'active'",
            [row.workspaceId, row.accountId],
          )
        ).rowCount
      )
        return null;
      const updated = await client.query(
        `UPDATE tholi.sessions SET last_used_at = $2 WHERE id = $1 AND status = 'active'
          AND token_hash = $3 AND access_expires_at > $2 AND expires_at > $2 RETURNING id`,
        [row.id, now, parameters[0]],
      );
      return updated.rowCount ? readSession(client, row.id) : null;
    });
  }

  async rotateSession(
    input: Parameters<IdentityStore["rotateSession"]>[0],
  ): Promise<RefreshResult> {
    input = structuredClone(input);
    return withTransaction(this.pool, async (client) => {
      const lookup = await client.query<{
        sessionId: string;
        accountId: string;
        workspaceId: string;
      }>(
        `SELECT s.id AS "sessionId",s.account_id AS "accountId",s.workspace_id AS "workspaceId" FROM tholi.session_refresh_tokens r
          JOIN tholi.sessions s ON s.id = r.session_id WHERE r.token_hash = $1 AND s.client_id = $2`,
        [hash(input.refreshHash), input.clientId],
      );
      const found = lookup.rows[0];
      if (
        !found ||
        (input.expectedSessionId !== undefined &&
          input.expectedSessionId !== found.sessionId)
      )
        return { status: "invalid" };
      await setDatabaseScope(client, found);
      if (!(await lockAccount(client, found.accountId))) {
        await this.revokeAccountSessions(client, found.accountId, input.now);
        return { status: "invalid" };
      }
      const result = await client.query<{
        status: string;
        expiresAt: Date;
        consumedAt: Date | null;
        membership: string;
      }>(
        `SELECT s.status,s.expires_at AS "expiresAt",r.consumed_at AS "consumedAt",m.status AS membership
         FROM tholi.sessions s JOIN tholi.session_refresh_tokens r ON r.session_id = s.id AND r.token_hash = $2
          JOIN tholi.memberships m ON m.workspace_id = s.workspace_id AND m.account_id = s.account_id
         WHERE s.id = $1 FOR UPDATE OF s`,
        [found.sessionId, hash(input.refreshHash)],
      );
      const row = result.rows[0];
      if (
        !row ||
        row.status !== "active" ||
        row.expiresAt <= date(input.now) ||
        row.membership !== "active"
      )
        return { status: "invalid" };
      if (row.consumedAt) {
        await client.query(
          "UPDATE tholi.sessions SET status = 'revoked', revoked_at = $2 WHERE id = $1",
          [found.sessionId, input.now],
        );
        return { status: "replayed" };
      }
      const accessExpiresAt = new Date(
        Math.min(
          date(input.accessExpiresAt).getTime(),
          row.expiresAt.getTime(),
        ),
      );
      if (accessExpiresAt <= input.now)
        throw new RepositoryError(
          "INVALID_INPUT",
          "Access expiry must fit the session lifetime.",
        );
      await client.query(
        "UPDATE tholi.session_refresh_tokens SET consumed_at = $2 WHERE token_hash = $1",
        [hash(input.refreshHash), input.now],
      );
      await client.query(
        "INSERT INTO tholi.session_refresh_tokens (token_hash,session_id,created_at,expires_at) VALUES ($1,$2,$3,$4)",
        [
          hash(input.nextRefreshHash),
          found.sessionId,
          input.now,
          row.expiresAt,
        ],
      );
      await client.query(
        `UPDATE tholi.sessions SET token_hash = $2, csrf_hash = $3, access_expires_at = $4,
          last_used_at = $5 WHERE id = $1`,
        [
          found.sessionId,
          hash(input.accessHash),
          hash(input.csrfHash),
          accessExpiresAt,
          input.now,
        ],
      );
      return {
        status: "rotated",
        session: (await readSession(client, found.sessionId))!,
      };
    });
  }

  async listSessions(accountId: string, now: Date): Promise<IdentitySession[]> {
    return withTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SessionRow>(
          `SELECT ${sessionColumns} FROM tholi.sessions s ${sessionJoins}
        WHERE s.account_id = $1 AND a.status = 'active' AND s.status = 'active'
          AND s.expires_at > $2 AND m.status = 'active'
        ORDER BY s.created_at DESC,s.id DESC LIMIT 100`,
          [accountId, date(now)],
        );
        return result.rows.map(session);
      },
      { accountId },
    );
  }

  async revokeSession(
    accountId: string,
    sessionId: string,
    now: Date,
  ): Promise<boolean> {
    return withTransaction(
      this.pool,
      async (client) => {
        const result = await client.query(
          `UPDATE tholi.sessions SET status = 'revoked',revoked_at = $3
        WHERE account_id = $1 AND id = $2 AND status = 'active' RETURNING id`,
          [accountId, sessionId, date(now)],
        );
        return Boolean(result.rowCount);
      },
      { accountId },
    );
  }

  private async revokeAccountSessions(
    client: PoolClient,
    accountId: string,
    now: Date,
  ) {
    await client.query(
      "UPDATE tholi.sessions SET status = 'revoked',revoked_at = $2 WHERE account_id = $1 AND status = 'active'",
      [accountId, date(now)],
    );
    await client.query(
      "DELETE FROM tholi.identity_brokers WHERE account_id = $1",
      [accountId],
    );
  }

  async revokeAllSessions(accountId: string, now: Date): Promise<void> {
    now = date(now);
    await withTransaction(
      this.pool,
      async (client) => {
        await lockAccount(client, accountId);
        await client.query(
          `UPDATE tholi.accounts SET revision = revision + 1, updated_at = $2,
          auth_grants_revoked_at = GREATEST(auth_grants_revoked_at,
            date_trunc('second',$2::timestamptz) + $3 * interval '1 second')
          WHERE id = $1`,
          [accountId, date(now), IDENTITY_CLOCK_TOLERANCE_SECONDS],
        );
        await this.revokeAccountSessions(client, accountId, now);
      },
      { accountId },
    );
  }

  async revokeProviderSessions(
    input: Parameters<IdentityStore["revokeProviderSessions"]>[0],
  ): Promise<void> {
    input = structuredClone(input);
    if (!input.subject && !input.providerSessionId)
      throw new RepositoryError(
        "INVALID_INPUT",
        "Provider logout needs an identity or session.",
      );
    await withTransaction(this.pool, async (client) => {
      await lockIssuer(client, input.issuer);
      const accounts = await client.query<{ account_id: string }>(
        `SELECT DISTINCT i.account_id FROM tholi.identity_links i WHERE i.issuer = $1
          AND ($2::text IS NULL OR i.subject = $2)
          AND ($3::text IS NULL
            OR EXISTS (SELECT FROM tholi.sessions s WHERE s.identity_id = i.id AND s.provider_session_id = $3)
            OR EXISTS (SELECT FROM tholi.identity_brokers b WHERE b.identity_id = i.id AND b.provider_session_id = $3))
          ORDER BY i.account_id`,
        [input.issuer, input.subject ?? null, input.providerSessionId ?? null],
      );
      for (const row of accounts.rows) {
        await setDatabaseScope(client, { accountId: row.account_id });
        await lockAccount(client, row.account_id);
      }
      await cleanup(client, input.now);
      const event = await client.query(
        `INSERT INTO tholi.identity_logout_events
          (issuer,event_id,subject,provider_session_id,issued_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,GREATEST($6::timestamptz,$7::timestamptz + interval '15 minutes'))
         ON CONFLICT DO NOTHING RETURNING event_id`,
        [
          input.issuer,
          input.eventId,
          input.subject ?? null,
          input.providerSessionId ?? null,
          date(input.issuedAt),
          date(input.expiresAt),
          date(input.now),
        ],
      );
      if (!event.rowCount) return;
      await client.query(
        `UPDATE tholi.sessions s SET status = 'revoked',revoked_at = $4
          FROM tholi.identity_links i WHERE s.identity_id = i.id AND i.issuer = $1
           AND ($2::text IS NULL OR i.subject = $2)
           AND ($3::text IS NULL OR s.provider_session_id = $3) AND s.status = 'active'`,
        [
          input.issuer,
          input.subject ?? null,
          input.providerSessionId ?? null,
          input.now,
        ],
      );
    });
  }
}
