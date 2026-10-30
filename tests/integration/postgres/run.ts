import { runPostgresChecks } from "./checks";

try {
  const migrationConnection = process.env.THOLI_DATABASE_MIGRATION_URL;
  const runtimeConnection = process.env.THOLI_DATABASE_URL;
  if (!migrationConnection || !runtimeConnection)
    throw new Error("Explicit migration and runtime connections are required.");
  process.stdout.write(
    JSON.stringify(
      await runPostgresChecks({ migrationConnection, runtimeConnection }),
    ) + "\n",
  );
} catch (error) {
  const message =
    error instanceof Error &&
    error.message.startsWith("PostgreSQL check failed:")
      ? error.message
      : "PostgreSQL integration verification failed.";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}
