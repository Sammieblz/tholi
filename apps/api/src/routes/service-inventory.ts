/** A contract inventory, not route registration or permission to expose data. */
export interface ServiceRouteInventoryEntry {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: `/api/v1/${string}`;
  operationId: string;
  group:
    | "discovery"
    | "identity"
    | "account"
    | "organizations"
    | "policies"
    | "decisions"
    | "usage"
    | "credits"
    | "plans"
    | "jobs"
    | "support"
    | "saved-data"
    | "sync"
    | "billing"
    | "onboarding";
  status: "implemented" | "planned";
  issue: number;
  access: "public" | "authenticated" | "provider";
  summary: string;
}

export const SERVICE_ROUTES = [
  {
    method: "GET",
    path: "/api/v1/capabilities",
    operationId: "getServiceCapabilities",
    group: "discovery",
    status: "implemented",
    issue: 29,
    access: "public",
    summary:
      "Discover the supported service contract and currently available features.",
  },
  {
    method: "POST",
    path: "/api/v1/handshake",
    operationId: "negotiateServiceCompatibility",
    group: "discovery",
    status: "implemented",
    issue: 29,
    access: "public",
    summary:
      "Negotiate compatibility without granting authentication or data access.",
  },
  {
    method: "GET",
    path: "/api/v1/openapi.json",
    operationId: "getServiceOpenApi",
    group: "discovery",
    status: "implemented",
    issue: 29,
    access: "public",
    summary:
      "Read the executable API specification and clearly separated future inventory.",
  },
  {
    method: "GET",
    path: "/api/v1/auth/authorize",
    operationId: "startServiceAuthorization",
    group: "identity",
    status: "planned",
    issue: 30,
    access: "public",
    summary:
      "Start sign-up or sign-in using a registered client and bound return intent.",
  },
  {
    method: "GET",
    path: "/api/v1/auth/callback",
    operationId: "completeServiceAuthorization",
    group: "identity",
    status: "planned",
    issue: 30,
    access: "public",
    summary:
      "Validate the provider callback and flow binding before resolving an approved return.",
  },
  {
    method: "POST",
    path: "/api/v1/auth/exchange",
    operationId: "exchangeServiceAuthorization",
    group: "identity",
    status: "planned",
    issue: 30,
    access: "public",
    summary:
      "Exchange a single-use client-bound authorization result with PKCE proof.",
  },
  {
    method: "POST",
    path: "/api/v1/auth/refresh",
    operationId: "refreshServiceSession",
    group: "identity",
    status: "planned",
    issue: 30,
    access: "authenticated",
    summary: "Rotate a valid session with refresh replay detection.",
  },
  {
    method: "POST",
    path: "/api/v1/auth/logout",
    operationId: "revokeCurrentServiceSession",
    group: "identity",
    status: "planned",
    issue: 30,
    access: "authenticated",
    summary:
      "Revoke the current server session and expire its client credential.",
  },
  {
    method: "GET",
    path: "/api/v1/account",
    operationId: "getCurrentAccount",
    group: "account",
    status: "planned",
    issue: 30,
    access: "authenticated",
    summary:
      "Read the authenticated account independently of inference credit availability.",
  },
  {
    method: "PATCH",
    path: "/api/v1/account",
    operationId: "updateCurrentAccount",
    group: "account",
    status: "planned",
    issue: 60,
    access: "authenticated",
    summary:
      "Update permitted account fields using the expected account revision.",
  },
  {
    method: "GET",
    path: "/api/v1/account/sessions",
    operationId: "listAccountSessions",
    group: "account",
    status: "planned",
    issue: 30,
    access: "authenticated",
    summary: "List bounded account security and device-session metadata.",
  },
  {
    method: "DELETE",
    path: "/api/v1/account/sessions/{sessionId}",
    operationId: "revokeAccountSession",
    group: "account",
    status: "planned",
    issue: 30,
    access: "authenticated",
    summary:
      "Revoke an owned session without trusting a supplied account identifier.",
  },
  {
    method: "POST",
    path: "/api/v1/auth/backchannel-logout",
    operationId: "receiveProviderLogout",
    group: "identity",
    status: "planned",
    issue: 30,
    access: "provider",
    summary:
      "Verify issuer-bound signed provider logout and revoke the matching session families.",
  },
  {
    method: "POST",
    path: "/api/v1/account/deletion",
    operationId: "requestAccountDeletion",
    group: "account",
    status: "planned",
    issue: 45,
    access: "authenticated",
    summary:
      "Request idempotent account deletion with explicit retention and organization boundaries.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces",
    operationId: "listAuthorizedWorkspaces",
    group: "organizations",
    status: "planned",
    issue: 31,
    access: "authenticated",
    summary:
      "List workspaces selected through current server-resolved membership.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/memberships",
    operationId: "listWorkspaceMemberships",
    group: "organizations",
    status: "planned",
    issue: 31,
    access: "authenticated",
    summary:
      "List bounded organization memberships after workspace authorization.",
  },
  {
    method: "PATCH",
    path: "/api/v1/workspaces/{workspaceId}/memberships/{accountId}",
    operationId: "updateWorkspaceMembership",
    group: "organizations",
    status: "planned",
    issue: 31,
    access: "authenticated",
    summary:
      "Change authorized membership or role state with expected revisions.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/policies",
    operationId: "getWorkspacePolicies",
    group: "policies",
    status: "planned",
    issue: 31,
    access: "authenticated",
    summary:
      "Read effective server policy without transferring journey authority.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/consents",
    operationId: "listWorkspaceConsents",
    group: "policies",
    status: "planned",
    issue: 31,
    access: "authenticated",
    summary:
      "Read purpose-specific policy versions and the actor's current consent.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/consents",
    operationId: "recordWorkspaceConsent",
    group: "policies",
    status: "planned",
    issue: 31,
    access: "authenticated",
    summary:
      "Record or revoke purpose/version consent using an expected revision.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/decisions",
    operationId: "requestNavigationDecision",
    group: "decisions",
    status: "planned",
    issue: 36,
    access: "authenticated",
    summary:
      "Negotiate bounded observations and grounded proposals; inference remains unavailable until its adapter and consent milestones.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/decisions/{requestId}",
    operationId: "getNavigationDecisionStatus",
    group: "decisions",
    status: "planned",
    issue: 36,
    access: "authenticated",
    summary:
      "Read an owned request's status without replaying uncertain billable work.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/decisions/{requestId}/cancel",
    operationId: "cancelNavigationDecision",
    group: "decisions",
    status: "planned",
    issue: 40,
    access: "authenticated",
    summary:
      "Request cancellation without claiming that an already executing provider was cancelled or unbilled.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/usage",
    operationId: "listWorkspaceUsage",
    group: "usage",
    status: "planned",
    issue: 44,
    access: "authenticated",
    summary:
      "Read bounded metering history without raw prompts or client-supplied counters.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/credits",
    operationId: "getWorkspaceCredits",
    group: "credits",
    status: "planned",
    issue: 44,
    access: "authenticated",
    summary:
      "Read authoritative integer credit balances and reservation state.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/credits/events",
    operationId: "listWorkspaceCreditEvents",
    group: "credits",
    status: "planned",
    issue: 44,
    access: "authenticated",
    summary:
      "Read bounded server ledger history; clients cannot grant or settle credits.",
  },
  {
    method: "GET",
    path: "/api/v1/plans",
    operationId: "listPublishedPlans",
    group: "plans",
    status: "planned",
    issue: 58,
    access: "public",
    summary:
      "Read the versioned Local, Free Cloud and paid catalog without granting entitlement.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/entitlements",
    operationId: "getWorkspaceEntitlements",
    group: "plans",
    status: "planned",
    issue: 58,
    access: "authenticated",
    summary:
      "Read server-resolved plan access independently of client plan-selection intent.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/jobs",
    operationId: "listWorkspaceJobs",
    group: "jobs",
    status: "planned",
    issue: 32,
    access: "authenticated",
    summary:
      "List bounded authorized job status without raw payloads or credentials.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/jobs/{jobId}",
    operationId: "getWorkspaceJob",
    group: "jobs",
    status: "planned",
    issue: 32,
    access: "authenticated",
    summary:
      "Read an authorized durable job and its safe failure or retry state.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/jobs/{jobId}/cancel",
    operationId: "cancelWorkspaceJob",
    group: "jobs",
    status: "planned",
    issue: 32,
    access: "authenticated",
    summary:
      "Request scoped cancellation while preserving uncertain external-effect state.",
  },
  {
    method: "POST",
    path: "/api/v1/support/requests",
    operationId: "createSupportRequest",
    group: "support",
    status: "planned",
    issue: 33,
    access: "authenticated",
    summary:
      "Submit bounded approved support content through authorized templates and private artifacts.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/artifacts",
    operationId: "listSavedArtifacts",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Read bounded owned cloud artifacts without uploading local memory.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/artifacts",
    operationId: "createSavedArtifact",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Explicitly save an allowlisted privacy-filtered artifact using a scoped idempotency key.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}",
    operationId: "getSavedArtifact",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Read an authorized saved artifact even when inference credits are exhausted.",
  },
  {
    method: "PATCH",
    path: "/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}",
    operationId: "updateSavedArtifact",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary: "Update a saved artifact only at its exact expected revision.",
  },
  {
    method: "DELETE",
    path: "/api/v1/workspaces/{workspaceId}/artifacts/{artifactId}",
    operationId: "deleteSavedArtifact",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Create an owned tombstone without allowing stale-device resurrection.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/artifacts/search",
    operationId: "searchSavedArtifacts",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary: "Search only authorized saved data with bounded results.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/artifacts/export",
    operationId: "exportSavedArtifacts",
    group: "saved-data",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Request an idempotent authorized export job and private expiring result.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/sync/changes",
    operationId: "getSavedArtifactChanges",
    group: "sync",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Read bounded revisioned changes including tombstones within the current account and workspace.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/sync/import",
    operationId: "importSavedArtifacts",
    group: "sync",
    status: "planned",
    issue: 59,
    access: "authenticated",
    summary:
      "Import only explicitly approved artifacts with revision conflict and deletion checks.",
  },
  {
    method: "GET",
    path: "/api/v1/workspaces/{workspaceId}/subscription",
    operationId: "getWorkspaceSubscription",
    group: "billing",
    status: "planned",
    issue: 50,
    access: "authenticated",
    summary:
      "Read the server-reconciled subscription, never client-asserted payment success.",
  },
  {
    method: "POST",
    path: "/api/v1/workspaces/{workspaceId}/checkout",
    operationId: "startWorkspaceCheckout",
    group: "billing",
    status: "planned",
    issue: 50,
    access: "authenticated",
    summary:
      "Resolve approved plan and return intent to a server-created checkout; no arbitrary checkout URL is trusted.",
  },
  {
    method: "GET",
    path: "/api/v1/billing/return",
    operationId: "completeCheckoutReturn",
    group: "billing",
    status: "planned",
    issue: 50,
    access: "authenticated",
    summary:
      "Resolve a bound checkout return without treating a redirect as payment or entitlement proof.",
  },
  {
    method: "POST",
    path: "/api/v1/billing/webhooks/{provider}",
    operationId: "receiveBillingEvent",
    group: "billing",
    status: "planned",
    issue: 50,
    access: "provider",
    summary:
      "Verify raw provider-event signatures and replay identity before billing reconciliation.",
  },
  {
    method: "POST",
    path: "/api/v1/onboarding/intent",
    operationId: "recordOnboardingIntent",
    group: "onboarding",
    status: "planned",
    issue: 61,
    access: "public",
    summary:
      "Preserve Local, Free Cloud or paid intent without granting account access or entitlement.",
  },
  {
    method: "POST",
    path: "/api/v1/onboarding/return",
    operationId: "completeOnboardingReturn",
    group: "onboarding",
    status: "planned",
    issue: 61,
    access: "authenticated",
    summary:
      "Complete a single-use client-bound return while keeping interrupted users' Local path available.",
  },
] as const satisfies readonly ServiceRouteInventoryEntry[];
