import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createBillingLinkCipher,
  validateBillingLinkKeyring,
} from "../../../apps/api/src/adapters/billing-secrets";
import { createProviderSecretCipher } from "../../../apps/api/src/adapters/provider-secrets";
import { BillingSecretError } from "../../../apps/api/src/application/billing-contracts";
import { ProviderSecretError } from "../../../apps/api/src/application/provider-connections";
import { BILLING_LIMITS } from "../../../packages/navigation-core/contracts-billing";

const ring = {
    version: 1 as const,
    activeVersion: "billing-test-v1",
    keys: { "billing-test-v1": Buffer.alloc(32, 31).toString("base64url") },
  },
  started = Date.parse("2026-11-18T00:00:00Z"),
  binding = () => ({
    accountId: randomUUID(),
    workspaceId: randomUUID(),
    operationId: randomUUID(),
    profileRevision: "1",
    expiresAt: new Date(started + 60000).toISOString(),
  }),
  url =
    "https://billing.stripe.com/p/session?secret=synthetic-portal-capability";

test("billing handoffs bind account, workspace, operation, profile and expiry and cannot be read as provider credentials", async () => {
  const cipher = createBillingLinkCipher(ring, () => new Date(started)),
    scope = binding(),
    sealed = await cipher.seal(scope, url);
  expect(JSON.stringify(sealed)).not.toContain(url);
  expect(await cipher.open(scope, sealed)).toBe(url);
  for (const change of [
    { accountId: randomUUID() },
    { workspaceId: randomUUID() },
    { operationId: randomUUID() },
    { profileRevision: "2" },
    { expiresAt: new Date(started + 61000).toISOString() },
  ])
    await expect(
      cipher.open({ ...scope, ...change }, sealed),
    ).rejects.toBeInstanceOf(BillingSecretError);
  // Deliberately reuse synthetic key material to establish namespace isolation independently of configuration.
  const providers = createProviderSecretCipher(ring),
    providerScope = {
      accountId: scope.accountId,
      connectionId: scope.operationId,
      provider: "openai" as const,
      revision: "1",
    };
  await expect(providers.open(providerScope, sealed)).rejects.toBeInstanceOf(
    ProviderSecretError,
  );
  await expect(
    cipher.open(
      scope,
      await providers.seal(providerScope, "synthetic-provider-key"),
    ),
  ).rejects.toBeInstanceOf(BillingSecretError);
});

test("billing handoff rotation retains valid old envelopes but expiry and overlong lifetimes fail closed", async () => {
  let time = started;
  const now = () => new Date(time),
    scope = binding(),
    old = createBillingLinkCipher(ring, now),
    sealed = await old.seal(scope, url),
    rotated = createBillingLinkCipher(
      {
        version: 1,
        activeVersion: "billing-test-v2",
        keys: {
          ...ring.keys,
          "billing-test-v2": Buffer.alloc(32, 32).toString("base64url"),
        },
      },
      now,
    );
  expect(await rotated.open(scope, sealed)).toBe(url);
  expect((await rotated.seal(scope, url)).keyVersion).toBe("billing-test-v2");
  await expect(
    rotated.seal(
      {
        ...scope,
        expiresAt: new Date(
          time + (BILLING_LIMITS.returnSeconds + 1) * 1000,
        ).toISOString(),
      },
      url,
    ),
  ).rejects.toBeInstanceOf(BillingSecretError);
  time = Date.parse(scope.expiresAt);
  await expect(rotated.open(scope, sealed)).rejects.toBeInstanceOf(
    BillingSecretError,
  );
  await expect(rotated.seal(scope, url)).rejects.toBeInstanceOf(
    BillingSecretError,
  );
});

test("billing cipher rejects noncanonical operator keys and unsafe URL capabilities with closed errors", async () => {
  expect(() =>
    validateBillingLinkKeyring({
      ...ring,
      keys: { "billing-test-v1": "A".repeat(42) + "B" },
    }),
  ).toThrow(BillingSecretError);
  const cipher = createBillingLinkCipher(ring, () => new Date(started));
  for (const value of [
    "javascript:alert(1)",
    "http://example.test/portal",
    "https://user:synthetic@example.test/portal",
    "https://example.test/portal#secret",
  ])
    await expect(cipher.seal(binding(), value)).rejects.toBeInstanceOf(
      BillingSecretError,
    );
});
