import { parseDatabaseConfig, type Environment } from "../config";
import { isMainModule } from "../runtime";
import { migrateDatabase, verifyDatabase } from "./migrations";
import { createDatabasePool } from "./postgres";
import { PostgresRepositories } from "./repositories";
import { PostgresJobs } from "./jobs";
import { REGISTERED_JOB_KINDS } from "../application/identity-maintenance";
import { z } from "zod";

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
  if (!["migrate", "verify", "seed", "retry-job"].includes(command ?? ""))
    throw new Error("Use database-cli.js migrate, verify, seed or retry-job.");
  if (args.length !== (command === "retry-job" ? 5 : 0))
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
      command === "migrate" || command === "retry-job"
        ? "migration"
        : "runtime",
    ),
  );
  try {
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
    await runDatabaseCommand(
      process.argv[2],
      process.env,
      process.argv.slice(3),
    );
    console.log("Tholi database operation completed.");
  } catch {
    // Driver and constraint messages can contain credentials or submitted data.
    console.error(
      "Tholi database operation failed. Check configuration, schema compatibility and role permissions.",
    );
    process.exitCode = 1;
  }
}
