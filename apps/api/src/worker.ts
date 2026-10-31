import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseWorkerConfig, type Environment } from "./config";
import { createServiceDatabase } from "./adapters/service-database";
import { PostgresJobs } from "./database/jobs";
import { PostgresRepositories } from "./database/repositories";
import { JobWorker } from "./application/job-worker";
import { JOB_HANDLERS } from "./application/identity-maintenance";
import { createSupportJobHandlers } from "./application/support-jobs";
import { createInferenceReconciliationHandler } from "./application/quotas";
import { createAccountDeletionHandler } from "./application/account";
import { PostgresAccount } from "./database/account";
import { PostgresSupport } from "./database/support";
import { createSmtpMailer } from "./adapters/smtp";
import { createS3Objects } from "./adapters/s3";
import { createObservability } from "./adapters/observability";
import {
  isMainModule,
  runExecutable,
  startManagedRuntime,
  type ManagedApplication,
  type RuntimeOptions,
} from "./runtime";

type WorkerConfig = ReturnType<typeof parseWorkerConfig>;
const healthMaxAgeMs = 30000;

function healthPath(value: string | undefined) {
  if (!value || !isAbsolute(value))
    throw new Error("An absolute worker health path is required.");
  return value;
}

/** Local process health only. Never publishes queue, account or database metadata. */
export async function checkWorkerHealth(
  file: string | undefined,
  now = Date.now(),
) {
  const path = healthPath(file);
  if ((await stat(path)).size > 128)
    throw new Error("Invalid worker health marker.");
  const marker: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !marker ||
    typeof marker !== "object" ||
    !("healthyAt" in marker) ||
    typeof marker.healthyAt !== "number" ||
    !Number.isSafeInteger(marker.healthyAt) ||
    marker.healthyAt > now ||
    now - marker.healthyAt > healthMaxAgeMs
  )
    throw new Error("Worker health is stale or unavailable.");
}

export async function createWorkerRuntime(
  config: WorkerConfig,
): Promise<ManagedApplication> {
  const path =
    config.healthFile === undefined ? undefined : healthPath(config.healthFile);
  const observer = createObservability(config.observability);
  const { pool, resource } = await createServiceDatabase(
    config.database,
    observer,
  ).catch(async (error) => {
    await observer.close();
    throw error;
  });
  const transports: { close(): Promise<void> }[] = [];
  let worker: JobWorker;
  try {
    let external: ReturnType<typeof createSupportJobHandlers> = [];
    if (config.support) {
      const mail = createSmtpMailer(
        config.support.mail,
        config.support.allowLocal,
        observer,
      );
      transports.push(mail);
      const objects = createS3Objects(
        config.support.objects,
        config.support.allowLocal,
        observer,
      );
      transports.push(objects);
      external = createSupportJobHandlers(
        new PostgresSupport(pool),
        mail,
        objects,
        observer,
      );
    }
    const repositories = new PostgresRepositories(pool);
    worker = new JobWorker(
      new PostgresJobs(pool),
      {
        ...config.options,
        workerId: randomUUID(),
      },
      [
        ...JOB_HANDLERS,
        createInferenceReconciliationHandler(repositories),
        ...(config.support
          ? [
              createAccountDeletionHandler(
                new PostgresAccount(pool, repositories),
              ),
            ]
          : []),
        ...external,
      ],
      observer,
      config.productEnvironment === "development"
        ? { refillFreePlans: (input) => repositories.refillFreePlans(input) }
        : undefined,
    );
  } catch (error) {
    await Promise.allSettled(transports.map((item) => item.close()));
    await Promise.resolve()
      .then(() => resource.close())
      .finally(() => observer.close());
    throw error;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let writing = Promise.resolve();
  let closed = false;
  return {
    async start() {
      if (path) await rm(path, { force: true });
      await worker.start();
      if (path) {
        timer = setInterval(() => {
          writing = writing
            .then(async () => {
              if (!worker.ready() || closed) {
                await rm(path, { force: true });
                return;
              }
              const temporary = path + ".tmp";
              await writeFile(
                temporary,
                JSON.stringify({ healthyAt: worker.lastHealthyAt() }),
                { mode: 0o600 },
              );
              await rename(temporary, path);
            })
            .catch(() => {});
        }, 1000);
        timer.unref();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      try {
        await worker.stop();
        await writing;
        if (path) await rm(path, { force: true });
      } finally {
        try {
          await worker.close();
        } finally {
          await Promise.allSettled(transports.map((item) => item.close()));
          await Promise.resolve()
            .then(() => resource.close())
            .finally(() => observer.close());
        }
      }
    },
  };
}

export async function startWorker(
  env: Environment = process.env,
  factory: (
    config: WorkerConfig,
  ) => Promise<ManagedApplication> = createWorkerRuntime,
  options: RuntimeOptions = {},
) {
  const config = parseWorkerConfig(env);
  return startManagedRuntime(
    () => factory(config),
    (worker) => worker.start(),
    options,
    "worker",
  );
}

if (isMainModule(import.meta.url)) {
  await runExecutable(async () => {
    if (process.argv.length === 3 && process.argv[2] === "--health") {
      await checkWorkerHealth(process.env.THOLI_WORKER_HEALTH_FILE);
      return;
    }
    if (process.argv.length !== 2) throw new Error("Unknown worker arguments.");
    await startWorker(process.env, createWorkerRuntime, {
      exit: (code) => process.exit(code),
    });
    console.log(
      "Tholi durable worker started. Interactive navigation remains request-scoped.",
    );
  }, "worker");
}
