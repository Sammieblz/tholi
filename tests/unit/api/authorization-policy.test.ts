import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_CONSENT_POLICIES,
  authorizationPageQuerySchema,
  consentPageSchema,
  consentSchema,
  consentUpdateSchema,
  membershipPageSchema,
  membershipUpdateSchema,
  policyCatalogSchema,
  workspacePageSchema,
} from "../../../packages/navigation-core/contracts-authorization";
import {
  authorizationPolicyCatalog,
  evaluateAuthorization,
  type AuthorizationContext,
} from "../../../apps/api/src/application/authorization-policy";

const owner = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const workspaceId = "00000000-0000-4000-8000-000000000003";
const recordId = "00000000-0000-4000-8000-000000000004";

function context(
  role: "owner" | "admin" | "member" = "member",
): AuthorizationContext {
  const accountId = role === "owner" ? owner : member;
  return {
    account: { id: accountId, status: "active" },
    workspace: { id: workspaceId, kind: "organization", ownerAccountId: owner },
    membership: { accountId, role, status: "active" },
    consents: [],
  };
}

describe("portable authorization contracts", () => {
  it("uses bounded shared pagination and decimal revisions without scope selectors", () => {
    expect(
      authorizationPageQuerySchema.parse({ after: owner, limit: "50" }),
    ).toEqual({ after: owner, limit: 50 });
    for (const query of [
      { cursor: owner },
      { after: "invented" },
      { limit: "01" },
      { limit: "1e1" },
      { limit: ["1", "2"] },
      { limit: 101 },
      { workspaceId },
    ])
      expect(authorizationPageQuerySchema.safeParse(query).success).toBe(false);
    const update = {
      role: "member",
      status: "revoked",
      expectedRevision: "9223372036854775807",
    };
    expect(membershipUpdateSchema.parse(update)).toEqual(update);
    for (const change of [
      { ...update, role: "owner" },
      { ...update, accountId: owner },
      { ...update, workspaceId },
      { ...update, expectedRevision: "0" },
      { ...update, expectedRevision: 1 },
      { ...update, expectedRevision: "9223372036854775808" },
    ])
      expect(membershipUpdateSchema.safeParse(change).success).toBe(false);
  });

  it("keeps historical consent versions readable without accepting extra claims", () => {
    const stored = {
      id: recordId,
      purpose: "cloud_saved_routes",
      policyVersion: "historical-0",
      granted: true,
      revision: "2",
    };
    expect(consentSchema.parse(stored)).toEqual(stored);
    expect(consentPageSchema.parse({ items: [stored] })).toEqual({
      items: [stored],
    });
    expect(
      consentUpdateSchema.parse({
        purpose: stored.purpose,
        policyVersion: stored.policyVersion,
        granted: false,
        expectedRevision: "2",
      }),
    ).toMatchObject({ policyVersion: "historical-0", granted: false });
    for (const extra of [{ accountId: owner }, { workspaceId }, { credits: 1 }])
      expect(consentSchema.safeParse({ ...stored, ...extra }).success).toBe(
        false,
      );
    expect(
      consentUpdateSchema.safeParse({
        purpose: stored.purpose,
        policyVersion: "x".repeat(101),
        granted: true,
        expectedRevision: "0",
      }).success,
    ).toBe(false);
    expect(
      consentPageSchema.safeParse({ items: [stored], nextCursor: owner })
        .success,
    ).toBe(false);
  });

  it("validates page DTOs and unique bounded policy declarations", () => {
    expect(
      workspacePageSchema.parse({
        items: [
          {
            id: workspaceId,
            kind: "personal",
            ownerAccountId: owner,
            revision: "1",
          },
        ],
        nextCursor: workspaceId,
      }).nextCursor,
    ).toBe(workspaceId);
    expect(
      membershipPageSchema.parse({
        items: [
          {
            accountId: member,
            role: "member",
            status: "active",
            revision: "1",
          },
        ],
      }).items,
    ).toHaveLength(1);
    const catalog = authorizationPolicyCatalog(context("owner"));
    expect(policyCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(
      policyCatalogSchema.safeParse({
        ...catalog,
        allowedActions: ["policies.read", "policies.read"],
      }).success,
    ).toBe(false);
    expect(
      policyCatalogSchema.safeParse({ ...catalog, capabilities: ["inference"] })
        .success,
    ).toBe(false);
    expect(Object.isFrozen(AUTHORIZATION_CONSENT_POLICIES)).toBe(true);
    expect(AUTHORIZATION_CONSENT_POLICIES.every(Object.isFrozen)).toBe(true);
  });
});

describe("server-derived authorization policy", () => {
  it("retains own account controls without a workspace but rejects foreign actors", () => {
    const accountOnly: AuthorizationContext = {
      account: { id: member, status: "active" },
    };
    for (const action of [
      "account.read",
      "account.manage",
      "workspaces.list",
    ] as const)
      expect(evaluateAuthorization(accountOnly, action)).toEqual({
        allowed: true,
      });
    expect(
      evaluateAuthorization(accountOnly, "account.manage", {
        targetAccountId: owner,
      }).allowed,
    ).toBe(false);
    expect(evaluateAuthorization(accountOnly, "saved-data.read").allowed).toBe(
      false,
    );
    expect(
      evaluateAuthorization(
        { ...accountOnly, account: { id: member, status: "suspended" } },
        "account.read",
      ).allowed,
    ).toBe(false);
  });

  it("requires current matching membership and canonical personal ownership", () => {
    const valid = context();
    for (const changed of [
      { ...valid, membership: undefined },
      {
        ...valid,
        membership: { ...valid.membership!, status: "revoked" as const },
      },
      { ...valid, membership: { ...valid.membership!, accountId: owner } },
      {
        ...valid,
        membership: { ...valid.membership!, role: "owner" as const },
      },
      {
        ...valid,
        workspace: { ...valid.workspace!, kind: "personal" as const },
      },
    ])
      expect(evaluateAuthorization(changed, "policies.read").allowed).toBe(
        false,
      );
    expect(() =>
      authorizationPolicyCatalog({ ...valid, membership: undefined }),
    ).toThrow("The workspace is unavailable.");
  });

  it("lets org owner/admin inspect membership while only its canonical owner mutates", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      const scope = context(role);
      expect(evaluateAuthorization(scope, "memberships.read").allowed).toBe(
        role !== "member",
      );
      expect(
        evaluateAuthorization(scope, "memberships.read", {
          targetAccountId: scope.account.id,
        }).allowed,
      ).toBe(true);
      expect(
        evaluateAuthorization(scope, "memberships.update", {
          targetAccountId: member,
        }).allowed,
      ).toBe(role === "owner");
    }
    expect(
      evaluateAuthorization(context("owner"), "memberships.update", {
        targetAccountId: owner,
      }).allowed,
    ).toBe(false);
    const personal = context("owner");
    personal.workspace!.kind = "personal";
    expect(
      evaluateAuthorization(personal, "memberships.update", {
        targetAccountId: member,
      }).allowed,
    ).toBe(false);
  });

  it("keeps own read/export/delete, credits and support independent of inference consent", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      const scope = context(role);
      for (const action of [
        "saved-data.read",
        "saved-data.export",
        "saved-data.delete",
        "usage.read",
        "credits.read",
        "support.request",
        "consents.read",
        "jobs.read",
        "jobs.cancel",
      ] as const) {
        expect(evaluateAuthorization(scope, action)).toEqual({ allowed: true });
        expect(
          evaluateAuthorization(scope, action, {
            targetAccountId: role === "owner" ? member : owner,
          }).allowed,
        ).toBe(false);
      }
    }
  });

  it("requires distinct current purposes for import, inference, images and analytics", () => {
    const scope = context();
    for (const action of [
      "saved-data.write",
      "saved-data.import",
      "inference.request",
      "image.transmit",
      "analytics.record",
    ] as const)
      expect(evaluateAuthorization(scope, action)).toEqual({
        allowed: false,
        reason: "CONSENT_REQUIRED",
      });
    scope.consents = [
      {
        purpose: "cloud_inference",
        policyVersion: "historical-0",
        granted: true,
      },
    ];
    expect(evaluateAuthorization(scope, "inference.request").allowed).toBe(
      false,
    );
    scope.consents = [
      { purpose: "cloud_inference", policyVersion: "1", granted: true },
    ];
    expect(evaluateAuthorization(scope, "inference.request").allowed).toBe(
      true,
    );
    expect(evaluateAuthorization(scope, "image.transmit").allowed).toBe(false);
    expect(evaluateAuthorization(scope, "saved-data.import").allowed).toBe(
      false,
    );
    scope.consents = AUTHORIZATION_CONSENT_POLICIES.map((policy) => ({
      ...policy,
      granted: true,
    }));
    for (const action of [
      "saved-data.write",
      "saved-data.import",
      "inference.request",
      "image.transmit",
      "analytics.record",
    ] as const)
      expect(evaluateAuthorization(scope, action).allowed).toBe(true);
    scope.consents = scope.consents.map((consent) => ({
      ...consent,
      granted: false,
    }));
    expect(evaluateAuthorization(scope, "inference.request").allowed).toBe(
      false,
    );
  });

  it("rejects invented grants but permits revoking the exact stored old version", () => {
    const scope = context();
    const change = {
      purpose: "cloud_saved_routes",
      policyVersion: "1",
      granted: true,
    };
    expect(
      evaluateAuthorization(scope, "consents.write", { consentChange: change })
        .allowed,
    ).toBe(true);
    for (const invalid of [
      { ...change, purpose: "invented" },
      { ...change, policyVersion: "future-2" },
    ])
      expect(
        evaluateAuthorization(scope, "consents.write", {
          consentChange: invalid,
        }).allowed,
      ).toBe(false);
    scope.consents = [{ ...change, policyVersion: "historical-0" }];
    expect(
      evaluateAuthorization(scope, "consents.write", {
        consentChange: {
          ...change,
          policyVersion: "historical-0",
          granted: false,
        },
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAuthorization(scope, "consents.write", {
        consentChange: { ...change, granted: false },
      }).allowed,
    ).toBe(false);
  });

  it("describes authorization preconditions without claiming route or credit availability", () => {
    const ownerCatalog = authorizationPolicyCatalog(context("owner"));
    expect(ownerCatalog.allowedActions).toContain("memberships.update");
    expect(ownerCatalog.allowedActions).toContain("saved-data.delete");
    expect(ownerCatalog.allowedActions).not.toContain("inference.request");
    const adminCatalog = authorizationPolicyCatalog(context("admin"));
    expect(adminCatalog.allowedActions).toContain("memberships.read");
    expect(adminCatalog.allowedActions).not.toContain("memberships.update");
    expect(ownerCatalog.consentPolicies).toEqual(
      AUTHORIZATION_CONSENT_POLICIES,
    );
    expect(ownerCatalog).not.toHaveProperty("credits");
    expect(ownerCatalog).not.toHaveProperty("capabilities");
  });
});
