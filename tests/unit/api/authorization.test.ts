import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationService,
  type AuthorizationRepositories,
  type AuthorizationTransaction,
} from "../../../apps/api/src/application/authorization";
import {
  JobService,
  type JobTransaction,
} from "../../../apps/api/src/application/jobs";
import {
  IdentityService,
  identityHash,
} from "../../../apps/api/src/application/identity";
import type {
  IdentityProvider,
  IdentitySession,
  IdentityStore,
} from "../../../apps/api/src/application/identity-contracts";
import { parseServiceConfig } from "../../../apps/api/src/config";
import {
  RepositoryError,
  type Consent,
  type Membership,
  type Job,
  type RepositoryScope,
} from "../../../apps/api/src/database/contracts";
import { createServiceApi } from "../../../apps/api/src/server";
import { SupportService } from "../../../apps/api/src/application/support";
import type {
  ObjectPort,
  PrivateFile,
  SupportStore,
} from "../../../apps/api/src/application/support-contracts";
import {
  diagnosticSnapshotSchema,
  fileLinkSchema,
  privateFileSchema,
  supportRequestSchema,
} from "../../../packages/navigation-core/contracts-support";
import {
  consentSchema,
  membershipSchema,
  policyCatalogSchema,
  workspacePageSchema,
} from "../../../packages/navigation-core/contracts-authorization";
import { serviceErrorEnvelopeSchema } from "../../../packages/navigation-core/contracts-service";
import {
  cancelJobInputSchema,
  jobPageQuerySchema,
  jobPageSchema,
  jobSchema,
} from "../../../packages/navigation-core/contracts-jobs";

const applications: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});
const webOrigin = "https://tholi.io";
const nativeOrigin = "chrome-extension://" + "a".repeat(32);
const nativeToken = "n".repeat(43);
const webToken = "w".repeat(43);
const bearer = { authorization: `Bearer ${nativeToken}` };

