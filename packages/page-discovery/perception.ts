import { z } from "zod";
import { controlId } from "../page-model";
import {
  nativeBrowserReferenceSchema,
  navigationBoundsSchema,
  navigationControlReferenceSchema,
  navigationFrameSchema,
  navigationRegionSchema,
  navigationDomViewportSchema,
  navigationControlKey,
  nativeReferenceKey,
} from "../navigation-core/contracts-navigation";

export const DISCOVERY_PERCEPTION_VERSION = 1;
export const PERCEPTION_LIMITS = Object.freeze({
  regions: 100,
  controls: 600,
  frames: 16,
  coverage: 100,
  ancestorDepth: 16,
  ancestorWalkDepth: 64,
});
const count = z.number().int().nonnegative().safe();
const reasons = z
  .array(
    z.enum([
      "budget",
      "inaccessible-frame",
      "privacy",
      "unsupported",
      "not-eligible",
      "partial-scan",
      "ambiguous-control",
    ]),
  )
  .max(7);
export const discoveryOmissionsSchema = z
  .object({
    regions: count,
    controlRegions: count,
    hierarchyTruncated: z.boolean(),
    partial: z.boolean(),
    reasons,
  })
  .strict();
export const perceptionOmissionsSchema = z
  .object({
    frames: count,
    regions: count,
    controls: count,
    hierarchyTruncated: z.boolean(),
    partial: z.boolean(),
    reasons,
  })
  .strict();
const localRegionSchema = navigationRegionSchema.omit({ frameId: true });
const localControlSchema = z
  .object({
    controlId: controlId.max(100),
    regionId: navigationRegionSchema.shape.id.optional(),
    bounds: navigationBoundsSchema.optional(),
  })
  .strict();

export const regionObservationRequestSchema = z
  .object({
    native: nativeBrowserReferenceSchema,
    scanId: z.string().uuid(),
    pageRevision: count,
    regionId: navigationRegionSchema.shape.id,
  })
  .strict();
export type RegionObservationRequest = z.infer<
  typeof regionObservationRequestSchema
>;

function checkRegions(
  regions: { id: string; parentId?: string; frameId?: number }[],
  controls: { regionId?: string }[],
  context: z.RefinementCtx,
) {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const fail = (message: string) =>
    context.addIssue({ code: "custom", message });
  if (byId.size !== regions.length) fail("Duplicate region identity.");
  for (const region of regions) {
    const visited = new Set<string>();
    let current: typeof region | undefined = region;
    while (current) {
      if (
        visited.has(current.id) ||
        visited.size >= PERCEPTION_LIMITS.ancestorDepth
      ) {
        fail("Region hierarchy is cyclic or exceeds its bound.");
        break;
      }
      visited.add(current.id);
      if (!current.parentId) break;
      const parent = byId.get(current.parentId);
      if (!parent || parent.frameId !== current.frameId) {
        fail("Region parent must be retained in the same frame.");
        break;
      }
      current = parent;
    }
  }
  for (const control of controls)
    if (control.regionId && !byId.has(control.regionId))
      fail("Control region must be retained.");
}

/** Ephemeral DOM evidence, without privileged browser identity or zoom claims. */
export const discoveryPerceptionSchema = z
  .object({
    version: z.literal(DISCOVERY_PERCEPTION_VERSION),
    scanId: z.string().uuid(),
    pageRevision: count,
    viewport: navigationDomViewportSchema,
    regions: z.array(localRegionSchema).max(PERCEPTION_LIMITS.regions),
    controls: z.array(localControlSchema).max(PERCEPTION_LIMITS.controls),
    omissions: discoveryOmissionsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.controls.map((control) => control.controlId)).size !==
      value.controls.length
    )
      context.addIssue({
        code: "custom",
        message: "Duplicate control identity.",
      });
    checkRegions(value.regions, value.controls, context);
  });

