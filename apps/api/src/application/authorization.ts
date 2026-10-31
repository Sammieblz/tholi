import { z } from "zod";
import {
  authorizationPageQuerySchema,
  consentPageSchema,
  consentSchema,
  consentUpdateSchema,
  membershipPageSchema,
  membershipSchema,
  membershipUpdateSchema,
  workspacePageSchema,
  workspaceSchema,
  type AuthorizationAction,
} from "../../../../packages/navigation-core/contracts-authorization";
import type { ServiceErrorCode } from "../../../../packages/navigation-core/contracts-service";
import type { ServiceRequestContext } from "../capabilities";
import { RepositoryError } from "../database/contracts";
import type {
  Account,
  Consent,
  Membership,
  RepositoryScope,
  Workspace,
} from "../database/contracts";
import {
  authorizationPolicyCatalog,
  evaluateAuthorization,
  readAuthorizationContext,
  type AuthorizationContext,
  type AuthorizationContextReader,
  type AuthorizationOptions,
} from "./authorization-policy";
import type { IdentitySession } from "./identity-contracts";

type PageQuery = { after?: string; limit?: number };
type Principal = Pick<IdentitySession, "accountId">;

/** Existing scoped repository owner implements this application-facing port. */
export interface AuthorizationTransaction extends AuthorizationContextReader {
  getAccount(): Promise<Account>;
  getWorkspace(): Promise<Workspace>;
  getMembership(accountId?: string): Promise<Membership | undefined>;
  listMemberships(query?: PageQuery): Promise<Membership[]>;
  listConsents(): Promise<Consent[]>;
  setMembership(input: {
    accountId: string;
    role: Membership["role"];
    status: Membership["status"];
    expectedRevision: bigint;
  }): Promise<Membership>;
  recordConsent(input: {
    purpose: string;
    policyVersion: string;
    granted: boolean;
    expectedRevision: bigint;
  }): Promise<Consent>;
}
export interface AuthorizationRepositories extends AuthorizedRepositories<AuthorizationTransaction> {
  /** Rechecks the active account and memberships under its own account scope. */
  listWorkspaces(accountId: string, query?: PageQuery): Promise<Workspace[]>;
}

/** Shared transaction owner for the demonstrated account and durable-job services. */
export interface AuthorizedRepositories<R extends AuthorizationContextReader> {
  transaction<T>(
    scope: RepositoryScope,
    work: (repository: R) => Promise<T>,
  ): Promise<T>;
}

export class AuthorizationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

const identifier = z.string().uuid();
const forbidden = () =>
  new AuthorizationError(403, "FORBIDDEN", "The workspace is unavailable.");
function revision<T extends { revision: bigint }>(row: T) {
  return { ...row, revision: row.revision.toString() };
}
export function authorizationRepositoryFailure(error: unknown): never {
  if (error instanceof RepositoryError) {
    if (error.code === "FORBIDDEN") throw forbidden();
    if (error.code === "INVALID_INPUT")
      throw new AuthorizationError(
        400,
        "INVALID_REQUEST",
        "The request is invalid.",
      );
    if (error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT")
      throw new AuthorizationError(
        409,
        error.code,
        "The record is unavailable or has changed.",
      );
    if (error.code === "RATE_LIMITED")
      throw new AuthorizationError(
        429,
        "RATE_LIMITED",
        "The request allowance has been reached. Try again later.",
      );
    if (
      error.code === "INSUFFICIENT_CREDITS" ||
      error.code === "QUOTA_EXCEEDED"
    )
      throw new AuthorizationError(
        429,
        "QUOTA_EXCEEDED",
        "The cloud allowance has been reached.",
      );
    if (error.code === "INFERENCE_DISABLED")
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Cloud inference is disabled.",
      );
  }
  throw error;
}

export async function withAuthorization<
  R extends AuthorizationContextReader,
  T,
