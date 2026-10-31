import { z } from "zod";
import { controlId, controlSchema, progressSchema } from "../page-model";
import { sanitizeGoal, sanitizeText } from "../privacy-redaction";
import { inspectPngData } from "../vision/png";
import {
  SERVICE_LIMITS,
  serviceErrorCodeSchema,
  serviceRequestPolicySchema,
  serviceRequestStatusSchema,
} from "./contracts-service";

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
export const navigationViewportObjectSchema = z
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
  .strict();
function refineViewport(
  viewport: Pick<
    z.infer<typeof navigationViewportObjectSchema>,
    "width" | "height" | "scrollX" | "scrollY" | "visualViewport"
  >,
  context: z.RefinementCtx,
) {
  const visual = viewport.visualViewport;
  const fits = (edge: number, layout: number) =>
    edge <= layout || (Number.isInteger(layout) && edge - layout <= 0.5);
  if (
    visual.offsetLeft < 0 ||
    visual.offsetTop < 0 ||
    !fits(visual.offsetLeft + visual.width, viewport.width) ||
    !fits(visual.offsetTop + visual.height, viewport.height) ||
    !close(visual.pageLeft, viewport.scrollX + visual.offsetLeft) ||
    !close(visual.pageTop, viewport.scrollY + visual.offsetTop)
  )
    context.addIssue({
      code: "custom",
      message: "Visual viewport must match layout and document coordinates.",
    });
}
export const navigationViewportSchema =
  navigationViewportObjectSchema.superRefine(refineViewport);
/** DOM observations cannot assert privileged browser zoom. */
export const navigationDomViewportSchema = navigationViewportObjectSchema
  .omit({ browserZoom: true })
  .superRefine(refineViewport);
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

export const navigationFrameSchema = z
  .object({
    native: nativeBrowserReferenceSchema,
    parentFrameId: generation.optional(),
    viewport: navigationViewportSchema,
  })
  .strict();
export const navigationScrollSchema = z
  .object({
    horizontal: z.boolean(),
    vertical: z.boolean(),
    left: coordinate,
    top: coordinate,
    clientWidth: positive,
    clientHeight: positive,
    scrollWidth: positive,
    scrollHeight: positive,
  })
  .strict()
  .refine(
    (value) =>
      (value.horizontal || value.vertical) &&
      (!value.horizontal || value.scrollWidth > value.clientWidth) &&
      (!value.vertical || value.scrollHeight > value.clientHeight),
    "Scroll evidence requires an observed overflowing axis.",
  );
export const navigationRegionSchema = z
  .object({
    id: opaqueId,
    frameId: generation,
    parentId: opaqueId.optional(),
    role: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9-]*$/),
    label: label.optional(),
    bounds: navigationBoundsSchema.optional(),
    scroll: navigationScrollSchema.optional(),
  })
  .strict();
export const navigationControlSchema = z
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
    description: label.optional(),
    context: label.optional(),
    scope: controlSchema.shape.scope,
    popup: controlSchema.shape.popup,
    placement: controlSchema.shape.placement,
    checked: controlSchema.shape.checked,
    selected: controlSchema.shape.selected,
    expanded: controlSchema.shape.expanded,
    options: z
      .array(
        z
          .object({ label, selected: z.boolean(), enabled: z.boolean() })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export const navigationCaptureSourceSchema = z
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
    captureCssBounds: navigationBoundsSchema.optional(),
  })
  .strict();
