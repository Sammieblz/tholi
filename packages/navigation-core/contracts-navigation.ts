import { z } from "zod";
import { controlId, controlSchema, progressSchema } from "../page-model";
import { sanitizeGoal, sanitizeText } from "../privacy-redaction";
import { inspectPngData } from "../vision/png";
import { SERVICE_LIMITS } from "./contracts-service";

export const NAVIGATION_PROTOCOL = "tholi-navigation";
export const NAVIGATION_CONTRACT_VERSION = 1;
export const NATIVE_BROWSER_VERSION = 1;
export const NAVIGATION_LIMITS = Object.freeze({
  maxFrames: 16,
  maxRegions: 32,
  maxControls: 96,
  maxProgress: 8,
  maxProjectionBytes: 24000,
  maxImages: 1,
  maxImageBytes: 2 * 1024 * 1024,
  maxImagePixels: 4000000,
  maxImageDimension: 8192,
  maxEnvelopeBytes: 4 * 1024 * 1024,
  maxLifetimeMs: SERVICE_LIMITS.maxDeadlineMs,
});

const generation = z.number().int().nonnegative().safe();
const clock = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().finite().positive().max(16777216);
const coordinate = z.number().finite().min(-16777216).max(16777216);
const scale = z.number().finite().positive().max(64);
const opaqueId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:-]+$/);
const label = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => sanitizeText(value) === value, "Text must be sanitized.");

/** Browser logical request IDs are independent of HTTP correlation identifiers. */
export const navigationStampSchema = z
  .object({
    sessionId: z.string().uuid(),
    journeyId: z.string().uuid(),
    requestId: z.string().uuid(),
    sessionGeneration: generation,
    journeyGeneration: generation,
    documentGeneration: generation,
    requestGeneration: generation,
    contextGeneration: generation,
    scanGeneration: generation,
    viewportGeneration: generation,
  })
  .strict();

/** This extension is versioned separately from persisted/public page models. */
export const nativeBrowserReferenceSchema = z
  .object({
    kind: z.literal("browser"),
    version: z.literal(NATIVE_BROWSER_VERSION),
    windowId: generation,
    tabId: generation,
    frameId: generation,
    documentId: z.string().min(1).max(200),
  })
  .strict();
export const navigationControlReferenceSchema = nativeBrowserReferenceSchema
  .extend({ controlId: controlId.max(100) })
  .strict();

export const navigationBoundsSchema = z
  .object({ x: coordinate, y: coordinate, width: positive, height: positive })
  .strict();
export const navigationViewportSchema = z
  .object({
    width: positive,
    height: positive,
    scrollX: coordinate,
    scrollY: coordinate,
    devicePixelRatio: scale,
    browserZoom: scale,
    visualViewport: z
      .object({
        offsetLeft: coordinate,
        offsetTop: coordinate,
        pageLeft: coordinate,
        pageTop: coordinate,
        width: positive,
        height: positive,
        scale,
      })
      .strict(),
  })
  .strict()
  .superRefine((viewport, context) => {
    const visual = viewport.visualViewport;
    if (
      visual.offsetLeft < 0 ||
      visual.offsetTop < 0 ||
      visual.offsetLeft + visual.width > viewport.width ||
      visual.offsetTop + visual.height > viewport.height ||
      !close(visual.pageLeft, viewport.scrollX + visual.offsetLeft) ||
      !close(visual.pageTop, viewport.scrollY + visual.offsetTop)
    )
      context.addIssue({
        code: "custom",
        message: "Visual viewport must match layout and document coordinates.",
      });
  });
export const navigationContextSchema = z
  .object({
    goal: z
      .string()
      .min(1)
      .max(1000)
      .refine(
        (value) => value.length <= 1000 && sanitizeGoal(value) === value,
        "Goal must be sanitized.",
      ),
    verifiedProgress: z
      .array(progressSchema.pick({ label: true, kind: true }).extend({ label }))
      .max(NAVIGATION_LIMITS.maxProgress),
  })
  .strict();

const frameSchema = z
  .object({
    native: nativeBrowserReferenceSchema,
    parentFrameId: generation.optional(),
    viewport: navigationViewportSchema,
  })
  .strict();
