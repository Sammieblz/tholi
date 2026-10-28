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
import type { LocalInference, NavigationRepository } from "../capabilities";

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