export const navigationImagePixelsObjectSchema = z
  .object({
    maskedAtMs: clock,
    source: navigationCaptureSourceSchema,
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
  .strict();
/** Shared PNG admission for prepared pixels and complete stamped images. */
export function refineNavigationImagePixels(
  image: z.infer<typeof navigationImagePixelsObjectSchema>,
  context: z.RefinementCtx,
) {
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
}
const imageSchema = navigationImagePixelsObjectSchema
  .extend({
    captureId: z.string().uuid(),
    stamp: navigationStampSchema,
    native: nativeBrowserReferenceSchema,
    capturedAtMs: clock,
  })
  .strict()
  .superRefine(refineNavigationImagePixels);

const encoder = new TextEncoder();
export const serializedUtf8Bytes = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).length;
export const nativeReferenceKey = (reference: NativeBrowserReference) =>
  JSON.stringify([
    reference.windowId,
    reference.tabId,
    reference.frameId,
    reference.documentId,
  ]);
export const navigationControlKey = (reference: NavigationControlReference) =>
  JSON.stringify([nativeReferenceKey(reference), reference.controlId]);
/** Image provenance remains structural input; only PNG bytes are separate. */
export function navigationProjectionBytes(value: {
  images: readonly { image: string }[];
}) {
  return serializedUtf8Bytes({
    ...value,
    images: value.images.map((image) => ({ ...image, image: "" })),
  });
}
/** Union of observed CSS extents, without replacing either raw measurement. */
export function navigationViewportExtent(
  viewport: Pick<NavigationViewport, "width" | "height" | "visualViewport">,
) {
  return {
    width: Math.max(
      viewport.width,
      viewport.visualViewport.offsetLeft + viewport.visualViewport.width,
    ),
    height: Math.max(
      viewport.height,
      viewport.visualViewport.offsetTop + viewport.visualViewport.height,
    ),
  };
}
const sameStamp = (a: NavigationStamp, b: NavigationStamp) =>
  (Object.keys(navigationStampSchema.shape) as (keyof NavigationStamp)[]).every(
    (key) => a[key] === b[key],
  );
const close = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(0.000001, Math.abs(b) * 0.000001);

/** The same source-plane check applies before stamping and at Nav1 admission. */
export function navigationImageMatchesViewport(
  image: z.infer<typeof navigationImagePixelsObjectSchema>,
  viewport: NavigationViewport,
): boolean {
  const visual = viewport.visualViewport,
    source = image.source;
  const css = source.cssBounds,
    pixels = source.pixelBounds;
  const plane = source.captureCssBounds || {
    x: visual.offsetLeft,
    y: visual.offsetTop,
    width: visual.width,
    height: visual.height,
  };
  return (
    (!source.captureCssBounds ||
      (plane.x === 0 &&
        plane.y === 0 &&
        plane.width === viewport.width &&
        plane.height === viewport.height)) &&
    css.x >= visual.offsetLeft &&
    css.y >= visual.offsetTop &&
    css.x + css.width <= visual.offsetLeft + visual.width &&
    css.y + css.height <= visual.offsetTop + visual.height &&
    pixels.x + pixels.width <= source.bitmapWidth &&
    pixels.y + pixels.height <= source.bitmapHeight &&
    close(source.scaleX, source.bitmapWidth / plane.width) &&
    close(source.scaleY, source.bitmapHeight / plane.height) &&
    close(source.devicePixelRatio, viewport.devicePixelRatio) &&
    close(source.browserZoom, viewport.browserZoom) &&
    Math.abs(pixels.x - (css.x - plane.x) * source.scaleX) <= 1 &&
    Math.abs(pixels.y - (css.y - plane.y) * source.scaleY) <= 1 &&
    Math.abs(pixels.width - css.width * source.scaleX) <= 1 &&
    Math.abs(pixels.height - css.height * source.scaleY) <= 1 &&
    image.width <= pixels.width &&
    image.height <= pixels.height &&
    Math.abs(image.height - (image.width * pixels.height) / pixels.width) <=
      2 &&
    Math.abs(image.width - (image.height * pixels.width) / pixels.height) <=
      2 &&
    (source.kind !== "viewport" ||
      (css.x === visual.offsetLeft &&
        css.y === visual.offsetTop &&
        css.width === visual.width &&
        css.height === visual.height))
  );
}

/** Geometry and captures are ephemeral; this is not a persisted page schema. */
export const navigationObservationSchema = z
  .object({
    protocol: z.literal(NAVIGATION_PROTOCOL),
    version: z.literal(NAVIGATION_CONTRACT_VERSION),
    stamp: navigationStampSchema,
    native: nativeBrowserReferenceSchema,
    observedAtMs: clock,
    deadlineAtMs: clock,
    frames: z
      .array(navigationFrameSchema)
      .min(1)
      .max(NAVIGATION_LIMITS.maxFrames),
    regions: z.array(navigationRegionSchema).max(NAVIGATION_LIMITS.maxRegions),
    controls: z
      .array(navigationControlSchema)
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
      nativeReferenceKey(root.native) !==
        nativeReferenceKey(observation.native) ||
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
        navigationControlKey(control.reference),
        control,
      ]),
    );
    if (controls.size !== observation.controls.length)
      fail("Duplicate control.");
    for (const control of observation.controls) {
      const frame = frames.get(control.reference.frameId);
      if (
        !frame ||
        nativeReferenceKey(frame.native) !==
          nativeReferenceKey(control.reference)
      )
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
          !controls.has(
            navigationControlKey({ ...control.reference, controlId: id }),
          )
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
        visit(navigationControlKey({ ...control.reference, controlId: id }));
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
        nativeReferenceKey(image.native) !==
          nativeReferenceKey(observation.native)
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
      if (!navigationImageMatchesViewport(image, root.viewport))
        fail(
          "Capture pixel and CSS geometry must match the observed viewport.",
        );
    }
    if (
      navigationProjectionBytes(observation) >
      NAVIGATION_LIMITS.maxProjectionBytes
    )
      fail("Model projection exceeds its UTF-8 byte budget.");
    if (serializedUtf8Bytes(observation) > NAVIGATION_LIMITS.maxEnvelopeBytes)
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
export const navigationProposalSchema = z
  .discriminatedUnion("kind", [
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
  ])
  .superRefine((proposal, context) => {
    if (
      proposal.kind === "clarify" &&
      proposal.choices &&
      new Set(proposal.choices.map((choice) => choice.id)).size !==
        proposal.choices.length
    )
      context.addIssue({
        code: "custom",
        message: "Choice IDs must be distinct.",
      });
  });
