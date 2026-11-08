import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import {
  validateIdentityOptions,
  type ServiceApiOptions,
} from "../../../apps/api/src/config";
import { createIdentityRuntime } from "../../../apps/api/src/adapters/service-identity";
import { createServiceApi } from "../../../apps/api/src/server";
import { NavigationTransportService } from "../../../apps/api/src/application/navigation";
import { createProviderInferencePolicy } from "../../../apps/api/src/application/provider-inference";
import { createFakeNavigationModel } from "../../../apps/api/src/adapters/fake-navigation-model";
import { ModelError } from "../../../apps/api/src/application/model-contracts";
import { createRuntimeActor } from "./runtime-actor";
import { decisionInput, eventually, replicaClient } from "./resilience-fixture";

/** Two independent HTTP compositions with real SQL and explicitly injected deterministic faults.
 * Container-image rolling/load evidence is collected separately; this is not live-provider evidence.
 */
export async function runResilienceModelChecks(
  migration: Pool,
  runtimeConnection: string,
) {
  const identity = validateIdentityOptions({
    issuer: "http://localhost:18080/realms/tholi-local",
    authorizationEndpoint: "http://localhost:18080/auth",
    tokenEndpoint: "http://oidc:8080/token",
    jwksUri: "http://oidc:8080/certs",
    endSessionEndpoint: "http://localhost:18080/logout",
    clientId: "fixture",
    clientSecret: randomBytes(32).toString("base64url"),
    flowEncryptionKey: randomBytes(32).toString("base64url"),
    callbackUrl: "http://localhost:8788/api/v1/auth/callback",
    webOrigin: "http://localhost:5174",
    clients: [
      {
        id: "extension-chromium",
        kind: "extension",
        redirectUris: [
          "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/",
        ],
      },
    ],
    secureCookies: false,
    requireVerifiedEmail: true,
    accessLifetimeMs: 180000,
    sessionLifetimeMs: 600000,
  });
  const options: ServiceApiOptions = {
    origins: [identity.webOrigin],
    identity,
    database: { connectionString: runtimeConnection, max: 4 },
    plans: { environment: "development" },
    navigation: { provider: "fake" },
    transport: {
      maxConcurrentRequests: 2,
      maxConcurrentPerAccount: 1,
      controlReserve: 2,
    },
  };
  const apps: FastifyInstance[] = [],
    origins: string[] = [];
  const fake = createFakeNavigationModel();
  let mode: "normal" | "throttle" | "unknown" | "held" = "normal",
    calls = 0,
    entered = 0,
    release = () => {};
  let held = Promise.resolve();
  const hold = () => {
    mode = "held";
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const open = async () => {
    const runtime = await createIdentityRuntime(
      identity,
      options.database!,
      undefined,
      undefined,
      false,
      "development",
    );
    const model = {
      async infer(...args: Parameters<typeof fake.infer>) {
        calls++;
        entered++;
        if (mode === "throttle")
          throw new ModelError("THROTTLED", {
            outcome: "not-sent",
            retryAfterMs: 1500,
          });
        if (mode === "unknown")
          throw new ModelError("UNAVAILABLE", { outcome: "unknown" });
        if (mode === "held") await held;
        return fake.infer(...args);
      },
    };
    const navigation = new NavigationTransportService(
      runtime.repositories,
      model,
      createProviderInferencePolicy(
        runtime.repositories,
        model,
        runtime.providers,
        runtime.savedData,
        "development",
      ),
    );
    try {
      const app = await createServiceApi(options, runtime.resources, {
        ...runtime,
        identity: runtime.service,
        navigation,
      });
      try {
        const origin = await app.listen({ host: "127.0.0.1", port: 0 });
        return { app, origin };
      } catch (error) {
        await app.close();
        throw error;
      }
    } catch (error) {
      await Promise.allSettled(
        runtime.resources.map((resource) => resource.close()),
      );
      throw error;
    }
  };
  let stage = "composition";
  const checks: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const node = await open();
      apps.push(node.app);
      origins.push(node.origin);
    }
    const client = replicaClient(origins);
    const actor = async () => {
      const value = await createRuntimeActor(migration);
      await client.enroll(0, value);
      await client.consent(0, value, ["cloud_inference"]);
      return value;
    };
    const requestState = async (id: string) =>
      (
        await migration.query("SELECT status FROM tholi.requests WHERE id=$1", [
          id,
        ])
      ).rows[0]?.status;
    const ledgerState = async (id: string) =>
      (
        await migration.query(
          "SELECT state FROM tholi.inference_reservations WHERE request_id=$1",
          [id],
        )
      ).rows[0]?.state;
    stage = "throttling";
    mode = "throttle";
    const throttled = await actor(),
      input = decisionInput(),
      path = `/api/v1/workspaces/${throttled.account.workspaceId}/decisions`;
    const response = await client.request(
      0,
      path,
      throttled,
      "POST",
      input,
      429,
    );
    assert.equal(response.headers.get("retry-after"), "2");
    assert.equal(await ledgerState(input.requestId), "released");
    const count = calls;
    const replay = await client.json<{ replayed: boolean; decision?: unknown }>(
      1,
      path,
      throttled,
      "POST",
      input,
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.decision, undefined);
    assert.equal(calls, count);
    checks.push("throttle-releases-unsent-hold-without-automatic-retry");
    stage = "unknown-outcome";
    mode = "unknown";
    const uncertain = await actor(),
      unknown = decisionInput(),
      unknownPath = `/api/v1/workspaces/${uncertain.account.workspaceId}/decisions`;
    await client.request(0, unknownPath, uncertain, "POST", unknown, 503);
    assert.equal(await ledgerState(unknown.requestId), "uncertain");
    const before = calls;
    await client.request(1, unknownPath, uncertain, "POST", unknown);
    assert.equal(calls, before);
    checks.push("unknown-outcome-fences-replay-and-retains-hold");
    stage = "noisy-account-and-cross-replica-cancellation";
    const noisy = await actor(),
      neighbor = await actor(),
      pending = decisionInput(),
      pendingPath = `/api/v1/workspaces/${noisy.account.workspaceId}/decisions`;
    hold();
    const enteredBefore = entered;
    const operation = client.request(
      0,
      pendingPath,
      noisy,
      "POST",
      pending,
      409,
    );
    await eventually(async () => entered > enteredBefore);
    stage = "noisy-neighbor-admission";
    await client.request(
      0,
      "/api/v1/account/profile",
      noisy,
      "GET",
      undefined,
      429,
    );
    await client.request(0, "/api/v1/account/profile", neighbor);
    stage = "shared-foreground-admission";
    const quota = await client.json<{ error: { code: string } }>(
      1,
      pendingPath,
      noisy,
      "POST",
      decisionInput(),
      409,
    );
    assert.equal(quota.error.code, "CONFLICT");
    assert.equal(entered, enteredBefore + 1);
    await client.request(0, "/health/live");
    stage = "cross-replica-cancel";
    const cancelled = await client.json<{
      cancelRequested: boolean;
      cancellationConfirmed: boolean;
      status: string;
    }>(1, pendingPath + "/" + pending.requestId + "/cancel", noisy, "POST", {});
    assert.equal(cancelled.cancelRequested, true);
    assert.equal(cancelled.cancellationConfirmed, false);
    release();
    stage = "cancelled-original-settlement";
    await operation;
    assert.equal(await requestState(pending.requestId), "uncertain");
    checks.push(
      "verified-noisy-account-isolation-and-cross-replica-cancellation",
    );
    stage = "listener-drain-and-evidence-loss";
    const drained = await actor(),
      lost = decisionInput(),
      lostPath = `/api/v1/workspaces/${drained.account.workspaceId}/decisions`;
    hold();
    const startedBefore = entered;
    const interrupted = client.request(0, lostPath, drained, "POST", lost, 503);
    await eventually(async () => entered > startedBefore);
    const closing = apps[0].close();
    await interrupted;
    release();
    await closing;
    assert.ok(
      ["pending", "uncertain", "cancelled"].includes(
        await requestState(lost.requestId),
      ),
    );
    const invoked = calls;
    const status = await client.json<{ decision?: unknown }>(
      1,
      lostPath + "/" + lost.requestId,
      drained,
    );
    assert.equal(status.decision, undefined);
    const repeated = await client.json<{
      replayed: boolean;
      decision?: unknown;
    }>(1, lostPath, drained, "POST", lost);
    assert.equal(repeated.replayed, true);
    assert.equal(repeated.decision, undefined);
    assert.equal(calls, invoked);
    const replacement = await open();
    apps[0] = replacement.app;
    origins[0] = replacement.origin;
    await client.request(0, "/health/ready");
    mode = "normal";
    const retained = await client.json<{ decision?: unknown }>(
      0,
      lostPath + "/" + lost.requestId,
      drained,
    );
    assert.equal(retained.decision, undefined);
    assert.equal(calls, invoked);
    checks.push(
      "graceful-drain-and-restarted-replica-never-reconstructs-private-evidence",
    );
    return {
      passed: true,
      checks,
      modelInvocations: calls,
      externalModelCalls: 0,
      composition:
        "independent HTTP runtimes, real PostgreSQL, injected deterministic model",
    };
  } catch {
    process.stdout.write(
      JSON.stringify({ failedStage: "model-" + stage }) + "\n",
    );
    throw new Error("PostgreSQL check failed: model resilience " + stage + ".");
  } finally {
    release();
    await Promise.allSettled(apps.map((app) => app.close()));
  }
}
