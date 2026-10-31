import type { z } from "zod";
import { createHash } from "node:crypto";
import type {
  PlanInput,
  observationInputSchema,
} from "../../../../packages/navigation-core/contracts";
import type {
  observationDeltaSchema,
  observationEnvelopeSchema,
} from "../../../../packages/navigation-core/contracts-v2";
import {
  hash,
  type PageSnapshot,
  type ObservedTransition,
} from "../../../../packages/page-model";
import { MODEL_REVISION } from "../../../../packages/nlp/constants";
import type {
  LocalInference,
  NavigationRepository,
  NavigationModel,
  ServiceRequestContext,
} from "../capabilities";
import {
  joinNavigationDecision,
  validateNavigationObservationContext,
  serializedUtf8Bytes,
  type NavigationDecision,
  type NavigationJoinResult,
  type NavigationValidationContext,
  NAVIGATION_TRANSPORT_OPERATION,
  navigationTransportInputSchema,
  navigationTransportResponseSchema,
  navigationRequestStatusSchema,
  navigationCancellationSchema,
} from "../../../../packages/navigation-core/contracts-navigation";
import type { ServiceRequest, RequestStatus } from "../database/contracts";
import type { IdentitySession } from "./identity-contracts";
import {
  AuthorizationError,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";
import {
  evaluateAuthorization,
  type AuthorizationContextReader,
} from "./authorization-policy";
import {
  MODEL_LIMITS,
  awaitModelOperation,
  ModelError,
  modelProposalSchema,
  modelResponseSchema,
  modelUsageSchema,
  resolveModelBudget,
  type ModelBudget,
  type ModelUsage,
} from "./model-contracts";

export type IncrementalObservation =
  | z.infer<typeof observationInputSchema>
  | z.infer<typeof observationEnvelopeSchema>
  | z.infer<typeof observationDeltaSchema>;

export function createNavigationService(
  repository: NavigationRepository,
  inference: LocalInference,
) {
  // Only structural knowledge reaches the repository; delta assembly stays bounded.
  const observations = new Map<string, { page: PageSnapshot; used: number }>();
  return {
    repository,
    async observe(page: PageSnapshot, transition?: ObservedTransition) {
      await repository.observe(page, transition);
      return { ok: true, revision: page.revision };
    },
    async observeIncremental(input: IncrementalObservation) {
      for (const [key, value] of observations)
        if (Date.now() - value.used > 300000) observations.delete(key);
      let page = input.observation;
      if ("upserts" in input) {
        const key = input.documentId + ":" + input.frameId;
        const prior = observations.get(key)?.page;
        if (!page) {
          if (!prior || prior.revision !== input.baseRevision)
            return {
              status: "conflict" as const,
              reason: "Fresh observation required; delta base is stale.",
            };
          const controls = new Map(
            prior.controls.map((control) => [control.id, control]),
          );
          for (const id of input.removed) controls.delete(id);
          for (const control of input.upserts)
            controls.set(control.id, control);
          if (controls.size > 600)
            return {
              status: "conflict" as const,
              reason: "Send a bounded fresh projection.",
            };
          page = {
            ...prior,
            controls: [...controls.values()],
            revision: input.revision,
            coverage: input.coverage,
            partial: true,
          };
          page.fingerprint = hash(
            prior.fingerprint + "|delta|" + JSON.stringify(page.controls),
          );
          page.stateKey = page.pageKey + ":" + page.fingerprint;
        }
        observations.delete(key);
        observations.set(key, { page, used: Date.now() });
      } else if ("reference" in input) {
        const key = input.reference.documentId + ":" + input.reference.frameId;
        observations.delete(key);
        observations.set(key, { page: input.observation, used: Date.now() });
      }
      while (observations.size > 32)
        observations.delete(observations.keys().next().value!);
      if (!page)
        return { status: "invalid" as const, reason: "Observation required." };
      await repository.observe(page);
      return { status: "observed" as const, revision: page.revision };
    },
    async plan(input: PlanInput, version: 1 | 2, signal: AbortSignal) {
      try {
        return await inference.infer("plan", input, signal);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Indexing timed out")
        )
          throw error;
        const request =
          input.request ||
          (await import("../../../../packages/nlp/interpret")).interpretRequest(
            input.text,
            input.context,
            version === 2 ? { clauses: true } : undefined,
          );
        request.id = input.requestId;
        return {
          requestId: input.requestId,
          documentId: input.documentId,
          revision: input.revision,
          ...(version === 2
            ? {
                contextRevision: input.contextRevision,
                protocolVersion: 2,
                workflow: input.workflow,
              }
            : {}),
          status: "pending-indexing",
          request,
          reason:
            "Indexing has not finished. Retry this retained request on the current page.",
          activity: {
            embedded: 0,
            cacheHits: 0,
            llmCalls: 0,
            modelRevision: MODEL_REVISION,
          },
        };
      }
    },
    async suggestions(input: PlanInput, version: 1 | 2, signal: AbortSignal) {
      return {
        requestId: input.requestId,
        documentId: input.documentId,
        revision: input.revision,
        ...(version === 2 ? { contextRevision: input.contextRevision } : {}),
        suggestions: await inference.infer("suggestions", input, signal),
      };
    },
    async forget(origin: string, version: 1 | 2) {
      if (version === 2)
        for (const [key, value] of observations)
          if (value.page.origin === origin) observations.delete(key);
      await inference.infer("reset", {});
      await repository.forget(origin);
      return { ok: true };
    },
    async clear(version: 1 | 2) {
      if (version === 2) observations.clear();
      await inference.infer("reset", {});
      await repository.clear();
      return { ok: true };
    },
  };
}

