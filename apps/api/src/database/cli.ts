import { parseDatabaseConfig, type Environment } from "../config";
import { isMainModule } from "../runtime";
import { migrateDatabase, verifyDatabase } from "./migrations";
import { createDatabasePool } from "./postgres";
import { PostgresRepositories } from "./repositories";
import { PostgresJobs } from "./jobs";
import { REGISTERED_JOB_KINDS } from "../application/identity-maintenance";
import { z } from "zod";
import { readSecurityAudit } from "./audit";

export const localSeed = Object.freeze({
  accountId: "00000000-0000-4000-8000-000000000028",
  workspaceId: "00000000-0000-4000-8000-000000000029",
});

/** One-shot operator entrypoint. Never run migrations from each HTTP replica. */
export async function runDatabaseCommand(
  command: string | undefined,
  env: Environment = process.env,
  args: readonly string[] = [],
) {
  if (
    ![
      "migrate",
      "verify",
      "seed",
      "retry-job",
      "audit-export",
      "audit-prune",
    ].includes(command ?? "")
  )
    throw new Error(
      "Use database-cli.js migrate, verify, seed, retry-job, audit-export or audit-prune.",
    );
  const auditFilter =
    command === "audit-export"
      ? z
          .union([
            z.tuple([
              z.enum(["account", "workspace"]),
              z.string().uuid(),
              z.coerce.number().int().min(1).max(100),
            ]),
            z.tuple([
              z.enum(["account", "workspace"]),
              z.string().uuid(),
              z.coerce.number().int().min(1).max(100),
              z.string().uuid(),
            ]),
          ])
          .parse(args)
      : undefined;
  const pruneBudget =
    command === "audit-prune"
      ? z.tuple([z.coerce.number().int().min(1).max(1000)]).parse(args)[0]
      : undefined;
  if (
    !auditFilter &&
    pruneBudget === undefined &&
    args.length !== (command === "retry-job" ? 5 : 0)
  )
    throw new Error(
      "Retry requires workspace, job, expected revision, registered kind and version.",
    );
  const retry =
    command === "retry-job"
      ? z
          .tuple([
            z.string().uuid(),
            z.string().uuid(),
            z
              .string()
              .regex(/^[1-9]\d{0,18}$/)
              .refine((value) => BigInt(value) <= 9223372036854775807n),
            z.string().min(1).max(100),
            z
              .string()
              .regex(/^[1-9]\d{0,9}$/)
              .transform(Number)
              .refine((value) => value <= 2147483647),
          ])
          .parse(args)
      : undefined;
  if (
    command === "seed" &&
    (env.NODE_ENV !== "development" || env.THOLI_ALLOW_DEV_SEED !== "true")
  )
    throw new Error(
      "Synthetic seed requires the explicit local development profile.",
    );
  const pool = createDatabasePool(
    parseDatabaseConfig(
      env,
      ["migrate", "retry-job", "audit-export", "audit-prune"].includes(
        command ?? "",
      )
        ? "migration"
        : "runtime",
    ),
  );
  try {
    if (auditFilter) {
      const [scope, id, limit, cursorId] = auditFilter;
      const client = await pool.connect();
      try {
        await verifyDatabase(client);
        const items = await readSecurityAudit(client, {
          ...(scope === "account" ? { accountId: id } : { workspaceId: id }),
          limit,
          ...(cursorId ? { after: cursorId } : {}),
        });
        const last = items.at(-1);
        return {
          items,
          ...(items.length === limit && last ? { nextCursor: last.id } : {}),
        };
      } finally {
        client.release();
      }
    }
    if (pruneBudget !== undefined) {
      const client = await pool.connect();
      try {
        await verifyDatabase(client);
      } finally {
        client.release();
      }
      return new PostgresJobs(pool).pruneObservability(pruneBudget);
    }
    if (command === "seed") {
      await new PostgresRepositories(pool).provisionAccount(localSeed);
    } else {
      const client = await pool.connect();
      try {
        if (command === "migrate")
          await migrateDatabase(client, {
            runtimeRole: env.THOLI_DATABASE_RUNTIME_ROLE ?? "tholi_runtime",
            workerRole: env.THOLI_DATABASE_WORKER_ROLE ?? "tholi_worker",
          });
        else await verifyDatabase(client);
      } finally {
        client.release();
      }
      if (
        retry &&
        !(await new PostgresJobs(pool).retryDead(
          {
            workspaceId: retry[0],
            id: retry[1],
            expectedRevision: BigInt(retry[2]),
            kind: retry[3],
            version: retry[4],
          },
          REGISTERED_JOB_KINDS,
        ))
      )
        throw new Error("The dead job is unavailable or its revision changed.");
    }
  } finally {
    await pool.end();
  }
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await runDatabaseCommand(
      process.argv[2],
      process.env,
      process.argv.slice(3),
    );
    console.log(
      result === undefined
        ? "Tholi database operation completed."
        : JSON.stringify(result),
    );
  } catch {
    // Driver and constraint messages can contain credentials or submitted data.
    console.error(
      "Tholi database operation failed. Check configuration, schema compatibility and role permissions.",
    );
    process.exitCode = 1;
  }
}
