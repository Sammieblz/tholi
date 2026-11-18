import {
  billingSubscriptionSchema,
  billingInvoicesSchema,
  type BillingSubscription,
  type BillingInvoices,
} from "../../../../packages/navigation-core/contracts-billing";
import type { ServiceRequestContext } from "../capabilities";
import type { IdentitySession } from "./identity-contracts";
import type { AuthorizationContextReader } from "./authorization-policy";
import {
  AuthorizationError,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";

export interface BillingReader {
  subscription(): Promise<BillingSubscription>;
  invoices(): Promise<BillingInvoices>;
}
export interface BillingTransaction extends AuthorizationContextReader {
  withBilling<T>(work: (billing: BillingReader) => Promise<T>): Promise<T>;
}

/** Financial reads remain available without inference consent or a paid allowance. */
export class BillingService {
  constructor(
    private readonly repositories: AuthorizedRepositories<BillingTransaction>,
  ) {}

  private read<T>(
    principal: Pick<IdentitySession, "accountId">,
    workspaceId: string,
    context: ServiceRequestContext,
    work: (billing: BillingReader) => Promise<T>,
  ) {
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "policies.read",
      async (transaction, authorization) => {
        if (
          authorization.workspace?.ownerAccountId !== principal.accountId ||
          authorization.membership?.role !== "owner"
        )
          throw new AuthorizationError(
            403,
            "FORBIDDEN",
            "Billing records require the workspace owner.",
          );
        return transaction.withBilling(work);
      },
      context,
    );
  }

  subscription(
    principal: Pick<IdentitySession, "accountId">,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return this.read(principal, workspaceId, context, async (billing) =>
      billingSubscriptionSchema.parse(await billing.subscription()),
    );
  }
  invoices(
    principal: Pick<IdentitySession, "accountId">,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return this.read(principal, workspaceId, context, async (billing) =>
      billingInvoicesSchema.parse(await billing.invoices()),
    );
  }
}