const regionSchema = z
  .object({
    id: opaqueId,
    frameId: generation,
    parentId: opaqueId.optional(),
    role: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9-]*$/),
    label,
    bounds: navigationBoundsSchema.optional(),
  })
  .strict();
const controlSchemaNavigation = z
  .object({
    reference: navigationControlReferenceSchema,
    role: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9-]*$/),
    label,
    kind: controlSchema.shape.kind,
    risk: controlSchema.shape.risk,
    eligible: z.boolean(),
    visible: z.boolean(),
    enabled: z.boolean(),
    occluded: z.boolean(),
    inViewport: z.boolean(),
    regionId: opaqueId.optional(),
    bounds: navigationBoundsSchema.optional(),
    revealIds: z.array(controlId.max(100)).max(10),
  })
  .strict();

const captureSourceSchema = z
  .object({
    kind: z.enum(["viewport", "crop"]),
    cssBounds: navigationBoundsSchema,
    pixelBounds: z
      .object({
        x: generation,
        y: generation,
        width: z.number().int().positive().max(65536),
        height: z.number().int().positive().max(65536),
      })
      .strict(),
    bitmapWidth: z.number().int().positive().max(65536),
    bitmapHeight: z.number().int().positive().max(65536),
    scaleX: scale,
    scaleY: scale,
    devicePixelRatio: scale,
    browserZoom: scale,
  })
  .strict();
const imageSchema = z
  .object({
    captureId: z.string().uuid(),
    stamp: navigationStampSchema,
    native: nativeBrowserReferenceSchema,
    capturedAtMs: clock,
    maskedAtMs: clock,
    source: captureSourceSchema,
    width: z.number().int().positive().max(NAVIGATION_LIMITS.maxImageDimension),
    height: z
      .number()
      .int()
      .positive()
      .max(NAVIGATION_LIMITS.maxImageDimension),
    image: z
      .string()
      .min(1)
      .max(4 * Math.ceil(NAVIGATION_LIMITS.maxImageBytes / 3)),
    masking: z
      .object({
        version: z.literal(1),
        complete: z.literal(true),
        maskedBeforeTransform: z.literal(true),
        maskedRegions: generation.max(5000),
      })
      .strict(),
  })
  .strict()
  .superRefine((image, context) => {
    try {
      const inspected = inspectPngData(image.image, {
        maxBytes: NAVIGATION_LIMITS.maxImageBytes,
        maxPixels: NAVIGATION_LIMITS.maxImagePixels,
      });
      if (inspected.width !== image.width || inspected.height !== image.height)
        context.addIssue({
          code: "custom",
          message: "PNG dimensions mismatch.",
        });
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid bounded PNG capture.",
      });
    }
  });

const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const nativeKey = (reference: NativeBrowserReference) =>
  JSON.stringify([
    reference.windowId,
    reference.tabId,
    reference.frameId,
    reference.documentId,
  ]);
const controlKey = (reference: NavigationControlReference) =>
  JSON.stringify([nativeKey(reference), reference.controlId]);
const sameStamp = (a: NavigationStamp, b: NavigationStamp) =>
  (Object.keys(navigationStampSchema.shape) as (keyof NavigationStamp)[]).every(
    (key) => a[key] === b[key],
  );
const close = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(0.000001, Math.abs(b) * 0.000001);

