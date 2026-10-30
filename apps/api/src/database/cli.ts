import { parseDatabaseConfig, type Environment } from "../config";
import { isMainModule } from "../runtime";
import { migrateDatabase, verifyDatabase } from "./migrations";
import { createDatabasePool } from "./postgres";
import { PostgresRepositories } from "./repositories";

export const localSeed = Object.freeze({
  accountId: "00000000-0000-4000-8000-000000000028",
  workspaceId: "00000000-0000-4000-8000-000000000029",
});

/** One-shot operator entrypoint. Never run migrations from each HTTP replica. */
export async function runDatabaseCommand(
  command: string | undefined,
  env: Environment = process.env,
) {
  if (!["migrate", "verify", "seed"].includes(command ?? ""))
    throw new Error("Use database-cli.js migrate, verify or seed.");
  if (
    command === "seed" &&
    (env.NODE_ENV !== "development" || env.THOLI_ALLOW_DEV_SEED !== "true")
  )
    throw new Error(
      "Synthetic seed requires the explicit local development profile.",
    );
  const pool = createDatabasePool(
    parseDatabaseConfig(env, command === "migrate" ? "migration" : "runtime"),
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
          });
        else await verifyDatabase(client);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error("One database command is required.");
    await runDatabaseCommand(process.argv[2]);
    console.log("Tholi database operation completed.");
  } catch {
    // Driver and constraint messages can contain credentials or submitted data.
    console.error(
      "Tholi database operation failed. Check configuration, schema compatibility and role permissions.",
    );
    process.exitCode = 1;
  }
}
