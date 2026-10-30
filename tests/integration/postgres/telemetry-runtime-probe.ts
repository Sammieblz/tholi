import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createDatabasePool } from "../../../apps/api/src/database/postgres";
import { correlationSchema } from "../../../apps/api/src/application/observability";
import { createRuntimeActor } from "./runtime-actor";

/** Synthetic local-only transport proof. Return identifiers, never sentinels or credentials. */
export async function runTelemetryRuntimeProbe(options: {
  phase: "submit" | "complete";
  jobId?: string;
  sentinel: string;
  apiUrl: string;
  migrationConnection: string;
  runtimeConnection: string;
}) {
  const base = new URL(options.apiUrl);
  if (
    base.origin !== "http://api:8788" ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error("PostgreSQL check failed: local telemetry probe origin.");
  const marker = z
    .string()
    .regex(/^[A-Za-z0-9_-]{24,64}$/)
    .parse(options.sentinel);
  const migration = createDatabasePool({
    connectionString: options.migrationConnection,
    max: 1,
  });
  const runtime = createDatabasePool({
    connectionString: options.runtimeConnection,
    max: 1,
  });
  const readJob = async (id: string) =>
    (
      await migration.query<{
        id: string;
        status: string;
        attempts: number;
        last_error_code: string | null;
        origin_correlation: unknown;
      }>(
        "SELECT id,status,attempts,last_error_code,origin_correlation FROM tholi.jobs WHERE id=$1",
        [id],
      )
    ).rows[0];
  const waitFor = async (id: string, complete: boolean) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const job = await readJob(id);
      assert.ok(job);
      assert.ok(
        !["failed", "dead", "cancelled", "uncertain"].includes(job.status),
      );
      if (
        complete
          ? job.status === "succeeded" && job.attempts >= 2
          : job.status === "queued" &&
            job.attempts >= 1 &&
            job.last_error_code === "UNAVAILABLE"
      )
        return job;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      "PostgreSQL check failed: telemetry worker retry deadline.",
    );
  };
  try {
    if (options.phase === "complete") {
      const id = z.string().uuid().parse(options.jobId);
      const before = await readJob(id);
      assert.ok(before);
      const origin = correlationSchema.parse(before.origin_correlation);
      const finished = await waitFor(id, true);
      assert.deepEqual(
        correlationSchema.parse(finished.origin_correlation),
        origin,
      );
      return {
        passed: true as const,
        jobId: id,
        correlation: origin,
        attempts: finished.attempts,
      };
    }
    const actor = await createRuntimeActor(runtime, marker + "TOKEN");
    const begin = await fetch(
      new URL(
        "/api/v1/auth/authorize?clientId=web&action=signin&destination=account",
        base,
      ),
      {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.equal(begin.status, 302);
    const redirect = new URL(begin.headers.get("location")!);
    const state = redirect.searchParams.get("state");
    assert.ok(state);
    const cookie = begin.headers
      .getSetCookie()
      .find((value) => value.startsWith("tholi_flow="))
      ?.split(";", 1)[0];
    assert.ok(cookie);
    const callback = new URL("/api/v1/auth/callback", base);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", marker + "AUTHCODE");
    const failed = await fetch(callback, {
      headers: { Cookie: cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.ok(failed.status >= 400 && failed.status < 600);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    const failedProviderRequestId = z
      .string()
      .uuid()
      .parse(failed.headers.get("x-request-id"));
    await failed.body?.cancel();
    const unmatched = new URL("/__private_telemetry_probe", base);
    unmatched.searchParams.set(
      "privateUrl",
      "https://private.example.invalid/" + marker,
    );
    unmatched.searchParams.set("goal", marker + "GOAL");
    const missing = await fetch(unmatched, {
      headers: { Authorization: "Bearer " + actor.token },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(missing.status, 404);
    await missing.body?.cancel();
    const submitted = await fetch(new URL("/api/v1/support/requests", base), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: "Bearer " + actor.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        name: marker,
        email: "synthetic@example.invalid",
        topic: "Support",
        subject: marker,
        message: JSON.stringify({
          goal: marker + "GOAL",
          privateUrl: "https://private.example.invalid/" + marker,
          prompt: marker + "PROMPT",
          screenshot: "data:image/png;base64," + marker,
          secret: marker + "SECRET",
        }),
      }),
    });
    assert.equal(submitted.status, 200);
    const requestId = z
      .string()
      .uuid()
      .parse(submitted.headers.get("x-request-id"));
    const body = z
      .object({ operatorJobId: z.string().uuid() })
      .passthrough()
      .parse(await submitted.json());
    const job = await waitFor(body.operatorJobId, false);
    const correlation = correlationSchema.parse(job.origin_correlation);
    assert.equal(correlation.requestId, requestId);
    return {
      passed: true as const,
      jobId: job.id,
      correlation,
      failedProviderRequestId,
    };
  } finally {
    await Promise.all([runtime.end(), migration.end()]);
  }
}
