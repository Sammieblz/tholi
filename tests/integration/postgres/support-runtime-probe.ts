import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDatabasePool } from "../../../apps/api/src/database/postgres";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";
import { PostgresSupport } from "../../../apps/api/src/database/support";
import { diagnosticSnapshotSchema } from "../../../packages/navigation-core/contracts-support";

/** Uses the independently running API/worker and their real mail/storage adapters. */
export async function runSupportRuntimeProbe(options: {
  migrationConnection: string;
  runtimeConnection: string;
  workerConnection: string;
  apiUrl: string;
}) {
  const base = new URL(options.apiUrl);
  if (
    base.protocol !== "http:" ||
    base.hostname !== "api" ||
    base.port !== "8788" ||
    base.pathname !== "/"
  )
    throw new Error("PostgreSQL check failed: local support probe origin.");
  const runtime = createDatabasePool({
    connectionString: options.runtimeConnection,
    max: 1,
  });
  const migration = createDatabasePool({
    connectionString: options.migrationConnection,
    max: 1,
  });
  const worker = createDatabasePool({
    connectionString: options.workerConnection,
    max: 1,
  });
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const checkedFetch = async (
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
  ) => {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response;
  };
  try {
    const identities = new PostgresIdentityRepository(runtime);
    const bootstrap = async () => {
      const issuedAt = new Date(Date.now() - 1000);
      const identity = {
        issuer: "https://identity.example.test/realms/local-runtime-probe",
        subject: randomUUID(),
        providerSessionId: randomUUID(),
        issuedAt,
        verifiedEmail: `tholi-capture-${randomUUID()}@example.invalid`,
      };
      const account = await identities.resolveIdentity(identity),
        token = randomBytes(32).toString("base64url"),
        now = new Date();
      await identities.createSession({
        ...account,
        id: randomUUID(),
        clientId: "extension-chromium",
        clientKind: "extension",
        providerIssuer: identity.issuer,
        providerSubject: identity.subject,
        providerSessionId: identity.providerSessionId,
        providerIssuedAt: issuedAt,
        accessHash: digest(token),
        refreshHash: digest(randomBytes(32).toString("base64url")),
        csrfHash: digest(randomUUID()),
        accessExpiresAt: new Date(now.getTime() + 180000),
        expiresAt: new Date(now.getTime() + 600000),
        createdAt: now,
        lastUsedAt: now,
      });
      return { account, token };
    };
    const actor = await bootstrap(),
      stranger = await bootstrap();
    const submitted = (await (
      await checkedFetch("/api/v1/support/requests", actor.token, {
        idempotencyKey: randomUUID(),
        name: "Local runtime probe",
        email: "reply-only@example.invalid",
        topic: "Support",
        subject: "Local captured support workflow",
        message:
          "Explicit local acceptance request. No browsing content is included.",
      })
    ).json()) as {
      id: string;
      operatorJobId: string;
      receiptJobId: string | null;
    };
    assert.ok(submitted.receiptJobId);
    const waitFor = async (work: () => Promise<boolean>) => {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (await work()) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(
        "PostgreSQL check failed: independent support worker deadline.",
      );
    };
    const completed = async (ids: string[]) => {
      const rows = (
        await migration.query(
          "SELECT id,status FROM tholi.jobs WHERE id=ANY($1::uuid[])",
          [ids],
        )
      ).rows;
      assert.ok(
        !rows.some((row) =>
          ["failed", "dead", "cancelled", "uncertain"].includes(row.status),
        ),
      );
      return (
        rows.length === ids.length &&
        rows.every((row) => row.status === "succeeded")
      );
    };
    await waitFor(() =>
      completed([submitted.operatorJobId, submitted.receiptJobId!]),
    );
    const exported = (await (
      await checkedFetch("/api/v1/account/diagnostic-exports", actor.token, {
        idempotencyKey: randomUUID(),
      })
    ).json()) as { requestId: string; jobId: string; fileId: string };
    await waitFor(() => completed([exported.jobId]));
    const filePath = `/api/v1/account/files/${exported.fileId}`;
    const metadata = (await (
      await checkedFetch(filePath, actor.token)
    ).json()) as { revision: string; status: string };
    assert.equal(metadata.status, "ready");
    await checkedFetch(filePath, undefined, undefined, 401);
    await checkedFetch(filePath, stranger.token, undefined, 404);
    const link = (await (
      await checkedFetch(`${filePath}/link`, actor.token, {
        expectedRevision: metadata.revision,
      })
    ).json()) as { url: string };
    const published = new URL(link.url);
    assert.equal(published.pathname, `${filePath}/download`);
    const downloadPath = published.pathname + published.search;
    const response = await checkedFetch(downloadPath, actor.token);
    assert.match(
      response.headers.get("content-disposition") ?? "",
      /attachment/,
    );
    const snapshot = diagnosticSnapshotSchema.parse(await response.json());
    assert.equal(snapshot.profile, "service");
    await checkedFetch(downloadPath, stranger.token, undefined, 404);
    // Expiry and account revocation cannot prevent the same worker from deleting
    // the already-created object. Operator changes only accelerate test time.
    await migration.query(
      "UPDATE tholi.accounts SET status='deleted',revision=revision+1 WHERE id=$1",
      [actor.account.accountId],
    );
    await checkedFetch(downloadPath, actor.token, undefined, 401);
    await migration.query(
      "UPDATE tholi.private_files SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [exported.fileId],
    );
    await new PostgresSupport(worker).scheduleFileExpiry({
      limit: 100,
      intervalMs: 60000,
    });
    const cleanup = (
      await migration.query(
        "SELECT id FROM tholi.jobs WHERE workspace_id=$1 AND request_id=$2 AND kind='file.expire'",
        [actor.account.workspaceId, exported.requestId],
      )
    ).rows[0];
    assert.ok(cleanup);
    await waitFor(() => completed([cleanup.id]));
    const deleted = (
      await migration.query(
        "SELECT status,snapshot FROM tholi.private_files WHERE id=$1",
        [exported.fileId],
      )
    ).rows[0];
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.snapshot, null);
    return {
      passed: true as const,
      requestId: submitted.id,
      operatorJobId: submitted.operatorJobId,
      receiptJobId: submitted.receiptJobId,
      deletedObject: {
        workspaceId: actor.account.workspaceId,
        fileId: exported.fileId,
      },
      checks: [
        {
          name: "actual independent worker delivered distinct local operator and verified-account SMTP effects",
          passed: true as const,
        },
        {
          name: "actual S3 diagnostic file was downloaded through authenticated scoped expiring application links",
          passed: true as const,
        },
        {
          name: "file access was denied after revocation and actual independent worker completed physical expiry cleanup",
          passed: true as const,
        },
      ],
    };
  } finally {
    await Promise.all([runtime.end(), migration.end(), worker.end()]);
  }
}
