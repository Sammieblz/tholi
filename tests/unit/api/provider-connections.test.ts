import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ProviderConnectionService,
  ProviderSecretError,
  type ProviderSecretBinding,
} from "../../../apps/api/src/application/provider-connections";
import {
  createProviderSecretCipher,
  validateProviderSecretKeyring,
} from "../../../apps/api/src/adapters/provider-secrets";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  providerConnectionSelection,
} from "../../../packages/navigation-core/contracts-providers";
import {
  providerConnectionStoreFixture as fixture,
  providerTestContext as context,
  providerTestKeyring as ring,
} from "../../support/provider-connection-store";

const binding = (): ProviderSecretBinding => ({
  accountId: randomUUID(),
  connectionId: randomUUID(),
  provider: "openai",
  revision: "1",
});

test("provider credentials use randomized authenticated encryption bound to owner, connection, provider, revision and key version", async () => {
  const cipher = createProviderSecretCipher(ring),
    scope = binding();
  const sealed = await cipher.seal(scope, "synthetic-provider-key"),
    other = await cipher.seal(scope, "synthetic-provider-key");
  expect(sealed).not.toEqual(other);
  expect(JSON.stringify(sealed)).not.toContain("synthetic-provider-key");
  expect(await cipher.open(scope, sealed)).toBe("synthetic-provider-key");
  for (const changed of [
    { accountId: randomUUID() },
    { connectionId: randomUUID() },
    { provider: "anthropic" as const },
    { revision: "2" },
  ])
    await expect(
      cipher.open({ ...scope, ...changed }, sealed),
    ).rejects.toBeInstanceOf(ProviderSecretError);
  for (const field of ["ciphertext", "iv", "tag"] as const) {
    const value = sealed[field];
    await expect(
      cipher.open(scope, {
        ...sealed,
        [field]: (value[0] === "A" ? "B" : "A") + value.slice(1),
      }),
    ).rejects.toBeInstanceOf(ProviderSecretError);
  }
  await expect(
    cipher.open(scope, { ...sealed, keyVersion: "unknown" }),
  ).rejects.toBeInstanceOf(ProviderSecretError);
});

test("keyring rotation can read retained versions without accepting unknown, noncanonical or shared-length keys", async () => {
  const scope = binding(),
    old = createProviderSecretCipher(ring),
    sealed = await old.seal(scope, "synthetic-key");
  const rotated = createProviderSecretCipher({
    version: 1,
    activeVersion: "test-v2",
    keys: {
      ...ring.keys,
      "test-v2": Buffer.alloc(32, 82).toString("base64url"),
    },
  });
  expect(await rotated.open(scope, sealed)).toBe("synthetic-key");
  expect((await rotated.seal(scope, "synthetic-key")).keyVersion).toBe(
    "test-v2",
  );
  const missing = createProviderSecretCipher({
    version: 1,
    activeVersion: "test-v2",
    keys: { "test-v2": Buffer.alloc(32, 82).toString("base64url") },
  });
  await expect(missing.open(scope, sealed)).rejects.toBeInstanceOf(
    ProviderSecretError,
  );
  for (const raw of [
    { ...ring, version: 2 },
    { ...ring, activeVersion: "missing" },
    { ...ring, keys: { "test-v1": "x".repeat(43) } },
    { ...ring, keys: { "test-v1": "A".repeat(42) + "B" } },
  ])
    expect(() => validateProviderSecretKeyring(raw)).toThrow(
      ProviderSecretError,
    );
});

