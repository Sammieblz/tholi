import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  AccountService,
  createAccountDeletionHandler,
  type AccountStore,
} from "../../../apps/api/src/application/account";
import { RepositoryError } from "../../../apps/api/src/database/contracts";
import {
  accountExportManifestSchema,
  accountExportPartSchema,
  type AccountDeletionResult,
} from "../../../packages/navigation-core/contracts-account";
import {
  privateExportBytes,
  validatePrivateFile,
} from "../../../apps/api/src/application/private-files";

function fixture() {
  const principal = {
    id: randomUUID(),
    accountId: randomUUID(),
    workspaceId: randomUUID(),
  };
  const status = {
    generation: randomUUID(),
    requestId: randomUUID(),
    jobId: randomUUID(),
    fileId: randomUUID(),
    preparation: "partial" as const,
    delivery: "pending" as const,
    continuation: "opaque-owned-cursor",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const deletion = {
    requestId: randomUUID(),
    jobId: randomUUID(),
    status: "deletion_pending" as const,
    signedOut: true as const,
    retained: [
      "identity-and-abuse-prevention",
      "financial-liabilities",
      "security-audit",
      "deletion-tombstones",
    ] as AccountDeletionResult["retained"],
  };
  const store: AccountStore = {
    prepareExport: vi.fn(async () => status),
    exportStatus: vi.fn(async () => status),
    listExports: vi.fn(async () => ({ items: [status] })),
    requestDeletion: vi.fn(async () => structuredClone(deletion)),
    cleanupDeletion: vi.fn(async () => {}),
  };
  const controller = new AbortController(),
    context = {
      requestId: randomUUID(),
      deadlineAt: Date.now() + 25000,
      signal: controller.signal,
    };
  const service = new AccountService(store, {
    exportsAvailable: true,
    deletionAvailable: true,
  });
  return { principal, status, deletion, store, controller, context, service };
}

test("account export uses actual account authority and validates owned continuations before database work", async () => {
  const f = fixture(),
    input = {
      idempotencyKey: randomUUID(),
      continuation: "opaque-owned-cursor",
    };
  const supplied = { ...f.principal, accessHash: "PRIVATE_SESSION_HASH" };
  expect(await f.service.requestExport(supplied, input, f.context)).toEqual(
    f.status,
  );
  expect(f.store.prepareExport).toHaveBeenCalledWith(
    f.principal,
    input,
    f.context.signal,
  );
  expect(
    await f.service.listExports(f.principal, { limit: 1 }, f.context),
  ).toEqual({ items: [f.status] });
  expect(() =>
    f.service.requestExport(
      f.principal,
      { ...input, accountId: randomUUID() },
      f.context,
    ),
  ).toThrow();
  expect(() =>
    f.service.requestExport(
      f.principal,
      { ...input, continuation: "http://foreign.test/data" },
      f.context,
    ),
  ).toThrow();
  expect(f.store.prepareExport).toHaveBeenCalledTimes(1);
  vi.mocked(f.store.prepareExport).mockRejectedValue(
    new RepositoryError("CONFLICT", "PRIVATE_SQL"),
  );
  await expect(
    f.service.requestExport(f.principal, input, f.context),
  ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
});

test("account lifecycle availability and cancellation prevent dispatch without consuming credits", async () => {
  const f = fixture(),
    input = {
      operationId: randomUUID(),
      expectedRevision: "1",
      confirmation: "DELETE",
    };
  const disabled = new AccountService(f.store, {
    exportsAvailable: false,
    deletionAvailable: false,
  });
  expect(() =>
    disabled.requestExport(
      f.principal,
      { idempotencyKey: randomUUID() },
      f.context,
    ),
  ).toThrow("unavailable");
  expect(() => disabled.deleteAccount(f.principal, input, f.context)).toThrow(
    "unavailable",
  );
  f.controller.abort();
  await expect(
    f.service.deleteAccount(f.principal, input, f.context),
  ).rejects.toThrow();
  expect(f.store.requestDeletion).not.toHaveBeenCalled();
});

test("account deletion requires the explicit self-account confirmation and reports pending cleanup honestly", async () => {
  const f = fixture(),
    input = {
      operationId: randomUUID(),
      expectedRevision: "1",
      confirmation: "DELETE",
    };
  expect(await f.service.deleteAccount(f.principal, input, f.context)).toEqual(
    f.deletion,
  );
  for (const forged of [
    { ...input, accountId: randomUUID() },
    { ...input, confirmation: "yes" },
    { ...input, expectedRevision: "0" },
  ])
    expect(() =>
      f.service.deleteAccount(f.principal, forged, f.context),
    ).toThrow();
  expect(f.store.requestDeletion).toHaveBeenCalledTimes(1);
  const handler = createAccountDeletionHandler(f.store);
  await expect(
    handler.execute(
      { kind: "file.expire", version: 1 } as never,
      new AbortController().signal,
      1000,
    ),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_JOB" });
  expect(f.store.cleanupDeletion).not.toHaveBeenCalled();
});

test("private account exports reject authentication fields, arbitrary sections and false completeness", () => {
  const f = fixture(),
    at = new Date().toISOString();
  const part = {
    schemaVersion: 1,
    kind: "account-export-part",
    generation: f.status.generation,
    accountId: f.principal.accountId,
    workspaceId: null,
    cutoff: at,
    section: "profile",
    items: [
      {
        accountId: f.principal.accountId,
        revision: "1",
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
  expect(accountExportPartSchema.parse(part)).toEqual(part);
  expect(() =>
    accountExportPartSchema.parse({
      ...part,
      items: [{ ...part.items[0], accessHash: "PRIVATE_TOKEN_HASH" }],
    }),
  ).toThrow();
  expect(() =>
    accountExportPartSchema.parse({ ...part, section: "raw_database" }),
  ).toThrow();
  const encoded = privateExportBytes(part, "account-export-part");
  const file = {
    id: f.status.fileId,
    requestId: f.status.requestId,
    revision: 1n,
    key: `exports/${f.principal.workspaceId}/${f.status.fileId}.json`,
    purpose: "account-export-part" as const,
    ...encoded,
    contentType: "application/json" as const,
    status: "ready" as const,
    expiresAt: new Date(Date.now() + 3600000),
  };
  expect(validatePrivateFile(file, encoded.body)).toEqual(part);
  expect(() =>
    validatePrivateFile({ ...file, purpose: "diagnostic" }, encoded.body),
  ).toThrow();
  const manifest = {
    schemaVersion: 1,
    kind: "account-export-manifest",
    generation: f.status.generation,
    accountId: f.principal.accountId,
    startedAt: at,
    completedAt: at,
    cutoff: at,
    consistency: "collected-over-interval",
    scope: { workspaces: "current-memberships", workspaceIds: [] },
    parts: [],
    previousManifestFileId: null,
    continuation: "owned-cursor",
    complete: false,
    omissions: [],
  };
  expect(accountExportManifestSchema.parse(manifest).complete).toBe(false);
  expect(() =>
    accountExportManifestSchema.parse({ ...manifest, complete: true }),
  ).toThrow();
  expect(() =>
    accountExportManifestSchema.parse({
      ...manifest,
      continuation: null,
      complete: true,
      omissions: [
        { workspaceId: null, section: "saved_data", reason: "not-exportable" },
      ],
    }),
  ).toThrow();
});
