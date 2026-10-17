import type { PinnedSession } from "../../../../packages/route-registry/session";
import {
  planInputSchema,
  resultSchema,
} from "../../../../packages/navigation-core/contracts";
import {
  supportsLiveUrl,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import {
  visualObservationSchema,
  type VisualObservation,
} from "../../../../packages/vision/contracts";
import { needsVision } from "../../../../packages/vision/fusion";
import { recognizeWithFallback } from "../../../../packages/vision/processing";
import { browserOcr, localNlp } from "../inference/offscreen-client";
import { backendOcr } from "../platform/backend-client";
import { presentationVisible } from "./ui-transport";

interface Context {
  visionJob: AbortController | undefined;
  lastVisionKey: string;
  session: PinnedSession | undefined;
  goalGeneration: number;
  activeTab: () => Promise<chrome.tabs.Tab>;
  originOf: (url?: string) => string | undefined;
  lastCapture: number;
  knownSites: Map<string, SiteMemory | undefined>;
  save: () => Promise<void>;
  acceptView: (raw: unknown) => Promise<void>;
}

export function createVisionService(context: Context) {
  function cancelVision() {
    context.visionJob?.abort();
    context.visionJob = undefined;
    context.lastVisionKey = "";
    void chrome.runtime
      .sendMessage({ target: "offscreen", type: "CANCEL_OCR" })
      .catch(() => {});
  }

  async function attemptVision(sessionId: string, requestId: string) {
    if (
      context.visionJob ||
      !context.session ||
      context.session.sessionId !== sessionId ||
      context.session.view?.request?.id !== requestId ||
      !context.session.view.journey ||
      !context.session.view.page ||
      context.session.view.status !== "running" ||
      context.session.view.journey.workflow?.status === "review" ||
      (context.session.view.goalPlan?.recoveryStage &&
        context.session.view.goalPlan.recoveryStage !== "vision") ||
      !needsVision(
        context.session.view.goalPlan,
        !!context.session.view.clarification,
      )
    )
      return;
    const candidate = context.session;
    if (
      !(await presentationVisible(candidate)) ||
      context.session !== candidate
    )
      return;
    const captured = structuredClone(context.session),
      view = captured.view!;
    const controller = new AbortController();
    context.visionJob = controller;
    const generation = context.goalGeneration;
    try {
      const tab = await context.activeTab();
      if (
        tab?.id !== captured.tabId ||
        !supportsLiveUrl(tab.url || "") ||
        context.originOf(tab.url) !== captured.origin
      )
        return;
      const metadata = await chrome.tabs.sendMessage(captured.tabId, {
        type: "PREPARE_CAPTURE",
        sessionId,
      });
      if (!metadata?.width || !metadata?.height) return;
      const key = [
        requestId,
        captured.documentId,
        view.page!.revision,
        metadata.viewportRevision,
      ].join(":");
      if (context.lastVisionKey === key) return;
      if (Date.now() - context.lastCapture < 2000) {
        setTimeout(
          () => void attemptVision(sessionId, requestId),
          2000 - (Date.now() - context.lastCapture),
        );
        return;
      }
      context.lastCapture = Date.now();
      context.lastVisionKey = key;
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      controller.signal.throwIfAborted();
      const afterTab = await context.activeTab();
      if (afterTab?.id !== tab.id || afterTab.url !== tab.url) return;
      const stamp = {
        requestId,
        journeyId: view.journey!.id,
        contextRevision: view.journey!.workflow?.revision || 0,
        documentId: captured.documentId!,
        observationRevision: view.page!.revision,
        viewportRevision: metadata.viewportRevision,
        captureId: crypto.randomUUID(),
      };
      const settings = (await chrome.storage.local.get("vision")).vision;
      const value = await recognizeWithFallback(
        { image, metadata, stamp },
        { browser: browserOcr, backend: backendOcr },
        !!settings?.backend,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const observation = visualObservationSchema.parse(value);
      if (
        Object.entries(stamp).some(
          ([k, v]) => observation[k as keyof VisualObservation] !== v,
        )
      )
        return;
      const viewport = await chrome.tabs.sendMessage(captured.tabId, {
        type: "CHECK_VIEWPORT",
        sessionId,
      });
      const fresh = await chrome.tabs.sendMessage(captured.tabId, {
        type: "GET_PAGE",
        sessionId,
      });
      if (
        generation !== context.goalGeneration ||
        context.session?.documentId !== stamp.documentId ||
        context.session.view?.request?.id !== requestId ||
        fresh.page?.revision !== stamp.observationRevision ||
        viewport.viewportRevision !== stamp.viewportRevision ||
        fresh.view?.journey?.id !== stamp.journeyId ||
        (fresh.view.journey.workflow?.revision || 0) !==
          stamp.contextRevision ||
        fresh.view.status !== "running" ||
        !needsVision(fresh.view.goalPlan, !!fresh.view.clarification)
      )
        return;

      const visualInput = planInputSchema.parse({
        requestId,
        documentId: stamp.documentId,
        revision: stamp.observationRevision,
        text: view.request!.original,
        observation: fresh.page,
        request: fresh.view.request,
        journey: fresh.view.journey,
        workflow: fresh.view.journey.workflow,
        contextRevision: stamp.contextRevision,
        protocolVersion: 2,
        strategy: fresh.view.journey.strategy,
        tabId: captured.tabId,
        visualObservation: observation,
      });
      const interpreted = resultSchema.parse(
        await localNlp(visualInput, context.knownSites.get(captured.origin!)),
      );
      controller.signal.throwIfAborted();
      const currentViewport = await chrome.tabs.sendMessage(captured.tabId, {
        type: "CHECK_VIEWPORT",
        sessionId,
      });
      if (
        currentViewport.viewportRevision !== stamp.viewportRevision ||
        context.session?.view?.request?.id !== requestId ||
        context.session.view.page?.revision !== stamp.observationRevision
      )
        return;
      const plan = interpreted.plan;
      if (!plan) {
        context.session.view!.instruction =
          "Visual assistance did not identify an unambiguous target. Your destination remains active.";
        await context.save();
        return;
      }
      if (plan.action?.kind === "visual") {
        const delay = Math.max(0, 2000 - (Date.now() - context.lastCapture));
        if (delay)
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        controller.signal.throwIfAborted();
        const active = await context.activeTab();
        if (active?.id !== captured.tabId || active.url !== tab.url) return;
        context.lastCapture = Date.now();
        const currentImage = await chrome.tabs.captureVisibleTab(
          active.windowId,
          { format: "png" },
        );
        const checked = await browserOcr({
          image: currentImage,
          referenceImage: image,
          metadata,
          stamp,
          compareRegion: plan.action.box,
        });
        controller.signal.throwIfAborted();
        if (!checked.matches) {
          context.lastVisionKey = "";
          return;
        }
        const shown = await chrome.tabs.sendMessage(captured.tabId, {
          type: "SHOW_VISUAL",
          sessionId,
          action: plan.action,
          viewportRevision: metadata.viewportRevision,
          capturedAt: metadata.at,
        });
        if (!shown.shown) return;
      }
      const result = interpreted;
      const reply = await chrome.tabs.sendMessage(captured.tabId, {
        type: "INSTALL_REQUEST",
        sessionId,
        result,
      });
      if (
        reply.view &&
        context.session?.sessionId === sessionId &&
        generation === context.goalGeneration
      ) {
        await context.acceptView(reply.view);
        await context.save();
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        context.session?.sessionId === sessionId &&
        generation === context.goalGeneration
      ) {
        context.session.view!.instruction =
          /activeTab|permission|capture|Cannot access/i.test(
            error instanceof Error ? error.message : "",
          )
            ? "Chrome needs renewed capture access. Click the extension icon on this website; your destination is retained."
            : "Visual recognition is unavailable right now. Your destination is retained; use live controls or retry visual assistance.";
        await context.save();
      }
    } finally {
      await chrome.tabs
        .sendMessage(captured.tabId, { type: "RESTORE_CAPTURE", sessionId })
        .catch(() => {});
      if (context.visionJob === controller) context.visionJob = undefined;
    }
  }
  return { cancelVision, attemptVision };
}
