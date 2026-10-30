import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  NO_OBSERVABILITY,
  type Observability,
} from "../application/observability";

const observers = new WeakMap<Pool, Observability>();
export function databaseObservability(pool: Pool): Observability {
  return observers.get(pool) ?? NO_OBSERVABILITY;
}

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  lockTimeoutMillis?: number;
  ssl?: boolean | { ca: string; rejectUnauthorized: true };
}

export interface DatabaseScope {
  accountId: string;
  workspaceId: string;
}

export interface AccountScope {
  accountId: string;
  workspaceId?: string;
}

const scopeSchema = z.object({
  accountId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
});

/** Identity discovers the actor before a workspace can be selected. Always local. */
export async function setDatabaseScope(
  client: Pick<PoolClient, "query">,
  scope?: AccountScope,
) {
  if (scope) scopeSchema.parse(scope);
  await client.query(
    "SELECT set_config('tholi.account_id', $1, true), set_config('tholi.workspace_id', $2, true)",
    [scope?.accountId ?? "", scope?.workspaceId ?? ""],
  );
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    throw new Error("Invalid database connection or timeout budget.");
  return result;
}

/** No global int8 parser: repositories explicitly expose credit quantities as bigint. */
export function createDatabasePool(
  options: DatabaseOptions,
  observer: Observability = NO_OBSERVABILITY,
): Pool {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("A PostgreSQL connection URL is required.");
  if (
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    url.hash
  )
    throw new Error(
      "Explicit PostgreSQL host, database, user and password are required.",
    );
  // pg gives URL options precedence over supplied settings. Parse once and pass
  // explicit fields so neither the URL nor ambient PG* can override our budgets.
  for (const name of url.searchParams.keys())
    if (
      !["sslmode", "sslrootcert"].includes(name) ||
      url.searchParams.getAll(name).length !== 1
    )
      throw new Error("Unsupported PostgreSQL URL option.");
  const mode = url.searchParams.get("sslmode");
  if (mode !== null && !["disable", "verify-full"].includes(mode))
    throw new Error("Use disabled local TLS or fully verified PostgreSQL TLS.");
  if (
    options.ssl &&
    typeof options.ssl === "object" &&
    (options.ssl.rejectUnauthorized !== true || !options.ssl.ca)
  )
    throw new Error("PostgreSQL TLS must verify the server certificate.");
  if (
    (mode === "disable" && options.ssl) ||
    (mode === "verify-full" && options.ssl === false)
  )
    throw new Error("Conflicting PostgreSQL TLS configuration.");
  const certificate = url.searchParams.get("sslrootcert");
  if (certificate && (mode !== "verify-full" || options.ssl !== undefined))
    throw new Error(
      "A root certificate requires one verified TLS configuration.",
    );
  let connection: {
    host: string;
    user: string;
    password: string;
    database: string;
  };
  try {
    connection = {
      host: decodeURIComponent(url.hostname.replace(/^\[|\]$/g, "")),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    };
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration.");
  }
  const pool = new Pool({
    ...connection,
    port: bounded(url.port ? Number(url.port) : undefined, 5432, 65535),
    max: bounded(options.max, 8, 32),
    connectionTimeoutMillis: bounded(
      options.connectionTimeoutMillis,
      3000,
      30000,
    ),
    statement_timeout: bounded(options.statementTimeoutMillis, 5000, 120000),
    lock_timeout: bounded(options.lockTimeoutMillis, 2000, 30000),
    idle_in_transaction_session_timeout: 10000,
    idleTimeoutMillis: 10000,
    application_name: "tholi-service",
    // pg treats an empty options string as missing and then reads PGOPTIONS.
    options: "-c search_path=pg_catalog,tholi",
    client_encoding: "UTF8",
    sslnegotiation: "postgres",
    ssl: certificate
      ? { ca: readFileSync(certificate, "utf8"), rejectUnauthorized: true }
      : ((options.ssl === true ? { rejectUnauthorized: true } : options.ssl) ??
        (mode === "verify-full" ? { rejectUnauthorized: true } : false)),
  });
  // An idle connection failure must not crash the process or print its connection
  // string. pg removes the broken client; the next operation checks connectivity.
  observers.set(pool, observer);
  if (observer.enabled) {
    const acquire = pool.connect.bind(pool);
    type Callback = Parameters<Pool["connect"]>[0];
    pool.connect = ((callback?: Callback) => {
      const span = observer.start("database.connect");
      const started = performance.now();
      const finish = (failed: boolean) => {
        span.end(failed ? "unavailable" : "ok");
        observer.metric("database.pool.wait_ms", performance.now() - started);
        observer.metric("database.pool.total", pool.totalCount);
        observer.metric("database.pool.idle", pool.idleCount);
        observer.metric("database.pool.waiting", pool.waitingCount);
        if (failed)
          observer.metric("database.failures", 1, { outcome: "unavailable" });
      };
      if (callback)
        return acquire((error, client, release) => {
          finish(!!error);
          callback(error, client, release);
        });
      return acquire().then(
        (client) => {
          finish(false);
          return client;
        },
        (error) => {
          finish(true);
          throw error;
        },
      );
    }) as Pool["connect"];
  }
  pool.on("error", () => {
    observer.metric("database.failures", 1, { outcome: "unavailable" });
  });
  return pool;
}

/** One checked-out connection owns the entire transaction and its local scope. */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  scope?: AccountScope,
): Promise<T> {
  const localScope = scope ? Object.freeze({ ...scope }) : undefined;
  if (localScope) scopeSchema.parse(localScope);
  const observer = databaseObservability(pool);
  const client = await pool.connect();
  const transaction = observer.start("database.transaction");
  let discard = false;
  try {
    await client.query("BEGIN");
    await setDatabaseScope(client, localScope);
    const result = await observer.run(transaction.correlation, () =>
      work(client),
    );
    await client.query("COMMIT");
    transaction.end("ok");
    return result;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const outcome =
      code === "42501" ? "denied" : code === "57014" ? "timeout" : "error";
    transaction.end(outcome);
    observer.metric("database.failures", 1, { outcome });
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