/** The background binds actual native frame identities and browser zoom. */
export const browserPerceptionSchema = z
  .object({
    version: z.literal(DISCOVERY_PERCEPTION_VERSION),
    pageRevision: count,
    native: nativeBrowserReferenceSchema,
    frames: z
      .array(
        navigationFrameSchema
          .extend({
            scanId: z.string().uuid(),
            pageRevision: count,
          })
          .strict(),
      )
      .min(1)
      .max(PERCEPTION_LIMITS.frames),
    regions: z.array(navigationRegionSchema).max(PERCEPTION_LIMITS.regions),
    controlRegions: z
      .array(
        z
          .object({
            reference: navigationControlReferenceSchema,
            regionId: navigationRegionSchema.shape.id.optional(),
            bounds: navigationBoundsSchema.optional(),
          })
          .strict(),
      )
      .max(PERCEPTION_LIMITS.controls),
    coverage: z
      .array(
        discoveryOmissionsSchema
          .extend({
            frameId: count,
            indexedControls: count.nullable(),
            snapshotControls: count,
          })
          .strict(),
      )
      .max(PERCEPTION_LIMITS.coverage),
    omissions: perceptionOmissionsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: "custom", message });
    const frames = new Map(
      value.frames.map((frame) => [frame.native.frameId, frame]),
    );
    if (frames.size !== value.frames.length) fail("Duplicate native frame.");
    const root = frames.get(0);
    if (
      value.native.frameId !== 0 ||
      !root ||
      root.parentFrameId !== undefined ||
      nativeReferenceKey(root.native) !== nativeReferenceKey(value.native)
    )
      fail("The pinned native root must be present.");
    for (const frame of value.frames) {
      if (
        frame.native.tabId !== value.native.tabId ||
        frame.native.windowId !== value.native.windowId
      )
        fail("Frames must belong to the pinned tab and window.");
      const visited = new Set<number>();
      let current: typeof frame | undefined = frame;
      while (current && current.native.frameId !== 0) {
        if (
          visited.has(current.native.frameId) ||
          current.parentFrameId === undefined
        ) {
          fail("Frame ancestry must be complete and acyclic.");
          break;
        }
        visited.add(current.native.frameId);
        current = frames.get(current.parentFrameId);
        if (!current) fail("Frame parent must be retained.");
      }
    }
    const references = new Set<string>();
    for (const control of value.controlRegions) {
      const frame = frames.get(control.reference.frameId);
      if (
        !frame ||
        nativeReferenceKey(frame.native) !==
          nativeReferenceKey(control.reference)
      )
        fail("Control must reference a current native frame.");
      const key = navigationControlKey(control.reference);
      if (references.has(key)) fail("Duplicate native control reference.");
      references.add(key);
      const region = value.regions.find(
        (region) => region.id === control.regionId,
      );
      if (region && region.frameId !== control.reference.frameId)
        fail("Control region must belong to its native frame.");
    }
    if (value.regions.some((region) => !frames.has(region.frameId)))
      fail("Region must belong to a retained native frame.");
    checkRegions(value.regions, value.controlRegions, context);
    const covered = new Set(value.coverage.map((coverage) => coverage.frameId));
    if (
      covered.size !== value.coverage.length ||
      covered.size !== frames.size ||
      [...covered].some((frameId) => !frames.has(frameId))
    )
      fail("Coverage must describe each retained frame exactly once.");
  });

export type DiscoveryPerception = z.infer<typeof discoveryPerceptionSchema>;
export type BrowserPerception = z.infer<typeof browserPerceptionSchema>;
/** Assembly only. Each nested observation is validated before native binding. */
export interface ComposedDiscoveryPerception {
  pageRevision: number;
  root: DiscoveryPerception;
  frames: {
    frameId: number;
    parentFrameId: number;
    documentId: string;
    perception: DiscoveryPerception;
  }[];
  coverage: BrowserPerception["coverage"];
  omissions: BrowserPerception["omissions"];
}
