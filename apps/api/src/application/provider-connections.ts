import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  providerApiKeySchema,
  providerConnectionCreateSchema,
  providerConnectionReplaceSchema,
  providerConnectionRemoveSchema,
  providerConnectionSchema,
  providerConnectionSelectionSchema,
  providerConnectionsSchema,
  type ProviderConnection,
  type ProviderConnectionSelection,
  type ProviderId,
} from "../../../../packages/navigation-core/contracts-providers";
import type { ServiceRequestContext } from "../capabilities";
import {
  AuthorizationError,
  authorizationRepositoryFailure,
} from "./authorization";

export interface ProviderConnectionPrincipal {
  readonly accountId: string;
}
export interface ProviderSecretBinding {
  readonly accountId: string;
  readonly connectionId: string;
  readonly provider: ProviderId;
  readonly revision: string;
}
export interface SealedProviderSecret {
  readonly version: 1;
  readonly keyVersion: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}
export const sealedProviderSecretSchema = z
  .object({
    version: z.literal(1),
    keyVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    ciphertext: z
      .string()
      .min(2)
      .max(10923)
      .regex(/^[A-Za-z0-9_-]+$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();
export interface ProviderSecretCipher {
  seal(
    binding: ProviderSecretBinding,
    apiKey: string,
  ): Promise<SealedProviderSecret>;
  open(
    binding: ProviderSecretBinding,
    sealed: SealedProviderSecret,
  ): Promise<string>;
}
/** Internal only. Callers must project metadata before HTTP or account export. */
export interface ProviderConnectionRecord extends ProviderConnection {
  accountId: string;
  sealedKey: SealedProviderSecret | null;
}
export type ProviderConnectionWrite = Omit<
  ProviderConnectionRecord,
  "createdAt" | "updatedAt" | "verifiedAt"
>;
export interface ProviderConnectionStore {
  list(accountId: string, signal: AbortSignal): Promise<ProviderConnection[]>;
  read(
    accountId: string,
    connectionId: string,
    signal: AbortSignal,
  ): Promise<ProviderConnectionRecord | undefined>;
  create(
    accountId: string,
    record: ProviderConnectionWrite,
    signal: AbortSignal,
  ): Promise<ProviderConnection>;
  replace(
    accountId: string,
    record: ProviderConnectionWrite,
    expectedRevision: string,
    signal: AbortSignal,
  ): Promise<ProviderConnection>;
  remove(
    accountId: string,
    connectionId: string,
    expectedRevision: string,
    signal: AbortSignal,
  ): Promise<ProviderConnection>;
  markVerified(
    accountId: string,
    connectionId: string,
    expectedRevision: string,
    policyDigest: string,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export class ProviderSecretError extends Error {
  constructor() {
    super("The provider credential is unavailable.");
    this.name = "ProviderSecretError";
  }
}

/** Contains no user secret and binds the exact source-owned processing policy. */
export function providerRoutingPolicyDigest(provider: ProviderId): string {
  const entry = getProviderDefinition(provider);
  return createHash("sha256")
    .update(
      JSON.stringify({
        catalogRevision: PROVIDER_CATALOG_REVISION,
        provider: entry.provider,
        model: entry.model,
        transport: entry.transport,
        routingPolicyVersion: entry.routingPolicyVersion,
        upstream: entry.upstream,
        requestPolicy: entry.requestPolicy,
      }),
    )
    .digest("hex");
}

const unavailable = () =>
  new AuthorizationError(
    503,
    "UNAVAILABLE",
    "Provider credential storage is unavailable.",
  );
const changed = () =>
  new AuthorizationError(
    409,
    "CONFLICT",
    "The provider connection is unavailable or has changed. Refresh your connections.",
  );
const actor = (principal: ProviderConnectionPrincipal) =>
  z.string().uuid().parse(principal.accountId);
const metadata = (record: ProviderConnection) =>
  providerConnectionSchema.parse({
    id: record.id,
    provider: record.provider,
    model: record.model,
    catalogRevision: record.catalogRevision,
    routingPolicyVersion: record.routingPolicyVersion,
    policyDigest: record.policyDigest,
    status: record.status,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    verifiedAt: record.verifiedAt,
  });
const binding = (
  record: ProviderConnectionRecord | ProviderConnectionWrite,
): ProviderSecretBinding => ({
  accountId: record.accountId,
  connectionId: record.id,
  provider: record.provider,
  revision: record.revision,
});

/** Credential management reuses current account proof and never grants model consent. */
export class ProviderConnectionService {
  constructor(
    private readonly store: ProviderConnectionStore,
    private readonly cipher?: ProviderSecretCipher,
  ) {}
  get storageAvailable() {
    return !!this.cipher;
  }

  private async operation<T>(
    context: ServiceRequestContext,
    work: () => Promise<T>,
  ) {
    context.signal.throwIfAborted();
    try {
      const result = await work();
      context.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof ProviderSecretError) throw unavailable();
      return authorizationRepositoryFailure(error);
    }
  }
  list(principal: ProviderConnectionPrincipal, context: ServiceRequestContext) {
    const accountId = actor(principal);
    return this.operation(context, async () =>
      providerConnectionsSchema.parse({
        catalogRevision: PROVIDER_CATALOG_REVISION,
        items: (await this.store.list(accountId, context.signal)).map(metadata),
      }),
    );
  }
  create(
    principal: ProviderConnectionPrincipal,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = providerConnectionCreateSchema.parse(raw),
      accountId = actor(principal);
    if (!this.cipher) throw unavailable();
    const cipher = this.cipher,
      definition = getProviderDefinition(input.provider);
    if (input.catalogRevision !== PROVIDER_CATALOG_REVISION)
      throw new AuthorizationError(
        409,
        "COMPATIBILITY_MISMATCH",
        "The provider catalog changed. Refresh your connections.",
      );
    if (input.model !== definition.model)
      throw new AuthorizationError(
        400,
        "INVALID_REQUEST",
        "Select an approved model for this provider.",
      );
    return this.operation(context, async () => {
      const record: ProviderConnectionWrite = {
        id: randomUUID(),
        accountId,
        provider: definition.provider,
        model: definition.model,
        catalogRevision: PROVIDER_CATALOG_REVISION,
        routingPolicyVersion: definition.routingPolicyVersion,
        policyDigest: providerRoutingPolicyDigest(definition.provider),
        status: "active",
        revision: "1",
        sealedKey: null,
      };
      record.sealedKey = await cipher.seal(binding(record), input.apiKey);
      context.signal.throwIfAborted();
      return metadata(
        await this.store.create(accountId, record, context.signal),
      );
    });
  }
  replace(
    principal: ProviderConnectionPrincipal,
    connectionId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = providerConnectionReplaceSchema.parse(raw),
      accountId = actor(principal);
    z.string().uuid().parse(connectionId);
    if (!this.cipher) throw unavailable();
    const cipher = this.cipher;
    return this.operation(context, async () => {
      const prior = await this.store.read(
        accountId,
        connectionId,
        context.signal,
      );
      if (
        !prior ||
        prior.accountId !== accountId ||
        prior.revision !== input.expectedRevision ||
        BigInt(prior.revision) === 9223372036854775807n
      )
        throw changed();
      const definition = getProviderDefinition(prior.provider);
      if (input.catalogRevision !== PROVIDER_CATALOG_REVISION)
        throw new AuthorizationError(
          409,
          "COMPATIBILITY_MISMATCH",
          "The provider catalog changed. Refresh your connections.",
        );
      if (input.model !== definition.model)
        throw new AuthorizationError(
          400,
          "INVALID_REQUEST",
          "Select an approved model for this provider.",
        );
      if (
        input.apiKey === undefined &&
        prior.status === "active" &&
        prior.model === definition.model &&
        prior.catalogRevision === PROVIDER_CATALOG_REVISION &&
        prior.routingPolicyVersion === definition.routingPolicyVersion &&
        prior.policyDigest === providerRoutingPolicyDigest(prior.provider)
      )
        return metadata(prior);
      if (input.apiKey === undefined && !prior.sealedKey) throw changed();
      const record: ProviderConnectionWrite = {
        id: prior.id,
        accountId,
        provider: definition.provider,
        model: definition.model,
        catalogRevision: PROVIDER_CATALOG_REVISION,
        routingPolicyVersion: definition.routingPolicyVersion,
        policyDigest: providerRoutingPolicyDigest(definition.provider),
        status: "active",
        revision: (BigInt(prior.revision) + 1n).toString(),
        sealedKey: null,
      };
      const apiKey =
        input.apiKey ?? (await cipher.open(binding(prior), prior.sealedKey!));
      record.sealedKey = await cipher.seal(binding(record), apiKey);
      context.signal.throwIfAborted();
      return metadata(
        await this.store.replace(
          accountId,
          record,
          input.expectedRevision,
          context.signal,
        ),
      );
    });
  }
  remove(
    principal: ProviderConnectionPrincipal,
    connectionId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = providerConnectionRemoveSchema.parse(raw),
      accountId = actor(principal);
    z.string().uuid().parse(connectionId);
    return this.operation(context, async () =>
      metadata(
        await this.store.remove(
          accountId,
          connectionId,
          input.expectedRevision,
          context.signal,
        ),
      ),
    );
  }

  private async current(
    accountId: string,
    selection: ProviderConnectionSelection,
    context: ServiceRequestContext,
  ) {
    const record = await this.store.read(
      accountId,
      selection.connectionId,
      context.signal,
    );
    const definition = getProviderDefinition(selection.provider);
    if (
      !record ||
      record.accountId !== accountId ||
      record.status !== "active" ||
      !record.sealedKey ||
      record.provider !== selection.provider ||
      record.model !== selection.model ||
      record.revision !== selection.revision ||
      record.catalogRevision !== selection.catalogRevision ||
      record.routingPolicyVersion !== selection.routingPolicyVersion ||
      record.policyDigest !== selection.policyDigest ||
      record.catalogRevision !== PROVIDER_CATALOG_REVISION ||
      record.model !== definition.model ||
      record.routingPolicyVersion !== definition.routingPolicyVersion ||
      record.policyDigest !== providerRoutingPolicyDigest(selection.provider)
    )
      throw changed();
    return record;
  }
  assertCurrent(
    principal: ProviderConnectionPrincipal,
    raw: ProviderConnectionSelection,
    context: ServiceRequestContext,
  ) {
    const accountId = actor(principal),
      selection = providerConnectionSelectionSchema.parse(raw);
    return this.operation(context, async () =>
      metadata(await this.current(accountId, selection, context)),
    );
  }

  /** Proof metadata is best-effort; failure cannot erase already reported usage. */
  async markVerified(
    principal: ProviderConnectionPrincipal,
    raw: ProviderConnectionSelection,
    context: ServiceRequestContext,
  ): Promise<boolean> {
    try {
      const accountId = actor(principal),
        selection = providerConnectionSelectionSchema.parse(raw);
      await this.assertCurrent(principal, selection, context);
      context.signal.throwIfAborted();
      return await this.store.markVerified(
        accountId,
        selection.connectionId,
        selection.revision,
        selection.policyDigest,
        context.signal,
      );
    } catch {
      return false;
    }
  }

  /** Server adapter only. Its caller still owns consent, usage and final response proof. */
  async withCredential<T>(
    principal: ProviderConnectionPrincipal,
    raw: ProviderConnectionSelection,
    context: ServiceRequestContext,
    work: (apiKey: string, connection: ProviderConnection) => Promise<T>,
  ): Promise<T> {
    const accountId = actor(principal),
      selection = providerConnectionSelectionSchema.parse(raw);
    if (!this.cipher) throw unavailable();
    context.signal.throwIfAborted();
    let record: ProviderConnectionRecord, key: string;
    try {
      record = await this.current(accountId, selection, context);
      key = providerApiKeySchema.parse(
        await this.cipher.open(binding(record), record.sealedKey!),
      );
      context.signal.throwIfAborted();
      await this.current(accountId, selection, context);
      context.signal.throwIfAborted();
    } catch (error) {
      if (error instanceof ProviderSecretError) throw unavailable();
      return authorizationRepositoryFailure(error);
    }
    // No post-callback throw can discard already reported model usage. The caller
    // rechecks this binding before releasing a proposal through the shared owner.
    return work(key, metadata(record));
  }
}
