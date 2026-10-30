import type { ServiceRequestContext } from "../capabilities";

/** Shared token-validation skew and conservative all-client logout fence. */
export const IDENTITY_CLOCK_TOLERANCE_SECONDS = 5;

export type IdentityClientKind = "web" | "extension" | "desktop";
export type IdentityAction = "signin" | "signup" | "recover" | "verify";
export interface IdentityClient {
  id: string;
  kind: IdentityClientKind;
  redirectUris: readonly string[];
}
export interface IdentityOptions {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  webOrigin: string;
  clients: readonly IdentityClient[];
  /** Shared 32-byte key for sealed flow secrets and session-bound CSRF proofs. */
  flowEncryptionKey: string;
  secureCookies: boolean;
  requireVerifiedEmail: boolean;
  accessLifetimeMs: number;
  sessionLifetimeMs: number;
}
export interface ProviderIdentity {
  issuer: string;
  subject: string;
  providerSessionId?: string;
  issuedAt: Date;
  /** Only a valid signed verified address; null disables an older contact projection. */
  verifiedEmail?: string | null;
}
export interface IdentityAccount {
  identityId: string;
  accountId: string;
  workspaceId: string;
  revision: string;
}
export interface IdentityFlow {
  stateHash: string;
  browserBindingHash: string;
  nonceHash: string;
  sealedVerifier: string;
  clientId: string;
  redirectUri: string;
  destination: "account" | "download" | "client";
  clientState?: string;
  codeChallenge?: string;
  expiresAt: Date;
}
export interface IdentityBroker extends IdentityAccount, ProviderIdentity {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: Date;
}
export interface IdentitySession extends IdentityAccount {
  id: string;
  clientId: string;
  clientKind: IdentityClientKind;
  providerIssuer: string;
  providerSubject: string;
  providerSessionId?: string;
  providerIssuedAt: Date;
  accessHash: string;
  refreshHash: string;
  csrfHash: string;
  accessExpiresAt: Date;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
}
export type RefreshResult =
  | { status: "rotated"; session: IdentitySession }
  | { status: "invalid" | "replayed" };

/** Each one-use/revocation method is atomic and commits before returning. */
export interface IdentityStore {
  createFlow(flow: IdentityFlow): Promise<void>;
  consumeFlow(
    stateHash: string,
    browserBindingHash: string,
    now: Date,
  ): Promise<IdentityFlow | null>;
  resolveIdentity(identity: ProviderIdentity): Promise<IdentityAccount>;
  createBroker(broker: IdentityBroker): Promise<void>;
  consumeBroker(
    codeHash: string,
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    now: Date,
  ): Promise<IdentityBroker | null>;
  createSession(session: IdentitySession): Promise<void>;
  authenticateSession(
    accessHash: string,
    now: Date,
  ): Promise<IdentitySession | null>;
  rotateSession(input: {
    refreshHash: string;
    clientId: string;
    expectedSessionId?: string;
    accessHash: string;
    nextRefreshHash: string;
    csrfHash: string;
    accessExpiresAt: Date;
    now: Date;
  }): Promise<RefreshResult>;
  listSessions(accountId: string, now: Date): Promise<IdentitySession[]>;
  revokeSession(
    accountId: string,
    sessionId: string,
    now: Date,
  ): Promise<boolean>;
  revokeAllSessions(accountId: string, now: Date): Promise<void>;
  revokeProviderSessions(input: {
    issuer: string;
    subject?: string;
    providerSessionId?: string;
    eventId: string;
    issuedAt: Date;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
}
export interface IdentityProvider {
  authorize(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    action: IdentityAction;
  }): string;
  exchange(input: {
    code: string;
    verifier: string;
    nonceHash: string;
    context: ServiceRequestContext;
  }): Promise<ProviderIdentity>;
  verifyLogout(
    token: string,
    context: ServiceRequestContext,
  ): Promise<{
    issuer: string;
    subject?: string;
    providerSessionId?: string;
    eventId: string;
    issuedAt: Date;
    expiresAt: Date;
  }>;
  /** Provider logout may require confirmation; local revocation is independent. */
  logoutUrl(): string;
}