>(
  repositories: AuthorizedRepositories<R>,
  principal: Principal,
  workspaceId: string,
  action: AuthorizationAction,
  work: (repository: R, authorization: AuthorizationContext) => Promise<T>,
  context: ServiceRequestContext,
  options?: AuthorizationOptions,
) {
  const scope = Object.freeze({
    accountId: identifier.parse(principal.accountId),
    workspaceId: identifier.parse(workspaceId),
  });
  context.signal.throwIfAborted();
  try {
    return await repositories.transaction(scope, async (repository) => {
      context.signal.throwIfAborted();
      const authorization = await readAuthorizationContext(repository, {
        includeConsents:
          action === "policies.read" ||
          action === "consents.write" ||
          action === "saved-data.write" ||
          action === "saved-data.import" ||
          action === "inference.request" ||
          action === "image.transmit" ||
          action === "analytics.record",
      });
      context.signal.throwIfAborted();
      if (
        authorization.account.id !== scope.accountId ||
        authorization.workspace?.id !== scope.workspaceId ||
        !evaluateAuthorization(authorization, action, options).allowed
      )
        throw forbidden();
      const result = await work(repository, authorization);
      // An observed deadline during SQL work must throw into the same rollback.
      context.signal.throwIfAborted();
      return result;
    });
  } catch (error) {
    return authorizationRepositoryFailure(error);
  }
}

/** Identity supplies the actor; current repository records supply workspace authority. */
export class AuthorizationService {
  constructor(private readonly repositories: AuthorizationRepositories) {}

  private async scoped<T>(
    principal: Principal,
    workspaceId: string,
    action: AuthorizationAction,
    work: (
      repository: AuthorizationTransaction,
      authorization: AuthorizationContext,
    ) => Promise<T>,
    context: ServiceRequestContext,
    options?: AuthorizationOptions,
  ) {
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      action,
      work,
      context,
      options,
    );
  }

  async listWorkspaces(
    principal: Principal,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const accountId = identifier.parse(principal.accountId);
    const query = authorizationPageQuerySchema.parse(rawQuery);
    context.signal.throwIfAborted();
    try {
      const items = (
        await this.repositories.listWorkspaces(accountId, query)
      ).map((row) => workspaceSchema.parse(revision(row)));
      context.signal.throwIfAborted();
      return workspacePageSchema.parse({
        items,
        ...(items.length === query.limit
          ? { nextCursor: items.at(-1)!.id }
          : {}),
      });
    } catch (error) {
      return authorizationRepositoryFailure(error);
    }
  }

  async listMemberships(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const query = authorizationPageQuerySchema.parse(rawQuery);
    return this.scoped(
      principal,
      workspaceId,
      "memberships.read",
      async (repository) => {
        const items = (await repository.listMemberships(query)).map((row) =>
          membershipSchema.parse(revision(row)),
        );
        return membershipPageSchema.parse({
          items,
          ...(items.length === query.limit
            ? { nextCursor: items.at(-1)!.accountId }
            : {}),
        });
      },
      context,
    );
  }

  async updateMembership(
    principal: Principal,
    workspaceId: string,
    accountId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const targetAccountId = identifier.parse(accountId);
    const input = membershipUpdateSchema.parse(raw);
    return this.scoped(
      principal,
      workspaceId,
      "memberships.update",
      async (repository) =>
        membershipSchema.parse(
          revision(
            await repository.setMembership({
              ...input,
              accountId: targetAccountId,
              expectedRevision: BigInt(input.expectedRevision),
            }),
          ),
        ),
      context,
      { targetAccountId },
    );
  }

  async policies(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return this.scoped(
      principal,
      workspaceId,
      "policies.read",
      async (_repository, authorization) =>
        authorizationPolicyCatalog(authorization),
      context,
    );
  }

  async listConsents(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return this.scoped(
      principal,
      workspaceId,
      "consents.read",
      async (repository) =>
        consentPageSchema.parse({
          items: (await repository.listConsents()).map((row) =>
            consentSchema.parse(revision(row)),
          ),
        }),
      context,
    );
  }

  async recordConsent(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = consentUpdateSchema.parse(raw);
    return this.scoped(
      principal,
      workspaceId,
      "consents.write",
      async (repository) =>
        consentSchema.parse(
          revision(
            await repository.recordConsent({
              ...input,
              expectedRevision: BigInt(input.expectedRevision),
            }),
          ),
        ),
      context,
      { consentChange: input },
    );
  }
}
