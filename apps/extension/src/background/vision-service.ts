import { cancelInferenceHost } from "../platform/inference-host";
import { api, browserTarget } from "../platform/api";
import type { PinnedSession } from "../../../../packages/route-registry/session";
import {
  planInputSchema,
  resultSchema,
} from "../../../../packages/navigation-core/contracts";
import {
  supportsLiveUrl,
  type PageSnapshot,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import { validPinnedView } from "../../../../packages/route-registry/session";
import {
  captureMetadataSchema,
  type CaptureMetadata,
  preparedNavigationPixelsSchema,
  type PreparedNavigationPixels,
  visualObservationSchema,
  type VisualObservation,
} from "../../../../packages/vision/contracts";
import { needsVision } from "../../../../packages/vision/fusion";
import { recognizeWithFallback } from "../../../../packages/vision/processing";
import { browserOcr, localNlp } from "../inference/client";
import { backendOcr } from "../platform/backend-client";
import { presentationVisible } from "./ui-transport";
import { beginPageObservation } from "./frame-coordinator";
import { getPrivateSetting } from "../platform/private-settings";
import { hostPermissionPattern } from "../platform/site-access";
import {
  navigationImageMatchesViewport,
  type NavigationObservation,
} from "../../../../packages/navigation-core/contracts-navigation";

export interface MaskedNavigationCapture {
  pixels: PreparedNavigationPixels;
  native: NavigationObservation["native"];
  viewport: NavigationObservation["frames"][number]["viewport"];
  page: PageSnapshot;
  capturedAtMs: number;
  signal: AbortSignal;
}
type NavigationCaptureConsumer = {
  crop?: CaptureMetadata["masks"][number];
  consume: (
    capture: MaskedNavigationCapture,
    beforeSend: () => Promise<void>,
  ) => Promise<void>;
};

interface Context {
  visionJob: AbortController | undefined;
  lastVisionKey: string;
  session: PinnedSession | undefined;
  goalGeneration: number;
  originOf: (url?: string) => string | undefined;
  lastCapture: number;
  knownSites: Map<string, SiteMemory | undefined>;
  save: () => Promise<void>;
  acceptView: (raw: unknown) => Promise<void>;
}

export function createVisionService(context: Context) {
  let capturedWindow: number | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  function cancelVision() {
    clearTimeout(retry);
    retry = undefined;
    context.visionJob?.abort();
    context.visionJob = undefined;
    capturedWindow = undefined;
    context.lastVisionKey = "";
    void cancelInferenceHost("CANCEL_OCR");
  }

  async function runVision(
    sessionId: string,
    requestId: string,
    navigation?: NavigationCaptureConsumer,
  ) {
    if (
      context.visionJob ||
      !context.session ||
      !context.session.documentId ||
      context.session.sessionId !== sessionId ||
      context.session.view?.request?.id !== requestId ||
      (navigation && context.session.view.request.status !== "active") ||
      !context.session.view.journey ||
      !context.session.view.page ||
      context.session.view.status !== "running" ||
      context.session.view.journey.workflow?.status === "review" ||
      (!navigation &&
        context.session.view.goalPlan?.recoveryStage &&
        context.session.view.goalPlan.recoveryStage !== "vision") ||
      (!navigation &&
        !needsVision(
          context.session.view.goalPlan,
          !!context.session.view.clarification,
        ))
    ) {
      if (navigation)
        throw Error(
          "A current running browser request is required for masked capture.",
        );
      return;
    }
    const candidate = context.session;
    if (
      !(await presentationVisible(candidate)) ||
      context.session !== candidate ||
      context.visionJob
    ) {
      if (navigation)
        throw Error("The current Tholi presentation is unavailable.");
      return;
    }
    const captured = structuredClone(context.session),
      view = captured.view!;
    const controller = new AbortController();
    context.visionJob = controller;
    const generation = context.goalGeneration;
    try {
      const tab = await api.tabs.get(captured.tabId);
      if (
        tab?.id !== captured.tabId ||
        tab.windowId === undefined ||
        !supportsLiveUrl(tab.url || "") ||
        context.originOf(tab.url) !== captured.origin
      )
        throw Error("The authorized browser context is unavailable.");
      capturedWindow = tab.windowId;
      const start = await beginPageObservation(captured, tab);
      if (!start) throw Error("The native document is unavailable.");
      const stale = () => {
        controller.abort();
        throw new DOMException("The capture context changed.", "AbortError");
      };
      const assertOwner = () => {
        controller.signal.throwIfAborted();
        if (
          context.visionJob !== controller ||
          context.session !== candidate ||
          generation !== context.goalGeneration ||
          context.session.documentId !== captured.documentId ||
          context.session.navigationPending ||
          context.session.view?.status !== "running" ||
          context.session.view.page?.revision !== view.page!.revision ||
          context.session.view.request?.id !== requestId ||
          context.session.view.request.status !== view.request!.status ||
          context.session.view.request.active !== view.request!.active ||
          context.session.view.journey?.id !== view.journey!.id ||
          context.session.view.journey.status !== view.journey!.status ||
          (context.session.view.journey.workflow?.revision || 0) !==
            (view.journey!.workflow?.revision || 0)
        )
          stale();
      };
      const assertNative = async () => {
        assertOwner();
        const [native, window, active, permitted, visible] = await Promise.all([
          beginPageObservation(captured, tab),
          api.windows.get(start.windowId, { populate: false }),
          api.tabs.query({ active: true, windowId: start.windowId }),
          api.permissions.contains({
            origins: [hostPermissionPattern(captured.origin!)],
          }),
          presentationVisible(candidate),
        ]);
        assertOwner();
        if (
          !native ||
          native.epoch !== start.epoch ||
          native.zoom !== start.zoom ||
          native.documentId !== start.documentId ||
          native.windowId !== start.windowId ||
          !window.focused ||
          window.state === "minimized" ||
          active.length !== 1 ||
          active[0].id !== captured.tabId ||
          active[0].url !== tab.url ||
          !permitted ||
          !visible
        )
          stale();
      };
      const assertCapture = async (metadata: CaptureMetadata) => {
        const checked = await api.tabs.sendMessage(
          captured.tabId,
          {
            type: "CHECK_CAPTURE",
            sessionId,
            captureId: metadata.captureId,
          },
          { frameId: 0 },
        );
        if (
          !checked?.current ||
          checked.viewportRevision !== metadata.viewportRevision ||
          Date.now() - metadata.at > 15000 ||
          metadata.at > Date.now()
        )
          stale();
        await assertNative();
      };
      const capture = async () => {
        await assertNative();
        const captureId = crypto.randomUUID();
        try {
          const reply = await api.tabs.sendMessage(
            captured.tabId,
            {
              type: "PREPARE_CAPTURE",
              sessionId,
              captureId,
            },
            { frameId: 0 },
          );
          const metadata = captureMetadataSchema.parse(reply?.metadata);
          const viewport = metadata.viewport;
          if (
            viewport.visualViewport.scale !== 1 ||
            viewport.visualViewport.offsetLeft !== 0 ||
            viewport.visualViewport.offsetTop !== 0 ||
            (browserTarget() === "firefox" &&
              (Math.abs(viewport.width - viewport.visualViewport.width) > 0.5 ||
                Math.abs(viewport.height - viewport.visualViewport.height) >
                  0.5))
          )
            throw Error(
              "This viewport geometry is unsupported for visual assistance.",
            );
          const observed = validPinnedView(captured, reply?.view);
          if (
            metadata.captureId !== captureId ||
            !observed?.page ||
            observed.page.revision !== metadata.observationRevision ||
            observed.page.revision !== view.page!.revision ||
            observed.request?.id !== requestId ||
            observed.status !== "running" ||
            observed.journey?.id !== view.journey!.id ||
            (observed.journey.workflow?.revision || 0) !==
              (view.journey!.workflow?.revision || 0)
          )
            stale();
          await assertNative();
          const capturedAtMs = Date.now();
          context.lastCapture = capturedAtMs;
          const image = await api.tabs.captureVisibleTab(start.windowId, {
            format: "png",
          });
          await assertCapture(metadata);
          return {
            image,
            capturedAtMs,
            metadata,
            observed: observed!,
            browserZoom: start.zoom,
            captureCssBounds: {
              x: 0,
              y: 0,
              width: metadata.viewport.width,
              height: metadata.viewport.height,
            },
          };
        } finally {
          // Suppression never spans worker inference or network capability waits.
          await api.tabs
            .sendMessage(
              captured.tabId,
              {
                type: "RESTORE_CAPTURE",
                sessionId,
                captureId,
              },
              { frameId: 0 },
            )
            .catch(() => {});
        }
      };
      const visionKey = (viewport: number) =>
        [requestId, captured.documentId, view.page!.revision, viewport].join(
          ":",
        );
      const currentViewport = await api.tabs.sendMessage(
        captured.tabId,
        {
          type: "CHECK_VIEWPORT",
          sessionId,
        },
        { frameId: 0 },
      );
      if (
        !navigation &&
        context.lastVisionKey === visionKey(currentViewport?.viewportRevision)
      )
        return;
      const remaining = 2000 - (Date.now() - context.lastCapture);
      if (remaining > 0) {
        if (navigation)
          throw Error(
            "Viewport capture is throttled. Keep structured guidance available.",
          );
        clearTimeout(retry);
        retry = setTimeout(() => {
          retry = undefined;
          void attemptVision(sessionId, requestId);
        }, remaining);
        return;
      }
      const initial = await capture();
      const { image, metadata, observed } = initial;
      if (navigation) {
        const pixels = preparedNavigationPixelsSchema.parse(
          await browserOcr({
            image,
            metadata,
            browserZoom: initial.browserZoom,
            captureCssBounds: initial.captureCssBounds,
            prepareNavigation: { crop: navigation.crop },
          }),
        );
        const viewport = {
          ...metadata.viewport,
          browserZoom: initial.browserZoom,
        };
        if (
          pixels.captureId !== metadata.captureId ||
          pixels.scanId !== metadata.scanId ||
          pixels.observationRevision !== metadata.observationRevision ||
          pixels.viewportRevision !== metadata.viewportRevision ||
          pixels.maskedAtMs < initial.capturedAtMs ||
          pixels.maskedAtMs > Date.now() ||
          !navigationImageMatchesViewport(pixels, viewport)
        )
          stale();
        await assertCapture(metadata);
        await navigation.consume(
          {
            pixels,
            native: {
              kind: "browser",
              version: 1,
              frameId: 0,
              tabId: start.tabId,
              windowId: start.windowId,
              documentId: start.documentId,
            },
            viewport,
            page: observed.page!,
            signal: controller.signal,
            capturedAtMs: initial.capturedAtMs,
          },
          () => assertCapture(metadata),
        );
        assertOwner();
        return;
      }
      const key = visionKey(metadata.viewportRevision);
      if (context.lastVisionKey === key) return;
      context.lastVisionKey = key;
      const stamp = {
        requestId,
        journeyId: view.journey!.id,
        contextRevision: view.journey!.workflow?.revision || 0,
        documentId: captured.documentId!,
        observationRevision: view.page!.revision,
        viewportRevision: metadata.viewportRevision,
        captureId: metadata.captureId,
      };
      const settings = await getPrivateSetting<{ backend: boolean }>("vision");
      const value = await recognizeWithFallback(
        {
          image,
          metadata,
          stamp,
          browserZoom: initial.browserZoom,
          captureCssBounds: initial.captureCssBounds,
        },
        {
          browser: browserOcr,
          backend: (input, signal) =>
            backendOcr(input, signal, async () => {
              if (
                !(await getPrivateSetting<{ backend: boolean }>("vision"))
                  ?.backend
              )
                throw Error(
                  "Backend visual assistance was disabled before transmission.",
                );
              await assertCapture(metadata);
            }),
        },
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
      await assertCapture(metadata);
      if (
        generation !== context.goalGeneration ||
        context.session?.documentId !== stamp.documentId ||
        context.session.view?.request?.id !== requestId ||
        observed.page?.revision !== stamp.observationRevision ||
        observed.journey?.id !== stamp.journeyId ||
        !needsVision(observed.goalPlan, !!observed.clarification)
      )
        return;

      const visualInput = planInputSchema.parse({
        requestId,
        documentId: stamp.documentId,
        revision: stamp.observationRevision,
        text: view.request!.original,
        observation: observed.page,
        request: observed.request,
        journey: observed.journey,
        workflow: observed.journey.workflow,
        contextRevision: stamp.contextRevision,
        protocolVersion: 2,
        strategy: observed.journey.strategy,
        tabId: captured.tabId,
        visualObservation: observation,
      });
      const interpreted = resultSchema.parse(
        await localNlp(visualInput, context.knownSites.get(captured.origin!)),
      );
      controller.signal.throwIfAborted();
      await assertCapture(metadata);
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
          await new Promise<void>((resolve, reject) => {
            const aborted = () => {
              clearTimeout(timer);
              reject(controller.signal.reason);
            };
            const timer = setTimeout(() => {
              controller.signal.removeEventListener("abort", aborted);
              resolve();
            }, delay);
            controller.signal.addEventListener("abort", aborted, {
              once: true,
            });
            if (controller.signal.aborted) aborted();
          });
        controller.signal.throwIfAborted();
        const current = await capture();
        if (current.metadata.viewportRevision !== metadata.viewportRevision)
          return;
        const checked = await browserOcr({
          image: current.image,
          referenceImage: image,
          metadata: current.metadata,
          referenceMetadata: metadata,
          referenceBrowserZoom: initial.browserZoom,
          referenceCaptureCssBounds: initial.captureCssBounds,
          browserZoom: current.browserZoom,
          captureCssBounds: current.captureCssBounds,
          stamp: { ...stamp, captureId: current.metadata.captureId },
          compareRegion: plan.action.box,
        });
        controller.signal.throwIfAborted();
        await assertCapture(current.metadata);
        if (!checked.matches) {
          context.lastVisionKey = "";
          return;
        }
        const shown = await api.tabs.sendMessage(captured.tabId, {
          type: "SHOW_VISUAL",
          sessionId,
          action: plan.action,
          viewportRevision: metadata.viewportRevision,
          capturedAt: metadata.at,
        });
        if (!shown.shown) return;
      }
      const result = interpreted;
      const reply = await api.tabs.sendMessage(captured.tabId, {
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
      if (navigation) throw error;
      if (
        !controller.signal.aborted &&
        context.session?.sessionId === sessionId &&
        generation === context.goalGeneration
      ) {
        context.session.view!.instruction =
          /activeTab|permission|Cannot access|not granted/i.test(
            error instanceof Error ? error.message : "",
          )
            ? "Your browser needs renewed capture access. Click the extension icon on this website; your destination is retained."
            : "Visual recognition is unavailable right now. Your destination is retained; use live controls or retry visual assistance.";
        await context.save();
      }
    } finally {
      if (context.visionJob === controller) {
        context.visionJob = undefined;
        capturedWindow = undefined;
      }
    }
  }
  const attemptVision = (sessionId: string, requestId: string) =>
    runVision(sessionId, requestId);
  // The caller must supply its actual future request stamp. This owner exposes
  // only native-bound masked pixels and keeps its cancellation span alive while
  // the consumer validates and uses them; no provider or transport is enabled.
  const withMaskedNavigation = (
    sessionId: string,
    requestId: string,
    consumer: NavigationCaptureConsumer,
  ) => runVision(sessionId, requestId, consumer);
  return {
    cancelVision,
    attemptVision,
    withMaskedNavigation,
    captureWindowId: () => capturedWindow,
  };
}
