import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLinks } from "../../../apps/api/src/adapters/file-links";
import { SupportService } from "../../../apps/api/src/application/support";
import { diagnosticBytes } from "../../../apps/api/src/application/private-files";
import { createSupportJobHandlers } from "../../../apps/api/src/application/support-jobs";
import type { JobLease } from "../../../apps/api/src/application/job-contracts";
import type {
  ApprovedMail,
  MailPort,
  ObjectPort,
  PreparedExternal,
  PrivateFile,
  SupportStore,
} from "../../../apps/api/src/application/support-contracts";
import { RepositoryError } from "../../../apps/api/src/database/contracts";
import { createObservability } from "../../../apps/api/src/adapters/observability";
import { OBSERVABILITY_DEFAULTS } from "../../../apps/api/src/application/observability";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const context = () => ({
  requestId: randomUUID(),
  deadlineAt: Date.now() + 25_000,
  signal: new AbortController().signal,
});
function fixture() {
  const principal = { accountId: randomUUID(), workspaceId: randomUUID() };
  const payload = diagnosticBytes({
    schemaVersion: 1,
    version: "0.11.0",
    profile: "service",
    accountStatus: "active",
    workspaceKind: "personal",
    role: "owner",
    jobs: {
      queued: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      dead: 0,
      cancelled: 0,
      uncertain: 0,
    },
  });
  const id = randomUUID(),
    requestId = randomUUID();
  const file: PrivateFile = {
    id,
    requestId,
    revision: 2n,
    key: `exports/${principal.workspaceId}/${id}.json`,
    bytes: payload.bytes,
    sha256: payload.sha256,
    contentType: "application/json",
    expiresAt: new Date(Date.now() + 3_600_000),
    status: "ready",
  };
  const store: SupportStore = {
    submit: vi.fn(async () => ({
      id: requestId,
      operatorJobId: randomUUID(),
      receiptJobId: randomUUID(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
    })),
    requestDiagnostic: vi.fn(async () => ({
      requestId,
      jobId: randomUUID(),
      fileId: id,
    })),
    getFile: vi.fn(async () => ({ ...file })),
    prepareExternal: vi.fn(async () => null),
    finishExternal: vi.fn(async () => true),
    prepareCleanup: vi.fn(async () => null),
    finishCleanup: vi.fn(async () => true),
    scheduleFileExpiry: vi.fn(async () => 1),
  };
  const objects: ObjectPort = {
    put: vi.fn(async () => {}),
    read: vi.fn(async () => payload.body),
    delete: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const links = createFileLinks(randomBytes(32).toString("base64url"));
  const service = new SupportService(store, objects, links, {
    publicOrigin: "https://api.example.test",
    linkLifetimeMs: 60_000,
  });
  const input = {
    idempotencyKey: "support-test-1",
    name: "Reader",
    email: "reply@example.test",
    topic: "Support",
    subject: "Finding settings",
    message: "Please help me find settings.",
  };
  const lease: JobLease = {
    id: randomUUID(),
    accountId: principal.accountId,
    workspaceId: principal.workspaceId,
    kind: "support.operator",
    version: 1,
    recordReferences: { requestId },
    attempts: 1,
    maxAttempts: 3,
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 30000),
  };
  const message: ApprovedMail = {
    template: "support.operator",
    templateVersion: 1,
    messageId: lease.id,
    requestId,
    name: "Reader",
    email: input.email,
    topic: "Support",
    subject: input.subject,
    message: input.message,
  };
  const prepared: PreparedExternal = {
    attemptId: randomUUID(),
    effectId: lease.id,
    commandHash: "a".repeat(64),
    command: { type: "mail", message },
  };
  const mail: MailPort = {
    send: vi.fn(async () => "accepted" as const),
    close: vi.fn(async () => {}),
  };
  return {
    principal,
    payload,
    file,
    store,
    objects,
    links,
    service,
    input,
    lease,
    message,
    prepared,
    mail,
  };
}

describe("approved support and private downloads", () => {
  it("binds canonical commands to server scope and rejects forged selectors before enqueue", async () => {
    const f = fixture();
    await f.service.submit(f.principal, f.input, context());
    await f.service.submit(
      f.principal,
      { ...f.input, idempotencyKey: "support-test-2" },
      context(),
    );
    const calls = vi.mocked(f.store.submit).mock.calls;
    expect(calls[0][0]).toEqual(f.principal);
    expect(calls[0][1].payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[0][1].payloadHash).toBe(calls[1][1].payloadHash);
    await expect(
      f.service.submit(
        f.principal,
        { ...f.input, accountId: randomUUID() },
        context(),
      ),
    ).rejects.toThrow();
    await expect(
      f.service.submit(
        f.principal,
        { ...f.input, subject: "Hello\r\nBcc: victim@example.test" },
        context(),
      ),
    ).rejects.toThrow();
    expect(f.store.submit).toHaveBeenCalledTimes(2);
  });
  it("returns safe rate errors and keeps requests cancelled before admission out of the store", async () => {
    const f = fixture();
    vi.mocked(f.store.submit).mockRejectedValue(
      new RepositoryError("RATE_LIMITED", "PRIVATE_SQL_SENTINEL"),
    );
    await expect(
      f.service.submit(f.principal, f.input, context()),
    ).rejects.toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
    const stop = new AbortController();
    stop.abort();
    await expect(
      f.service.diagnostic(
        f.principal,
        { idempotencyKey: "diagnostic-1" },
        { ...context(), signal: stop.signal },
      ),
    ).rejects.toThrow();
    expect(f.store.requestDiagnostic).not.toHaveBeenCalled();
  });
  it("issues application-only short links and serves only verified approved JSON", async () => {
    const f = fixture();
    const metadata = await f.service.getFile(f.principal, f.file.id, context());
    expect(JSON.stringify(metadata)).not.toMatch(
      /exports\/|sha256|contact|key/,
    );
    const link = await f.service.fileLink(
      f.principal,
      f.file.id,
      { expectedRevision: "2" },
      context(),
    );
    const url = new URL(link.url);
    expect(url.origin).toBe("https://api.example.test");
    expect(url.pathname).toBe(`/api/v1/account/files/${f.file.id}/download`);
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      60_000,
    );
    const response = await f.service.download(
      f.principal,
      f.file.id,
      url.searchParams.get("token")!,
      context(),
    );
    expect(response.body).toEqual(f.payload.body);
    expect(response.filename).toBe("tholi-diagnostic.json");
    expect(f.store.getFile).toHaveBeenCalledTimes(4);
  });
  it.each(["foreign-actor", "foreign-file", "stale-revision", "expired-proof"])(
    "rejects %s download proof before object access",
    async (condition) => {
      vi.useFakeTimers();
      const f = fixture();
      const proof = {
        ...f.principal,
        fileId: f.file.id,
        revision: "2",
        expiresAt: new Date(Date.now() + 2000),
      };
      if (condition === "foreign-actor") proof.accountId = randomUUID();
      if (condition === "foreign-file") proof.fileId = randomUUID();
      if (condition === "stale-revision") proof.revision = "1";
      const token = await f.links.issue(proof);
      if (condition === "expired-proof")
        await vi.advanceTimersByTimeAsync(3000);
      await expect(
        f.service.download(f.principal, f.file.id, token, context()),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(f.objects.read).not.toHaveBeenCalled();
    },
  );
  it("rechecks authorization after object I/O and never serves data after scope revocation", async () => {
    const f = fixture();
    const token = await f.links.issue({
      ...f.principal,
      fileId: f.file.id,
      revision: "2",
      expiresAt: new Date(Date.now() + 30_000),
    });
    vi.mocked(f.store.getFile)
      .mockResolvedValueOnce({ ...f.file })
      .mockRejectedValue(
        new RepositoryError("FORBIDDEN", "PRIVATE_SCOPE_SENTINEL"),
      );
    await expect(
      f.service.download(f.principal, f.file.id, token, context()),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(f.objects.read).toHaveBeenCalledOnce();
  });
  it("refuses changed object bytes, stale link requests and pending or expired files", async () => {
    const f = fixture();
    await expect(
      f.service.fileLink(
        f.principal,
        f.file.id,
        { expectedRevision: "1" },
        context(),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    f.file.status = "pending";
    await expect(
      f.service.fileLink(
        f.principal,
        f.file.id,
        { expectedRevision: "2" },
        context(),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    f.file.status = "ready";
    const token = await f.links.issue({
      ...f.principal,
      fileId: f.file.id,
      revision: "2",
      expiresAt: new Date(Date.now() + 30_000),
    });
    vi.mocked(f.objects.read).mockResolvedValue(
      Buffer.from("PRIVATE_UNAPPROVED_PAYLOAD"),
    );
    await expect(
      f.service.download(f.principal, f.file.id, token, context()),
    ).rejects.toThrow("verified");
    f.file.expiresAt = new Date(0);
    await expect(
      f.service.getFile(f.principal, f.file.id, context()),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("external job orchestration", () => {
  it.each([
    ["accepted", "committed", 0],
    ["not-sent", "retryable", 1000],
    ["uncertain", "uncertain", 0],
  ] as const)(
    "records SMTP %s without a SQL callback across I/O",
    async (receipt, status, backoffMs) => {
      const f = fixture();
      const lines: string[] = [];
      const observer = createObservability(
        { enabled: true, service: "tholi-worker", ...OBSERVABILITY_DEFAULTS },
        {
          write: (line, done) => {
            lines.push(line);
            done();
          },
        },
      );
      vi.mocked(f.store.prepareExternal).mockResolvedValue(f.prepared);
      vi.mocked(f.mail.send).mockImplementation(async () => {
        expect(f.store.prepareExternal).toHaveResolvedWith(f.prepared);
        return receipt;
      });
      const handler = createSupportJobHandlers(
        f.store,
        f.mail,
        f.objects,
        observer,
      ).find((h) => h.kind === f.lease.kind)!;
      try {
        await handler.execute(f.lease, new AbortController().signal, 1000);
      } finally {
        await observer.close();
      }
      expect(f.store.finishExternal).toHaveBeenCalledWith(
        f.lease,
        f.prepared.attemptId,
        expect.objectContaining({ status, backoffMs }),
      );
      const records = lines.flatMap((line) =>
        line
          .trim()
          .split("\n")
          .map((value) => JSON.parse(value)),
      );
      expect(
        records.find((record) => record.operation === "job.acknowledge")
          ?.outcome,
      ).toBe(status === "committed" ? "ok" : status);
    },
  );
  it("records a lost external finish fence as stale rather than successful delivery acknowledgement", async () => {
    const f = fixture();
    const lines: string[] = [];
    const observer = createObservability(
      { enabled: true, service: "tholi-worker", ...OBSERVABILITY_DEFAULTS },
      {
        write: (line, done) => {
          lines.push(line);
          done();
        },
      },
    );
    vi.mocked(f.store.prepareExternal).mockResolvedValue(f.prepared);
    vi.mocked(f.store.finishExternal).mockResolvedValue(false);
    try {
      await createSupportJobHandlers(f.store, f.mail, f.objects, observer)
        .find((handler) => handler.kind === f.lease.kind)!
        .execute(f.lease, new AbortController().signal, 1000);
    } finally {
      await observer.close();
    }
    const records = lines.flatMap((line) =>
      line
        .trim()
        .split("\n")
        .map((value) => JSON.parse(value)),
    );
    expect(
      records.find((record) => record.operation === "job.acknowledge")?.outcome,
    ).toBe("stale");
  });
  it("does not resend after a failed durable finish and a subsequent started barrier", async () => {
    const f = fixture();
    vi.mocked(f.store.prepareExternal)
      .mockResolvedValueOnce(f.prepared)
      .mockResolvedValue(null);
    vi.mocked(f.store.finishExternal).mockRejectedValue(
      new Error("PRIVATE_CONNECTION_SENTINEL"),
    );
    const handler = createSupportJobHandlers(f.store, f.mail, f.objects).find(
      (h) => h.kind === f.lease.kind,
    )!;
    await expect(
      handler.execute(f.lease, new AbortController().signal, 1000),
    ).rejects.toThrow();
    await handler.execute(
      { ...f.lease, leaseToken: randomUUID() },
      new AbortController().signal,
      1000,
    );
    expect(f.mail.send).toHaveBeenCalledOnce();
  });
  it("uses the narrow expiry capability without active-member admission and retries physical deletion", async () => {
    const f = fixture();
    const lease = { ...f.lease, kind: "file.expire" };
    const prepared = {
      attemptId: randomUUID(),
      effectId: lease.id,
      commandHash: "b".repeat(64),
      file: { id: f.file.id, key: f.file.key },
    };
    vi.mocked(f.store.prepareCleanup).mockResolvedValue(prepared);
    vi.mocked(f.objects.delete).mockRejectedValue(
      new Error("PRIVATE_STORAGE_SENTINEL"),
    );
    const handler = createSupportJobHandlers(f.store, f.mail, f.objects).find(
      (h) => h.kind === "file.expire",
    )!;
    await handler.execute(lease, new AbortController().signal, 1000);
    expect(f.store.prepareExternal).not.toHaveBeenCalled();
    expect(f.store.finishCleanup).toHaveBeenCalledWith(
      lease,
      prepared.attemptId,
      { status: "retryable", code: "UNAVAILABLE", backoffMs: 1000 },
    );
    await handler.schedule!({ limit: 100, intervalMs: 60000 });
    expect(f.store.scheduleFileExpiry).toHaveBeenCalledWith({
      limit: 100,
      intervalMs: 60000,
    });
  });
});