/** Geometry and captures are ephemeral; this is not a persisted page schema. */
export const navigationObservationSchema = z
  .object({
    protocol: z.literal(NAVIGATION_PROTOCOL),
    version: z.literal(NAVIGATION_CONTRACT_VERSION),
    stamp: navigationStampSchema,
    native: nativeBrowserReferenceSchema,
    observedAtMs: clock,
    deadlineAtMs: clock,
    frames: z.array(frameSchema).min(1).max(NAVIGATION_LIMITS.maxFrames),
    regions: z.array(regionSchema).max(NAVIGATION_LIMITS.maxRegions),
    controls: z
      .array(controlSchemaNavigation)
      .max(NAVIGATION_LIMITS.maxControls),
    omissions: z
      .object({
        frames: generation,
        regions: generation,
        controls: generation,
        reasons: z
          .array(
            z.enum([
              "budget",
              "inaccessible-frame",
              "privacy",
              "unsupported",
              "not-eligible",
              "partial-scan",
            ]),
          )
          .max(6),
      })
      .strict(),
    context: navigationContextSchema,
    images: z.array(imageSchema).max(NAVIGATION_LIMITS.maxImages),
  })
  .strict()
  .superRefine((observation, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      observation.deadlineAtMs <= observation.observedAtMs ||
      observation.deadlineAtMs - observation.observedAtMs >
        NAVIGATION_LIMITS.maxLifetimeMs
    )
      fail("Invalid client observation lifetime.");
    const frames = new Map(
      observation.frames.map((frame) => [frame.native.frameId, frame]),
    );
    if (frames.size !== observation.frames.length) fail("Duplicate frame.");
    const root = frames.get(observation.native.frameId);
    if (
      observation.native.frameId !== 0 ||
      !root ||
      nativeKey(root.native) !== nativeKey(observation.native) ||
      root.parentFrameId !== undefined
    )
      fail("The observed native root must be present.");
    for (const frame of observation.frames) {
      if (
        frame.native.windowId !== observation.native.windowId ||
        frame.native.tabId !== observation.native.tabId
      )
        fail("Frames must belong to the pinned native tab and window.");
      const visited = new Set<number>();
      let current: typeof frame | undefined = frame;
      while (current) {
        if (visited.has(current.native.frameId)) {
          fail("Frame hierarchy must be acyclic.");
          break;
        }
        visited.add(current.native.frameId);
        if (current.parentFrameId === undefined) {
          if (current.native.frameId !== observation.native.frameId)
            fail("Every frame must descend from the native root.");
          break;
        }
        const parent = frames.get(current.parentFrameId);
        if (!parent) fail("Unknown parent frame.");
        current = parent;
      }
    }
    const regions = new Map(
      observation.regions.map((region) => [region.id, region]),
    );
    if (regions.size !== observation.regions.length) fail("Duplicate region.");
    for (const region of observation.regions) {
      if (!frames.has(region.frameId)) fail("Unknown region frame.");
      const visited = new Set<string>();
      let current: typeof region | undefined = region;
      while (current) {
        if (visited.has(current.id)) {
          fail("Region hierarchy must be acyclic.");
          break;
        }
        visited.add(current.id);
        if (!current.parentId) break;
        const parent = regions.get(current.parentId);
        if (!parent || parent.frameId !== region.frameId)
          fail("Unknown or cross-frame parent region.");
        current = parent;
      }
    }
    const controls = new Map(
      observation.controls.map((control) => [
        controlKey(control.reference),
        control,
      ]),
    );
    if (controls.size !== observation.controls.length)
      fail("Duplicate control.");
    for (const control of observation.controls) {
      const frame = frames.get(control.reference.frameId);
      if (!frame || nativeKey(frame.native) !== nativeKey(control.reference))
        fail("Control native identity must match its observed frame.");
      if (control.regionId) {
        const region = regions.get(control.regionId);
        if (!region || region.frameId !== control.reference.frameId)
          fail("Unknown or cross-frame control region.");
      }
      if (new Set(control.revealIds).size !== control.revealIds.length)
        fail("Duplicate opener reference.");
      for (const id of control.revealIds)
        if (
          id === control.reference.controlId ||
          !controls.has(controlKey({ ...control.reference, controlId: id }))
        )
          fail("Opener references must resolve in the same observed frame.");
    }
    const opened = new Set<string>();
    const pending = new Set<string>();
    const visit = (key: string): void => {
      if (pending.has(key)) {
        fail("Opener dependencies must be acyclic.");
        return;
      }
      if (opened.has(key)) return;
      const control = controls.get(key);
      if (!control) return;
      pending.add(key);
      for (const id of control.revealIds)
        visit(controlKey({ ...control.reference, controlId: id }));
      pending.delete(key);
      opened.add(key);
    };
    for (const key of controls.keys()) visit(key);
    if (
      new Set(observation.omissions.reasons).size !==
      observation.omissions.reasons.length
    )
      fail("Omission reasons must be distinct.");
    for (const image of observation.images) {
      if (
        !sameStamp(image.stamp, observation.stamp) ||
        nativeKey(image.native) !== nativeKey(observation.native)
      )
        fail("Capture must match the complete current observation stamp.");
      if (
        image.capturedAtMs > image.maskedAtMs ||
        image.maskedAtMs > observation.observedAtMs ||
        observation.deadlineAtMs - image.capturedAtMs >
          NAVIGATION_LIMITS.maxLifetimeMs
      )
        fail("Invalid client capture timestamps.");
      if (!root) continue;
      const viewport = root.viewport;
      const visual = viewport.visualViewport;
      const source = image.source;
      const css = source.cssBounds;
      const pixels = source.pixelBounds;
      if (
        css.x < visual.offsetLeft ||
        css.y < visual.offsetTop ||
        css.x + css.width > visual.offsetLeft + visual.width ||
        css.y + css.height > visual.offsetTop + visual.height ||
        pixels.x + pixels.width > source.bitmapWidth ||
        pixels.y + pixels.height > source.bitmapHeight ||
        !close(source.scaleX, source.bitmapWidth / visual.width) ||
        !close(source.scaleY, source.bitmapHeight / visual.height) ||
        !close(source.devicePixelRatio, viewport.devicePixelRatio) ||
        !close(source.browserZoom, viewport.browserZoom) ||
        Math.abs(pixels.x - (css.x - visual.offsetLeft) * source.scaleX) > 1 ||
        Math.abs(pixels.y - (css.y - visual.offsetTop) * source.scaleY) > 1 ||
        Math.abs(pixels.width - css.width * source.scaleX) > 1 ||
        Math.abs(pixels.height - css.height * source.scaleY) > 1 ||
        image.width > pixels.width ||
        image.height > pixels.height ||
        Math.abs(image.height - (image.width * pixels.height) / pixels.width) >
          2 ||
        Math.abs(image.width - (image.height * pixels.width) / pixels.height) >
          2
      )
        fail(
          "Capture pixel and CSS geometry must match the observed viewport.",
        );
      if (
        source.kind === "viewport" &&
        (css.x !== visual.offsetLeft ||
          css.y !== visual.offsetTop ||
          css.width !== visual.width ||
          css.height !== visual.height)
      )
        fail("Viewport captures must cover the complete CSS viewport.");
    }
    const structure = {
      ...observation,
      images: observation.images.map((image) => ({ ...image, image: "" })),
    };
    if (bytes(structure) > NAVIGATION_LIMITS.maxProjectionBytes)
      fail("Model projection exceeds its UTF-8 byte budget.");
    if (bytes(observation) > NAVIGATION_LIMITS.maxEnvelopeBytes)
      fail("Observation exceeds its encoded envelope budget.");
  });

