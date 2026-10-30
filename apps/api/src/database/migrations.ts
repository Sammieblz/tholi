import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { identityAndScope } from "./migrations/001-identity-and-scope";
import { serviceData } from "./migrations/002-service-data";

export interface DatabaseMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

function migration(
  version: number,
  name: string,
  sql: string,
): DatabaseMigration {
  return Object.freeze({
    version,
    name,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  });
}

/** Append new versions; editing an applied body deliberately fails verification. */
export const migrations: readonly DatabaseMigration[] = Object.freeze([
  migration(1, "identity-and-scope", identityAndScope),
  migration(2, "service-data", serviceData),
]);

export interface MigrationOptions {
  /** Apply an explicit prefix for upgrade validation. Downgrades are refused. */
  target?: number;
  /** Existing non-owner runtime role. Role names are not part of migration bytes. */
  runtimeRole?: string;
}

type AppliedMigration = Pick<
  DatabaseMigration,
  "version" | "name" | "checksum"
>;

// A database-local session lock spans individual migration transactions. A second
// operator fails promptly instead of waiting behind an unbounded rollout.
const lockKey = [1414025036, 28];

const mutableTables = [
  "accounts",
  "workspaces",
  "memberships",
  "sessions",
  "consents",
  "requests",
  "entitlements",
  "credit_reservations",
  "saved_artifacts",
  "jobs",
  "outbox",
] as const;

const appendOnlyTables = [
  "identity_links",
  "plan_versions",
  "credit_grants",
  "credit_settlements",
  "usage_records",
] as const;

function runtimeIdentifier(role: string): string {
  if (
    !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(role) ||
    role.toLowerCase() === "public" ||
    role.toLowerCase().startsWith("pg_")
  )
    throw new Error("Use an existing dedicated PostgreSQL runtime role.");
  return '"' + role + '"';
}

async function validateRuntimeRole(client: PoolClient, role: string) {
  const { rows } = await client.query<{ unsafe: boolean }>(
    `SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls
       OR pg_has_role(r.oid, current_user, 'SET')
       OR EXISTS (
         SELECT FROM pg_namespace n
          WHERE n.nspname = 'tholi' AND pg_has_role(r.oid, n.nspowner, 'SET')
       )
       OR EXISTS (
         SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'tholi' AND pg_has_role(r.oid, c.relowner, 'SET')
       )
       OR EXISTS (
         SELECT FROM pg_roles privileged
          WHERE (privileged.rolsuper OR privileged.rolcreatedb
            OR privileged.rolcreaterole OR privileged.rolbypassrls
            OR privileged.rolname IN ('pg_read_all_data', 'pg_write_all_data',
              'pg_read_server_files', 'pg_write_server_files',
              'pg_execute_server_program'))
            AND pg_has_role(r.oid, privileged.oid, 'SET')
       ) AS unsafe
       FROM pg_roles r WHERE r.rolname = $1`,
    [role],
  );
  if (rows.length !== 1 || rows[0].unsafe)
    throw new Error(
      "Runtime role must be unprivileged and separate from its migration owner.",
    );
}

async function transaction<T>(
  client: PoolClient,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL search_path = pg_catalog, tholi");
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The caller owns release. Ending the connection makes a failed rollback
      // unusable before that client can return to the pool.
      await client.end().catch(() => {});
    }
    throw error;
  }
}

function checkApplied(rows: AppliedMigration[], target: number) {
  for (let index = 0; index < rows.length; index++) {
    const applied = rows[index];
    const expected = migrations[index];
    if (!expected || applied.version !== expected.version)
      throw new Error("Unknown or non-contiguous database migration history.");
    if (
      applied.name !== expected.name ||
      applied.checksum !== expected.checksum
    )
      throw new Error(
        "Applied database migration differs from this application.",
      );
  }
  if (rows.length > target)
    throw new Error("Database is newer than the requested migration target.");
}

async function appliedMigrations(client: PoolClient) {
  const { rows } = await client.query<AppliedMigration>(
    "SELECT version, name, checksum FROM tholi.schema_migrations ORDER BY version",
  );
  return rows;
}

/** Read-only compatibility check; safe for the non-owner runtime readiness path. */
export async function verifyDatabase(client: PoolClient): Promise<number> {
  const rows = await appliedMigrations(client);
  checkApplied(rows, migrations.length);
  if (rows.length !== migrations.length)
    throw new Error(
      "Database migrations are required before starting the service.",
    );
  return rows.length;
}

async function grantRuntime(client: PoolClient, role: string) {
  const identifier = runtimeIdentifier(role);
  await validateRuntimeRole(client, role);
  const { rows } = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'tholi'",
  );
  const existing = new Set(rows.map((row) => row.table_name));
  await client.query(`GRANT USAGE ON SCHEMA tholi TO ${identifier}`);
  // No DELETE, TRUNCATE, DDL or future-table default grant. Saved data is
  // tombstoned; privileged erasure and RLS policy are later authorization work.
  for (const table of mutableTables) {
    if (existing.has(table))
      await client.query(
        `GRANT SELECT, INSERT, UPDATE ON tholi.${table} TO ${identifier}`,
      );
  }
  for (const table of appendOnlyTables) {
    if (existing.has(table))
      await client.query(
        `GRANT SELECT, INSERT ON tholi.${table} TO ${identifier}`,
      );
  }
  for (const table of ["schema_migrations", "credit_ledger"]) {
    if (existing.has(table))
      await client.query(`GRANT SELECT ON tholi.${table} TO ${identifier}`);
  }
}

/**
 * One operator-owned, idle PoolClient for the entire run. No HTTP startup,
 * environment reads, cloud SDKs, automatic seeds or SQLite import occur here.
 * Authorization/RLS belongs to #31; repositories must already scope each query.
 */
export async function migrateDatabase(
  client: PoolClient,
  options: MigrationOptions = {},
): Promise<{ version: number; applied: number[] }> {
  const target = options.target ?? migrations.length;
  if (!Number.isSafeInteger(target) || target < 0 || target > migrations.length)
    throw new Error("Unknown database migration target.");
  if (options.runtimeRole !== undefined) runtimeIdentifier(options.runtimeRole);
  const lock = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1, $2) AS locked",
    lockKey,
  );
  if (!lock.rows[0]?.locked)
    throw new Error("Another database migration is already running.");
  let failed = false;
  try {
    if (options.runtimeRole !== undefined)
      await validateRuntimeRole(client, options.runtimeRole);
    await transaction(client, async () => {
      await client.query("CREATE SCHEMA IF NOT EXISTS tholi");
      await client.query(`CREATE TABLE IF NOT EXISTS tholi.schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL CHECK (length(name) > 0),
        checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    });
    const rows = await appliedMigrations(client);
    checkApplied(rows, target);
    const applied: number[] = [];
    for (const item of migrations.slice(rows.length, target)) {
      await transaction(client, async () => {
        await client.query(item.sql);
        await client.query(
          "INSERT INTO tholi.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [item.version, item.name, item.checksum],
        );
      });
      applied.push(item.version);
    }
    if (options.runtimeRole !== undefined)
      await transaction(client, () =>
        grantRuntime(client, options.runtimeRole!),
      );
    return { version: target, applied };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", lockKey);
    } catch (error) {
      if (!failed) throw error;
    }
  }
}