export type NavigationProposal = z.infer<typeof navigationProposalSchema>;
export const navigationDecisionSchema = z
  .object({
    protocol: z.literal(NAVIGATION_PROTOCOL),
    version: z.literal(NAVIGATION_CONTRACT_VERSION),
    stamp: navigationStampSchema,
    native: nativeBrowserReferenceSchema,
    serverTiming: serverTimingSchema.optional(),
    decision: navigationProposalSchema,
  })
  .strict();

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

/** Transient processing metadata, never a capture, saved route or arrival proof. */
export const navigationServiceStateSchema = z
  .object({
    profile: z.literal("fake"),
    requestId: z.string().uuid(),
    state: z.enum(["pending", "guiding", "clarify", "unsupported", "error"]),
    message: label.optional(),
    code: serviceErrorCodeSchema.optional(),
  })
  .strict();
export type NavigationServiceState = z.infer<
  typeof navigationServiceStateSchema
>;

export const navigationValidationContextSchema = z
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
  typeof navigationValidationContextSchema
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

function rejectNavigationContext(
  observation: NavigationObservation,
  context: NavigationValidationContext,
  response?: NavigationDecision,
): Extract<NavigationJoinResult, { accepted: false }> | undefined {
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
    (response && !sameStamp(response.stamp, context.currentStamp)) ||
    nativeReferenceKey(observation.native) !==
      nativeReferenceKey(context.currentNative) ||
    (response &&
      nativeReferenceKey(response.native) !==
        nativeReferenceKey(context.currentNative))
  )
    return { accepted: false, reason: "STALE_CONTEXT" };
  const timing = response?.serverTiming;
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
}

/** Check actual submitted observation/context before incurring model work. */
export function validateNavigationObservationContext(
  rawObservation: unknown,
  rawContext: NavigationValidationContext,
):
  | {
      accepted: true;
      observation: NavigationObservation;
      context: NavigationValidationContext;
    }
  | Extract<NavigationJoinResult, { accepted: false }> {
  const observed = navigationObservationSchema.safeParse(rawObservation);
  if (!observed.success)
    return { accepted: false, reason: "INVALID_OBSERVATION" };
  const checked = navigationValidationContextSchema.safeParse(rawContext);
  if (!checked.success) return { accepted: false, reason: "INVALID_CONTEXT" };
  return (
    rejectNavigationContext(observed.data, checked.data) || {
      accepted: true,
      observation: observed.data,
      context: checked.data,
    }
  );
}

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
  const checked = navigationValidationContextSchema.safeParse(rawContext);
  if (!checked.success) return { accepted: false, reason: "INVALID_CONTEXT" };
  const observation = observed.data,
    response = proposed.data;
  const rejected = rejectNavigationContext(observation, checked.data, response);
  if (rejected) return rejected;
  const decision = response.decision;
  if (decision.kind === "guide") {
    const control = observation.controls.find(
      (candidate) =>
        navigationControlKey(candidate.reference) ===
        navigationControlKey(decision.reference),
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

export const NAVIGATION_TRANSPORT_CAPABILITY = "navigation-decisions";
export const NAVIGATION_FAKE_CAPABILITY = "fake-navigation-model";
export const NAVIGATION_TRANSPORT_OPERATION = "navigation-decisions.v1";
export const NAVIGATION_TRANSPORT_LIMITS = Object.freeze({
  maxBodyBytes: NAVIGATION_LIMITS.maxEnvelopeBytes,
  maxResponseBytes: 32768,
});

/** The caller's clock and original identities are never replaced by server time. */
export const navigationTransportInputSchema = z
  .object({
    requestId: z.string().uuid(),
    profile: z.literal("fake"),
    observation: navigationObservationSchema,
    validation: navigationValidationContextSchema,
    policy: serviceRequestPolicySchema.default({}),
  })
  .strict();
export type NavigationTransportInput = z.infer<
  typeof navigationTransportInputSchema
>;

export const navigationRequestStatusSchema = z
  .object({
    requestId: z.string().uuid(),
    status: serviceRequestStatusSchema,
  })
  .strict();
export type NavigationRequestStatus = z.infer<
  typeof navigationRequestStatusSchema
>;

/** Replays acknowledge owned work; they never restart inference or cache page data. */
export const navigationTransportResponseSchema = navigationRequestStatusSchema
  .extend({
    replayed: z.boolean(),
    decision: navigationDecisionSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      (response.decision !== undefined &&
        (response.status !== "completed" || response.replayed)) ||
      (!response.replayed &&
        (response.status !== "completed" || response.decision === undefined))
    )
      context.addIssue({
        code: "custom",
        message: "Only the original completed request may return a proposal.",
      });
  });
export type NavigationTransportResponse = z.infer<
  typeof navigationTransportResponseSchema
>;

/** Acknowledged intent does not prove that a provider stopped or charged nothing. */
export const navigationCancellationSchema = navigationRequestStatusSchema
  .extend({
    cancelRequested: z.boolean(),
    cancellationConfirmed: z.literal(false),
  })
  .strict();
export type NavigationCancellation = z.infer<
  typeof navigationCancellationSchema
>;