const serverTimingSchema = z
  .object({ generatedAtMs: clock, expiresAtMs: clock })
  .strict()
  .refine(
    (value) =>
      value.expiresAtMs > value.generatedAtMs &&
      value.expiresAtMs - value.generatedAtMs <=
        NAVIGATION_LIMITS.maxLifetimeMs,
    "Invalid independent server lifetime.",
  );
export const navigationDecisionSchema = z
  .object({
    protocol: z.literal(NAVIGATION_PROTOCOL),
    version: z.literal(NAVIGATION_CONTRACT_VERSION),
    stamp: navigationStampSchema,
    native: nativeBrowserReferenceSchema,
    serverTiming: serverTimingSchema.optional(),
    decision: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("guide"),
          reference: navigationControlReferenceSchema,
          message: label,
        })
        .strict(),
      z
        .object({
          kind: z.literal("request-observation"),
          reason: z.enum(["layout", "controls", "visual", "freshness"]),
          message: label,
          regionId: opaqueId.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("clarify"),
          question: label,
          choices: z
            .array(z.object({ id: opaqueId, label }).strict())
            .min(2)
            .max(3)
            .optional(),
        })
        .strict(),
      z.object({ kind: z.literal("unsupported"), reason: label }).strict(),
    ]),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.decision.kind === "clarify" &&
      response.decision.choices &&
      new Set(response.decision.choices.map((choice) => choice.id)).size !==
        response.decision.choices.length
    )
      context.addIssue({
        code: "custom",
        message: "Choice IDs must be distinct.",
      });
  });

export type NavigationStamp = z.infer<typeof navigationStampSchema>;
export type NativeBrowserReference = z.infer<
  typeof nativeBrowserReferenceSchema
