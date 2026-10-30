import {
  AUTHORIZATION_CONSENT_POLICIES,
  authorizationActionSchema,
  policyCatalogSchema,
  type AuthorizationAction,
  type AuthorizationPolicyCatalog,
  type ConsentPurpose,
  type ConsentUpdate,
  type Membership,
  type Workspace,
} from "../../../../packages/navigation-core/contracts-authorization";

/** Built from current server records within the transaction, never from request claims. */
export interface AuthorizationContext {
  account: {
    id: string;
    status: "active" | "suspended" | "deletion_pending" | "deleted";
  };
  workspace?: Pick<Workspace, "id" | "kind" | "ownerAccountId">;
  membership?: Pick<Membership, "accountId" | "role" | "status">;
  consents?: readonly {
    purpose: string;
    policyVersion: string;
    granted: boolean;
  }[];
}
export interface AuthorizationContextReader {
  getAccount(): Promise<AuthorizationContext["account"]>;
  getWorkspace(): Promise<NonNullable<AuthorizationContext["workspace"]>>;
  getMembership(): Promise<AuthorizationContext["membership"]>;
  listConsents(): Promise<NonNullable<AuthorizationContext["consents"]>>;
}

/** HTTP and fenced workers resolve the same current records on their own transaction. */
export async function readAuthorizationContext(
  reader: AuthorizationContextReader,
  options: { includeConsents?: boolean } = {},
): Promise<AuthorizationContext> {
  return {
    account: await reader.getAccount(),
    workspace: await reader.getWorkspace(),
    membership: await reader.getMembership(),
    ...(options.includeConsents
      ? { consents: await reader.listConsents() }
      : {}),
  };
}
export interface AuthorizationOptions {
  targetAccountId?: string;
  consentChange?: Pick<ConsentUpdate, "purpose" | "policyVersion" | "granted">;
}
export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: "FORBIDDEN" | "CONSENT_REQUIRED" };

const denied: AuthorizationDecision = Object.freeze({
  allowed: false,
  reason: "FORBIDDEN",
});
const allowed: AuthorizationDecision = Object.freeze({ allowed: true });
const missingConsent: AuthorizationDecision = Object.freeze({
  allowed: false,
  reason: "CONSENT_REQUIRED",
});

function currentConsent(
  context: AuthorizationContext,
  purpose: ConsentPurpose,
) {
  const policy = AUTHORIZATION_CONSENT_POLICIES.find(
    (entry) => entry.purpose === purpose,
  )!;
  return !!context.consents?.some(
    (entry) =>
      entry.purpose === purpose &&
      entry.policyVersion === policy.policyVersion &&
      entry.granted,
  );
}

/** Authorization is one precondition; availability, host grants and budgets remain separate. */
export function evaluateAuthorization(
  context: AuthorizationContext,
  action: AuthorizationAction,
  options: AuthorizationOptions = {},
): AuthorizationDecision {
  if (
    context.account.status !== "active" ||
    !authorizationActionSchema.safeParse(action).success
  )
    return denied;
  const membershipAction =
    action === "memberships.read" || action === "memberships.update";
  if (
    options.targetAccountId !== undefined &&
    options.targetAccountId !== context.account.id &&
    !membershipAction
  )
    return denied;
  if (
    action === "account.read" ||
    action === "account.manage" ||
    action === "workspaces.list"
  )
    return allowed;

  const { workspace, membership } = context;
  if (
    !workspace ||
    !membership ||
    membership.accountId !== context.account.id ||
    membership.status !== "active" ||
    (workspace.kind === "personal" &&
      workspace.ownerAccountId !== context.account.id) ||
    (membership.role === "owner" &&
      workspace.ownerAccountId !== context.account.id)
  )
    return denied;
  const canonicalOwner =
    workspace.ownerAccountId === context.account.id &&
    membership.role === "owner";

  switch (action) {
    case "memberships.read":
      return options.targetAccountId === context.account.id ||
        canonicalOwner ||
        (workspace.kind === "organization" && membership.role === "admin")
        ? allowed
        : denied;
    case "memberships.update":
      return workspace.kind === "organization" &&
        canonicalOwner &&
        options.targetAccountId !== workspace.ownerAccountId
        ? allowed
        : denied;
    case "consents.write": {
      const change = options.consentChange;
      // Catalogs describe the right to manage consent without granting any purpose.
      if (!change) return allowed;
      if (change.granted)
        return AUTHORIZATION_CONSENT_POLICIES.some(
          (policy) =>
            policy.purpose === change.purpose &&
            policy.policyVersion === change.policyVersion,
        )
          ? allowed
          : denied;
      return context.consents?.some(
        (stored) =>
          stored.purpose === change.purpose &&
          stored.policyVersion === change.policyVersion,
      )
        ? allowed
        : denied;
    }
    case "saved-data.write":
    case "saved-data.import":
      return currentConsent(context, "cloud_saved_routes")
        ? allowed
        : missingConsent;
    case "inference.request":
      return currentConsent(context, "cloud_inference")
        ? allowed
        : missingConsent;
    case "image.transmit":
      return currentConsent(context, "cloud_inference") &&
        currentConsent(context, "image_transmission")
        ? allowed
        : missingConsent;
    case "analytics.record":
      return currentConsent(context, "product_analytics")
        ? allowed
        : missingConsent;
    case "policies.read":
    case "consents.read":
    case "jobs.read":
    case "jobs.cancel":
    case "saved-data.read":
    case "saved-data.export":
    case "saved-data.delete":
    case "usage.read":
    case "credits.read":
    case "support.request":
      // Own reads, export, deletion and requested support never consume credits
      // or depend on inference consent. Their domain checks still apply.
      return allowed;
    default:
      return denied;
  }
}

export function authorizationPolicyCatalog(
  context: AuthorizationContext,
): AuthorizationPolicyCatalog {
  if (!evaluateAuthorization(context, "policies.read").allowed)
    throw new Error("The workspace is unavailable.");
  return policyCatalogSchema.parse({
    workspaceId: context.workspace!.id,
    role: context.membership!.role,
    allowedActions: authorizationActionSchema.options.filter(
      (action) => evaluateAuthorization(context, action).allowed,
    ),
    consentPolicies: AUTHORIZATION_CONSENT_POLICIES,
  });
}
