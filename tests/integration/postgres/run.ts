import { runPostgresChecks } from "./checks";
import { runWorkerRuntimeProbe } from "./job-checks";
import { runSupportRuntimeProbe } from "./support-runtime-probe";
import { runTelemetryRuntimeProbe } from "./telemetry-runtime-probe";
import { runProfileRuntimeProbe } from "./profile-runtime-probe";
import { runResilienceRuntimeProbe } from "./resilience-runtime-probe";

function finish(stream: NodeJS.WriteStream, message: string, status: number) {
  // This is a one-shot container entrypoint. All probe-owned pools and servers
  // are closed before it writes a result; exit after the result is flushed so
  // unrelated imported-library handles cannot strand the Compose smoke job.
  stream.write(message, () => process.exit(status));
}

try {
  const migrationConnection = process.env.THOLI_DATABASE_MIGRATION_URL;
  const runtimeConnection = process.env.THOLI_DATABASE_URL;
  if (!migrationConnection || !runtimeConnection)
    throw new Error("Explicit migration and runtime connections are required.");
  const probe =
    process.argv.length === 3 && process.argv[2] === "--worker-runtime-probe";
  const supportProbe =
    process.argv.length === 3 && process.argv[2] === "--support-runtime-probe";
  const telemetryProbe =
    process.argv[2] === "--telemetry-runtime-probe" &&
    ((process.argv.length === 4 && process.argv[3] === "submit") ||
      (process.argv.length === 5 && process.argv[3] === "complete"));
  const profileProbe =
    process.argv.length === 3 && process.argv[2] === "--profile-runtime-probe";
  const resilienceProbe =
    process.argv.length === 3 &&
    process.argv[2] === "--resilience-runtime-probe";
  if (
    process.argv.length > 2 &&
    !probe &&
    !supportProbe &&
    !telemetryProbe &&
    !profileProbe &&
    !resilienceProbe
  )
    throw new Error("Unknown PostgreSQL verification mode.");
  finish(
    process.stdout,
    JSON.stringify(
      resilienceProbe
        ? await runResilienceRuntimeProbe({
            migrationConnection,
            runtimeConnection,
            origins: JSON.parse(process.env.THOLI_RESILIENCE_ORIGINS ?? "[]"),
          })
        : profileProbe
          ? await runProfileRuntimeProbe(runtimeConnection)
          : telemetryProbe
            ? await runTelemetryRuntimeProbe({
                phase: process.argv[3] as "submit" | "complete",
                jobId: process.argv[4],
                sentinel: process.env.THOLI_TELEMETRY_SENTINEL ?? "",
                migrationConnection,
                runtimeConnection,
                apiUrl: process.env.THOLI_SUPPORT_PROBE_API_URL ?? "",
              })
            : supportProbe
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
    0,
  );
} catch (error) {
  const message =
    error instanceof Error &&
    error.message.startsWith("PostgreSQL check failed:")
      ? error.message
      : "PostgreSQL integration verification failed.";
  finish(process.stderr, message + "\n", 1);
}
