import type {
  CaptureMetadata,
  PreparedNavigationPixels,
  RecognitionInput,
} from "../../packages/vision/contracts";

/** Runs inside the installed extension. No image or field content crosses WebDriver. */
export async function nativeVisionPixels({
  tabId,
  compare,
}: {
  tabId: number;
  compare: boolean;
}) {
  const api = (globalThis as any).browser || (globalThis as any).chrome;
  type Box = { x: number; y: number; width: number; height: number };
  type Capture = {
    image: string;
    metadata: CaptureMetadata;
    browserZoom: number;
    captureCssBounds: Box;
  };
  let stage = "session";
  const session = await api.runtime.sendMessage({ type: "GET_SESSION" });
  const tab = await api.tabs.get(tabId);
  if (
    !session.sessionId ||
    !session.view?.request?.id ||
    !session.view?.journey?.id ||
    !session.documentId ||
    !tab.active
  )
    throw Error("Native privacy proof requires the active pinned session");
  const fixture = async (action: "geometry" | "changePrivateValue") => {
    const [result] = await api.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (action: string) => (window as any).__vision38Fixture[action](),
      args: [action],
    });
    return result.result;
  };
  const geometry: {
    privateRects: Box[];
    publicRect: Box;
    publicSlotRect: Box;
    privateSlotIndex: number;
    privateSlotOverflowIndex: number;
    publicSlotOutsidePrivateText: boolean;
    ownedRects: Box[];
    bottomRect: Box;
    fractionalTextRect: Box;
    viewport: {
      layoutHeight: number;
      visualHeight: number;
      visualWidth: number;
    };
  } = await fixture("geometry");
  const styles = async () => {
    const [result] = await api.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () =>
        JSON.stringify((window as any).__vision38Fixture.ownedStyles()),
    });
    return result.result;
  };
  const priorStyles = await styles();
  const worker = new Worker(api.runtime.getURL("ocr-worker.js"), {
    type: "module",
  });
  async function capture(): Promise<Capture> {
    const captureId = crypto.randomUUID();
    try {
      stage = "prepare";
      const reply = await api.tabs.sendMessage(
        tabId,
        { type: "PREPARE_CAPTURE", sessionId: session.sessionId, captureId },
        { frameId: 0 },
      );
      if (reply?.error || !reply?.metadata) {
        const reasons = [
          "A current running task is required for capture.",
          "Current page perception is unavailable.",
          "The capture task changed.",
          "Complete private capture evidence is unavailable.",
        ];
        stage += ":" + reasons.indexOf(reply?.error);
        throw Error("Current capture metadata unavailable");
      }
      const metadata: CaptureMetadata = reply.metadata;
      const browserZoom = await api.tabs.getZoom(tabId);
      const current = await api.tabs.get(tabId);
      if (!current.active || current.windowId !== tab.windowId)
        throw Error("Native capture tab changed");
      stage = "native-capture";
      const image = await api.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      stage = "current-proof";
      const checked = await api.tabs.sendMessage(
        tabId,
        { type: "CHECK_CAPTURE", sessionId: session.sessionId, captureId },
        { frameId: 0 },
      );
      if (!checked?.current) throw Error("Capture evidence changed");
      return {
        image,
        metadata,
        browserZoom,
        captureCssBounds: {
          x: 0,
          y: 0,
          width: metadata.viewport.width,
          height: metadata.viewport.height,
        },
      };
    } finally {
      await api.tabs.sendMessage(
        tabId,
        { type: "RESTORE_CAPTURE", sessionId: session.sessionId, captureId },
        { frameId: 0 },
      );
    }
  }
  async function request<T>(body: Record<string, unknown>): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Native pixel worker deadline")),
        30_000,
      );
      worker.onerror = () => {
        clearTimeout(timer);
        reject(Error("Native pixel worker failed"));
      };
      worker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        clearTimeout(timer);
        data.error
          ? reject(Error("Native pixel preparation rejected"))
          : resolve(data.value);
      };
      worker.postMessage({ type: "OCR_REQUEST", id, ...body });
    });
  }
  async function inspect(
    image: string,
    width: number,
    height: number,
    cssBounds: Box,
    mode: "color" | "ocr",
    viewportEdges = false,
  ) {
    const bitmap = await createImageBitmap(
      await (await fetch("data:image/png;base64," + image)).blob(),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
      if (bitmap.width !== width || bitmap.height !== height)
        throw Error("Prepared PNG dimensions differ");
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, width, height).data;
      const pixel = (x: number, y: number) => {
        const index =
          (Math.min(
            height - 1,
            Math.max(
              0,
              Math.floor(((y - cssBounds.y) * height) / cssBounds.height),
            ),
          ) *
            width +
            Math.min(
              width - 1,
              Math.max(
                0,
                Math.floor(((x - cssBounds.x) * width) / cssBounds.width),
              ),
            )) *
          4;
        return [data[index], data[index + 1], data[index + 2], data[index + 3]];
      };
      let checkedPrivatePixels = 0,
        privateFailures = 0,
        checkedPadding = 0,
        paddingFailures = 0,
        privateSlotPixels = 0,
        privateSlotOverflowPixels = 0;
      for (const [rectIndex, rect] of geometry.privateRects.entries()) {
        const left = Math.max(rect.x, cssBounds.x),
          top = Math.max(rect.y, cssBounds.y);
        const right = Math.min(
            rect.x + rect.width,
            cssBounds.x + cssBounds.width,
          ),
          bottom = Math.min(
            rect.y + rect.height,
            cssBounds.y + cssBounds.height,
          );
        if (right <= left || bottom <= top) continue;
        const x0 = Math.max(
          0,
          Math.floor(((left - cssBounds.x) * width) / cssBounds.width),
        );
        const y0 = Math.max(
          0,
          Math.floor(((top - cssBounds.y) * height) / cssBounds.height),
        );
        const x1 = Math.min(
          width,
          Math.ceil(((right - cssBounds.x) * width) / cssBounds.width),
        );
        const y1 = Math.min(
          height,
          Math.ceil(((bottom - cssBounds.y) * height) / cssBounds.height),
        );
        // Check every output pixel intersecting each independent fixture box.
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const index = (y * width + x) * 4;
            const r = data[index],
              g = data[index + 1],
              b = data[index + 2],
              a = data[index + 3];
            checkedPrivatePixels++;
            if (rectIndex === geometry.privateSlotIndex) privateSlotPixels++;
            if (rectIndex === geometry.privateSlotOverflowIndex)
              privateSlotOverflowPixels++;
            if (
              a !== 255 ||
              r !== g ||
              g !== b ||
              !(mode === "color" ? r === 136 : r === 136 || r === 119)
            )
              privateFailures++;
          }
        if (mode === "color" && rect.x - 1 > cssBounds.x) {
          const [r, g, b, a] = pixel(rect.x - 1, (top + bottom) / 2);
          checkedPadding++;
          if (r !== 136 || g !== 136 || b !== 136 || a !== 255)
            paddingFailures++;
        }
      }
      const center = (rect: Box) =>
        pixel(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const bottomRow = (rect: Box) => {
        let samples = 0,
          failures = 0;
        // Independent fixture geometry fixes the horizontal span; the last
        // output row is explicit, regardless of the producer's source plane.
        const x0 = Math.max(
          0,
          Math.floor((rect.x * width) / geometry.viewport.visualWidth),
        );
        const x1 = Math.min(
          width,
          Math.ceil(
            ((rect.x + rect.width) * width) / geometry.viewport.visualWidth,
          ),
        );
        for (let x = x0; x < x1; x++) {
          const index = ((height - 1) * width + x) * 4;
          samples++;
          if (
            data[index] !== 136 ||
            data[index + 1] !== 136 ||
            data[index + 2] !== 136 ||
            data[index + 3] !== 255
          )
            failures++;
        }
        return { samples, failures };
      };
      const fractionalStripExpected =
        geometry.viewport.visualHeight > geometry.viewport.layoutHeight;
      const bottom = viewportEdges
        ? bottomRow(geometry.bottomRect)
        : { samples: 0, failures: 0 };
      const fractional =
        viewportEdges && fractionalStripExpected
          ? bottomRow(geometry.fractionalTextRect)
          : { samples: 0, failures: 0 };
      return {
        checkedPrivatePixels,
        privateFailures,
        privateSlotPixels,
        privateSlotOverflowPixels,
        publicSlotOutsidePrivateText: geometry.publicSlotOutsidePrivateText,
        checkedPadding,
        paddingFailures,
        bottomRowSamples: bottom.samples,
        bottomRowFailures: bottom.failures,
        fractionalStripExpected,
        fractionStripSampleCount: fractional.samples,
        fractionStripFailures: fractional.failures,
        publicColorRetained:
          mode === "color" &&
          center(geometry.publicRect).every(
            (value, index) => value === [31, 111, 235, 255][index],
          ),
        publicSlotColorRetained:
          mode === "color" &&
          center(geometry.publicSlotRect).every(
            (value, index) => value === [245, 166, 35, 255][index],
          ),
        ownedUiAbsent:
          mode === "color" &&
          geometry.ownedRects.every((rect) =>
            center(rect).every(
              (value, index) => value === [17, 19, 23, 255][index],
            ),
          ),
      };
    } finally {
      bitmap.close();
      canvas.width = canvas.height = 0;
    }
  }
  try {
    const captured = await capture();
    stage = "navigation-worker";
    const prepared = await request<PreparedNavigationPixels>({
      ...captured,
      prepareNavigation: {},
    });
    stage = "navigation-pixels";
    const color = await inspect(
      prepared.image,
      prepared.width,
      prepared.height,
      prepared.source.cssBounds,
      "color",
      true,
    );
    const rect = geometry.privateRects[0];
    const cropBox = {
      x: rect.x + 2,
      y: rect.y + 2,
      width: rect.width - 4,
      height: rect.height - 4,
    };
    stage = "crop-worker";
    const crop = await request<PreparedNavigationPixels>({
      ...captured,
      prepareNavigation: { crop: cropBox },
    });
    stage = "crop-pixels";
    const cropProof = await inspect(
      crop.image,
      crop.width,
      crop.height,
      crop.source.cssBounds,
      "color",
    );
    stage = "ocr-worker";
    const ocr = await request<RecognitionInput>({
      ...captured,
      prepareOnly: true,
      stamp: {
        requestId: session.view.request.id,
        journeyId: session.view.journey.id,
        contextRevision: session.view.journey.workflow?.revision || 0,
        documentId: session.documentId,
        observationRevision: captured.metadata.observationRevision,
        viewportRevision: captured.metadata.viewportRevision,
        captureId: captured.metadata.captureId,
      },
    });
    stage = "ocr-pixels";
    const ocrProof = await inspect(
      ocr.image,
      ocr.width,
      ocr.height,
      captured.captureCssBounds,
      "ocr",
    );
    let privateComparisonMatched: boolean | null = null;
    if (compare) {
      await fixture("changePrivateValue");
      // Keep native capture requests below the browser-owned capture rate limit.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const changed = await capture();
      stage = "comparison-worker";
      const comparison = await request<{ matches: boolean }>({
        ...changed,
        referenceImage: captured.image,
        referenceMetadata: captured.metadata,
        referenceCaptureCssBounds: captured.captureCssBounds,
        referenceBrowserZoom: captured.browserZoom,
        compareRegion: rect,
      });
      privateComparisonMatched = comparison.matches;
    }
    stage = "restoration";
    return {
      browserZoom: captured.browserZoom,
      devicePixelRatio: captured.metadata.viewport.devicePixelRatio,
      maskCount: captured.metadata.masks.length,
      privateRectCount: geometry.privateRects.length,
      layoutWidth: captured.metadata.viewport.width,
      visualWidth: captured.metadata.viewport.visualViewport.width,
      layoutHeight: captured.metadata.viewport.height,
      visualHeight: captured.metadata.viewport.visualViewport.height,
      sourceWidth: prepared.source.bitmapWidth,
      sourceHeight: prepared.source.bitmapHeight,
      scaleX: prepared.source.scaleX,
      scaleY: prepared.source.scaleY,
      color,
      crop: cropProof,
      ocr: ocrProof,
      privateComparisonMatched,
      exactStylesRestored: (await styles()) === priorStyles,
      identityMatched:
        prepared.captureId === captured.metadata.captureId &&
        prepared.scanId === captured.metadata.scanId &&
        prepared.observationRevision ===
          captured.metadata.observationRevision &&
        prepared.viewportRevision === captured.metadata.viewportRevision,
      bounded:
        prepared.width * prepared.height <= 4_000_000 &&
        crop.width * crop.height <= 4_000_000 &&
        ocr.width * ocr.height <= 4_000_000,
    };
  } catch {
    throw Error("Native privacy proof failed at " + stage);
  } finally {
    worker.terminate();
  }
}
