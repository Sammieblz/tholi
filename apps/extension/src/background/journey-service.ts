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
import { backendNavigation, backendNlp } from "../platform/backend-client";
import {
  serviceAuthCommand,
  serviceInferenceSignal,
} from "../platform/service-auth";
import { serviceInferenceStatusSchema } from "../platform/service-auth-contract";
import { ServiceClientError } from "../../../../packages/navigation-core/service-client";
import {
  joinNavigationDecision,
  nativeReferenceKey,
  type NavigationObservation,
  type NavigationStamp,
} from "../../../../packages/navigation-core/contracts-navigation";
import { buildNavigationObservation } from "../../../../packages/goal-planner/model-context";
import {
  SERVICE_LIMITS,
  serviceErrorCodeSchema,
} from "../../../../packages/navigation-core/contracts-service";
import { hostPermissionPattern } from "../platform/site-access";
import { awaitAbortableOperation } from "../../../../packages/navigation-core/abort";
import { observePinnedPage } from "./frame-coordinator";
import type { RegionObservationRequest } from "../../../../packages/page-discovery/perception";
import type {
  createVisionService,
  MaskedNavigationCapture,
} from "./vision-service";
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
  withMaskedNavigation?: ReturnType<
    typeof createVisionService
  >["withMaskedNavigation"];
  suspended: SuspendedJourney[];
  acceptView: (raw: unknown) => Promise<void>;
  remember: (observed?: unknown) => Promise<void>;
  save: () => Promise<void>;
}