>;
export type NavigationControlReference = z.infer<
  typeof navigationControlReferenceSchema
>;
export type NavigationViewport = z.infer<typeof navigationViewportSchema>;
export type NavigationContext = z.infer<typeof navigationContextSchema>;
export type NavigationObservation = z.infer<typeof navigationObservationSchema>;
export type NavigationDecision = z.infer<typeof navigationDecisionSchema>;

const validationContextSchema = z
  .object({
    currentStamp: navigationStampSchema,
    currentNative: nativeBrowserReferenceSchema,
    nowMs: clock,
    requestStartedAtMs: clock,
    requestDeadlineMs: clock,
    serverNowMs: clock.optional(),
  })
  .strict();
export type NavigationValidationContext = z.infer<
  typeof validationContextSchema
>;
export type NavigationJoinResult =
  | {
      accepted: true;
      decision: NavigationDecision;
      control?: NavigationObservation["controls"][number];
    }
  | {
      accepted: false;
      reason:
        | "INVALID_OBSERVATION"
        | "INVALID_DECISION"
        | "INVALID_CONTEXT"
        | "STALE_CONTEXT"
        | "EXPIRED"
        | "UNKNOWN_REFERENCE"
        | "INELIGIBLE_REFERENCE";
    };

/** A proposal never changes local authority or establishes task completion. */
export function joinNavigationDecision(
  rawDecision: unknown,
  rawObservation: unknown,
  rawContext: NavigationValidationContext,
): NavigationJoinResult {
  const observed = navigationObservationSchema.safeParse(rawObservation);
  if (!observed.success)
    return { accepted: false, reason: "INVALID_OBSERVATION" };
  const proposed = navigationDecisionSchema.safeParse(rawDecision);
  if (!proposed.success) return { accepted: false, reason: "INVALID_DECISION" };
  const checked = validationContextSchema.safeParse(rawContext);
  if (!checked.success) return { accepted: false, reason: "INVALID_CONTEXT" };
  const observation = observed.data;
  const response = proposed.data;
  const context = checked.data;
  if (
    context.requestDeadlineMs <= context.requestStartedAtMs ||
    context.requestDeadlineMs - context.requestStartedAtMs >
      NAVIGATION_LIMITS.maxLifetimeMs ||
    context.nowMs < context.requestStartedAtMs ||
    context.nowMs < observation.observedAtMs
  )
    return { accepted: false, reason: "INVALID_CONTEXT" };
  if (
    !sameStamp(observation.stamp, context.currentStamp) ||
    !sameStamp(response.stamp, context.currentStamp) ||
    nativeKey(observation.native) !== nativeKey(context.currentNative) ||
    nativeKey(response.native) !== nativeKey(context.currentNative)
  )
    return { accepted: false, reason: "STALE_CONTEXT" };
  const timing = response.serverTiming;
  const deadline = Math.min(
    observation.deadlineAtMs,
    context.requestDeadlineMs,
    timing
      ? context.requestStartedAtMs + (timing.expiresAtMs - timing.generatedAtMs)
      : Infinity,
  );
  if (
    context.nowMs >= deadline ||
    (timing &&
      context.serverNowMs !== undefined &&
      (context.serverNowMs < timing.generatedAtMs ||
        context.serverNowMs >= timing.expiresAtMs))
  )
    return { accepted: false, reason: "EXPIRED" };
  const decision = response.decision;
  if (decision.kind === "guide") {
    const control = observation.controls.find(
      (candidate) =>
        controlKey(candidate.reference) === controlKey(decision.reference),
    );
    if (!control) return { accepted: false, reason: "UNKNOWN_REFERENCE" };
    if (
      !control.eligible ||
      !control.visible ||
      !control.enabled ||
      control.occluded ||
      control.risk !== "ordinary"
    )
      return { accepted: false, reason: "INELIGIBLE_REFERENCE" };
    return { accepted: true, decision: response, control };
  }
  if (
    decision.kind === "request-observation" &&
    decision.regionId &&
    !observation.regions.some((region) => region.id === decision.regionId)
  )
    return { accepted: false, reason: "UNKNOWN_REFERENCE" };
  return { accepted: true, decision: response };
}
