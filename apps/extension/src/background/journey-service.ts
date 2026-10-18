import { api, type Runtime } from "../platform/api";
import type { SuspendedJourney } from "../../../../packages/navigation-core/continuity";
import type { SavedTask } from "../../../../packages/page-model/index";
import type { PinnedSession } from "../../../../packages/route-registry/session";
import {
  sameDestination,
  suspendJourney,
} from "../../../../packages/navigation-core/continuity";
import {
  planInputSchema,
  requestSchema,
  resultSchema,
  type PlanInput,
} from "../../../../packages/navigation-core/contracts";
import { interpretRequest } from "../../../../packages/nlp/interpret";
import { type SiteMemory } from "../../../../packages/page-model/index";
import { sanitizeGoal } from "../../../../packages/privacy-redaction/index";
import { messageSchema } from "../../../../packages/route-schema/index";
import { needsVision } from "../../../../packages/vision/fusion";
import { localNlp } from "../inference/client";
import { backendNlp } from "../platform/backend-client";
import { trustedUi } from "./ui-transport";

interface Context {
  goalGeneration: number;
  session: PinnedSession | undefined;
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
  live: () => boolean;
  inScope: (url: string) => boolean;
  knownSites: Map<string, SiteMemory | undefined>;
  knownTasks: Map<string, SavedTask[]>;
  attemptVision: (sessionId: string, requestId: string) => Promise<void>;
  suspended: SuspendedJourney[];
  acceptView: (raw: unknown) => Promise<void>;
  remember: (observed?: unknown) => Promise<void>;
  save: () => Promise<void>;
}

