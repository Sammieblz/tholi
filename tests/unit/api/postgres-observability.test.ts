import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import {
  NO_OBSERVABILITY,
  type Observability,
} from "../../../apps/api/src/application/observability";
import {
  createDatabasePool,
  withTransaction,
} from "../../../apps/api/src/database/postgres";
import {
  appendSecurityAudit,
  readSecurityAudit,
} from "../../../apps/api/src/database/audit";

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Pool: class extends EventEmitter {
      totalCount = 1;
      idleCount = 0;
      waitingCount = 0;
      failure?: Error;
      rollbackFailure = false;
      client = {
        query: vi.fn(async (query: string) => {
          if (this.rollbackFailure && query === "ROLLBACK")
            throw new Error("ROLLBACK_PRIVATE_SENTINEL");
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      connect(
        callback?: (
          error: Error | undefined,
          client: unknown,
          release: () => void,
        ) => void,
      ) {
        if (callback) {
          queueMicrotask(() =>
            callback(
              this.failure,
              this.failure ? undefined : this.client,
              this.client.release,
            ),
          );
          return;
        }
        return this.failure
          ? Promise.reject(this.failure)
          : Promise.resolve(this.client);
      }
    },
  };
});

type FakePool = Pool & {
  failure?: Error;
  rollbackFailure: boolean;
  client: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
};
const connectionString =
  "postgres://user:CONNECTION_PRIVATE_SENTINEL@localhost/db";
function instrumented() {
  const observations: unknown[] = [];
  const observer: Observability = {
    ...NO_OBSERVABILITY,
    enabled: true,
    start: (operation, fields) => ({
      correlation: undefined,
      end: (outcome, extra) =>
        observations.push({ operation, fields, outcome, extra }),
    }),
    metric: (name, value, fields) => observations.push({ name, value, fields }),
  };
  return {
    pool: createDatabasePool({ connectionString }, observer) as FakePool,
    observations,
  };
}

describe("PostgreSQL observability boundary", () => {
  test("preserves promise and callback pool acquisition and emits only safe waits counts and idle failures", async () => {
    const { pool, observations } = instrumented();
    expect(await pool.connect()).toBe(pool.client);
    await new Promise<void>((resolve, reject) =>
      pool.connect((error, client, release) => {
        if (error) {
          reject(error);
          return;
        }
        expect(client).toBe(pool.client);
        expect(release).toBe(pool.client.release);
        resolve();
      }),
    );
    pool.emit("error", new Error("IDLE_PRIVATE_SENTINEL"));
    expect(
      observations.filter(
        (value) =>
          (value as { operation?: string }).operation === "database.connect",
      ),
    ).toHaveLength(2);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "database.pool.wait_ms" }),
        expect.objectContaining({ name: "database.pool.total", value: 1 }),
        expect.objectContaining({
          name: "database.failures",
          fields: { outcome: "unavailable" },
        }),
      ]),
    );
    expect(JSON.stringify(observations)).not.toMatch(
      /PRIVATE_SENTINEL|postgres:|password|SELECT/,
    );
  });

  test("does not replace original acquisition or rollback errors with telemetry payloads", async () => {
    const { pool, observations } = instrumented();
    const failure = new Error("DRIVER_PRIVATE_SENTINEL");
    pool.failure = failure;
    await expect(pool.connect()).rejects.toBe(failure);
    await new Promise<void>((resolve) =>
      pool.connect((error) => {
        expect(error).toBe(failure);
        resolve();
      }),
    );
    pool.failure = undefined;
    pool.rollbackFailure = true;
    await expect(
      withTransaction(pool, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(pool.client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(observations).toContainEqual(
      expect.objectContaining({
        operation: "database.transaction",
        outcome: "error",
      }),
    );
    expect(JSON.stringify(observations)).not.toContain("PRIVATE_SENTINEL");
  });

  test("rejects free-form audit metadata and unbounded operator exports before SQL", async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(
      appendSecurityAudit(
        client as never,
        {
          accountId: randomUUID(),
          kind: "session.revoked",
          subjectId: randomUUID(),
          details: { goal: "AUDIT_PRIVATE_SENTINEL" },
        } as never,
      ),
    ).rejects.toThrow();
    for (const input of [
      {},
      { accountId: randomUUID(), limit: 101 },
      { accountId: randomUUID(), query: "SELECT *" },
    ])
      await expect(readSecurityAudit(client as never, input)).rejects.toThrow();
    expect(client.query).not.toHaveBeenCalled();
  });
});
