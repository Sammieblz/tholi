import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig } from "../../../apps/api/src/config";
import type { ManagedApplication } from "../../../apps/api/src/runtime";
import { createWorkerRuntime, startWorker } from "../../../apps/api/src/worker";

const boundaries = vi.hoisted(() => ({
  database: vi.fn(),
  constructed: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
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
    ready = () => false;
    lastHealthyAt = () => 0;
    constructor() {
      boundaries.constructed();
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
