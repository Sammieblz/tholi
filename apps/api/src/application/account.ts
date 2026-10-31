import {
  accountExportInputSchema,
  accountExportStatusSchema,
  accountDeletionInputSchema,
  accountDeletionResultSchema,
  type AccountExportInput,
  type AccountExportStatus,
  type AccountDeletionInput,
  type AccountDeletionResult,
  accountExportPageSchema,
  accountExportQuerySchema,
  type AccountExportPage,
  type AccountExportQuery,
} from "../../../../packages/navigation-core/contracts-account";
import { z } from "zod";
import type { IdentitySession } from "./identity-contracts";
import type { ServiceRequestContext } from "../capabilities";
import {
  AuthorizationError,
  authorizationRepositoryFailure,
} from "./authorization";
import {
  JobHandlerFailure,
  type JobLease,
  type ExternalJobHandler,
} from "./job-contracts";

export type AccountPrincipal = Pick<
  IdentitySession,
  "accountId" | "workspaceId" | "id"
>;
export interface AccountStore {
  prepareExport(
    principal: AccountPrincipal,
    input: AccountExportInput,
    signal: AbortSignal,
  ): Promise<AccountExportStatus>;
  exportStatus(
    principal: AccountPrincipal,
    generation: string,
    signal: AbortSignal,
  ): Promise<AccountExportStatus>;
  listExports(
    principal: AccountPrincipal,
    query: AccountExportQuery,
    signal: AbortSignal,
  ): Promise<AccountExportPage>;
  requestDeletion(
    principal: AccountPrincipal,
    input: AccountDeletionInput,
    signal: AbortSignal,
  ): Promise<AccountDeletionResult>;
  cleanupDeletion(lease: JobLease, signal: AbortSignal): Promise<void>;
}

/** Identity is supplied by the route; account access never consumes inference credits. */
export class AccountService {
  constructor(
    private readonly store: AccountStore,
    private readonly options: {
      exportsAvailable: boolean;
      deletionAvailable: boolean;
    },
  ) {}
  get exportsAvailable() {
    return this.options.exportsAvailable;
  }
  get deletionAvailable() {
    return this.options.deletionAvailable;
  }
  private actor(principal: AccountPrincipal): AccountPrincipal {
    return Object.freeze({
      id: z.string().uuid().parse(principal.id),
      accountId: z.string().uuid().parse(principal.accountId),
      workspaceId: z.string().uuid().parse(principal.workspaceId),
    });
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
      return authorizationRepositoryFailure(error);
    }
  }
  requestExport(
    principal: AccountPrincipal,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    if (!this.exportsAvailable)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Private account exports are unavailable.",
      );
    const input = accountExportInputSchema.parse(raw);
    return this.operation(context, async () =>
      accountExportStatusSchema.parse(
        await this.store.prepareExport(
          this.actor(principal),
          input,
          context.signal,
        ),
      ),
    );
  }
  getExport(
    principal: AccountPrincipal,
    generation: string,
    context: ServiceRequestContext,
  ) {
    if (!this.exportsAvailable)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Private account exports are unavailable.",
      );
    z.string().uuid().parse(generation);
    return this.operation(context, async () =>
      accountExportStatusSchema.parse(
        await this.store.exportStatus(
          this.actor(principal),
          generation,
          context.signal,
        ),
      ),
    );
  }
  listExports(
    principal: AccountPrincipal,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    if (!this.exportsAvailable)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Private account exports are unavailable.",
      );
    const query = accountExportQuerySchema.parse(raw);
    return this.operation(context, async () =>
      accountExportPageSchema.parse(
        await this.store.listExports(
          this.actor(principal),
          query,
          context.signal,
        ),
      ),
    );
  }
  deleteAccount(
    principal: AccountPrincipal,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    if (!this.deletionAvailable)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Account cleanup is unavailable.",
      );
    const input = accountDeletionInputSchema.parse(raw);
    return this.operation(context, async () =>
      accountDeletionResultSchema.parse(
        await this.store.requestDeletion(
          this.actor(principal),
          input,
          context.signal,
        ),
      ),
    );
  }
}

export const ACCOUNT_DELETION_JOB = Object.freeze({
  kind: "account.delete",
  version: 1,
  replaySafe: true,
});
export function createAccountDeletionHandler(
  store: AccountStore,
): ExternalJobHandler {
  return {
    ...ACCOUNT_DELETION_JOB,
    external: true,
    async execute(lease, signal) {
      if (
        lease.kind !== ACCOUNT_DELETION_JOB.kind ||
        lease.version !== ACCOUNT_DELETION_JOB.version
      )
        throw new JobHandlerFailure("failed", "UNSUPPORTED_JOB");
      signal.throwIfAborted();
      await store.cleanupDeletion(lease, signal);
    },
  };
}