function modelContextError(
  reason: Extract<NavigationJoinResult, { accepted: false }>["reason"],
  usage?: ModelUsage,
) {
  const code =
    reason === "EXPIRED"
      ? "DEADLINE_EXCEEDED"
      : reason === "STALE_CONTEXT"
        ? "STALE_CONTEXT"
        : reason === "UNKNOWN_REFERENCE" || reason === "INELIGIBLE_REFERENCE"
          ? reason
          : reason === "INVALID_DECISION"
            ? "INVALID_OUTPUT"
            : "INVALID_INPUT";
  return new ModelError(code, {
    outcome: usage ? "reported" : "not-sent",
    usage,
  });
}

/** New proposals never enter the legacy local result or grant browser authority. */
export function createNavigationModelService(model: NavigationModel) {
  return {
    async propose(
      rawObservation: unknown,
      current: () => NavigationValidationContext,
      context: ServiceRequestContext,
      requestedBudget: Partial<ModelBudget> = {},
    ): Promise<{ decision: NavigationDecision; usage: ModelUsage }> {
      if (context.signal.aborted) throw new ModelError("CANCELLED");
      const started = Date.now();
      if (
        !Number.isSafeInteger(context.deadlineAt) ||
        context.deadlineAt <= started
      )
        throw new ModelError("DEADLINE_EXCEEDED");
      const budget = resolveModelBudget(requestedBudget);
      let initial: ReturnType<typeof validateNavigationObservationContext>;
      try {
        initial = validateNavigationObservationContext(
          rawObservation,
          current(),
        );
      } catch {
        throw new ModelError("INVALID_INPUT");
      }
      if (!initial.accepted) throw modelContextError(initial.reason);
      // Zod admitted a private copy; providers receive a second copy so mutation
      // can never rewrite the allowlist against which their proposal is joined.
      const observation = initial.observation;
      if (
        observation.images.length > budget.maxImages ||
        observation.images.some(
          (image) =>
            Buffer.byteLength(image.image, "base64") > budget.maxImageBytes ||
            image.width * image.height > budget.maxImagePixels,
        )
      )
        throw new ModelError("BUDGET_EXCEEDED");
      const deadlineAt = Math.min(
        context.deadlineAt,
        started + MODEL_LIMITS.maxDeadlineMs,
      );
      const timeout = new AbortController();
      const signal = AbortSignal.any([context.signal, timeout.signal]);
      let sent = false;
      const interrupted = () =>
        new ModelError(
          context.signal.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED",
          { outcome: sent ? "unknown" : "not-sent" },
        );
      const timer = setTimeout(
        () => timeout.abort(),
        Math.max(0, deadlineAt - Date.now()),
      );
      try {
        if (signal.aborted || Date.now() >= deadlineAt) throw interrupted();
        const raw = await awaitModelOperation(
          () => {
            if (signal.aborted || Date.now() >= deadlineAt) throw interrupted();
            sent = true;
            return model.infer(
              {
                observation: structuredClone(observation),
                budget: { ...budget },
              },
              { ...context, deadlineAt, signal },
            );
          },
          signal,
          interrupted,
        );
        if (signal.aborted || Date.now() >= deadlineAt) throw interrupted();
        const response = modelResponseSchema.safeParse(raw);
        if (!response.success) {
          const usage = modelUsageSchema.safeParse(raw?.usage);
          throw new ModelError(
            usage.success ? "INVALID_OUTPUT" : "INVALID_USAGE",
            {
              outcome: usage.success ? "reported" : "unknown",
              usage: usage.success ? usage.data : undefined,
            },
          );
        }
        const usage = response.data.usage;
        let responseBytes: number;
        try {
          responseBytes = serializedUtf8Bytes(response.data.proposal);
        } catch {
          throw new ModelError("INVALID_OUTPUT", {
            outcome: "reported",
            usage,
          });
        }
        if (
          usage.promptTokens > budget.maxInputTokens ||
          usage.outputTokens + usage.thoughtTokens > budget.maxOutputTokens ||
          responseBytes > budget.maxResponseBytes
        )
          throw new ModelError("BUDGET_EXCEEDED", {
            outcome: "reported",
            usage,
          });
        const proposal = modelProposalSchema.safeParse(response.data.proposal);
        if (!proposal.success)
          throw new ModelError("INVALID_OUTPUT", {
            outcome: "reported",
            usage,
          });
        const candidate = {
          protocol: observation.protocol,
          version: observation.version,
          stamp: observation.stamp,
          native: observation.native,
          decision: proposal.data,
        };
        const joined = joinNavigationDecision(
          candidate,
          observation,
          current(),
        );
        if (!joined.accepted) throw modelContextError(joined.reason, usage);
        return { decision: joined.decision, usage };
      } catch (error) {
        if (signal.aborted || Date.now() >= deadlineAt) throw interrupted();
        if (error instanceof ModelError) throw error;
        throw new ModelError("PROVIDER_ERROR", {
          outcome: sent ? "unknown" : "not-sent",
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export interface NavigationRequestTransaction extends AuthorizationContextReader {
  beginRequest(input: {
    id?: string;
    operation: string;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<{ request: ServiceRequest; replayed: boolean }>;
  getRequest(id: string): Promise<ServiceRequest | undefined>;
  setRequestStatus(
    id: string,
    status: Exclude<RequestStatus, "pending">,
    expectedStatus?: RequestStatus,
  ): Promise<ServiceRequest>;
}
type NavigationRequestRepositories =
  AuthorizedRepositories<NavigationRequestTransaction>;
type NavigationPrincipal = Pick<IdentitySession, "accountId">;
type RevalidateNavigationIdentity = () => Promise<void>;
const navigationRequestLimit = 32;
const missingNavigationRequest = () =>
  new AuthorizationError(
    404,
    "NOT_FOUND",
    "The navigation request is unavailable.",
  );

/** Scoped request metadata is durable; observations and proposals remain ephemeral. */
export class NavigationTransportService {
  readonly provider = "fake" as const;
  private readonly active = new Map<string, AbortController>();
  private admitting = 0;

  constructor(
    private readonly repositories: NavigationRequestRepositories,
    private readonly model: NavigationModel,
  ) {}

  private key(
    principal: NavigationPrincipal,
    workspaceId: string,
    requestId: string,
  ) {
    return `${principal.accountId}:${workspaceId}:${requestId}`;
  }

  private async owned(
    repository: NavigationRequestTransaction,
    requestId: string,
  ) {
    const row = await repository.getRequest(requestId);
    if (!row || row.operation !== NAVIGATION_TRANSPORT_OPERATION)
      throw missingNavigationRequest();
    return row;
  }

  private revalidateIdentity(
    context: ServiceRequestContext,
    revalidate: RevalidateNavigationIdentity,
  ) {
    return awaitModelOperation(revalidate, context.signal, () =>
      context.signal.reason instanceof ModelError
        ? context.signal.reason
        : new ModelError(
            Date.now() >= context.deadlineAt
              ? "DEADLINE_EXCEEDED"
              : "CANCELLED",
            { outcome: "unknown" },
          ),
    );
  }

  private async scoped<T>(
    principal: NavigationPrincipal,
    workspaceId: string,
    context: ServiceRequestContext,
    work: (repository: NavigationRequestTransaction) => Promise<T>,
    images = false,
    consent = false,
  ) {
    return awaitModelOperation(
      () =>
        withAuthorization(
          this.repositories,
          principal,
          workspaceId,
          consent ? "inference.request" : "usage.read",
          async (repository, authorization) => {
            if (
              images &&
              !evaluateAuthorization(authorization, "image.transmit").allowed
            )
              throw new AuthorizationError(
                403,
                "FORBIDDEN",
                "Image transmission consent is required.",
              );
            return work(repository);
          },
          context,
        ),
      context.signal,
      () =>
        context.signal.reason instanceof ModelError
          ? context.signal.reason
          : new ModelError("CANCELLED", { outcome: "unknown" }),
    );
  }

  async request(
    principal: NavigationPrincipal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
    revalidate: RevalidateNavigationIdentity,
  ) {
    const input = navigationTransportInputSchema.parse(raw);
    const elapsedStart = performance.now(),
      started = Date.now();
    const remaining =
      Math.min(
        input.observation.deadlineAtMs,
        input.validation.requestDeadlineMs,
      ) - input.validation.nowMs;
    const deadlineAt = Math.min(
      context.deadlineAt,
      started + input.policy.timeoutMs,
      started + remaining,
    );
    const controller = new AbortController();
    const timeout = new AbortController();
    const signal = AbortSignal.any([
      context.signal,
      controller.signal,
      timeout.signal,
    ]);
    const operation = { ...context, deadlineAt, signal };
    const interrupted = () =>
      new ModelError(
        timeout.signal.aborted || Date.now() >= deadlineAt
          ? "DEADLINE_EXCEEDED"
          : "CANCELLED",
        { outcome: "unknown" },
      );
    const alive = () => {
      if (signal.aborted) throw interrupted();
      if (Date.now() >= deadlineAt) throw new ModelError("DEADLINE_EXCEEDED");
    };
    const identity = async () => {
      alive();
      await this.revalidateIdentity(operation, revalidate);
      alive();
    };
    const current = () => ({
      ...input.validation,
      nowMs:
        input.validation.nowMs + Math.floor(performance.now() - elapsedStart),
    });
    const initial = validateNavigationObservationContext(
      input.observation,
      current(),
    );
    if (!initial.accepted) throw modelContextError(initial.reason);
    if (this.active.size + this.admitting >= navigationRequestLimit)
      throw new AuthorizationError(
        429,
        "RATE_LIMITED",
        "Navigation request capacity has been reached.",
      );
    // The HTTP owner still controls disconnect and drain. This timer only
    // shortens that budget to the caller's unchanged observation/policy lifetime.
    const timer = setTimeout(
      () =>
        timeout.abort(
          new ModelError("DEADLINE_EXCEEDED", { outcome: "unknown" }),
        ),
      Math.max(0, deadlineAt - Date.now()),
    );
    timer.unref();
    this.admitting++;
    let admitted = true,
      claimed = false;
    const key = this.key(principal, workspaceId, input.requestId);
    try {
      await identity();
      const claim = await this.scoped(
        principal,
        workspaceId,
        operation,
        (repository) =>
          repository.beginRequest({
            id: input.requestId,
            operation: NAVIGATION_TRANSPORT_OPERATION,
            idempotencyKey: input.policy.idempotencyKey ?? input.requestId,
            payloadHash: createHash("sha256")
              .update(
                JSON.stringify({
                  operation: NAVIGATION_TRANSPORT_OPERATION,
                  command: input,
                }),
              )
              .digest("hex"),
          }),
        input.observation.images.length > 0,
        true,
      );
      claimed = !claim.replayed;
      alive();
      if (claim.replayed) {
        const replay = await this.status(
          principal,
          workspaceId,
          claim.request.id,
          operation,
          revalidate,
        );
        return navigationTransportResponseSchema.parse({
          ...replay,
          replayed: true,
        });
      }
      this.active.set(key, controller);
      this.admitting--;
      admitted = false;
      await identity();
      await this.scoped(
        principal,
        workspaceId,
        operation,
        async (repository) => {
          if (
            (await this.owned(repository, input.requestId)).status !== "pending"
          )
            throw new ModelError("CANCELLED", { outcome: "unknown" });
        },
        input.observation.images.length > 0,
        true,
      );
      alive();
      const result = await createNavigationModelService(this.model).propose(
        input.observation,
        current,
        operation,
      );
      await identity();
      await this.scoped(
        principal,
        workspaceId,
        operation,
        async (repository) => {
          const row = await this.owned(repository, input.requestId);
          if (row.status !== "pending")
            throw new ModelError("CANCELLED", {
              outcome: "reported",
              usage: result.usage,
            });
          await repository.setRequestStatus(
            input.requestId,
            "completed",
            "pending",
          );
        },
        input.observation.images.length > 0,
        true,
      );
      alive();
      return navigationTransportResponseSchema.parse({
        requestId: input.requestId,
        status: "completed",
        replayed: false,
        decision: result.decision,
      });
    } catch (error) {
      if (claimed) {
        // Cleanup records no page data and never retries inference. Revocation or
        // database failure may leave pending metadata; that still forbids replay.
        const cleanup = {
          requestId: context.requestId,
          deadlineAt: Date.now() + 1000,
          signal: AbortSignal.timeout(1000),
        };
        const finalization = this.scoped(
          principal,
          workspaceId,
          cleanup,
          async (repository) => {
            const row = await this.owned(repository, input.requestId);
            if (row.status === "pending")
              await repository.setRequestStatus(
                input.requestId,
                "uncertain",
                "pending",
              );
          },
        ).catch(() => {});
        // The caller's deadline/cancellation bounds its response. Metadata
        // cleanup has its own short budget and can settle after that response.
        if (!signal.aborted && Date.now() < deadlineAt)
          await awaitModelOperation(
            () => finalization,
            signal,
            interrupted,
          ).catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (admitted) this.admitting--;
      if (this.active.get(key) === controller) this.active.delete(key);
    }
  }

  async status(
    principal: NavigationPrincipal,
    workspaceId: string,
    requestId: string,
    context: ServiceRequestContext,
    revalidate: RevalidateNavigationIdentity,
  ) {
    requestId = navigationRequestStatusSchema.shape.requestId.parse(requestId);
    await this.revalidateIdentity(context, revalidate);
    const row = await this.scoped(
      principal,
      workspaceId,
      context,
      (repository) => this.owned(repository, requestId),
    );
    return navigationRequestStatusSchema.parse({
      requestId: row.id,
      status: row.status,
    });
  }

  async cancel(
    principal: NavigationPrincipal,
    workspaceId: string,
    requestId: string,
    context: ServiceRequestContext,
    revalidate: RevalidateNavigationIdentity,
  ) {
    requestId = navigationRequestStatusSchema.shape.requestId.parse(requestId);
    await this.revalidateIdentity(context, revalidate);
    const row = await this.scoped(
      principal,
      workspaceId,
      context,
      async (repository) => {
        const existing = await this.owned(repository, requestId);
        return existing.status === "pending"
          ? repository.setRequestStatus(requestId, "uncertain", "pending")
          : existing;
      },
    );
    const requested = row.status === "uncertain";
    if (requested)
      this.active.get(this.key(principal, workspaceId, requestId))?.abort();
    return navigationCancellationSchema.parse({
      requestId: row.id,
      status: row.status,
      cancelRequested: requested,
      cancellationConfirmed: false,
    });
  }
}