export function createJourneyService(context: Context) {
  async function handleNlp(raw: any, sender: Runtime.MessageSender) {
    const startedGeneration = context.goalGeneration;
    if (sender.id !== api.runtime.id) throw new Error("Invalid sender.");
    const fromContent = raw.type === "NLP_REPLAN";
    if (!fromContent && !trustedUi(sender, context.session))
      throw new Error("Trusted extension panel required.");
    if (!fromContent && !messageSchema.safeParse(raw).success)
      throw new Error("Invalid request.");
    const captured = await context.enqueue(async () => {
      if (
        !context.session ||
        !context.live() ||
        context.session.navigationPending ||
        context.session.view?.status !== "running"
      )
        throw new Error("Start or resume navigation first.");
      if (
        fromContent &&
        (sender.tab?.id !== context.session.tabId ||
          sender.documentId !== context.session.documentId ||
          raw.sessionId !== context.session.sessionId ||
          !context.inScope(sender.url || ""))
      )
        throw new Error("Stale document.");
      let reply = await api.tabs.sendMessage(context.session.tabId, {
        type: "GET_PAGE",
        sessionId: context.session.sessionId,
      });
      if (!reply.page) throw new Error("Fresh page observation required.");
      if (raw.type === "SET_GOAL" && raw.revision !== reply.page.revision)
        throw new Error(
          "The page changed before this request. Use the current scan.",
        );
      if (raw.text || raw.goal || raw.request?.original)
        reply = await api.tabs.sendMessage(context.session.tabId, {
          type: "GET_PAGE",
          sessionId: context.session.sessionId,
          query: sanitizeGoal(raw.text || raw.goal || raw.request.original),
        });
      const request = fromContent
        ? requestSchema.parse(raw.request)
        : raw.type === "CLARIFY"
          ? context.session.view.request
          : undefined;
      return {
        sessionId: context.session.sessionId,
        documentId: context.session.documentId!,
        request,
        page: reply.page,
        origin: context.session.origin!,
        journey: context.session.view.journey,
        tabId: context.session.tabId,
        activeRequest: context.session.view.request,
        target:
          context.session.view.request?.tasks[
            context.session.view.request.active
          ]?.target,
      };
    });
    let input: PlanInput = planInputSchema.parse({
      requestId: captured.request?.id || raw.requestId || crypto.randomUUID(),
      documentId: captured.documentId,
      revision: captured.page.revision,
      text: sanitizeGoal(captured.request?.original || raw.text || raw.goal),
      observation: captured.page,
      strategy: raw.strategy || captured.journey?.strategy || "fastest",
      request: captured.request,
      choice: raw.choice,
      context: {
        target: captured.target,
        verifiedDestination: fromContent ? raw.verifiedDestination : undefined,
      },
      protocolVersion: 2,
      tabId: captured.tabId,
      frameId: 0,
      navigationLedger: context.session?.ledger,
      workflow: captured.journey?.workflow,
      contextRevision: captured.journey?.workflow?.revision || 0,
    });
    if (
      raw.type === "SET_GOAL" &&
      captured.activeRequest &&
      !["completed", "canceled"].includes(captured.activeRequest.status)
    ) {
      const parsed = interpretRequest(input.text, input.context, {
        clauses: true,
      });
      if (sameDestination(parsed, captured.activeRequest)) {
        input.request = captured.activeRequest;
        input.requestId = captured.activeRequest.id;
        input.text = captured.activeRequest.original;
      }
    }
    const site = context.knownSites.get(captured.origin);
    input.journey = captured.journey;
    if (raw.savedRouteId) {
      const saved = (context.knownTasks.get(captured.origin) || []).find(
        (task) => task.id === raw.savedRouteId,
      );
      if (saved) {
        input.savedRoute = saved;
        input.context = { ...input.context, target: saved.objective.purpose };
      }
    }
    if (captured.journey?.savedRouteId)
      input.savedRoute = (
        context.knownTasks.get(captured.journey.origin) || []
      ).find((t) => t.id === captured.journey!.savedRouteId);
    for (let attempt = 0; attempt < 4; attempt++) {
      let value;
      try {
        value = await backendNlp(input, raw.type === "NLP_SUGGEST", site);
      } catch {
        value = undefined;
      }
      if (startedGeneration !== context.goalGeneration)
        throw new Error("Planning was replaced or canceled.");
      value ??= await localNlp(input, site, raw.type === "NLP_SUGGEST");
      const applied = await context.enqueue(async () => {
        if (startedGeneration !== context.goalGeneration)
          throw new Error("This request was replaced or canceled.");
        if (
          fromContent &&
          context.session?.view?.request?.id !== captured.request?.id
        )
          throw new Error("Older request result.");
        if (
          !context.session ||
          context.session.sessionId !== captured.sessionId ||
          context.session.view?.status !== "running" ||
          context.session.navigationPending
        )
          throw new Error("Planning canceled by navigation or Stop.");
        const fresh = await api.tabs.sendMessage(context.session.tabId, {
          type: "GET_PAGE",
          sessionId: context.session.sessionId,
        });
        if (
          fromContent &&
          input.journey &&
          fresh.view?.journey?.requestTaskId === input.journey.requestTaskId &&
          (fresh.view.journey.totalVerified ??
            fresh.view.journey.progress.length) !==
            (input.journey.totalVerified ?? input.journey.progress.length)
        ) {
          input = {
            ...input,
            journey: fresh.view.journey,
            observation: fresh.page,
            revision: fresh.page.revision,
            documentId: context.session.documentId!,
          };
          return undefined;
        }
        if (
          context.session.documentId !== input.documentId ||
          fresh.page.revision !== input.revision ||
          (input.workflow &&
            fresh.view?.journey?.workflow?.revision !== input.contextRevision)
        ) {
          input = {
            ...input,
            documentId: context.session.documentId!,
            observation: fresh.page,
            revision: fresh.page.revision,
            workflow: fresh.view?.journey?.workflow,
            contextRevision: fresh.view?.journey?.workflow?.revision || 0,
          };
          return undefined;
        }
        if (raw.type === "NLP_SUGGEST")
          return {
            requestId: input.requestId,
            documentId: input.documentId,
            revision: input.revision,
            contextRevision: input.contextRevision,
            suggestions: value,
          };
        const result = resultSchema.parse(value);
        if (
          result.documentId !== input.documentId ||
          result.revision !== input.revision ||
          result.requestId !== input.requestId ||
          result.contextRevision !== input.contextRevision
        )
          throw new Error("Stale planning result.");
        if (fromContent) {
          if (needsVision(result.plan, !!result.clarification))
            setTimeout(
              () =>
                void context.attemptVision(
                  captured.sessionId,
                  result.requestId,
                ),
              100,
            );
          return result;
        }
        if (
          raw.type === "SET_GOAL" &&
          context.session.view?.journey &&
          context.session.view.request &&
          result.request?.id !== context.session.view.request.id
        ) {
          const correction =
            !!result.workflow &&
            result.workflow.id === context.session.view.journey.workflow?.id;
          const parked =
            !correction &&
            suspendJourney(
              context.session.view.journey,
              context.session.view.request,
              context.session.origin!,
              context.session.tabId,
            );
          if (parked && !context.suspended.some((e) => e.id === parked.id)) {
            if (context.suspended.length >= 5)
              throw new Error(
                "Five unfinished journeys are saved. Remove one from Resume previous task, then submit this destination again.",
              );
            context.suspended.push(parked);
          }
        }
        const reply = await api.tabs.sendMessage(context.session.tabId, {
          type: "INSTALL_REQUEST",
          sessionId: context.session.sessionId,
          result,
          strategy: raw.strategy,
          savedRouteId: raw.savedRouteId,
        });
        if (reply.error) return undefined;
        await context.acceptView(reply.view);
        await context.remember();
        await context.save();
        if (needsVision(result.plan, !!result.clarification))
          setTimeout(
            () =>
              void context.attemptVision(captured.sessionId, result.requestId),
            100,
          );
        return structuredClone(context.session);
      });
      if (applied) return applied;
    }
    // Retain a first request too, rather than claiming retention while leaving the
    // previous task in the panel after a mutation storm exhausted stale retries.
    const request =
      input.request ||
      interpretRequest(input.text, input.context, { clauses: true });
    request.id = input.requestId;
    await context.enqueue(async () => {
      if (
        startedGeneration !== context.goalGeneration ||
        !context.session ||
        context.session.sessionId !== captured.sessionId ||
        context.session.view?.status !== "running" ||
        context.session.navigationPending
      )
        return;
      const fresh = await api.tabs.sendMessage(context.session.tabId, {
        type: "GET_PAGE",
        sessionId: context.session.sessionId,
      });
      if (!fresh.page) return;
      const reply = await api.tabs.sendMessage(context.session.tabId, {
        type: "INSTALL_REQUEST",
        sessionId: context.session.sessionId,
        result: {
          requestId: request.id,
          documentId: context.session.documentId!,
          revision: fresh.page.revision,
          protocolVersion: 2,
          contextRevision: input.contextRevision || 0,
          status: "pending-indexing",
          request,
          reason:
            "The page is changing. Your request is retained; recalculate on the current page.",
          activity: {
            embedded: 0,
            cacheHits: 0,
            llmCalls: 0,
            modelRevision: "751bff37182d3f1213fa05d7196b954e230abad9",
          },
        },
      });
      if (reply.view) {
        await context.acceptView(reply.view);
        await context.save();
      }
    });
    return {
      status: "pending-indexing",
      error: "The page is changing. Recalculate using the current scan.",
    };
  }
  return { handleNlp };
}
