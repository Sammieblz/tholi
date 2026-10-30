import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationService,
  type AuthorizationRepositories,
  type AuthorizationTransaction,
} from "../../../apps/api/src/application/authorization";
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
} from "../../../apps/api/src/database/contracts";
import { createServiceApi } from "../../../apps/api/src/server";
import {
  consentSchema,
  membershipSchema,
  policyCatalogSchema,
  workspacePageSchema,
} from "../../../packages/navigation-core/contracts-authorization";
import { serviceErrorEnvelopeSchema } from "../../../packages/navigation-core/contracts-service";

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

async function fixture() {
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
  const scoped = {
    getAccount: vi.fn(async () => account),
    getWorkspace: vi.fn(async () => workspace),
    getMembership: vi.fn(async () => membership),
    listMemberships: vi.fn(async () => [target]),
    listConsents: vi.fn(async () => consents),
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
  const repositories: AuthorizationRepositories = {
    listWorkspaces: vi.fn(async () => [workspace]),
    async transaction(scope, work) {
      if (scope.accountId !== account.id || scope.workspaceId !== workspace.id)
        throw new RepositoryError("FORBIDDEN", "PRIVATE_SCOPE_SENTINEL");
      return work(scoped);
    },
  };
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
  const app = await createServiceApi(options, [], { identity, authorization });
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