export function createJourneyService(context: Context) {
  // A continuation must not change the query projection or install old work
  // while a trusted foreground destination is being planned.
  let foregroundRevision = 0;
  let activeForeground = 0;
  let serviceJob: { key: string; controller: AbortController } | undefined;
  let lastServiceKey = "";
  let requestGeneration = 0;
  const generations = new Map<string, { identity: string; value: number }>();
  const generationFor = (kind: string, identity: string) => {
    const previous = generations.get(kind);
    if (previous?.identity === identity) return previous.value;
    const value = (previous?.value ?? 0) + 1;
    generations.set(kind, { identity, value });
    return value;
  };
  function scheduleService(
    sessionId: string,
    requestId: string,
    goalGeneration: number,
  ) {
    // Let the caller install its local result before observing the retained task.
    // The model wait never enters the local inference or routine journey queue.
    setTimeout(
      () => void enrich(sessionId, requestId, goalGeneration).catch(() => {}),
      0,
    );
  }
  async function enrich(
    sessionId: string,
    requestId: string,
    goalGeneration: number,
  ) {
    const candidate = context.session;
    const view = candidate?.view;
    const task = view?.request?.tasks[view.request.active];
    if (
      !candidate ||
      candidate.sessionId !== sessionId ||
      !candidate.documentId ||
      context.goalGeneration !== goalGeneration ||
      view?.request?.id !== requestId ||
      view.request.status !== "active" ||
      !task ||
      !view.journey ||
      view.status !== "running" ||
      candidate.navigationPending ||
      !context.live()
    )
      return;
    const key = [
      sessionId,
      candidate.documentId,
      requestId,
      task.id,
      view.journey.id,
      goalGeneration,
      view.page?.revision,
      view.verifiedSteps,
      view.journey.workflow?.revision ?? 0,
    ].join(":");
    if (key === lastServiceKey) return;
    const selected = serviceInferenceStatusSchema.safeParse(
      await serviceAuthCommand({ type: "AUTH_INFERENCE_STATUS" }),
    );
    if (!selected.success || !selected.data.enabled) return;
    if (
      context.session !== candidate ||
      context.goalGeneration !== goalGeneration ||
      candidate.view?.request?.id !== requestId ||
      candidate.view.request.status !== "active" ||
      candidate.view.request.tasks[candidate.view.request.active]?.id !==
        task.id ||
      candidate.view.journey?.id !== view.journey.id ||
      candidate.view.verifiedSteps !== view.verifiedSteps ||
      key === lastServiceKey
    )
      return;
    lastServiceKey = key;
    serviceJob?.controller.abort();
    const job = { key, controller: new AbortController() };
    serviceJob = job;
    const startedAt = Date.now(),
      deadlineAt = startedAt + SERVICE_LIMITS.maxDeadlineMs;
    const signal = AbortSignal.any([
      job.controller.signal,
      serviceInferenceSignal(),
      AbortSignal.timeout(SERVICE_LIMITS.maxDeadlineMs),
    ]);
    const journeyId = view.journey.id,
      documentId = candidate.documentId;
    const contextRevision = view.journey.workflow?.revision ?? 0;
    const progress = view.journey.totalVerified ?? view.journey.progress.length;
    const verifiedSteps = view.verifiedSteps,
      journeyStatus = view.journey.status;
    const sameTaskOwner = () =>
      serviceJob === job &&
      context.session === candidate &&
      candidate.documentId === documentId &&
      context.goalGeneration === goalGeneration &&
      !candidate.navigationPending &&
      candidate.view?.status === "running" &&
      candidate.view.request?.id === requestId &&
      ["active", "clarification"].includes(candidate.view.request.status) &&
      candidate.view.request.tasks[candidate.view.request.active]?.id ===
        task.id &&
      candidate.view.journey?.id === journeyId &&
      candidate.view.journey.status === journeyStatus &&
      candidate.view.verifiedSteps === verifiedSteps &&
      (candidate.view.journey.workflow?.revision ?? 0) === contextRevision &&
      (candidate.view.journey.totalVerified ??
        candidate.view.journey.progress.length) === progress;
    const ownerCurrent = () => !signal.aborted && sameTaskOwner();
    const ensureOwner = () => {
      if (!ownerCurrent()) throw new Error("The inference task changed.");
    };
    const state = async (
      value: "pending" | "guiding" | "clarify" | "unsupported" | "error",
      message?: string,
      code?: string,
    ) => {
      if (!ownerCurrent()) return;
      const knownCode = serviceErrorCodeSchema.safeParse(code);
      candidate.view!.serviceNavigation = {
        profile: "fake",
        requestId,
        state: value,
        ...(message ? { message } : {}),
        ...(knownCode.success ? { code: knownCode.data } : {}),
      };
      await context.save();
    };
    const interrupted = () =>
      new ServiceClientError(
        Date.now() >= deadlineAt ? "DEADLINE_EXCEEDED" : "CANCELLED",
        0,
        "The service proposal was cancelled or expired.",
      );
    const queued = <T>(operation: () => Promise<T>) =>
      awaitAbortableOperation(
        () =>
          context.enqueue(() =>
            awaitAbortableOperation(operation, signal, interrupted),
          ),
        signal,
        interrupted,
      );
    const observe = async (regionObservation?: RegionObservationRequest) =>
      queued(async () => {
        ensureOwner();
        const tab = await api.tabs.get(candidate.tabId);
        ensureOwner();
        if (
          !tab ||
          !context.inScope(tab.url || "") ||
          !(await api.permissions.contains({
            origins: [hostPermissionPattern(candidate.origin!)],
          }))
        )
          throw new ServiceClientError(
            "FORBIDDEN",
            0,
            "Website access is required for inference.",
          );
        const observed = await observePinnedPage(candidate, tab, ownerCurrent, {
          signal,
          regionObservation,
          query: candidate.view!.request!.original,
        });
        ensureOwner();
        if (
          !observed.perception ||
          observed.viewportRevision === undefined ||
          observed.view.request?.id !== requestId ||
          observed.view.request.tasks[observed.view.request.active]?.id !==
            task.id ||
          observed.view.journey?.id !== journeyId
        )
          throw new ServiceClientError(
            "UNAVAILABLE",
            0,
            "Fresh native page evidence is required.",
          );
        await context.acceptView(observed.view);
        ensureOwner();
        return {
          ...observed,
          perception: observed.perception,
          viewportRevision: observed.viewportRevision,
        };
      });
    type Observed = Awaited<ReturnType<typeof observe>>;
    let observed: Observed;
    const frameEvidence = (value: Observed) =>
      value.perception.frames.map((frame) => ({
        native: frame.native,
        parentFrameId: frame.parentFrameId,
        pageRevision: frame.pageRevision,
        viewport: frame.viewport,
      }));
    const sameObservation = (a: Observed, b: Observed) =>
      a.page.revision === b.page.revision &&
      a.page.fingerprint === b.page.fingerprint &&
      a.page.stateKey === b.page.stateKey &&
      a.viewportRevision === b.viewportRevision &&
      JSON.stringify(frameEvidence(a)) === JSON.stringify(frameEvidence(b)) &&
      nativeReferenceKey(a.perception.native) ===
        nativeReferenceKey(b.perception.native);
    try {
      ensureOwner();
      await state(
        "pending",
        "Requesting a proposal from the connected development service.",
      );
      observed = await observe();
      if (!candidate.view?.serviceNavigation)
        await state(
          "pending",
          "Requesting a proposal from the connected development service.",
        );
      let visual = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        ensureOwner();
        let needsObservation = false;
        let nextRegion: RegionObservationRequest | undefined;
        const propose = async (
          capture?: MaskedNavigationCapture,
          captureGuard?: () => Promise<void>,
        ) => {
          ensureOwner();
          if (
            capture &&
            (capture.page.revision !== observed.page.revision ||
              nativeReferenceKey(capture.native) !==
                nativeReferenceKey(observed.perception.native))
          )
            throw new Error("The captured page changed.");
          const stamp: NavigationStamp = {
            sessionId,
            journeyId,
            requestId,
            sessionGeneration: generationFor("session", sessionId),
            journeyGeneration: generationFor("journey", journeyId),
            documentGeneration: generationFor(
              "document",
              nativeReferenceKey(observed.perception.native),
            ),
            requestGeneration: ++requestGeneration,
            contextGeneration: generationFor(
              "context",
              [goalGeneration, task.id, contextRevision, progress].join(":"),
            ),
            scanGeneration: observed.page.revision,
            viewportGeneration: observed.viewportRevision,
          };
          const images: NavigationObservation["images"] = capture
            ? [
                {
                  captureId: capture.pixels.captureId,
                  stamp,
                  native: capture.native,
                  capturedAtMs: capture.capturedAtMs,
                  maskedAtMs: capture.pixels.maskedAtMs,
                  source: capture.pixels.source,
                  width: capture.pixels.width,
                  height: capture.pixels.height,
                  image: capture.pixels.image,
                  masking: capture.pixels.masking,
                },
              ]
            : [];
          const built = buildNavigationObservation(
            observed.page,
            candidate.view!.request!.original,
            {
              stamp,
              observedAtMs: Date.now(),
              deadlineAtMs: deadlineAt,
              perception: observed.perception,
              images,
            },
            candidate.view!.journey,
          );
          if (!built.observation)
            throw new ServiceClientError(
              "INVALID_REQUEST",
              0,
              "The current page cannot provide bounded inference evidence.",
            );
          const observation = built.observation;
          const validation = {
            currentStamp: stamp,
            currentNative: observation.native,
            nowMs: Date.now(),
            requestStartedAtMs: startedAt,
            requestDeadlineMs: deadlineAt,
          };
          const current = () => {
            ensureOwner();
            return {
              ...validation,
              nowMs: Date.now(),
              currentStamp: {
                ...stamp,
                scanGeneration: candidate.view?.page?.revision ?? -1,
              },
            };
          };
          const beforeSend = async () => {
            ensureOwner();
            const fresh = await observe();
            if (!sameObservation(observed, fresh))
              throw new Error("The observed page changed before transmission.");
            if (captureGuard) await captureGuard();
            ensureOwner();
          };
          const response = await backendNavigation(
            {
              requestId: crypto.randomUUID(),
              profile: "fake",
              observation,
              validation,
              policy: { timeoutMs: Math.max(1, deadlineAt - Date.now()) },
            },
            current,
            beforeSend,
            capture ? AbortSignal.any([signal, capture.signal]) : signal,
          );
          ensureOwner();
          if (!response.decision)
            throw new ServiceClientError(
              "UNAVAILABLE",
              0,
              "This request has no retained proposal. Start a new request explicitly.",
            );
          const joined = joinNavigationDecision(
            response.decision,
            observation,
            current(),
          );
          if (!joined.accepted)
            throw new Error("The proposal is stale or unsupported.");
          const decision = joined.decision.decision;
          if (decision.kind === "request-observation") {
            if (attempt === 1) {
              await state(
                "unsupported",
                "The service needs more evidence than this request allows.",
              );
              return;
            }
            visual = decision.reason === "visual";
            needsObservation = true;
            if (decision.regionId) {
              const region = observed.perception.regions.find(
                (item) => item.id === decision.regionId,
              );
              const frame =
                region &&
                observed.perception.frames.find(
                  (item) => item.native.frameId === region.frameId,
                );
              if (!region || !frame)
                throw new Error("The requested region is unavailable.");
              nextRegion = {
                native: frame.native,
                scanId: frame.scanId,
                pageRevision: frame.pageRevision,
                regionId: region.id,
              };
            }
            return;
          }
          await queued(async () => {
            ensureOwner();
            const fresh = await observePinnedPage(
              candidate,
              await api.tabs.get(candidate.tabId),
              ownerCurrent,
              { signal },
            );
            if (
              !fresh.perception ||
              fresh.viewportRevision === undefined ||
              !sameObservation(observed, {
                ...fresh,
                perception: fresh.perception,
                viewportRevision: fresh.viewportRevision,
              })
            )
              throw new Error("The proposed target changed before binding.");
            ensureOwner();
            const reply = await api.tabs.sendMessage(
              candidate.tabId,
              {
                type: "APPLY_NAVIGATION_PROPOSAL",
                sessionId,
                profile: "fake",
                binding: {
                  requestId,
                  activeTaskId: task.id,
                  journeyId,
                  pageRevision: observed.page.revision,
                  viewportRevision: observed.viewportRevision,
                  contextRevision,
                  native: observation.native,
                },
                decision,
              },
              { frameId: 0, documentId },
            );
            ensureOwner();
            if (reply?.error || !reply?.view)
              throw new Error(
                "The proposal could not bind to a current control.",
              );
            await context.acceptView(reply.view);
            await state(
              decision.kind === "guide" ? "guiding" : decision.kind,
              decision.kind === "guide"
                ? "The development service proposal is bound to a current website control."
                : decision.kind === "clarify"
                  ? decision.question
                  : decision.reason,
            );
          });
        };
        if (attempt === 0 || !visual) {
          await propose();
        } else {
          if (!selected.data.images || !context.withMaskedNavigation)
            throw new ServiceClientError(
              "FORBIDDEN",
              0,
              "Enable image transmission before requesting visual inference.",
            );
          await context.withMaskedNavigation(sessionId, requestId, {
            consume: async (capture, guard) => {
              observed = await observe();
              await propose(capture, guard);
            },
          });
        }
        if (!needsObservation) return;
        observed = await observe(nextRegion);
        if (!candidate.view?.serviceNavigation)
          await state(
            "pending",
            "Requesting a proposal from the connected development service.",
          );
      }
    } catch (error) {
      if (sameTaskOwner()) {
        candidate.view!.serviceNavigation = {
          profile: "fake",
          requestId,
          state: "error",
          message:
            "The service proposal is unavailable. Your destination remains unverified.",
          ...(signal.aborted
            ? {
                code:
                  Date.now() >= deadlineAt
                    ? ("DEADLINE_EXCEEDED" as const)
                    : ("CANCELLED" as const),
              }
            : error instanceof ServiceClientError &&
                serviceErrorCodeSchema.safeParse(error.code).success
              ? { code: serviceErrorCodeSchema.parse(error.code) }
              : {}),
        };
        await context.save();
      }
    } finally {
      if (serviceJob === job) serviceJob = undefined;
    }
  }
  async function handleNlp(raw: any, sender: Runtime.MessageSender) {
    const startedGeneration = context.goalGeneration;
    if (sender.id !== api.runtime.id) throw new Error("Invalid sender.");
    const fromContent = raw.type === "NLP_REPLAN";
    if (!fromContent && !trustedUi(sender, context.session))
      throw new Error("Trusted extension panel required.");
    if (!fromContent && !messageSchema.safeParse(raw).success)
      throw new Error("Invalid request.");
    const foreground = raw.type === "SET_GOAL" || raw.type === "CLARIFY";
    if (foreground) {
      foregroundRevision++;
      activeForeground++;
    }
    const intentRevision = foregroundRevision;
    const intentId = foreground ? crypto.randomUUID() : undefined;
    let intentSession: { tabId: number; sessionId: string } | undefined;
    const assertCurrentIntent = () => {
      if (
        intentRevision !== foregroundRevision ||
        (!foreground && activeForeground)
      )
        throw new Error("Planning was replaced by a foreground destination.");
    };
    try {
      const captured = await context.enqueue(async () => {
        assertCurrentIntent();
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
        if (
          !fromContent &&
          ((raw.sessionId && raw.sessionId !== context.session.sessionId) ||
            (raw.documentId && raw.documentId !== context.session.documentId))
        )
          throw new Error(
            "This destination belongs to a previous page. Send it on the current page.",
          );
        const query = sanitizeGoal(
          raw.text || raw.goal || raw.request?.original || "",
        );
        if (intentId)
          intentSession = {
            tabId: context.session.tabId,
            sessionId: context.session.sessionId,
          };
        const reply = await api.tabs.sendMessage(context.session.tabId, {
          type: "GET_PAGE",
          ...(intentId
            ? { planningIntent: { id: intentId, phase: "begin" } }
            : {}),
          sessionId: context.session.sessionId,
          ...(query ? { query } : {}),
        });
        assertCurrentIntent();
        if (!reply.page) throw new Error("Fresh page observation required.");
        // A destination is an intent, not a binding to a control. Plan on the
        // fresh scan; native document/session identity remains mandatory below.
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
          verifiedDestination: fromContent
            ? raw.verifiedDestination
            : undefined,
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
      // Unknown account settings preserve local planning but authorize neither
      // cloud nor legacy egress. Suggestions obey the same selected provider.
      let serviceSelected: boolean | undefined;
      try {
        const choice = serviceInferenceStatusSchema.safeParse(
          await serviceAuthCommand({ type: "AUTH_INFERENCE_STATUS" }),
        );
        serviceSelected = choice.success ? choice.data.enabled : undefined;
      } catch {
        serviceSelected = undefined;
      }
      const useService = raw.type !== "NLP_SUGGEST" && serviceSelected === true;
      for (let attempt = 0; attempt < 2; attempt++) {
        assertCurrentIntent();
        let value;
        if (serviceSelected === false)
          try {
            value = await backendNlp(input, raw.type === "NLP_SUGGEST", site);
          } catch {
            value = undefined;
          }
        assertCurrentIntent();
        if (startedGeneration !== context.goalGeneration)
          throw new Error("Planning was replaced or canceled.");
        value ??= await localNlp(input, site, raw.type === "NLP_SUGGEST");
        const applied = await context.enqueue(async () => {
          assertCurrentIntent();
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
          if (context.session.documentId !== captured.documentId)
            throw new Error(
              "The website moved to another page. Send this destination on the current page.",
            );
          const fresh = await api.tabs.sendMessage(context.session.tabId, {
            type: "GET_PAGE",
            sessionId: context.session.sessionId,
          });
          assertCurrentIntent();
          if (
            fromContent &&
            input.journey &&
            fresh.view?.journey?.requestTaskId ===
              input.journey.requestTaskId &&
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
            if (useService)
              scheduleService(
                captured.sessionId,
                result.requestId,
                startedGeneration,
              );
            else if (
              serviceSelected === false &&
              needsVision(result.plan, !!result.clarification)
            )
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
          assertCurrentIntent();
          const reply = await api.tabs.sendMessage(context.session.tabId, {
            type: "INSTALL_REQUEST",
            sessionId: context.session.sessionId,
            result,
            strategy: raw.strategy,
            savedRouteId: raw.savedRouteId,
          });
          assertCurrentIntent();
          if (reply.error) return undefined;
          await context.acceptView(reply.view);
          await context.remember();
          await context.save();
          if (useService)
            scheduleService(
              captured.sessionId,
              result.requestId,
              startedGeneration,
            );
          else if (
            serviceSelected === false &&
            needsVision(result.plan, !!result.clarification)
          )
            setTimeout(
              () =>
                void context.attemptVision(
                  captured.sessionId,
                  result.requestId,
                ),
              100,
            );
          return structuredClone(context.session);
        });
        if (applied) return applied;
      }
      // Suggestions cannot install or replace a task, including during scan churn.
      if (raw.type === "NLP_SUGGEST")
        return {
          requestId: input.requestId,
          documentId: captured.documentId,
          revision: input.revision,
          contextRevision: input.contextRevision,
          suggestions: [],
        };
      // Retain a first request too, rather than claiming retention while leaving the
      // previous task in the panel after a mutation storm exhausted stale retries.
      const request =
        input.request ||
        interpretRequest(input.text, input.context, { clauses: true });
      request.id = input.requestId;
      const retained = await context.enqueue(async () => {
        assertCurrentIntent();
        if (
          startedGeneration !== context.goalGeneration ||
          !context.session ||
          context.session.sessionId !== captured.sessionId ||
          context.session.documentId !== captured.documentId ||
          context.session.view?.status !== "running" ||
          context.session.navigationPending
        )
          return;
        const fresh = await api.tabs.sendMessage(context.session.tabId, {
          type: "GET_PAGE",
          sessionId: context.session.sessionId,
        });
        if (!fresh.page) return;
        const pending = {
          requestId: request.id,
          documentId: captured.documentId,
          revision: fresh.page.revision,
          protocolVersion: 2,
          contextRevision: fresh.view?.journey?.workflow?.revision || 0,
          status: "pending-indexing",
          request,
          reason:
            "The page is still updating. I’m checking its controls; your destination is retained.",
          activity: {
            embedded: 0,
            cacheHits: 0,
            llmCalls: 0,
            modelRevision: "751bff37182d3f1213fa05d7196b954e230abad9",
          },
        };
        if (fromContent) {
          if (useService)
            scheduleService(captured.sessionId, request.id, startedGeneration);
          return pending;
        }
        const reply = await api.tabs.sendMessage(context.session.tabId, {
          type: "INSTALL_REQUEST",
          sessionId: context.session.sessionId,
          result: pending,
        });
        if (reply.view) {
          await context.acceptView(reply.view);
          await context.save();
          if (useService)
            scheduleService(captured.sessionId, request.id, startedGeneration);
          return structuredClone(context.session);
        }
      });
      if (retained) return retained;
      throw new Error("Planning was replaced or canceled.");
    } finally {
      if (foreground) activeForeground--;
      if (intentId && intentSession)
        void api.tabs
          .sendMessage(intentSession.tabId, {
            type: "GET_PAGE",
            sessionId: intentSession.sessionId,
            planningIntent: { id: intentId, phase: "end" },
          })
          .catch(() => {});
    }
  }
  return { handleNlp };
}
