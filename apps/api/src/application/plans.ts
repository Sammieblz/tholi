import {
  enrollFreeInputSchema,
  freeEnrollmentSchema,
  productCatalogSchema,
  productCatalogV2Schema,
  productEntitlementsSchema,
  type EffectiveProductPlan,
  type FreeEnrollment,
  type ProductCatalog,
  type ProductCatalogV2,
} from "../../../../packages/navigation-core/contracts-plans";
import type { ServiceRequestContext } from "../capabilities";
import type { Entitlement } from "../database/contracts";
import {
  AuthorizationError,
  authorizationRepositoryFailure,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";
import type { AuthorizationContextReader } from "./authorization-policy";
import type { IdentitySession } from "./identity-contracts";

type Principal = Pick<IdentitySession, "accountId">;

export interface PlanTransaction extends AuthorizationContextReader {
  listEntitlements(query?: {
    after?: string;
    limit?: number;
  }): Promise<Entitlement[]>;
  readEffectivePlan(): Promise<EffectiveProductPlan | null>;
  /** The repository derives eligibility, period and grant from trusted records. */
  enrollFree(): Promise<FreeEnrollment>;
}

export interface PlanRepositories extends AuthorizedRepositories<PlanTransaction> {
  readPlanCatalog(
    schemaVersion?: 1 | 2,
  ): Promise<ProductCatalog | ProductCatalogV2>;
}

/** Existing worker maintenance may refill only server-selected active Free periods. */
export interface FreePlanRefills {
  refillFreePlans(input: { limit: number }): Promise<number>;
}

/** Catalog availability is deployment policy; a client plan intent grants nothing. */
export class PlanService {
  constructor(
    private readonly repositories: PlanRepositories,
    private readonly environment: "development" | "production" = "production",
    private readonly fakeBillingEnabled = false,
  ) {}

  catalog(context: ServiceRequestContext): Promise<ProductCatalog>;
  catalog(
    context: ServiceRequestContext,
    schemaVersion: 1,
  ): Promise<ProductCatalog>;
  catalog(
    context: ServiceRequestContext,
    schemaVersion: 2,
  ): Promise<ProductCatalogV2>;
  catalog(
    context: ServiceRequestContext,
    schemaVersion: 1 | 2,
  ): Promise<ProductCatalog | ProductCatalogV2>;
  async catalog(context: ServiceRequestContext, schemaVersion: 1 | 2 = 1) {
    context.signal.throwIfAborted();
    if (schemaVersion !== 1 && schemaVersion !== 2)
      throw new AuthorizationError(
        400,
        "INVALID_REQUEST",
        "The catalog view is unsupported.",
      );
    try {
      const schema =
        schemaVersion === 1 ? productCatalogSchema : productCatalogV2Schema;
      const catalog = schema.parse(
        await this.repositories.readPlanCatalog(schemaVersion),
      );
      context.signal.throwIfAborted();
      return schema.parse({
        ...catalog,
        environment: this.environment,
        plans: catalog.plans.map((plan) =>
          (this.environment === "production" && plan.mode !== "local") ||
          (schemaVersion === 2 &&
            plan.mode === "paid" &&
            !this.fakeBillingEnabled)
            ? {
                ...plan,
                developmentAllowance: null,
                ...(plan.mode === "paid"
                  ? { pricing: { status: "unpublished", amount: null } }
                  : {}),
                ...("billing" in plan ? { billing: null } : {}),
                availability: {
                  available: false,
                  reason:
                    plan.mode === "free-cloud"
                      ? "quality-gate-pending"
                      : "billing-not-enabled",
                },
              }
            : plan,
        ),
      });
    } catch (error) {
      return authorizationRepositoryFailure(error);
    }
  }

  async entitlements(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    const catalog = await this.catalog(context);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "policies.read",
      async (repository) => {
        const items = await repository.listEntitlements({ limit: 100 });
        const effective = await repository.readEffectivePlan();
        return productEntitlementsSchema.parse({
          catalogVersion: catalog.catalogVersion,
          items: items.map((item) => ({
            id: item.id,
            planId: item.planId,
            planVersion: item.planVersion,
            status: item.status,
            startsAt: item.startsAt.toISOString(),
            endsAt: item.endsAt?.toISOString() ?? null,
            revision: item.revision.toString(),
          })),
          effective:
            this.environment === "production" && effective
              ? { ...effective, status: "inactive", caps: null }
              : effective,
        });
      },
      context,
    );
  }

  enrollFree(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    enrollFreeInputSchema.parse(raw);
    if (this.environment !== "development")
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Cloud enrollment is not available in this deployment.",
      );
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "policies.read",
      async (repository, authorization) => {
        if (
          authorization.workspace?.kind !== "personal" ||
          authorization.workspace.ownerAccountId !== principal.accountId ||
          authorization.membership?.role !== "owner"
        )
          throw new AuthorizationError(
            403,
            "FORBIDDEN",
            "Free enrollment requires your personal workspace.",
          );
        return freeEnrollmentSchema.parse(await repository.enrollFree());
      },
      context,
    );
  }
}