async function fixture(supportEnabled = true) {
  const options = parseServiceConfig({
    NODE_ENV: "production",
    THOLI_SERVICE_ORIGINS: `${webOrigin},https://help.tholi.io`,
    THOLI_SERVICE_PUBLIC_ORIGIN: "https://api.tholi.io",
    THOLI_DATABASE_URL:
      "postgresql://runtime:synthetic@unreachable.invalid/tholi",
    THOLI_IDENTITY_ISSUER: "https://identity.tholi.io/realms/tholi",
    THOLI_IDENTITY_AUTHORIZATION_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/auth",
    THOLI_IDENTITY_TOKEN_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/token",
    THOLI_IDENTITY_JWKS_URI:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/certs",
    THOLI_IDENTITY_LOGOUT_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/logout",
    THOLI_IDENTITY_CLIENT_ID: "tholi-service",
    THOLI_IDENTITY_CLIENT_SECRET_KEY: "synthetic-authorization-profile-secret",
    THOLI_IDENTITY_FLOW_SECRET_KEY: Buffer.alloc(32, 7).toString("base64url"),
    THOLI_IDENTITY_WEB_ORIGIN: webOrigin,
    THOLI_IDENTITY_CHROMIUM_CALLBACKS:
      "https://" + "a".repeat(32) + ".chromiumapp.org/",
  }).options;
  const account = { id: randomUUID(), status: "active" as const, revision: 1n };
  const workspace = {
    id: randomUUID(),
    kind: "organization" as const,
    ownerAccountId: account.id,
    revision: 1n,
  };
  const membership: Membership = {
    accountId: account.id,
    role: "owner",
    status: "active",
    revision: 1n,
  };
  const target: Membership = {
    accountId: randomUUID(),
    role: "member",
    status: "active",
    revision: 2n,
  };
  const consents: Consent[] = [];
  const job: Job & { leaseOwner: string; leaseToken: string } = {
    id: randomUUID(),
    accountId: account.id,
    requestId: randomUUID(),
    kind: "fixture.prune",
    version: 1,
    recordReferences: { accountId: account.id },
    status: "queued",
    availableAt: new Date(),
    maxAttempts: 3,
    revision: 1n,
    attempts: 0,
    cancelRequested: false,
    errorCode: null,
    result: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    leaseOwner: "PRIVATE_WORKER_SENTINEL",
    leaseToken: "PRIVATE_FENCE_SENTINEL",
  };
  const scoped = {
    getAccount: vi.fn(async () => account),
    getWorkspace: vi.fn(async () => workspace),
    getMembership: vi.fn(async () => membership),
    listMemberships: vi.fn(async () => [target]),
    listConsents: vi.fn(async () => consents),
    listJobs: vi.fn<JobTransaction["listJobs"]>(async () => [job]),
    getJob: vi.fn<JobTransaction["getJob"]>(async (id) =>
      id === job.id ? job : undefined,
    ),
    cancelJob: vi.fn<JobTransaction["cancelJob"]>(async () => ({
      ...job,
      status: "running",
      cancelRequested: true,
      revision: 2n,
    })),
    setMembership: vi.fn<AuthorizationTransaction["setMembership"]>(
      async (input) => ({
        accountId: input.accountId,
        role: input.role,
        status: input.status,
        revision: input.expectedRevision + 1n,
      }),
    ),
    recordConsent: vi.fn<AuthorizationTransaction["recordConsent"]>(
      async (input) => {
        const result = {
          id:
            consents.find((row) => row.purpose === input.purpose)?.id ??
            randomUUID(),
          purpose: input.purpose,
          policyVersion: input.policyVersion,
          granted: input.granted,
          revision: input.expectedRevision + 1n,
        };
        consents.splice(0, consents.length, result);
        return result;
      },
    ),
  };
  const repositories = {
    listWorkspaces: vi.fn(async () => [workspace]),
    async transaction<T>(
      scope: RepositoryScope,
      work: (repository: typeof scoped) => Promise<T>,
    ) {
      if (scope.accountId !== account.id || scope.workspaceId !== workspace.id)
        throw new RepositoryError("FORBIDDEN", "PRIVATE_SCOPE_SENTINEL");
      return work(scoped);
    },
  } satisfies AuthorizationRepositories;
  vi.spyOn(repositories, "transaction");
  const session: IdentitySession = {
    id: randomUUID(),
    identityId: randomUUID(),
    accountId: account.id,
    workspaceId: randomUUID(),
    revision: "1",
    clientId: "extension-chromium",
    clientKind: "extension",
    providerIssuer: options.identity!.issuer,
    providerSubject: "synthetic-subject",
    providerIssuedAt: new Date(),
    accessHash: identityHash(nativeToken),
    refreshHash: identityHash("r".repeat(43)),
    csrfHash: identityHash("c".repeat(43)),
    accessExpiresAt: new Date(Date.now() + 60_000),
    expiresAt: new Date(Date.now() + 600_000),
    createdAt: new Date(),
    lastUsedAt: new Date(),
  };
  const webSession: IdentitySession = {
    ...session,
    id: randomUUID(),
    clientId: "web",
    clientKind: "web",
    accessHash: identityHash(webToken),
  };
  const unexpected = vi.fn(async (): Promise<never> => {
    throw new Error(
      "Provider and identity mutation are outside this route fixture.",
    );
  });
  const store: IdentityStore = {
    createFlow: unexpected,
    consumeFlow: unexpected,
    resolveIdentity: unexpected,
    createBroker: unexpected,
    consumeBroker: unexpected,
    createSession: unexpected,
    authenticateSession: vi.fn(async (hash) =>
      hash === session.accessHash
        ? session
        : hash === webSession.accessHash
          ? webSession
          : null,
    ),
    rotateSession: unexpected,
    listSessions: unexpected,
    revokeSession: unexpected,
    revokeAllSessions: unexpected,
    revokeProviderSessions: unexpected,
  };
  const provider: IdentityProvider = {
    authorize: () => {
      throw new Error("Unexpected provider authorization.");
    },
    exchange: unexpected,
    verifyLogout: unexpected,
    logoutUrl: () => {
      throw new Error("Unexpected provider logout.");
    },
  };
  const identity = new IdentityService(options.identity!, store, provider);
  const csrf = identity.account(webSession).csrfToken!;
  webSession.csrfHash = identityHash(csrf);
  const authorization = new AuthorizationService(repositories);
  const jobs = new JobService(repositories);
  const snapshot = diagnosticSnapshotSchema.parse({
    schemaVersion: 1,
    version: "0.11.0",
    profile: "service",
    accountStatus: "active",
    workspaceKind: "personal",
    role: "owner",
    jobs: {
      queued: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      uncertain: 0,
    },
  });
  const diagnosticBody = Buffer.from(JSON.stringify(snapshot));
  const file: PrivateFile = {
    id: randomUUID(),
    requestId: randomUUID(),
    revision: 1n,
    key: "",
    bytes: diagnosticBody.byteLength,
    sha256: createHash("sha256").update(diagnosticBody).digest("hex"),
    contentType: "application/json",
    expiresAt: new Date(Date.now() + 60_000),
    status: "ready",
  };
  file.key = `exports/${session.workspaceId}/${file.id}.json`;
  const supportRecord = {
    id: randomUUID(),
    operatorJobId: randomUUID(),
    receiptJobId: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  const supportStore: SupportStore = {
    submit: vi.fn(async () => supportRecord),
    requestDiagnostic: vi.fn(async () => ({
      requestId: file.requestId,
      jobId: randomUUID(),
      fileId: file.id,
    })),
    getFile: vi.fn(async (_scope, id) => (id === file.id ? file : null)),
    prepareExternal: unexpected,
    finishExternal: unexpected,
    prepareCleanup: unexpected,
    finishCleanup: unexpected,
    scheduleFileExpiry: unexpected,
  };
  const objects: ObjectPort = {
    put: unexpected,
    read: vi.fn(async () => diagnosticBody),
    delete: unexpected,
    close: vi.fn(async () => {}),
  };
  const support = new SupportService(
    supportStore,
    objects,
    {
      issue: vi.fn(async () => "signed.download-proof"),
      verify: vi.fn(async () => ({
        accountId: session.accountId,
        workspaceId: session.workspaceId,
        fileId: file.id,
        revision: "1",
      })),
    },
    { publicOrigin: "https://api.tholi.io", linkLifetimeMs: 60_000 },
  );
  const app = await createServiceApi(options, [], {
    identity,
    authorization,
    jobs,
    ...(supportEnabled ? { support } : {}),
  });
  applications.push(app);
  return {
    app,
    identity,
    authorization,
    store,
    repositories,
    scoped,
    account,
    workspace,
    membership,
    target,
    consents,
    job,
    session,
    supportStore,
    supportRecord,
    file,
    snapshot,
    objects,
    diagnosticBody,
    csrf,
    cookie: `__Host-tholi_session=${webToken}`,
  };
}

function safeError(
  response: { statusCode: number; json(): unknown },
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(serviceErrorEnvelopeSchema.parse(response.json()).error).toMatchObject(
    { code, retryable: false },
  );
  expect(JSON.stringify(response.json())).not.toMatch(
    /SENTINEL|unreachable|postgresql|synthetic-subject/,
  );
}
const change = { role: "admin", status: "active", expectedRevision: "2" };

describe("account support and private file HTTP contracts", () => {
  const input = {
    idempotencyKey: "support-request-1",
    email: "reply@example.test",
    topic: "Support",
    subject: "Opening Tholi",
    message: "Please help me find the browser panel.",
  };
  it("rechecks current session authority after object I/O before releasing private bytes", async () => {
    const { app, file, objects, diagnosticBody, store } = await fixture();
    let begin!: () => void;
    let complete!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      complete = resolve;
    });
    vi.mocked(objects.read).mockImplementationOnce(async () => {
      begin();
      await paused;
      return diagnosticBody;
    });
    const pending = app
      .inject({
        url: `/api/v1/account/files/${file.id}/download?token=signed.proof`,
        headers: bearer,
      })
      .then((response) => response);
    await started;
    vi.mocked(store.authenticateSession).mockResolvedValue(null);
    complete();
    const response = await pending;
    safeError(response, 401, "UNAUTHENTICATED");
    expect(response.payload).not.toContain('"schemaVersion"');
    expect(response.headers["content-disposition"]).toBeUndefined();
  });
  it("advertises only composed support/file handlers and leaves general saved-data export planned", async () => {
    const { app } = await fixture();
    const disabled = (await fixture(false)).app;
    for (const [current, enabled] of [
      [app, true],
      [disabled, false],
    ] as const) {
      const capabilities = (
        await current.inject({ url: "/api/v1/capabilities" })
      ).json();
      expect(capabilities.capabilities.includes("support-requests")).toBe(
        enabled,
      );
      expect(capabilities.capabilities.includes("private-files")).toBe(enabled);
      const spec = (
        await current.inject({ url: "/api/v1/openapi.json" })
      ).json();
      const entries = spec["x-tholi-route-inventory"].filter(
        (route: { issue: number }) => route.issue === 33,
      );
      expect(entries).toHaveLength(5);
      expect(
        entries.every(
          (route: { status: string }) =>
            route.status === (enabled ? "implemented" : "planned"),
        ),
      ).toBe(true);
      expect(Boolean(spec.paths["/api/v1/support/requests"])).toBe(enabled);
      expect(
        Boolean(spec.paths["/api/v1/account/files/{fileId}/download"]),
      ).toBe(enabled);
      expect(spec.paths["/api/v1/account/saved-data/export"]).toBeUndefined();
      if (enabled) {
        expect(
          spec.paths["/api/v1/support/requests"].post.responses["429"],
        ).toBeDefined();
        expect(spec.paths["/api/v1/support/requests"].post.security).toEqual([
          { NativeBearer: [] },
          { WebSession: [] },
        ]);
      }
    }
    expect(
      (
        await disabled.inject({
          method: "POST",
          url: "/api/v1/support/requests",
          payload: input,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("requires the current session and exact website CSRF boundary, rejects invented template/scope fields and reports queued requests with quota headers", async () => {
    const { app, supportStore, session, cookie, csrf, supportRecord } =
      await fixture();
    const url = "/api/v1/support/requests";
    safeError(
      await app.inject({ method: "POST", url, payload: input }),
      401,
      "UNAUTHENTICATED",
    );
    for (const headers of [
      { cookie, origin: webOrigin },
      { cookie, "x-tholi-csrf": csrf },
      { cookie, origin: "https://help.tholi.io", "x-tholi-csrf": csrf },
    ])
      safeError(
        await app.inject({ method: "POST", url, headers, payload: input }),
        403,
        "FORBIDDEN",
      );
    expect(supportStore.submit).not.toHaveBeenCalled();
    for (const payload of [
      { ...input, accountId: randomUUID() },
      { ...input, template: "custom" },
      { ...input, to: "unapproved@example.test" },
      { ...input, subject: "Header\r\nInjected" },
      { ...input, subject: "Header\tInjected" },
      { ...input, subject: "Header\u007fInjected" },
      { ...input, message: "x".repeat(3001) },
      { ...input, topic: "arbitrary" },
    ])
      safeError(
        await app.inject({ method: "POST", url, headers: bearer, payload }),
        400,
        "INVALID_REQUEST",
      );
    const response = await app.inject({
      method: "POST",
      url,
      headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(supportRequestSchema.parse(response.json())).toMatchObject({
      id: supportRecord.id,
      receiptJobId: null,
    });
    expect(supportStore.submit).toHaveBeenCalledWith(
      { accountId: session.accountId, workspaceId: session.workspaceId },
      expect.objectContaining(input),
      expect.any(AbortSignal),
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.json())).not.toContain(input.message);
    vi.mocked(supportStore.submit).mockRejectedValueOnce(
      new RepositoryError("RATE_LIMITED", "PRIVATE_QUOTA_SENTINEL"),
    );
    const limited = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload: input,
    });
    safeError(limited, 429, "RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBe("3600");
  });

  it("exports only explicitly requested diagnostic metadata and protects private links/downloads with the same account guard", async () => {
    const { app, file, supportStore, cookie, csrf, snapshot } = await fixture();
    expect(
      fileLinkSchema.safeParse({
        url: "not a URL",
        expiresAt: file.expiresAt.toISOString(),
      }).success,
    ).toBe(false);
    expect(
      diagnosticSnapshotSchema.safeParse({
        ...snapshot,
        pages: ["private page"],
      }).success,
    ).toBe(false);
    expect(supportStore.requestDiagnostic).not.toHaveBeenCalled();
    const url = "/api/v1/account/diagnostic-exports";
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: { idempotencyKey: "export-1", screenshot: "forbidden" },
      }),
      400,
      "INVALID_REQUEST",
    );
    const created = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload: { idempotencyKey: "export-1" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().fileId).toBe(file.id);
    const path = `/api/v1/account/files/${file.id}`;
    const metadata = await app.inject({ url: path, headers: bearer });
    expect(privateFileSchema.parse(metadata.json())).toMatchObject({
      id: file.id,
      revision: "1",
    });
    expect(metadata.payload).not.toMatch(
      /PRIVATE_OBJECT|sha256|accountId|workspaceId/,
    );
    safeError(
      await app.inject({
        method: "POST",
        url: path + "/link",
        headers: { cookie, origin: webOrigin },
        payload: { expectedRevision: "1" },
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await app.inject({
        method: "POST",
        url: path + "/link",
        headers: bearer,
        payload: { expectedRevision: "0" },
      }),
      400,
      "INVALID_REQUEST",
    );
    const link = await app.inject({
      method: "POST",
      url: path + "/link",
      headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
      payload: { expectedRevision: "1" },
    });
    expect(link.statusCode).toBe(200);
    const download = new URL(link.json().url);
    safeError(
      await app.inject({ url: download.pathname + download.search }),
      401,
      "UNAUTHENTICATED",
    );
    safeError(
      await app.inject({
        url: download.pathname + download.search,
        headers: { cookie, origin: "https://help.tholi.io" },
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await app.inject({
        url: download.pathname + download.search + "&key=forged",
        headers: bearer,
      }),
      400,
      "INVALID_REQUEST",
    );
    const response = await app.inject({
      url: download.pathname + download.search,
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(diagnosticSnapshotSchema.parse(response.json())).toEqual(snapshot);
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="tholi-diagnostic.json"',
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("tenant authorization routes", () => {
  it("advertises exactly the six authorization operations with native/cookie security and PATCH preflight", async () => {
    const { app } = await fixture();
    const capabilities = (
      await app.inject({ url: "/api/v1/capabilities" })
    ).json();
    expect(capabilities.capabilities).toEqual(
      expect.arrayContaining(["tenant-authorization", "purpose-consent"]),
    );
    expect(capabilities.availability).toMatchObject({
      decisions: false,
      billing: false,
    });
    const openapi = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    const operations = Object.values(
      openapi.paths as Record<string, Record<string, any>>,
    )
      .flatMap((path) => Object.values(path))
      .filter((operation) => operation.tags?.includes("authorization"));
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      [
        "getWorkspacePolicies",
        "listAuthorizedWorkspaces",
        "listWorkspaceConsents",
        "listWorkspaceMemberships",
        "recordWorkspaceConsent",
        "updateWorkspaceMembership",
      ],
    );
    for (const operation of operations)
      expect(operation.security).toEqual([
        { NativeBearer: [] },
        { WebSession: [] },
      ]);
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/workspaces",
      headers: {
        origin: webOrigin,
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type,x-tholi-csrf",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain(
      "PATCH",
    );
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("derives the actor from its session, bounds actual query strings and rejects forged selectors", async () => {
    const { app, repositories, workspace, account } = await fixture();
    safeError(
      await app.inject({ url: "/api/v1/workspaces" }),
      401,
      "UNAUTHENTICATED",
    );
    const response = await app.inject({
      url: "/api/v1/workspaces?limit=1",
      headers: { ...bearer, origin: nativeOrigin },
    });
    expect(response.statusCode).toBe(200);
    expect(workspacePageSchema.parse(response.json()).nextCursor).toBe(
      workspace.id,
    );
    expect(repositories.listWorkspaces).toHaveBeenCalledWith(account.id, {
      limit: 1,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    for (const query of [
      `accountId=${randomUUID()}`,
      `workspaceId=${workspace.id}`,
      "limit=1e2",
      "limit=101",
      "limit=1&limit=2",
    ])
      safeError(
        await app.inject({
          url: "/api/v1/workspaces?" + query,
          headers: bearer,
        }),
        400,
        "INVALID_REQUEST",
      );
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${randomUUID()}/policies`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("shares cookie delivery and CSRF enforcement with identity routes, without trusting admitted origins", async () => {
    const { app, workspace, csrf, cookie } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/consents`;
    expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(
      200,
    );
    for (const origin of [nativeOrigin, "https://help.tholi.io"])
      safeError(
        await app.inject({ url, headers: { cookie, origin } }),
        403,
        "FORBIDDEN",
      );
    safeError(
      await app.inject({
        url,
        headers: { authorization: `Bearer ${webToken}` },
      }),
      401,
      "UNAUTHENTICATED",
    );
    safeError(
      await app.inject({
        url,
        headers: { cookie: `__Host-tholi_session=${nativeToken}` },
      }),
      401,
      "UNAUTHENTICATED",
    );
    const payload = {
      purpose: "cloud_inference",
      policyVersion: "1",
      granted: true,
      expectedRevision: "0",
    };
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: { cookie, origin: webOrigin },
        payload,
      }),
      403,
      "FORBIDDEN",
    );
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: { cookie, "x-tholi-csrf": csrf },
        payload,
      }),
      403,
      "FORBIDDEN",
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
          payload,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("applies current roles and existing positive revisions to membership PATCH without provisioning", async () => {
    const {
      app,
      workspace,
      membership,
      target,
      scoped,
      repositories,
      account,
    } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/memberships/${target.accountId}`;
    const response = await app.inject({
      method: "PATCH",
      url,
      headers: bearer,
      payload: change,
    });
    expect(response.statusCode).toBe(200);
    expect(membershipSchema.parse(response.json()).revision).toBe("3");
    expect(scoped.setMembership).toHaveBeenCalledWith({
      ...change,
      accountId: target.accountId,
      expectedRevision: 2n,
    });
    expect(repositories.transaction).toHaveBeenCalledWith(
      { accountId: account.id, workspaceId: workspace.id },
      expect.any(Function),
    );
    for (const payload of [
      { ...change, accountId: randomUUID() },
      { ...change, workspaceId: randomUUID() },
      { ...change, expectedRevision: "0" },
      { ...change, role: "owner" },
    ])
      safeError(
        await app.inject({ method: "PATCH", url, headers: bearer, payload }),
        400,
        "INVALID_REQUEST",
      );
    workspace.ownerAccountId = randomUUID();
    membership.role = "admin";
    expect(
      (
        await app.inject({
          url: `/api/v1/workspaces/${workspace.id}/memberships`,
          headers: bearer,
        })
      ).statusCode,
    ).toBe(200);
    safeError(
      await app.inject({
        method: "PATCH",
        url,
        headers: bearer,
        payload: change,
      }),
      403,
      "FORBIDDEN",
    );
    membership.status = "revoked";
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${workspace.id}/policies`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
    expect(scoped.setMembership).toHaveBeenCalledTimes(1);
  });

  it("records current purpose/version consent, permits old-version withdrawal and returns safe stale-write conflicts", async () => {
    const { app, workspace, consents, scoped } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/consents`;
    const payload = {
      purpose: "cloud_inference",
      policyVersion: "1",
      granted: true,
      expectedRevision: "0",
    };
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: bearer,
        payload: { ...payload, accountId: randomUUID() },
      }),
      400,
      "INVALID_REQUEST",
    );
    const saved = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(consentSchema.parse(saved.json())).toMatchObject({
      purpose: "cloud_inference",
      granted: true,
      revision: "1",
    });
    const policy = policyCatalogSchema.parse(
      (
        await app.inject({
          url: `/api/v1/workspaces/${workspace.id}/policies`,
          headers: bearer,
        })
      ).json(),
    );
    expect(policy.allowedActions).toContain("inference.request");
    expect(policy.allowedActions).not.toContain("image.transmit");
    consents[0].policyVersion = "0";
    const withdrawn = await app.inject({
      method: "POST",
      url,
      headers: bearer,
      payload: {
        ...payload,
        policyVersion: "0",
        granted: false,
        expectedRevision: "1",
      },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(consentSchema.parse(withdrawn.json())).toMatchObject({
      granted: false,
      policyVersion: "0",
      revision: "2",
    });
    scoped.recordConsent.mockRejectedValueOnce(
      new RepositoryError("CONFLICT", "PRIVATE_SQL_SENTINEL"),
    );
    safeError(
      await app.inject({ method: "POST", url, headers: bearer, payload }),
      409,
      "CONFLICT",
    );
    const after = policyCatalogSchema.parse(
      (
        await app.inject({
          url: `/api/v1/workspaces/${workspace.id}/policies`,
          headers: bearer,
        })
      ).json(),
    );
    expect(after.allowedActions).not.toContain("inference.request");
    expect(after.allowedActions).toEqual(
      expect.arrayContaining([
        "account.manage",
        "saved-data.read",
        "saved-data.export",
        "saved-data.delete",
      ]),
    );
  });

  it("does not perform a consent mutation after its HTTP deadline and redacts unexpected repository failures", async () => {
    const { app, workspace, scoped } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scoped.getWorkspace.mockImplementationOnce(async () => {
      await gate;
      return workspace;
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace.id}/consents`,
        headers: { ...bearer, "x-tholi-timeout-ms": "5" },
        payload: {
          purpose: "cloud_inference",
          policyVersion: "1",
          granted: true,
          expectedRevision: "0",
        },
      });
      expect(response.statusCode).toBe(504);
      expect(serviceErrorEnvelopeSchema.parse(response.json()).error.code).toBe(
        "DEADLINE_EXCEEDED",
      );
    } finally {
      release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(scoped.recordConsent).not.toHaveBeenCalled();
    scoped.getAccount.mockRejectedValueOnce(new Error("PRIVATE_SQL_SENTINEL"));
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${workspace.id}/policies`,
        headers: bearer,
      }),
      500,
      "INTERNAL_ERROR",
    );
  });
});

describe("actor-private durable job routes", () => {
  it("exposes only the three registered operations and whitelisted job metadata", async () => {
    const { app, workspace, job, scoped } = await fixture();
    const openapi = (await app.inject({ url: "/api/v1/openapi.json" })).json();
    const operations = Object.values(
      openapi.paths as Record<
        string,
        Record<string, { tags?: string[]; operationId: string }>
      >,
    )
      .flatMap((path) => Object.values(path))
      .filter((operation) => operation.tags?.includes("jobs"));
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      ["cancelWorkspaceJob", "getWorkspaceJob", "listWorkspaceJobs"],
    );
    expect(
      (await app.inject({ url: "/api/v1/capabilities" })).json().capabilities,
    ).toContain("durable-jobs");
    const base = `/api/v1/workspaces/${workspace.id}/jobs`;
    const response = await app.inject({
      url: `${base}?limit=1&status=queued`,
      headers: bearer,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const page = jobPageSchema.parse(response.json());
    expect(page.items[0]).toMatchObject({
      id: job.id,
      revision: "1",
      status: "queued",
    });
    expect(page.nextCursor).toBe(job.id);
    expect(scoped.listJobs).toHaveBeenCalledWith({
      limit: 1,
      status: "queued",
    });
    const read = await app.inject({
      url: `${base}/${job.id}`,
      headers: bearer,
    });
    expect(jobSchema.parse(read.json())).toEqual(page.items[0]);
    expect(response.body + read.body).not.toMatch(
      /SENTINEL|recordReferences|leaseOwner|leaseToken|accountId|requestId/,
    );
    safeError(
      await app.inject({ url: `${base}/${randomUUID()}`, headers: bearer }),
      404,
      "NOT_FOUND",
    );
    safeError(
      await app.inject({
        method: "POST",
        url: base,
        headers: bearer,
        payload: {},
      }),
      404,
      "NOT_FOUND",
    );
    safeError(
      await app.inject({
        method: "POST",
        url: `${base}/${job.id}/retry`,
        headers: bearer,
        payload: {},
      }),
      404,
      "NOT_FOUND",
    );
  });

  it("rejects forged scope and actor records even for organization admins", async () => {
    const { app, workspace, job, scoped, membership } = await fixture();
    const base = `/api/v1/workspaces/${workspace.id}/jobs`;
    safeError(await app.inject({ url: base }), 401, "UNAUTHENTICATED");
    safeError(
      await app.inject({
        url: `/api/v1/workspaces/${randomUUID()}/jobs`,
        headers: bearer,
      }),
      403,
      "FORBIDDEN",
    );
    for (const query of [
      "accountId=" + randomUUID(),
      "limit=01",
      "limit=1e1",
      "limit=1&limit=2",
      "status=unknown",
      "cursor=unused",
    ])
      safeError(
        await app.inject({ url: `${base}?${query}`, headers: bearer }),
        400,
        "INVALID_REQUEST",
      );
    membership.role = "admin";
    workspace.ownerAccountId = randomUUID();
    scoped.getJob.mockResolvedValueOnce({ ...job, accountId: randomUUID() });
    safeError(
      await app.inject({ url: `${base}/${job.id}`, headers: bearer }),
      404,
      "NOT_FOUND",
    );
    scoped.getJob.mockResolvedValueOnce({ ...job, accountId: randomUUID() });
    safeError(
      await app.inject({
        method: "POST",
        url: `${base}/${job.id}/cancel`,
        headers: bearer,
        payload: { expectedRevision: "1" },
      }),
      404,
      "NOT_FOUND",
    );
    expect(scoped.cancelJob).not.toHaveBeenCalled();
    membership.status = "revoked";
    safeError(
      await app.inject({ url: base, headers: bearer }),
      403,
      "FORBIDDEN",
    );
  });

  it("uses shared cookie/CSRF guards and reports running cancellation as intent", async () => {
    const { app, workspace, job, scoped, cookie, csrf } = await fixture();
    const url = `/api/v1/workspaces/${workspace.id}/jobs/${job.id}/cancel`;
    const payload = { expectedRevision: "1" };
    safeError(
      await app.inject({
        method: "POST",
        url,
        headers: { cookie, origin: webOrigin },
        payload,
      }),
      403,
      "FORBIDDEN",
    );
    expect(scoped.cancelJob).not.toHaveBeenCalled();
    const result = await app.inject({
      method: "POST",
      url,
      headers: { cookie, origin: webOrigin, "x-tholi-csrf": csrf },
      payload,
    });
    expect(result.statusCode).toBe(200);
    expect(jobSchema.parse(result.json())).toMatchObject({
      status: "running",
      cancelRequested: true,
      revision: "2",
    });
    expect(scoped.cancelJob).toHaveBeenCalledWith({
      id: job.id,
      expectedRevision: 1n,
    });
    for (const invalid of [
      { expectedRevision: "0" },
      { expectedRevision: 1 },
      { ...payload, accountId: randomUUID() },
      { ...payload, force: true },
    ])
      safeError(
        await app.inject({
          method: "POST",
          url,
          headers: bearer,
          payload: invalid,
        }),
        400,
        "INVALID_REQUEST",
      );
    scoped.cancelJob.mockRejectedValueOnce(
      new RepositoryError("CONFLICT", "PRIVATE_CONFLICT_SENTINEL"),
    );
    safeError(
      await app.inject({ method: "POST", url, headers: bearer, payload }),
      409,
      "CONFLICT",
    );
  });

  it("bounds wire revisions, failure/results and rejects private worker metadata", async () => {
    const { app, workspace, job } = await fixture();
    const response = await app.inject({
      url: `/api/v1/workspaces/${workspace.id}/jobs/${job.id}`,
      headers: bearer,
    });
    const dto = jobSchema.parse(response.json());
    for (const invalid of [
      { ...dto, revision: 1 },
      { ...dto, revision: "9223372036854775808" },
      { ...dto, attempts: 4 },
      { ...dto, maxAttempts: 101 },
      { ...dto, errorCode: "raw provider password" },
      { ...dto, result: { processed: 101 } },
      { ...dto, result: { processed: 1, content: "PRIVATE_RESULT_SENTINEL" } },
      { ...dto, leaseToken: "PRIVATE_FENCE_SENTINEL" },
    ])
      expect(jobSchema.safeParse(invalid).success).toBe(false);
    expect(
      cancelJobInputSchema.safeParse({ expectedRevision: "01" }).success,
    ).toBe(false);
    expect(
      jobPageQuerySchema.parse({
        limit: "50",
        after: job.id,
        status: "uncertain",
      }),
    ).toEqual({ limit: 50, after: job.id, status: "uncertain" });
  });
});
