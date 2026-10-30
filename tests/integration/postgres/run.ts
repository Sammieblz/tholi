import { runPostgresChecks } from "./checks";
import { runWorkerRuntimeProbe } from "./job-checks";
import { runSupportRuntimeProbe } from "./support-runtime-probe";

try {
  const migrationConnection = process.env.THOLI_DATABASE_MIGRATION_URL;
  const runtimeConnection = process.env.THOLI_DATABASE_URL;
  if (!migrationConnection || !runtimeConnection)
    throw new Error("Explicit migration and runtime connections are required.");
  const probe =
    process.argv.length === 3 && process.argv[2] === "--worker-runtime-probe";
  const supportProbe =
    process.argv.length === 3 && process.argv[2] === "--support-runtime-probe";
  if (process.argv.length > 2 && !probe && !supportProbe)
    throw new Error("Unknown PostgreSQL verification mode.");
  process.stdout.write(
    JSON.stringify(
      supportProbe
        ? await runSupportRuntimeProbe({
            migrationConnection,
            runtimeConnection,
            workerConnection: process.env.THOLI_DATABASE_WORKER_URL ?? "",
            apiUrl: process.env.THOLI_SUPPORT_PROBE_API_URL ?? "",
          })
        : probe
          ? await runWorkerRuntimeProbe({ runtimeConnection })
          : await runPostgresChecks({
              migrationConnection,
              runtimeConnection,
              workerConnection: process.env.THOLI_DATABASE_WORKER_URL,
            }),
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
