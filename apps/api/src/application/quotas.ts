import { isDeepStrictEqual } from "node:util";
import {
  chargingPolicySchema,
  creditHistoryPageSchema,
  creditPageQuerySchema,
  creditUsagePageSchema,
  creditUsagePageV2Schema,
  creditUsageQuerySchema,
  fakeDevelopmentChargingPolicy,
  workspaceCreditsSchema,
  type ChargingPolicy,
  type CustomerChargingPolicy,
} from "../../../../packages/navigation-core/contracts-credits";
import type { NavigationModel, ServiceRequestContext } from "../capabilities";
import { effectiveProductPlanSchema } from "../../../../packages/navigation-core/contracts-plans";
import type {
  CreditBalance,
  CreditHistoryEntry,
  CustomerInferenceBinding,
  FinishInferenceInput,
  InferencePolicy,
  InferenceReservation,
  InferenceUsage,
  RepositoryPage,
} from "../database/contracts";
import {
  AuthorizationError,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";
import {
  evaluateAuthorization,
  type AuthorizationContextReader,
} from "./authorization-policy";
import type { IdentitySession } from "./identity-contracts";
import {
  ModelError,
  modelUsageSchema,
  modelUsageTotals,
  type ModelUsage,
} from "./model-contracts";
import type {
  NavigationInferenceOperation,
  NavigationInferencePolicy,
} from "./navigation";
import {
  jobResultSchema,
  type JobResult,
} from "../../../../packages/navigation-core/contracts-jobs";
import {
  JobHandlerFailure,
  type ExternalJobHandler,
  type JobLease,
} from "./job-contracts";

type PageQuery = { after?: string; limit?: number };
type Principal = Pick<IdentitySession, "accountId">;

/** The existing scoped PostgreSQL owner supplies admission and read capabilities. */
export interface QuotaTransaction extends AuthorizationContextReader {
  creditBalance(): Promise<CreditBalance>;
  listCreditHistory(
    query: PageQuery,
  ): Promise<RepositoryPage<CreditHistoryEntry>>;
  listUsage(
    query: PageQuery,
    view?: 1 | 2,
  ): Promise<RepositoryPage<InferenceUsage>>;
  getInferencePolicy(version?: string): Promise<InferencePolicy | undefined>;
  reserveInference(input: {
    requestId: string;
    journeyId: string;
    policyVersion: string;
    expiresAt: Date;
    binding?: CustomerInferenceBinding;
  }): Promise<InferenceReservation>;
  markInferenceDispatched(input: {
    id: string;
    claimToken: string;
  }): Promise<void>;
}

export interface QuotaRepositories extends AuthorizedRepositories<QuotaTransaction> {
  /** Existing hold authority, not fresh inference consent, fences accounting. */
  finishInference(input: FinishInferenceInput): Promise<InferenceUsage>;
}
type CreditReadTransaction = Pick<
  QuotaTransaction,
  | keyof AuthorizationContextReader
  | "creditBalance"
  | "listCreditHistory"
  | "listUsage"
>;

export interface InferenceReconciliationStore {
  scheduleInferenceReconciliation(input: {
    limit: number;
    intervalMs: number;
  }): Promise<number>;
  /** The database fences the real lease, metadata effect and job acknowledgement together. */
  reconcileInference(lease: JobLease): Promise<JobResult>;
}
export const INFERENCE_RECONCILIATION_JOB_KIND = Object.freeze({
  kind: "inference.reconcile",
  version: 1,
  replaySafe: true,
});

export function createInferenceReconciliationHandler(
  store: InferenceReconciliationStore,
): ExternalJobHandler {
  return Object.freeze({
    ...INFERENCE_RECONCILIATION_JOB_KIND,
    external: true,
    schedule: (input: { limit: number; intervalMs: number }) =>
      store.scheduleInferenceReconciliation(input),
    async execute(lease: JobLease, signal: AbortSignal) {
      signal.throwIfAborted();
      if (
        lease.kind !== INFERENCE_RECONCILIATION_JOB_KIND.kind ||
        lease.version !== INFERENCE_RECONCILIATION_JOB_KIND.version
      )
        throw new JobHandlerFailure("failed", "UNSUPPORTED_JOB");
      // Accounting maintenance has no model port and grants no new processing.
      // Its fenced owner can retain uncertainty after the account is revoked.
      jobResultSchema.parse(await store.reconcileInference(lease));
    },
  });
}

function publishedPolicy(raw: ChargingPolicy): ChargingPolicy {
  const parsed = chargingPolicySchema.parse(raw);
  if (
    !("fundingSource" in parsed) &&
    !isDeepStrictEqual(parsed, fakeDevelopmentChargingPolicy)
  )
    throw new ModelError("CONFIGURATION");
  return Object.freeze(parsed);
}

function matchesPolicy(stored: InferencePolicy, policy: ChargingPolicy) {
  return (
    stored.version === policy.version &&
    stored.provider === policy.provider &&
    stored.model === policy.model &&
    stored.priceRevision === policy.version &&
    stored.maxCredits === BigInt(policy.maxCredits) &&
    stored.maxProviderUsdMicros === BigInt(policy.maxProviderCostUsdMicros) &&
    stored.maxInputUnits === policy.maxInputTokens &&
    stored.maxOutputUnits === policy.maxOutputTokens &&
    stored.maxImages === policy.maxImages &&
    stored.maxRetries === policy.maxRetries &&
    stored.maxJourneyRequests === policy.maxDecisionsPerJourney &&
    ("fundingSource" in policy
      ? stored.fundingSource === "customer" &&
        stored.catalogRevision === policy.catalogRevision &&
        stored.routingPolicyVersion === policy.routingPolicyVersion &&
        stored.periodSeconds === policy.periodSeconds &&
        stored.accountRequests === policy.requestsPerPeriod &&
        stored.workspaceRequests === policy.requestsPerPeriod &&
        stored.requestsPerMinute === policy.requestsPerMinute &&
        stored.accountProviderUsdMicros === 0n &&
        stored.workspaceProviderUsdMicros === 0n &&
        stored.journeyProviderUsdMicros === 0n
      : stored.fundingSource !== "customer")
  );
}

function checkedUsage(raw: unknown, policy: ChargingPolicy) {
  const parsed = modelUsageSchema.safeParse(raw);
  return parsed.success &&
    parsed.data.provider === policy.provider &&
    parsed.data.source === ("fundingSource" in policy ? "measured" : "fake") &&
    (!("fundingSource" in policy) || "version" in parsed.data) &&
    parsed.data.model === policy.model
    ? parsed.data
    : undefined;
}

export interface CustomerInferenceContext {
  binding: CustomerInferenceBinding;
  revalidateConnection(): Promise<void>;
}

function matchesCustomerBinding(
  policy: CustomerChargingPolicy,
  binding: CustomerInferenceBinding,
) {
  return (
    policy.provider === binding.provider &&
    policy.model === binding.model &&
    policy.catalogRevision === binding.catalogRevision &&
    policy.routingPolicyVersion === binding.routingPolicyVersion
  );
}

/** One model invocation uses the shared transport's prepare/finish orchestration. */
export function createNavigationQuotaPolicy(
  repositories: QuotaRepositories,
  model: NavigationModel,
  rawPolicy: ChargingPolicy = fakeDevelopmentChargingPolicy,
  environment: "development" | "production" = "production",
  customer?: CustomerInferenceContext,
): NavigationInferencePolicy {
  const policy = publishedPolicy(rawPolicy);
  const customerPolicy = "fundingSource" in policy ? policy : undefined;
  if (
    !!customerPolicy !== !!customer ||
    (customerPolicy &&
      !matchesCustomerBinding(customerPolicy, customer!.binding))
  )
    throw new ModelError("CONFIGURATION");
  const binding = customer ? structuredClone(customer.binding) : undefined;
  return {
    async prepare(input, scope) {
      if (
        input.profile !== (customer ? "customer-funded" : "fake") ||
        input.evaluation
      )
        throw new ModelError("CONFIGURATION");
      if (binding && input.profile === "customer-funded") {
        const { retrievalSnapshotDigest, ...connection } = binding;
        if (
          !isDeepStrictEqual(input.connection, connection) ||
          (input.retrieval &&
            input.retrieval.snapshotDigest !== retrievalSnapshotDigest)
        )
          throw new ModelError("CONFIGURATION");
      }
      await scope.revalidate();
      await customer?.revalidateConnection();
      const reservation = await withAuthorization(
        repositories,
        scope.principal,
        scope.workspaceId,
        "inference.request",
        async (repository, authorization) => {
          if (
            input.observation.images.length > 0 &&
            !evaluateAuthorization(authorization, "image.transmit").allowed
          )
            throw new AuthorizationError(
              403,
              "FORBIDDEN",
              "Image transmission consent is required.",
            );
          const stored = await repository.getInferencePolicy(policy.version);
          if (!stored || !matchesPolicy(stored, policy))
            throw new ModelError("CONFIGURATION");
          const held = await repository.reserveInference({
            requestId: input.requestId,
            journeyId: input.observation.stamp.journeyId,
            policyVersion: policy.version,
            expiresAt: new Date(scope.context.deadlineAt),
            ...(binding ? { binding } : {}),
          });
          if (
            !matchesPolicy(held.policy, policy) ||
            held.requestId !== input.requestId ||
            held.maxCredits !== BigInt(policy.maxCredits) ||
            held.expiresAt.getTime() !== scope.context.deadlineAt ||
            (binding &&
              (!isDeepStrictEqual(held.binding, binding) ||
                held.creditReservationId !== null))
          )
            throw new ModelError("CONFIGURATION");
          if (!customer && held.effectivePlan !== null) {
            if (environment !== "development")
              throw new AuthorizationError(
                503,
                "UNAVAILABLE",
                "Product cloud processing is unavailable in this deployment.",
              );
            const effective = effectiveProductPlanSchema.parse(
              held.effectivePlan,
            );
            if (effective.status !== "active")
              throw new AuthorizationError(
                429,
                "QUOTA_EXCEEDED",
                "The cloud allowance is inactive.",
              );
          }
          return structuredClone(held);
        },
        scope.context,
      );
      const capability = Object.freeze({
        id: reservation.id,
        claimToken: reservation.claimToken,
      });
      let attempted = false,
        invoked = false,
        invalidUsage = false;
      let reportedUsage: ModelUsage | undefined;
      let inferenceError: ModelError | undefined;
      let completed: Promise<void> | undefined;
      const effectivePlan = customer ? null : reservation.effectivePlan;
      const operation: NavigationInferenceOperation = {
        budget: {
          maxInputTokens: Math.min(
            policy.maxInputTokens,
            effectivePlan?.caps?.maxInputTokens ?? policy.maxInputTokens,
          ),
          maxOutputTokens: Math.min(
            policy.maxOutputTokens,
            effectivePlan?.caps?.maxOutputTokens ?? policy.maxOutputTokens,
          ),
          maxImages: Math.min(
            policy.maxImages,
            effectivePlan?.caps?.maxImages ?? policy.maxImages,
          ),
        },
        model: {
          async infer(request, context) {
            if (attempted) throw new ModelError("CONFIGURATION");
            attempted = true;
            context.signal.throwIfAborted();
            await scope.revalidate();
            await customer?.revalidateConnection();
            await withAuthorization(
              repositories,
              scope.principal,
              scope.workspaceId,
              "inference.request",
              (repository) => repository.markInferenceDispatched(capability),
              context,
            );
            await scope.revalidate();
            await customer?.revalidateConnection();
            context.signal.throwIfAborted();
            invoked = true;
            try {
              const result = await model.infer(request, context);
              reportedUsage = checkedUsage(result.usage, policy);
              if (!reportedUsage) {
                invalidUsage = true;
                throw new ModelError("INVALID_USAGE", { outcome: "unknown" });
              }
              if (customer) {
                await scope.revalidate();
                await withAuthorization(
                  repositories,
                  scope.principal,
                  scope.workspaceId,
                  "inference.request",
                  async (_repository, authorization) => {
                    if (
                      input.observation.images.length > 0 &&
                      !evaluateAuthorization(authorization, "image.transmit")
                        .allowed
                    )
                      throw new AuthorizationError(
                        403,
                        "FORBIDDEN",
                        "Image transmission consent is required.",
                      );
                  },
                  context,
                );
                await customer.revalidateConnection();
              }
              return result;
            } catch (error) {
              if (error instanceof ModelError) inferenceError = error;
              if (error instanceof ModelError && error.usage) {
                reportedUsage = checkedUsage(error.usage, policy);
                invalidUsage ||= !reportedUsage;
              }
              throw error;
            }
          },
        },
        finish(result) {
          // The transport may have stopped waiting. One independent durable
          // finalization still runs; a failure never becomes an automatic refund.
          completed ??= (async () => {
            const suppliedUsage =
              result.usage === undefined
                ? undefined
                : checkedUsage(result.usage, policy);
            invalidUsage ||= result.usage !== undefined && !suppliedUsage;
            const usage = suppliedUsage ?? reportedUsage;
            const error = result.error;
            const knownNotSent =
              !invoked ||
              (error instanceof ModelError && error.outcome === "not-sent") ||
              inferenceError?.outcome === "not-sent";
            const resolution = invalidUsage
              ? "unknown"
              : usage
                ? "reported"
                : knownNotSent
                  ? "not-sent"
                  : "unknown";
            const accepted =
              resolution === "reported" && !!result.decision && !error;
            const outcome =
              resolution === "unknown"
                ? "uncertain"
                : accepted
                  ? "completed"
                  : error instanceof ModelError &&
                      ["CANCELLED", "DEADLINE_EXCEEDED"].includes(error.code)
                    ? "cancelled"
                    : "failed";
            try {
              await repositories.finishInference({
                ...capability,
                resolution,
                outcome,
                ...(resolution !== "unknown"
                  ? {
                      inputUnits: BigInt(
                        usage ? modelUsageTotals(usage).inputTokens : 0,
                      ),
                      outputUnits: BigInt(
                        usage ? modelUsageTotals(usage).outputTokens : 0,
                      ),
                      providerUsdMicros: 0n,
                      chargedCredits:
                        !customer && accepted ? reservation.maxCredits : 0n,
                    }
                  : {}),
                ...(usage && "version" in usage
                  ? {
                      usageVersion: 2 as const,
                      cacheReadInputUnits:
                        usage.cacheReadInputTokens === null
                          ? null
                          : BigInt(usage.cacheReadInputTokens),
                      cacheWriteInputUnits:
                        usage.cacheWriteInputTokens === null
                          ? null
                          : BigInt(usage.cacheWriteInputTokens),
                      reasoningOutputUnits:
                        usage.reasoningOutputTokens === null
                          ? null
                          : BigInt(usage.reasoningOutputTokens),
                    }
                  : {}),
                ...(customer
                  ? {
                      usageVersion: 2 as const,
                      providerUsdMicros: 0n,
                      chargedCredits: 0n,
                      customerUsdMicros: resolution === "not-sent" ? 0n : null,
                    }
                  : {}),
              });
            } catch {
              throw new ModelError("UNAVAILABLE", { outcome: "unknown" });
            }
            if (resolution === "unknown")
              throw new ModelError("INVALID_USAGE", { outcome: "unknown" });
          })();
          return completed;
        },
      };
      return operation;
    },
  };
}

/** Credit exhaustion and inference consent never gate authorized account reads. */
export class CreditService {
  private readonly policy: ChargingPolicy;
  constructor(
    private readonly repositories: AuthorizedRepositories<CreditReadTransaction>,
    policy: ChargingPolicy = fakeDevelopmentChargingPolicy,
  ) {
    this.policy = publishedPolicy(policy);
  }

  balance(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "credits.read",
      async (repository) => {
        const balance = await repository.creditBalance();
        return workspaceCreditsSchema.parse({
          balance: {
            granted: balance.granted.toString(),
            spent: balance.spent.toString(),
            reserved: balance.reserved.toString(),
            available: balance.available.toString(),
            expired: balance.expired.toString(),
            refunded: balance.refunded.toString(),
          },
          policy: this.policy,
        });
      },
      context,
    );
  }

  history(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const query = creditPageQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "credits.read",
      async (repository) => {
        const page = await repository.listCreditHistory(query);
        return creditHistoryPageSchema.parse({
          items: page.items.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            amount: entry.amount.toString(),
            createdAt: entry.createdAt.toISOString(),
            source: entry.source,
            periodStart: entry.periodStart?.toISOString() ?? null,
            periodEnd: entry.periodEnd?.toISOString() ?? null,
            expiresAt: entry.expiresAt?.toISOString() ?? null,
            policyVersion: entry.policyVersion,
          })),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        });
      },
      context,
    );
  }

  usage(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const { schemaVersion = 1, ...query } =
      creditUsageQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "usage.read",
      async (repository) => {
        const page =
          schemaVersion === 2
            ? await repository.listUsage(query, 2)
            : await repository.listUsage(query);
        const schema =
          schemaVersion === 2 ? creditUsagePageV2Schema : creditUsagePageSchema;
        return schema.parse({
          ...(schemaVersion === 2 ? { schemaVersion: 2 } : {}),
          items: page.items.map((entry) => ({
            id: entry.id,
            requestId: entry.requestId,
            provider: entry.provider,
            model: entry.model,
            inputUnits: entry.inputUnits?.toString() ?? null,
            outputUnits: entry.outputUnits?.toString() ?? null,
            providerUsdMicros: entry.providerUsdMicros?.toString() ?? null,
            chargedCredits: entry.chargedCredits?.toString() ?? null,
            policyVersion: entry.policyVersion,
            createdAt: entry.createdAt.toISOString(),
            ...(schemaVersion === 2
              ? {
                  fundingSource: entry.fundingSource ?? "managed",
                  usageVersion: entry.usageVersion ?? 1,
                  customerUsdMicros:
                    entry.customerUsdMicros?.toString() ?? null,
                  cacheReadInputUnits:
                    entry.cacheReadInputUnits?.toString() ?? null,
                  cacheWriteInputUnits:
                    entry.cacheWriteInputUnits?.toString() ?? null,
                  reasoningOutputUnits:
                    entry.reasoningOutputUnits?.toString() ?? null,
                }
              : {}),
          })),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          verification: {
            independentOutcomesAvailable: false,
            costPerVerifiedSuccessUsdMicros: null,
          },
        });
      },
      context,
    );
  }
}
