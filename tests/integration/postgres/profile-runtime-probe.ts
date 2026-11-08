import assert from "node:assert/strict";
import { createDatabasePool } from "../../../apps/api/src/database/postgres";
import { createRuntimeActor } from "./runtime-actor";
import { SERVICE_ACCOUNT_BINDING_HEADER } from "../../../packages/navigation-core/contracts-service";

/** Controlled database identity, not a claim of real production OIDC verification. */
export async function runProfileRuntimeProbe(runtimeConnection: string) {
  const runtime = createDatabasePool({
    connectionString: runtimeConnection,
    max: 1,
  });
  try {
    const actor = await createRuntimeActor(runtime);
    const request = (token: string, accountId: string) =>
      fetch("http://api:8788/api/v1/account/profile", {
        headers: {
          Authorization: "Bearer " + token,
          [SERVICE_ACCOUNT_BINDING_HEADER]: accountId,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
    const response = await request(actor.token, actor.account.accountId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.body?.cancel();
    const denied = await request("invalid", actor.account.accountId);
    assert.equal(denied.status, 401);
    await denied.body?.cancel();
    return {
      passed: true,
      scope: actor.account,
      authenticatedRead: true,
      missingProofDenied: true,
    };
  } finally {
    await runtime.end();
  }
}
