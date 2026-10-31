import { readFileSync } from "node:fs";
import {
  NAVIGATION_PROTOCOL,
  NAVIGATION_CONTRACT_VERSION,
  NATIVE_BROWSER_VERSION,
  type NavigationObservation,
  type NavigationValidationContext,
} from "../../packages/navigation-core/contracts-navigation";
export function navigationModelObservation(): NavigationObservation {
  const native: NavigationObservation["native"] = {
    kind: "browser" as const,
    version: NATIVE_BROWSER_VERSION,
    windowId: 3,
    tabId: 5,
    frameId: 0,
    documentId: "native:root-document",
  };
  return {
    protocol: NAVIGATION_PROTOCOL,
    version: NAVIGATION_CONTRACT_VERSION,
    stamp: {
      sessionId: "10000000-0000-4000-8000-000000000001",
      journeyId: "10000000-0000-4000-8000-000000000002",
      requestId: "10000000-0000-4000-8000-000000000003",
      sessionGeneration: 1,
      journeyGeneration: 2,
      documentGeneration: 3,
      requestGeneration: 4,
      contextGeneration: 5,
      scanGeneration: 6,
      viewportGeneration: 7,
    },
    native,
    observedAtMs: 1010,
    deadlineAtMs: 20000,
    frames: [
      {
        native: { ...native },
        viewport: {
          width: 320,
          height: 90,
          scrollX: 0,
          scrollY: 50,
          devicePixelRatio: 2,
          browserZoom: 1,
          visualViewport: {
            offsetLeft: 0,
            offsetTop: 0,
            pageLeft: 0,
            pageTop: 50,
            width: 320,
            height: 90,
            scale: 1,
          },
        },
      },
    ],
    regions: [{ id: "main", frameId: 0, role: "main", label: "Navigation" }],
    controls: [
      {
        reference: { ...native, controlId: "w0000000000000001-1" },
        role: "button",
        label: "Settings",
        kind: "expand",
        risk: "ordinary",
        eligible: true,
        visible: true,
        enabled: true,
        occluded: false,
        inViewport: true,
        regionId: "main",
        revealIds: [],
      },
    ],
    omissions: { frames: 0, regions: 0, controls: 3, reasons: ["budget"] },
    context: {
      goal: "Find account settings without changing the current language",
      verifiedProgress: [{ label: "Opened account menu", kind: "expand" }],
    },
    images: [],
  };
}
export function navigationModelValidation(
  observed: NavigationObservation,
): NavigationValidationContext {
  return {
    currentStamp: { ...observed.stamp },
    currentNative: { ...observed.native },
    nowMs: 1020,
    requestStartedAtMs: 1000,
    requestDeadlineMs: 20000,
  };
}

const png = readFileSync("tests/fixtures/vision/light.png").toString("base64");
export function navigationModelCapture(observed: NavigationObservation) {
  observed.images = [
    {
      captureId: "10000000-0000-4000-8000-000000000004",
      stamp: { ...observed.stamp },
      native: { ...observed.native },
      capturedAtMs: 1000,
      maskedAtMs: 1005,
      width: 640,
      height: 180,
      image: png,
      source: {
        kind: "viewport",
        cssBounds: { x: 0, y: 0, width: 320, height: 90 },
        pixelBounds: { x: 0, y: 0, width: 640, height: 180 },
        bitmapWidth: 640,
        bitmapHeight: 180,
        scaleX: 2,
        scaleY: 2,
        devicePixelRatio: 2,
        browserZoom: 1,
      },
      masking: {
        version: 1,
        complete: true,
        maskedBeforeTransform: true,
        maskedRegions: 2,
      },
    },
  ];
  return observed.images[0];
}

/** Identical provider wire fixture shared by adapter and operator tests. */
export function navigationModelVertexResponse(
  proposal: unknown,
  tokens: { prompt: number; output: number; thought: number; cached?: number },
) {
  return {
    modelVersion: "gemini-3.8-flash",
    usageMetadata: {
      promptTokenCount: tokens.prompt,
      candidatesTokenCount: tokens.output,
      thoughtsTokenCount: tokens.thought,
      cachedContentTokenCount: tokens.cached ?? 0,
      totalTokenCount: tokens.prompt + tokens.output + tokens.thought,
    },
    candidates: [
      {
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: JSON.stringify(proposal) }] },
      },
    ],
  };
}
