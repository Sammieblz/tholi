import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig } from "../../../apps/api/src/config";
import type { ManagedApplication } from "../../../apps/api/src/runtime";
import { createWorkerRuntime, startWorker } from "../../../apps/api/src/worker";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import type { FreePlanRefills } from "../../../apps/api/src/application/plans";

const boundaries = vi.hoisted(() => ({
  database: vi.fn(),
  constructed: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  healthy: false,
  healthyAt: 0,
  failConstruction: false,
}));
vi.mock("../../../apps/api/src/adapters/service-database", () => ({
  createServiceDatabase: boundaries.database,
}));
vi.mock("../../../apps/api/src/application/job-worker", () => ({
  JobWorker: class {
    start = boundaries.start;
    stop = boundaries.stop;
    close = boundaries.close;
    ready = () => boundaries.healthy;
    lastHealthyAt = () => boundaries.healthyAt;
    constructor(...args: unknown[]) {
      boundaries.constructed(...args);
      if (boundaries.failConstruction)
        throw new Error("PRIVATE_CONSTRUCTOR_SENTINEL");
    }
  },
}));

const environment = {
  THOLI_DATABASE_WORKER_URL: "postgresql://worker:synthetic@localhost/tholi",
};
const directories: string[] = [];
const pool = { end: vi.fn() };
const resource = {
  name: "worker-database",
  ready: () => true,
  stop: () => {},
  close: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.failConstruction = false;
  boundaries.healthy = false;
  boundaries.healthyAt = 0;
  boundaries.start.mockResolvedValue(undefined);
  boundaries.stop.mockResolvedValue(undefined);
  boundaries.close.mockResolvedValue(undefined);
  pool.end.mockResolvedValue(undefined);
  resource.close.mockImplementation(async () => pool.end());
  boundaries.database.mockResolvedValue({
    pool: pool as unknown as Pool,
    resource,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (
      !isAbsolute(directory) ||
      target !== directory ||
      !target.startsWith(resolve(tmpdir()) + sep + "tholi-worker-runtime-")
    )
      throw new Error("Refusing cleanup outside the worker test directory.");
    await rm(target, { recursive: true, force: true });
  }
});

describe("worker composition cleanup", () => {
  it("serves optional private worker probes from current worker health and closes them on drain", async () => {
    for (const value of ["0", "1023", "65536", "1.5", "NaN"])
      expect(() =>
        parseWorkerConfig({ ...environment, THOLI_WORKER_HEALTH_PORT: value }),
      ).toThrow();
    expect(parseWorkerConfig(environment).healthPort).toBeUndefined();
    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const application = await createWorkerRuntime(
      parseWorkerConfig({
        ...environment,
        THOLI_WORKER_HEALTH_PORT: String(port),
      }),
    );
    const url = `http://127.0.0.1:${port}`;
    try {
      await application.start();
      expect((await fetch(url + "/health/live")).status).toBe(200);
      expect((await fetch(url + "/health/ready")).status).toBe(503);
      boundaries.healthy = true;
      boundaries.healthyAt = Date.now();
      const ready = await fetch(url + "/health/ready");
      expect(ready.status).toBe(200);
      expect(ready.headers.get("cache-control")).toBe("no-store");
      expect(await ready.text()).toBe("");
      boundaries.healthyAt = Date.now() - 30001;
      expect((await fetch(url + "/health/ready")).status).toBe(503);
      expect((await fetch(url + "/jobs")).status).toBe(404);
      expect(
        (await fetch(url + "/health/live", { method: "POST" })).status,
      ).toBe(404);
    } finally {
      await application.close();
    }
    await expect(fetch(url + "/health/live")).rejects.toThrow();
    expect(boundaries.close).toHaveBeenCalledOnce();
    expect(resource.close).toHaveBeenCalledOnce();
  });
  it.each([undefined, "production", "development"])(
    "funds development Free periods only in the explicit development worker (%s)",
    async (nodeEnvironment) => {
      const refill = vi
        .spyOn(PostgresRepositories.prototype, "refillFreePlans")
        .mockResolvedValue(2);
      const application = await createWorkerRuntime(
        parseWorkerConfig({ ...environment, NODE_ENV: nodeEnvironment }),
      );
      try {
        const maintenance = boundaries.constructed.mock.calls[0][4] as
          FreePlanRefills | undefined;
        if (nodeEnvironment === "development") {
          expect(await maintenance?.refillFreePlans({ limit: 100 })).toBe(2);
          expect(refill).toHaveBeenCalledWith({ limit: 100 });
        } else {
          expect(maintenance).toBeUndefined();
          expect(refill).not.toHaveBeenCalled();
        }
      } finally {
        await application.close();
      }
    },
  );

  it("rejects an invalid health path before allocating the database", async () => {
    const config = parseWorkerConfig(environment);
    await expect(
      createWorkerRuntime({ ...config, healthFile: "relative-health.json" }),
    ).rejects.toThrow("An absolute worker health path is required.");
    expect(boundaries.database).not.toHaveBeenCalled();
    expect(boundaries.constructed).not.toHaveBeenCalled();
  });

  it("drains the worker and closes its pool once when startup and cleanup cannot unlink a directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tholi-worker-runtime-"));
    directories.push(directory);
    const reportError = vi.fn();
    let application: ManagedApplication | undefined;
    await expect(
      startWorker(
        { ...environment, THOLI_WORKER_HEALTH_FILE: directory },
        async (config) => {
          application = await createWorkerRuntime(config);
          return application;
        },
        { signals: new EventEmitter(), reportError },
      ),
    ).rejects.toThrow("Tholi worker could not start.");
    expect(boundaries.database).toHaveBeenCalledOnce();
    expect(boundaries.start).not.toHaveBeenCalled();
    expect(boundaries.stop).toHaveBeenCalledOnce();
    expect(boundaries.close).toHaveBeenCalledOnce();
    expect(resource.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      "Tholi worker startup cleanup failed or exceeded its deadline.",
    );
    await application!.close();
    expect(boundaries.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("closes the allocated pool when constructing the worker fails", async () => {
    boundaries.failConstruction = true;
    await expect(
      createWorkerRuntime(parseWorkerConfig(environment)),
    ).rejects.toThrow("PRIVATE_CONSTRUCTOR_SENTINEL");
    expect(boundaries.database).toHaveBeenCalledOnce();
    expect(boundaries.constructed).toHaveBeenCalledOnce();
    expect(boundaries.start).not.toHaveBeenCalled();
    expect(boundaries.close).not.toHaveBeenCalled();
    expect(resource.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
