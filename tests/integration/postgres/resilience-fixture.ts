import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import {
  navigationModelObservation,
  navigationModelValidation,
} from "../../support/navigation-model-fixture";
import { navigationTransportInputSchema } from "../../../packages/navigation-core/contracts-navigation";
import {
  AUTHORIZATION_CONSENT_POLICIES,
  type ConsentPurpose,
} from "../../../packages/navigation-core/contracts-authorization";
import { SERVICE_ACCOUNT_BINDING_HEADER } from "../../../packages/navigation-core/contracts-service";
import { createRuntimeActor } from "./runtime-actor";

export type RuntimeActor = Awaited<ReturnType<typeof createRuntimeActor>>;
export async function eventually(
  work: () => Promise<boolean>,
  timeout = 30000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Bounded resilience phase deadline exceeded.");
}
/** The host sees phase names only. Credentials and lease tokens stay in this process. */
export async function resiliencePhase(name: string) {
  assert.match(name, /^[a-z][a-z0-9-]{0,60}$/);
  process.stdout.write(JSON.stringify({ phase: name }) + "\n");
  await eventually(
    async () =>
      access(`/tmp/tholi-resilience-${name}`).then(
        () => true,
        () => false,
      ),
    60000,
  );
}
export function decisionInput() {
  const observation = navigationModelObservation();
  const requestId = randomUUID();
  observation.stamp.requestId = requestId;
  observation.stamp.journeyId = randomUUID();
  return navigationTransportInputSchema.parse({
    requestId,
    profile: "fake",
    observation,
    validation: navigationModelValidation(observation),
    policy: { timeoutMs: 5000 },
  });
}
/** All callers select a tested replica explicitly. No cookie, DNS or sticky-session affinity. */
export function replicaClient(origins: readonly string[]) {
  const send = async (
    replica: number,
    path: string,
    actor?: RuntimeActor,
    method = "GET",
    body?: unknown,
  ) => {
    const response = await fetch(new URL(path, origins[replica]), {
      method,
      headers: {
        ...(actor
          ? {
              authorization: `Bearer ${actor.token}`,
              [SERVICE_ACCOUNT_BINDING_HEADER]: actor.account.accountId,
            }
          : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response;
  };
  const request = async (
    replica: number,
    path: string,
    actor?: RuntimeActor,
    method = "GET",
    body?: unknown,
    expected = 200,
  ) => {
    const response = await send(replica, path, actor, method, body);
    if (response.status !== expected)
      process.stdout.write(
        JSON.stringify({
          httpFailure: { replica, method, status: response.status, expected },
        }) + "\n",
      );
    assert.equal(
      response.status,
      expected,
      `Replica ${replica} ${method} ${path.split("?")[0]} status`,
    );
    return response;
  };
  const json = async <T>(...args: Parameters<typeof request>) =>
    (await (await request(...args)).json()) as T;
  const enroll = (replica: number, actor: RuntimeActor) =>
    json<{
      grant: { id: string };
      effective: { periodStart: string };
      replayed: boolean;
    }>(
      replica,
      `/api/v1/workspaces/${actor.account.workspaceId}/entitlements/free`,
      actor,
      "POST",
      {},
    );
  const consent = async (
    replica: number,
    actor: RuntimeActor,
    purposes: readonly ConsentPurpose[],
  ) => {
    for (const policy of AUTHORIZATION_CONSENT_POLICIES.filter((p) =>
      purposes.includes(p.purpose),
    ))
      await request(
        replica,
        `/api/v1/workspaces/${actor.account.workspaceId}/consents`,
        actor,
        "POST",
        { ...policy, granted: true, expectedRevision: "0" },
      );
  };
  return { send, request, json, enroll, consent };
}
