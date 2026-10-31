import type { z } from "zod";
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
} from "../../../../packages/navigation-core/contracts-navigation";
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
