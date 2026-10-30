import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  identityAuthorizeSchema,
  identityExchangeSchema,
  identityTokensSchema,
  type IdentityAuthorizeInput,
  type IdentityTokens,
} from "../../../../packages/navigation-core/contracts-identity";
import type { ServiceErrorCode } from "../../../../packages/navigation-core/contracts-service";
import type { ServiceRequestContext } from "../capabilities";
import type {
  IdentityAccount,
  IdentityOptions,
  IdentityProvider,
  IdentitySession,
  IdentityStore,
  ProviderIdentity,
} from "./identity-contracts";

export class IdentityError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export const identityHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const challenge = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const opaque = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value);
const denied = () =>
  new IdentityError(401, "UNAUTHENTICATED", "Sign in again to continue.");
export function equalIdentityHash(left: string, right: string) {
  return (
    /^[a-f0-9]{64}$/.test(left) &&
    /^[a-f0-9]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
  );
}
export interface IssuedIdentitySession {
  session: IdentitySession;
  tokens: IdentityTokens;
}

/** Provider proof grants an account session, never navigation or entitlement authority. */
export class IdentityService {
  private readonly key: Buffer;
  constructor(
    readonly options: IdentityOptions,
    private readonly store: IdentityStore,
    private readonly provider: IdentityProvider,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = Buffer.from(options.flowEncryptionKey, "base64url");
    if (this.key.length !== 32)
      throw Error("Invalid identity flow encryption key.");
  }
  private seal(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString("base64url"))
      .join(".");
  }
  private unseal(value: string) {
    const parts = value.split(".");
    if (parts.length !== 3) throw denied();
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(parts[0], "base64url"),
      );
      decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[2], "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw denied();
    }
  }
  private client(id: string) {
    const client = this.options.clients.find((entry) => entry.id === id);
    if (!client)
      throw new IdentityError(
        400,
        "INVALID_REQUEST",
        "The authentication client is not registered.",
      );
    return client;
  }
  async start(raw: IdentityAuthorizeInput, priorBinding?: string) {
    const input = identityAuthorizeSchema.parse(raw),
      client = this.client(input.clientId);
    const native = client.kind !== "web";
    if (
      native &&
      (!input.redirectUri ||
        !input.state ||
        !input.codeChallenge ||
        input.destination !== "client")
    )
      throw new IdentityError(
        400,
        "INVALID_REQUEST",
        "The client authentication proof is incomplete.",
      );
    if (
      !native &&
      (input.redirectUri ||
        input.state ||
        input.codeChallenge ||
        input.destination === "client")
    )
      throw new IdentityError(
        400,
        "INVALID_REQUEST",
        "The website authentication return is invalid.",
      );
    const redirectUri = native
      ? input.redirectUri!
      : this.options.webOrigin +
        (input.destination === "download" ? "/download" : "/account");
    if (!client.redirectUris.includes(redirectUri))
      throw new IdentityError(
        400,
        "INVALID_REQUEST",
        "The authentication return is not registered.",
      );
    const state = secret(),
      nonce = secret(),
      verifier = secret(),
      browserBinding = opaque(priorBinding) ? priorBinding : secret();
    const url = this.provider.authorize({
      state,
      nonce,
      codeChallenge: challenge(verifier),
      action: input.action,
    });
    await this.store.createFlow({
      stateHash: identityHash(state),
      browserBindingHash: identityHash(browserBinding),
      nonceHash: identityHash(nonce),
      sealedVerifier: this.seal(verifier),
      clientId: client.id,
      redirectUri,
      destination: input.destination,
      ...(native
        ? { clientState: input.state, codeChallenge: input.codeChallenge }
        : {}),
      expiresAt: new Date(this.now().getTime() + 5 * 60_000),
    });
    return { url, browserBinding };
  }
  async complete(
    input: { state: string; code: string; browserBinding?: string },
    context: ServiceRequestContext,
  ): Promise<
    | { kind: "web"; redirectUri: string; issued: IssuedIdentitySession }
    | { kind: "native"; redirectUri: string }
  > {
    if (
      !opaque(input.state) ||
      !opaque(input.browserBinding) ||
      !input.code ||
      input.code.length > 4096
    )
      throw denied();
    const flow = await this.store.consumeFlow(
      identityHash(input.state),
      identityHash(input.browserBinding),
      this.now(),
    );
    if (!flow) throw denied();
    const identity = await this.provider.exchange({
      code: input.code,
      verifier: this.unseal(flow.sealedVerifier),
      nonceHash: flow.nonceHash,
      context,
    });
    context.signal.throwIfAborted();
    const account = await this.authorizedWrite(() =>
        this.store.resolveIdentity(identity),
      ),
      client = this.client(flow.clientId);
    context.signal.throwIfAborted();
    if (!client.redirectUris.includes(flow.redirectUri)) throw denied();
    if (client.kind === "web")
      return {
        kind: "web",
        redirectUri: flow.redirectUri,
        issued: await this.issue(account, identity, client.id),
      };
    if (!flow.codeChallenge || !flow.clientState) throw denied();
    const code = secret();
    await this.authorizedWrite(() =>
      this.store.createBroker({
        ...account,
        ...identity,
        codeHash: identityHash(code),
        clientId: client.id,
        redirectUri: flow.redirectUri,
        codeChallenge: flow.codeChallenge!,
        expiresAt: new Date(this.now().getTime() + 60_000),
      }),
    );
    const destination = new URL(flow.redirectUri);
    destination.searchParams.set("code", code);
    destination.searchParams.set("state", flow.clientState);
    return { kind: "native", redirectUri: destination.href };
  }
  async exchange(raw: unknown) {
    const input = identityExchangeSchema.parse(raw),
      client = this.client(input.clientId);
    if (
      client.kind === "web" ||
      !client.redirectUris.includes(input.redirectUri)
    )
      throw denied();
    const broker = await this.store.consumeBroker(
      identityHash(input.code),
      client.id,
      input.redirectUri,
      challenge(input.codeVerifier),
      this.now(),
    );
    if (!broker) throw denied();
    return this.issue(broker, broker, client.id);
  }
  private csrf(id: string) {
    return createHmac("sha256", this.key)
      .update("tholi-csrf:" + id)
      .digest("base64url");
  }
  private async authorizedWrite<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "IDENTITY_REVOKED"
      )
        throw denied();
      throw error;
    }
  }
  private async issue(
    account: IdentityAccount,
    identity: ProviderIdentity,
    clientId: string,
  ): Promise<IssuedIdentitySession> {
    const client = this.client(clientId),
      now = this.now(),
      id = randomUUID(),
      accessToken = secret(),
      refreshToken = secret();
    const expiresAt = new Date(now.getTime() + this.options.sessionLifetimeMs);
    const session: IdentitySession = {
      ...account,
      id,
      clientId,
      clientKind: client.kind,
      providerIssuer: identity.issuer,
      providerSubject: identity.subject,
      providerSessionId: identity.providerSessionId,
      providerIssuedAt: identity.issuedAt,
      accessHash: identityHash(accessToken),
      refreshHash: identityHash(refreshToken),
      csrfHash: identityHash(this.csrf(id)),
      accessExpiresAt: new Date(
        Math.min(
          expiresAt.getTime(),
          now.getTime() +
            (client.kind === "web"
              ? this.options.sessionLifetimeMs
              : this.options.accessLifetimeMs),
        ),
      ),
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
    };
    await this.authorizedWrite(() => this.store.createSession(session));
    return { session, tokens: this.tokens(session, accessToken, refreshToken) };
  }
  private tokens(
    session: IdentitySession,
    accessToken: string,
    refreshToken: string,
  ) {
    return identityTokensSchema.parse({
      accessToken,
      refreshToken,
      expiresAt: session.accessExpiresAt.toISOString(),
      sessionExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
      account: {
        id: session.accountId,
        workspaceId: session.workspaceId,
        revision: session.revision,
      },
    });
  }
  async authenticate(token: unknown) {
    if (!opaque(token)) throw denied();
    const session = await this.store.authenticateSession(
      identityHash(token),
      this.now(),
    );
    if (!session) throw denied();
    return session;
  }
  verifyCsrf(session: IdentitySession, value: unknown) {
    if (
      !opaque(value) ||
      !equalIdentityHash(identityHash(value), session.csrfHash)
    )
      throw new IdentityError(
        403,
        "FORBIDDEN",
        "The request verification failed. Reload your account page.",
      );
  }
  account(session: IdentitySession) {
    return {
      account: {
        id: session.accountId,
        workspaceId: session.workspaceId,
        revision: session.revision,
      },
      session: {
        id: session.id,
        clientId: session.clientId,
        clientKind: session.clientKind,
        expiresAt: session.expiresAt.toISOString(),
      },
      ...(session.clientKind === "web"
        ? { csrfToken: this.csrf(session.id) }
        : {}),
    };
  }
  async refresh(
    clientId: string,
    token: unknown,
    webSession?: IdentitySession,
  ): Promise<IssuedIdentitySession> {
    const client = this.client(clientId);
    if (
      !opaque(token) ||
      (client.kind === "web" &&
        (!webSession || webSession.clientId !== clientId))
    )
      throw denied();
    const accessToken = secret(),
      refreshToken = secret(),
      now = this.now();
    const result = await this.store.rotateSession({
      refreshHash: identityHash(token),
      clientId,
      expectedSessionId: webSession?.id,
      accessHash: identityHash(accessToken),
      nextRefreshHash: identityHash(refreshToken),
      csrfHash: webSession
        ? identityHash(this.csrf(webSession.id))
        : identityHash(secret()),
      accessExpiresAt: new Date(
        now.getTime() +
          (client.kind === "web"
            ? this.options.sessionLifetimeMs
            : this.options.accessLifetimeMs),
      ),
      now,
    });
    if (result.status !== "rotated") throw denied();
    return {
      session: result.session,
      tokens: this.tokens(result.session, accessToken, refreshToken),
    };
  }
  async sessions(session: IdentitySession) {
    return {
      items: (await this.store.listSessions(session.accountId, this.now()))
        .slice(0, 100)
        .map((entry) => ({
          id: entry.id,
          clientId: entry.clientId,
          clientKind: entry.clientKind,
          expiresAt: entry.expiresAt.toISOString(),
          createdAt: entry.createdAt.toISOString(),
          lastUsedAt: entry.lastUsedAt.toISOString(),
          current: entry.id === session.id,
        })),
    };
  }
  async revoke(session: IdentitySession, id: string) {
    if (!(await this.store.revokeSession(session.accountId, id, this.now())))
      throw new IdentityError(404, "NOT_FOUND", "The session was not found.");
    return { revoked: true as const };
  }
  async logout(session: IdentitySession, all: boolean) {
    if (all) await this.store.revokeAllSessions(session.accountId, this.now());
    else
      await this.store.revokeSession(session.accountId, session.id, this.now());
    return {
      signedOut: true as const,
      providerLogoutUrl: this.provider.logoutUrl(),
    };
  }
  async backchannel(token: string, context: ServiceRequestContext) {
    const event = await this.provider.verifyLogout(token, context);
    context.signal.throwIfAborted();
    await this.store.revokeProviderSessions({ ...event, now: this.now() });
  }
}