test("saving a curated explicit model returns only unverified metadata and stores encrypted account-scoped credentials", async () => {
  const app = fixture(),
    connection = await app.create();
  expect(connection).toMatchObject({
    provider: "openai",
    status: "active",
    revision: "1",
    verifiedAt: null,
  });
  const exposed = JSON.stringify(
    await app.service.list(app.principal, context()),
  );
  for (const privateValue of [
    "synthetic-provider-key",
    "sealedKey",
    "ciphertext",
    "accountId",
  ])
    expect(exposed).not.toContain(privateValue);
  expect(app.records.get(connection.id)?.sealedKey?.keyVersion).toBe("test-v1");
  const use = vi.fn(async (key: string) => key.length);
  expect(
    await app.service.withCredential(
      app.principal,
      providerConnectionSelection(connection),
      context(),
      use,
    ),
  ).toBe("synthetic-provider-key".length);
  expect(use).toHaveBeenCalledOnce();
  expect(
    await app.service.list({ accountId: randomUUID() }, context()),
  ).toMatchObject({ items: [] });
  await expect(
    app.service.assertCurrent(
      { accountId: randomUUID() },
      providerConnectionSelection(connection),
      context(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("model/catalog changes require explicit supported selection and never create duplicate provider connections", async () => {
  const app = fixture(),
    input = {
      provider: "openai",
      model: getProviderDefinition("openai").model,
      catalogRevision: PROVIDER_CATALOG_REVISION,
      apiKey: "synthetic-key",
    };
  await expect(
    (async () =>
      app.service.create(
        app.principal,
        { ...input, model: "unlisted-model" },
        context(),
      ))(),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    (async () =>
      app.service.create(
        app.principal,
        { ...input, catalogRevision: "old" },
        context(),
      ))(),
  ).rejects.toMatchObject({ code: "COMPATIBILITY_MISMATCH" });
  await expect(
    (async () =>
      app.service.create(
        app.principal,
        { provider: "openai", apiKey: "synthetic-key" },
        context(),
      ))(),
  ).rejects.toThrow();
  expect(app.records.size).toBe(0);
  await app.create();
  await expect(app.create()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(app.records.size).toBe(1);
});

test("verification is revision-bound, rotation resets it, removal destroys ciphertext and reconnect preserves the connection identifier", async () => {
  const app = fixture(),
    first = await app.create(),
    selection = providerConnectionSelection(first);
  expect(
    await app.service.markVerified(app.principal, selection, context()),
  ).toBe(true);
  const unchanged = await app.service.replace(
    app.principal,
    first.id,
    {
      expectedRevision: "1",
      model: first.model,
      catalogRevision: first.catalogRevision,
    },
    context(),
  );
  expect(unchanged.revision).toBe("1");
  expect(unchanged.verifiedAt).not.toBeNull();
  const second = await app.service.replace(
    app.principal,
    first.id,
    {
      expectedRevision: "1",
      model: first.model,
      catalogRevision: first.catalogRevision,
      apiKey: "rotated-synthetic-key",
    },
    context(),
  );
  expect(second).toMatchObject({
    id: first.id,
    revision: "2",
    verifiedAt: null,
  });
  await expect(
    app.service.assertCurrent(app.principal, selection, context()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    app.service.remove(
      app.principal,
      first.id,
      { expectedRevision: "1" },
      context(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const removed = await new ProviderConnectionService(app.store).remove(
    app.principal,
    first.id,
    { expectedRevision: "2" },
    context(),
  );
  expect(removed).toMatchObject({
    status: "removed",
    revision: "3",
    verifiedAt: null,
  });
  expect(app.records.get(first.id)?.sealedKey).toBeNull();
  const third = await app.service.replace(
    app.principal,
    first.id,
    {
      expectedRevision: "3",
      model: first.model,
      catalogRevision: first.catalogRevision,
      apiKey: "reconnected-key",
    },
    context(),
  );
  expect(third).toMatchObject({
    id: first.id,
    status: "active",
    revision: "4",
    verifiedAt: null,
  });
  const verify = vi
    .spyOn(app.store, "markVerified")
    .mockRejectedValue(new Error("private storage error"));
  expect(
    await app.service.markVerified(
      app.principal,
      providerConnectionSelection(third),
      context(),
    ),
  ).toBe(false);
  expect(verify).toHaveBeenCalledOnce();
});

test("credential revocation during decryption prevents the outbound callback; callback results are not lost to a later metadata recheck", async () => {
  const app = fixture(),
    connection = await app.create(),
    selection = providerConnectionSelection(connection),
    callback = vi.fn(async () => "reported");
  const original = app.cipher.open;
  const racing = new ProviderConnectionService(app.store, {
    seal: app.cipher.seal,
    async open(scope, sealed) {
      const result = await original(scope, sealed);
      await app.service.remove(
        app.principal,
        connection.id,
        { expectedRevision: "1" },
        context(),
      );
      return result;
    },
  });
  await expect(
    racing.withCredential(app.principal, selection, context(), callback),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(callback).not.toHaveBeenCalled();
  const next = await app.service.replace(
    app.principal,
    connection.id,
    {
      expectedRevision: "2",
      model: connection.model,
      catalogRevision: connection.catalogRevision,
      apiKey: "synthetic-again",
    },
    context(),
  );
  expect(
    await app.service.withCredential(
      app.principal,
      providerConnectionSelection(next),
      context(),
      async () => {
        await app.service.remove(
          app.principal,
          next.id,
          { expectedRevision: next.revision },
          context(),
        );
        return "reported";
      },
    ),
  ).toBe("reported");
});
