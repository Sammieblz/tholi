import {
  navigationModelCapture as capture,
  navigationModelObservation as observation,
  navigationModelValidation as context,
} from "../../support/navigation-model-fixture";
import { afterEach, expect, test, vi } from "vitest";
import {
  buildModelProjection,
  buildNavigationObservation,
} from "../../../packages/goal-planner/model-context";
import type { PageSnapshot } from "../../../packages/page-model";
import type { BrowserPerception } from "../../../packages/page-discovery/perception";
import {
  captureMetadataSchema,
  preparedNavigationPixelsSchema,
} from "../../../packages/vision/contracts";
import {
  NAVIGATION_CONTRACT_VERSION,
  NAVIGATION_LIMITS,
  NAVIGATION_PROTOCOL,
  joinNavigationDecision,
  navigationContextSchema,
  navigationCancellationSchema,
  navigationDecisionSchema,
  navigationTransportInputSchema,
  navigationTransportResponseSchema,
  navigationObservationSchema,
  navigationImageMatchesViewport,
  navigationViewportSchema,
  navigationDomViewportSchema,
  navigationViewportExtent,
  nativeBrowserReferenceSchema,
  navigationProjectionBytes,
  type NavigationDecision,
  type NavigationObservation,
} from "../../../packages/navigation-core/contracts-navigation";

afterEach(() => vi.unstubAllGlobals());

test("service inference keeps transport identity separate from the original browser stamps and deadline", () => {
  const observed = observation();
  const input = navigationTransportInputSchema.parse({
    requestId: "20000000-0000-4000-8000-000000000001",
    profile: "fake",
    observation: observed,
    validation: context(observed),
  });
  expect(input.requestId).not.toBe(input.observation.stamp.requestId);
  expect(input.observation.native).toEqual(observed.native);
  expect(input.validation.requestDeadlineMs).toBe(
    context(observed).requestDeadlineMs,
  );
  expect(input.policy.timeoutMs).toBe(NAVIGATION_LIMITS.maxLifetimeMs);
  for (const profile of [undefined, "vertex", "gemini"])
    expect(
      navigationTransportInputSchema.safeParse({ ...input, profile }).success,
    ).toBe(false);
});

test("only an original completed service request may carry a model proposal", () => {
  const observed = observation();
  const base = {
    requestId: "20000000-0000-4000-8000-000000000001",
    status: "completed",
  };
  expect(
    navigationTransportResponseSchema.safeParse({
      ...base,
      replayed: false,
      decision: decision(observed),
    }).success,
  ).toBe(true);
  expect(
    navigationTransportResponseSchema.safeParse({ ...base, replayed: true })
      .success,
  ).toBe(true);
  expect(
    navigationTransportResponseSchema.safeParse({
      ...base,
      replayed: true,
      decision: decision(observed),
    }).success,
  ).toBe(false);
  expect(
    navigationTransportResponseSchema.safeParse({
      ...base,
      status: "pending",
      replayed: false,
      decision: decision(observed),
    }).success,
  ).toBe(false);
  expect(
    navigationTransportResponseSchema.safeParse({ ...base, replayed: false })
      .success,
  ).toBe(false);
});

test("service cancellation acknowledges intent without claiming provider cancellation", () => {
  const response = {
    requestId: "20000000-0000-4000-8000-000000000001",
    status: "uncertain",
    cancelRequested: true,
    cancellationConfirmed: false,
  };
  expect(navigationCancellationSchema.safeParse(response).success).toBe(true);
  expect(
    navigationCancellationSchema.safeParse({
      ...response,
      cancellationConfirmed: true,
    }).success,
  ).toBe(false);
  expect(
    navigationCancellationSchema.safeParse({ ...response, costUsd: 0 }).success,
  ).toBe(false);
});

test("bounded integer CSSOM rounding retains raw viewport metrics and the entire visible mask band", () => {
  const viewport = {
    width: 955,
    height: 536,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 0.800000011920929,
    visualViewport: {
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      width: 936.25,
      height: 536.25,
      scale: 1,
    },
  };
  expect(navigationDomViewportSchema.parse(viewport)).toEqual(viewport);
  expect(
    navigationViewportSchema.parse({ ...viewport, browserZoom: 0.8 }),
  ).toEqual({ ...viewport, browserZoom: 0.8 });
  expect(navigationViewportExtent(viewport)).toEqual({
    width: 955,
    height: 536.25,
  });
  const metadata = {
    version: 1,
    captureId: "10000000-0000-4000-8000-000000000001",
    scanId: "10000000-0000-4000-8000-000000000002",
    observationRevision: 3,
    viewportRevision: 4,
    at: 100,
    viewport,
    masks: [{ x: 10, y: 536.05, width: 1, height: 0.15 }],
    masking: { version: 1, complete: true },
  };
  expect(captureMetadataSchema.parse(metadata)).toEqual(metadata);
  expect(
    captureMetadataSchema.safeParse({
      ...metadata,
      masks: [{ x: 10, y: 536.05, width: 1, height: 0.3 }],
    }).success,
  ).toBe(false);
  for (const [layout, visual] of [
    [536, 536.5],
    [536, 536.500001],
    [536.1, 536.25],
  ]) {
    const changed = {
      ...viewport,
      height: layout,
      visualViewport: { ...viewport.visualViewport, height: visual },
    };
    expect(navigationDomViewportSchema.safeParse(changed).success).toBe(
      layout === 536 && visual === 536.5,
    );
  }
});

function producerFixture() {
  const observed = observation();
  const controls = Array.from({ length: 3 }, (_, index) => ({
    id: `w0000000000000001-${index + 1}`,
    signature: `signature-${index}`,
    role: "button",
    label: `Preferences ${index}`,
    context: "Workspace",
    group: "Controls",
    kind: "action" as const,
    visible: true,
    enabled: true,
    inViewport: true,
    revealIds: [] as string[],
    risk: "ordinary" as const,
  }));
  const page: PageSnapshot = {
    origin: "https://public.example",
    path: "/workspace",
    pageKey: "page",
    stateKey: "state",
    templateKey: "template",
    fingerprint: "fingerprint",
    revision: 4,
    language: "en",
    layout: "wide",
    partial: false,
    indexedControls: controls.length,
    controls,
  };
  const regions: BrowserPerception["regions"] = controls.flatMap((_, index) =>
    Array.from({ length: 12 }, (_, depth) => ({
      id: `f0:region-${index}-${depth}`,
      frameId: 0,
      parentId: depth ? `f0:region-${index}-${depth - 1}` : undefined,
      role: depth ? "region" : "dialog",
      label: depth === 11 ? undefined : `Workspace ${index} area ${depth}`,
      ...(depth === 11
        ? {
            scroll: {
              horizontal: false,
              vertical: true,
              left: 0,
              top: 20,
              clientWidth: 250,
              clientHeight: 60,
              scrollWidth: 250,
              scrollHeight: 500,
            },
          }
        : {}),
    })),
  );
  const perception: BrowserPerception = {
    version: 1,
    pageRevision: page.revision,
    native: observed.native,
    frames: observed.frames.map((frame) => ({
      ...frame,
      scanId: "10000000-0000-4000-8000-000000000004",
      pageRevision: page.revision,
    })),
    regions,
    controlRegions: controls.map((control, index) => ({
      reference: { ...observed.native, controlId: control.id },
      regionId: `f0:region-${index}-11`,
      bounds: { x: 10, y: 10, width: 100, height: 20 },
    })),
    coverage: [
      {
        frameId: 0,
        indexedControls: controls.length,
        snapshotControls: controls.length,
        regions: 0,
        controlRegions: 0,
        hierarchyTruncated: false,
        partial: false,
        reasons: [],
      },
    ],
    omissions: {
      frames: 0,
      regions: 0,
      controls: 0,
      hierarchyTruncated: false,
      partial: false,
      reasons: [],
    },
  };
  return { observed, page, perception };
}

function legacyCompactionFixture() {
  const fixture = producerFixture();
  const { page, perception } = fixture;
  const main = "Navigation for the currently open workspace";
  const toolbar = "Tools for the current section and its preferences";
  const childNative = {
    ...perception.native,
    frameId: 9,
    documentId: "native:embedded-document",
  };
  perception.frames.push({
    ...perception.frames[0],
    native: childNative,
    parentFrameId: 0,
    scanId: "10000000-0000-4000-8000-000000000005",
  });
  perception.regions = [
    { id: "f0:main", frameId: 0, role: "main", label: main },
    {
      id: "f0:extra",
      frameId: 0,
      parentId: "f0:main",
      role: "section",
      label: "Additional enclosing section",
    },
    {
      id: "f0:toolbar",
      frameId: 0,
      parentId: "f0:extra",
      role: "toolbar",
      label: toolbar,
    },
    { id: "f9:main", frameId: 9, role: "main", label: main },
    {
      id: "f9:toolbar",
      frameId: 9,
      parentId: "f9:main",
      role: "toolbar",
      label: toolbar,
    },
  ];
  page.controls[0].structure = {
    regions: [
      { role: "main", name: main },
      { role: "toolbar", name: toolbar },
    ],
    headings: [{ level: 1, label: "Current workspace" }],
  };
  page.controls[1].structure = {
    regions: [{ role: "toolbar", name: toolbar }],
    headings: [{ level: 2, label: "Preferences group" }],
  };
  // The richer hierarchy can reach ancestors outside the legacy DOM cutoff.
  page.controls[2].structure = {
    regions: [],
    headings: [{ level: 3, label: "Current selection" }],
  };
  page.controls[1].reference = {
    tabId: childNative.tabId,
    frameId: childNative.frameId,
    documentId: childNative.documentId,
    controlId: page.controls[1].id,
  };
  perception.controlRegions = page.controls.map((control, index) => ({
    reference: {
      ...(index === 1 ? childNative : perception.native),
      controlId: control.id,
    },
    regionId: index === 1 ? "f9:toolbar" : "f0:toolbar",
  }));
  perception.coverage[0].indexedControls = 2;
  perception.coverage[0].snapshotControls = 2;
  perception.coverage.push({
    ...perception.coverage[0],
    frameId: 9,
    indexedControls: 1,
    snapshotControls: 1,
  });
  return fixture;
}

test("legacy compaction round-trips native identity and exact bounded region evidence for the same selected controls", () => {
  const { observed, page, perception } = legacyCompactionFixture();
  const { context, report } = buildModelProjection(
    page,
    "Workspace",
    undefined,
    perception,
  );
  expect(context.controls.map((control) => control.id).sort()).toEqual(
    page.controls.map((control) => control.id).sort(),
  );
  const restored = {
    ...context,
    controls: context.controls.map((control) => {
      const { frameId, ...remaining } = control;
      const frame = context.frames!.find(
        (frame) => frame.native.frameId === frameId,
      )!;
      const structure = control.structure!;
      const regions =
        "regionIds" in structure && structure.regionIds
          ? structure.regionIds.map((id) => {
              const region = context.regions!.find(
                (region) => region.id === id,
              )!;
              return { role: region.role, name: region.label || "" };
            })
          : structure.regions;
      return {
        ...remaining,
        reference: { ...frame.native, controlId: control.id },
        structure: { regions, headings: structure.headings },
      };
    }),
  };
  for (const control of restored.controls) {
    expect(control.reference).toEqual(
      perception.controlRegions.find(
        (entry) => entry.reference.controlId === control.id,
      )!.reference,
    );
    expect(control.structure).toEqual(
      page.controls.find((entry) => entry.id === control.id)!.structure,
    );
  }
  const root = context.controls.find(
    (control) => control.id === page.controls[0].id,
  )!;
  const child = context.controls.find(
    (control) => control.id === page.controls[1].id,
  )!;
  const outsideLegacyCutoff = context.controls.find(
    (control) => control.id === page.controls[2].id,
  )!;
  expect(root.frameId).toBe(0);
  expect(child.frameId).toBe(9);
  expect(root.structure).toMatchObject({
    regionIds: ["f0:main", "f0:toolbar"],
  });
  expect(child.structure).toMatchObject({ regionIds: ["f9:toolbar"] });
  expect(outsideLegacyCutoff.structure).toEqual(page.controls[2].structure);
  expect(
    context.controls.every((control) => !Object.hasOwn(control, "reference")),
  ).toBe(true);
  const compactBytes = new TextEncoder().encode(JSON.stringify(context)).length;
  expect(compactBytes).toBeLessThan(
    new TextEncoder().encode(JSON.stringify(restored)).length,
  );
  expect(report.projectionBytes).toBe(compactBytes);
  expect(compactBytes).toBeLessThanOrEqual(
    NAVIGATION_LIMITS.maxProjectionBytes,
  );
  const navigation = buildNavigationObservation(page, "Workspace", {
    stamp: observed.stamp,
    observedAtMs: observed.observedAtMs,
    deadlineAtMs: observed.deadlineAtMs,
    perception,
  });
  expect(
    navigation.observation!.controls.every((control) =>
      Object.hasOwn(control, "reference"),
    ),
  ).toBe(true);
});

test("legacy region encoding retains unmatched evidence and leaves absent, stale or invalid perception inputs unchanged", () => {
  const { page, perception } = legacyCompactionFixture();
  page.controls[0].structure!.regions[1].role = "Unrecognized role";
  // A matching global label is insufficient without this control's ancestry.
  perception.controlRegions[1].regionId = undefined;
  const encoded = buildModelProjection(
    page,
    "Workspace",
    undefined,
    perception,
  ).context;
  for (const original of page.controls) {
    const control = encoded.controls.find(
      (control) => control.id === original.id,
    )!;
    expect(control.structure).toEqual(original.structure);
    expect(Object.hasOwn(control.structure!, "regionIds")).toBe(false);
  }
  const plain = buildModelProjection(page, "Workspace").context;
  const stale = buildModelProjection(page, "Workspace", undefined, {
    ...perception,
    pageRevision: page.revision + 1,
  }).context;
  const invalid = structuredClone(perception);
  invalid.regions[0].parentId = "unknown-region";
  expect(
    buildModelProjection(page, "Workspace", undefined, invalid).context,
  ).toEqual(plain);
  expect(stale).toEqual(plain);
  expect(plain.frames).toBeUndefined();
  expect(plain.controls.every((control) => control.frameId === undefined)).toBe(
    true,
  );
  for (const control of plain.controls) {
    expect(control.structure).toEqual(
      page.controls.find((entry) => entry.id === control.id)!.structure,
    );
    expect(Object.hasOwn(control, "reference")).toBe(true);
  }
});

test("the producer retains complete region ancestry and real scroll evidence under the shared region budget", () => {
  const { observed, page, perception } = producerFixture();
  const result = buildNavigationObservation(page, "Preferences", {
    stamp: observed.stamp,
    observedAtMs: observed.observedAtMs,
    deadlineAtMs: observed.deadlineAtMs,
    perception,
  });
  expect(result.observation).not.toBeNull();
  const produced = result.observation!;
  expect(navigationObservationSchema.safeParse(produced).success).toBe(true);
  expect(produced.controls).toHaveLength(2);
  expect(produced.regions).toHaveLength(24);
  expect(produced.omissions).toMatchObject({
    controls: 1,
    regions: 12,
    reasons: ["budget"],
  });
  const regionIds = new Set(produced.regions.map((region) => region.id));
  expect(
    produced.regions.every(
      (region) => !region.parentId || regionIds.has(region.parentId),
    ),
  ).toBe(true);
  expect(
    produced.controls.every((control) => regionIds.has(control.regionId!)),
  ).toBe(true);
  expect(produced.regions.filter((region) => region.scroll)).toHaveLength(2);
  expect(result.report.projectionBytes).toBe(
    navigationProjectionBytes(produced),
  );
  expect(result.report.counts).toMatchObject({
    indexedCandidates: 3,
    snapshotControls: 3,
    composedControls: 3,
    projectedControls: 2,
    compositionOmittedControls: 0,
    modelOmittedControls: 1,
  });
});

test("legacy and navigation projections share sanitized evidence without exporting cloud paths or form keys", () => {
  const { observed, page, perception } = producerFixture();
  page.controls = page.controls.slice(0, 1);
  perception.controlRegions = perception.controlRegions.slice(0, 1);
  page.indexedControls = 1;
  perception.coverage[0].indexedControls = 1;
  perception.coverage[0].snapshotControls = 1;
  page.controls[0].description = "Contact someone@example.test";
  page.controls[0].context = "Read https://private.example.test/secret";
  page.controls[0].form = { key: "PRIVATE_FORM_KEY", authentication: "login" };
  page.controls[0].destination = {
    origin: page.origin,
    path: "/PRIVATE_DESTINATION",
    key: "private",
  };
  const legacy = buildModelProjection(
    page,
    "Preferences",
    undefined,
    perception,
  );
  const result = buildNavigationObservation(page, "Preferences", {
    stamp: observed.stamp,
    observedAtMs: observed.observedAtMs,
    deadlineAtMs: observed.deadlineAtMs,
    perception,
  });
  expect(result.observation).not.toBeNull();
  expect(result.observation!.controls[0].description).toBe(
    legacy.context.controls[0].description,
  );
  expect(result.observation!.controls[0].context).toBe(
    legacy.context.controls[0].context,
  );
  expect(JSON.stringify(result.observation)).not.toMatch(
    /someone@example|private\.example|PRIVATE_FORM_KEY|PRIVATE_DESTINATION/,
  );
  expect(JSON.stringify(result.report)).not.toMatch(
    /Preferences|Workspace|native:root-document/,
  );
});

test("missing, stale and invalid native perception cannot fall back to URL identity for a navigation observation", () => {
  const { observed, page, perception } = producerFixture();
  const input = {
    stamp: observed.stamp,
    observedAtMs: observed.observedAtMs,
    deadlineAtMs: observed.deadlineAtMs,
    perception,
  };
  const stale = buildNavigationObservation(page, "Preferences", {
    ...input,
    perception: { ...perception, pageRevision: page.revision + 1 },
  });
  expect(stale.observation).toBeNull();
  expect(stale.report.reasons).toContain("stale-perception");
  const absent = buildNavigationObservation(page, "Preferences", {
    ...input,
    perception: undefined as unknown as BrowserPerception,
  });
  expect(absent.observation).toBeNull();
  expect(absent.report.counts.projectedControls).toBeNull();
  expect(absent.report.reasons).toContain("missing-perception");
  const invalid = structuredClone(perception);
  invalid.controlRegions[0].reference.documentId = "wrong-native-document";
  expect(
    buildNavigationObservation(page, "Preferences", {
      ...input,
      perception: invalid,
    }).observation,
  ).toBeNull();
});

function decision(
  observed: NavigationObservation,
  kind: NavigationDecision["decision"]["kind"] = "guide",
): NavigationDecision {
  return {
    protocol: NAVIGATION_PROTOCOL,
    version: NAVIGATION_CONTRACT_VERSION,
    stamp: { ...observed.stamp },
    native: { ...observed.native },
    decision:
      kind === "guide"
        ? {
            kind,
            reference: { ...observed.controls[0].reference },
            message: "Open Settings.",
          }
        : kind === "request-observation"
          ? {
              kind,
              reason: "layout",
              message: "Inspect this area.",
              regionId: "main",
            }
          : kind === "clarify"
            ? {
                kind,
                question: "Which settings do you need?",
                choices: [
                  { id: "account", label: "Account settings" },
                  { id: "appearance", label: "Appearance" },
                ],
              }
            : { kind, reason: "No supported control is visible." },
  };
}

test("native layout capture provenance preserves the original bitmap and rejects stretched gutter coordinates", () => {
  const oldProfile = observation();
  capture(oldProfile);
  expect(navigationObservationSchema.safeParse(oldProfile).success).toBe(true);
  const layout = structuredClone(oldProfile);
  layout.frames[0].viewport.width = 327.5;
  const source = layout.images[0].source;
  source.bitmapWidth = 655;
  source.captureCssBounds = { x: 0, y: 0, width: 327.5, height: 90 };
  // The output remains the 640-pixel visual crop of a 655-pixel original.
  expect(navigationObservationSchema.safeParse(layout).success).toBe(true);
  const { stamp, native, capturedAtMs, ...pixels } = layout.images[0];
  const prepared = {
    ...pixels,
    scanId: pixels.captureId,
    observationRevision: 3,
    viewportRevision: 4,
  };
  expect(preparedNavigationPixelsSchema.parse(prepared)).toEqual(prepared);
  expect(
    navigationImageMatchesViewport(prepared, layout.frames[0].viewport),
  ).toBe(true);
  expect(
    preparedNavigationPixelsSchema.safeParse({ ...prepared, stamp }).success,
  ).toBe(false);
  expect(
    preparedNavigationPixelsSchema.safeParse({ ...prepared, width: 639 })
      .success,
  ).toBe(false);
  expect(
    preparedNavigationPixelsSchema.safeParse({ ...prepared, image: "AAAA" })
      .success,
  ).toBe(false);
  const invalid: ((value: NavigationObservation) => void)[] = [
    (value) => {
      value.images[0].source.captureCssBounds = undefined;
    },
    (value) => {
      value.images[0].source.captureCssBounds!.x = 1;
    },
    (value) => {
      value.images[0].source.captureCssBounds!.y = 1;
    },
    (value) => {
      value.images[0].source.captureCssBounds!.width = 320;
    },
    (value) => {
      value.images[0].source.captureCssBounds!.height = 89;
    },
    (value) => {
      value.images[0].source.scaleX = 655 / 320;
    },
    (value) => {
      value.images[0].source.pixelBounds.x = 10;
    },
    (value) => {
      value.images[0].source.cssBounds.width = 327.5;
    },
  ];
  for (const change of invalid) {
    const value = structuredClone(layout);
    change(value);
    expect(navigationObservationSchema.safeParse(value).success).toBe(false);
    expect(
      navigationImageMatchesViewport(value.images[0], value.frames[0].viewport),
    ).toBe(false);
  }
});
const kinds = [
  "guide",
  "request-observation",
  "clarify",
  "unsupported",
] as const;

test("browser-safe contracts preserve opaque native identities and full sanitized requests", () => {
  const observed = observation();
  observed.context.goal =
    "Find settings ".repeat(20) + "but do not save changes";
  capture(observed);
  vi.stubGlobal("Buffer", undefined);
  expect(navigationObservationSchema.parse(observed)).toEqual(observed);
  expect(observed.context.goal.length).toBeGreaterThan(160);
  for (const kind of kinds) {
    const response = decision(observed, kind);
    expect(navigationDecisionSchema.parse(response)).toEqual(response);
    expect(
      joinNavigationDecision(response, observed, context(observed)).accepted,
    ).toBe(true);
  }
  expect(nativeBrowserReferenceSchema.parse(observed.native).documentId).toBe(
    "native:root-document",
  );
});

test("sanitized context rejects raw private text and an oversized goal without throwing", () => {
  for (const goal of [
    "x".repeat(1001),
    "Find https://private.example/account",
    "Find user@example.test",
    "Use Bearer private-credential",
    " Find settings ",
  ]) {
    const observed = observation();
    observed.context.goal = goal;
    expect(navigationContextSchema.safeParse(observed.context).success).toBe(
      false,
    );
    expect(
      joinNavigationDecision(decision(observed), observed, context(observed)),
    ).toEqual({
      accepted: false,
      reason: "INVALID_OBSERVATION",
    });
  }
  const observed = observation();
  observed.context.verifiedProgress[0].label = "user@example.test";
  expect(navigationObservationSchema.safeParse(observed).success).toBe(false);
  expect(
    navigationContextSchema.safeParse({
      ...observation().context,
      objective: "private",
    }).success,
  ).toBe(false);
});

test("closed decisions reject execution, completion, entitlement and arbitrary evidence fields", () => {
  const observed = observation();
  for (const kind of kinds) {
    const response = decision(observed, kind);
    for (const field of [
      "code",
      "selector",
      "action",
      "completed",
      "arrival",
      "entitlement",
      "deadlineAtMs",
    ])
      expect(
        navigationDecisionSchema.safeParse({
          ...response,
          decision: { ...response.decision, [field]: "invented" },
        }).success,
      ).toBe(false);
    expect(
      navigationDecisionSchema.safeParse({ ...response, accountId: "forged" })
        .success,
    ).toBe(false);
  }
  expect(
    navigationDecisionSchema.safeParse({ ...decision(observed), version: 2 })
      .success,
  ).toBe(false);
  const clarify = decision(observed, "clarify");
  if (clarify.decision.kind !== "clarify")
    throw new Error("Expected fixture choice.");
  clarify.decision.choices![1].id = clarify.decision.choices![0].id;
  expect(navigationDecisionSchema.safeParse(clarify).success).toBe(false);
});

test("every decision kind requires the complete current native and generation stamp", () => {
  const observed = observation();
  for (const kind of kinds) {
    for (const field of Object.keys(
      observed.stamp,
    ) as (keyof typeof observed.stamp)[]) {
      const expected = context(observed);
      const value = expected.currentStamp[field];
      Object.assign(expected.currentStamp, {
        [field]:
          typeof value === "number"
            ? value + 1
            : "20000000-0000-4000-8000-000000000001",
      });
      expect(
        joinNavigationDecision(decision(observed, kind), observed, expected),
      ).toEqual({
        accepted: false,
        reason: "STALE_CONTEXT",
      });
    }
    for (const field of ["windowId", "tabId", "documentId"] as const) {
      const response = decision(observed, kind);
      Object.assign(response.native, {
        [field]:
          field === "documentId"
            ? "another-native-document"
            : response.native[field] + 1,
      });
      expect(
        joinNavigationDecision(response, observed, context(observed)),
      ).toEqual({
        accepted: false,
        reason: "STALE_CONTEXT",
      });
    }
  }
  const restored = context(observed);
  restored.currentStamp.documentGeneration += 2;
  expect(
    joinNavigationDecision(decision(observed), observed, restored).accepted,
  ).toBe(false);
});

test("client deadline is original and server wall-clock metadata can only shorten it", () => {
  const observed = observation();
  const expected = context(observed);
  for (const kind of kinds) {
    const response = decision(observed, kind);
    expect(
      joinNavigationDecision(response, observed, { ...expected, nowMs: 20000 }),
    ).toEqual({
      accepted: false,
      reason: "EXPIRED",
    });
    response.serverTiming = {
      generatedAtMs: 1800000000000,
      expiresAtMs: 1800000000500,
    };
    expect(joinNavigationDecision(response, observed, expected).accepted).toBe(
      true,
    );
    expect(
      joinNavigationDecision(response, observed, { ...expected, nowMs: 1500 })
        .accepted,
    ).toBe(false);
    expect(
      joinNavigationDecision(response, observed, {
        ...expected,
        serverNowMs: 1800000000500,
      }).accepted,
    ).toBe(false);
    response.serverTiming.expiresAtMs =
      response.serverTiming.generatedAtMs + 10;
    expect(joinNavigationDecision(response, observed, expected).accepted).toBe(
      false,
    );
  }
  expect(
    joinNavigationDecision(decision(observed), observed, {
      ...expected,
      nowMs: 999,
    }),
  ).toEqual({ accepted: false, reason: "INVALID_CONTEXT" });
});

test("guidance and observation requests resolve only included eligible references", () => {
  const observed = observation();
  for (const field of ["eligible", "visible", "enabled", "occluded"] as const) {
    const changed = structuredClone(observed);
    changed.controls[0][field] = field === "occluded";
    expect(
      joinNavigationDecision(decision(changed), changed, context(changed)),
    ).toEqual({
      accepted: false,
      reason: "INELIGIBLE_REFERENCE",
    });
  }
  const consequential = structuredClone(observed);
  consequential.controls[0].risk = "consequential";
  expect(
    joinNavigationDecision(
      decision(consequential),
      consequential,
      context(consequential),
    ),
  ).toEqual({ accepted: false, reason: "INELIGIBLE_REFERENCE" });
  for (const change of [
    { controlId: "w0000000000000001-999" },
    { frameId: 1 },
    { documentId: "other-document" },
    { tabId: 6 },
  ]) {
    const response = decision(observed);
    if (response.decision.kind !== "guide")
      throw new Error("Expected fixture guide.");
    Object.assign(response.decision.reference, change);
    expect(
      joinNavigationDecision(response, observed, context(observed)),
    ).toEqual({
      accepted: false,
      reason: "UNKNOWN_REFERENCE",
    });
  }
  const requested = decision(observed, "request-observation");
  if (requested.decision.kind !== "request-observation")
    throw new Error("Expected fixture request.");
  requested.decision.regionId = "omitted-region";
  expect(
    joinNavigationDecision(requested, observed, context(observed)),
  ).toEqual({
    accepted: false,
    reason: "UNKNOWN_REFERENCE",
  });
});

test("native frame, region and opener graphs are closed, unique and acyclic", () => {
  const observed = observation();
  observed.frames.push({
    native: { ...observed.native, frameId: 1, documentId: "native:child" },
    parentFrameId: 0,
    viewport: structuredClone(observed.frames[0].viewport),
  });
  observed.regions.push({
    id: "dialog",
    frameId: 1,
    role: "dialog",
    label: "Preferences",
  });
  observed.controls.push({
    ...structuredClone(observed.controls[0]),
    reference: {
      ...observed.frames[1].native,
      controlId: "w0000000000000001-1",
    },
    regionId: "dialog",
  });
  expect(navigationObservationSchema.safeParse(observed).success).toBe(true);
  const mutate: ((value: NavigationObservation) => void)[] = [
    (value) => {
      value.frames[1].native.windowId++;
    },
    (value) => {
      value.frames[1].parentFrameId = 2;
    },
    (value) => {
      value.frames[1].parentFrameId = 1;
    },
    (value) => {
      value.frames.push(structuredClone(value.frames[1]));
    },
    (value) => {
      value.native.frameId = 1;
    },
    (value) => {
      value.regions[1].parentId = "main";
    },
    (value) => {
      value.regions[0].parentId = "main";
    },
    (value) => {
      value.regions.push(structuredClone(value.regions[0]));
    },
    (value) => {
      value.controls[0].reference.documentId = "native:stale";
    },
    (value) => {
      value.controls[0].regionId = "dialog";
    },
    (value) => {
      value.controls[0].revealIds = ["w0000000000000001-2"];
    },
    (value) => {
      value.controls.push(structuredClone(value.controls[0]));
    },
  ];
  for (const change of mutate) {
    const value = structuredClone(observed);
    change(value);
    expect(navigationObservationSchema.safeParse(value).success).toBe(false);
  }
  const cycle = observation();
  cycle.controls.push({
    ...structuredClone(cycle.controls[0]),
    reference: { ...cycle.native, controlId: "w0000000000000001-2" },
    revealIds: [cycle.controls[0].reference.controlId],
  });
  cycle.controls[0].revealIds = [cycle.controls[1].reference.controlId];
  expect(navigationObservationSchema.safeParse(cycle).success).toBe(false);
});

test("projection admission counts the complete UTF-8 structure and bounded collections", () => {
  const observed = observation();
  observed.controls = Array.from({ length: 35 }, (_, index) => ({
    ...structuredClone(observed.controls[0]),
    reference: { ...observed.native, controlId: `w0000000000000001-${index}` },
    label: "a ".repeat(79) + "ab",
  }));
  expect(navigationObservationSchema.safeParse(observed).success).toBe(true);
  observed.controls.forEach((control) => {
    control.label = "界".repeat(160);
  });
  expect(JSON.stringify(observed).length).toBeLessThan(
    NAVIGATION_LIMITS.maxProjectionBytes,
  );
  expect(
    new TextEncoder().encode(JSON.stringify(observed)).length,
  ).toBeGreaterThan(NAVIGATION_LIMITS.maxProjectionBytes);
  expect(navigationObservationSchema.safeParse(observed).success).toBe(false);
  for (const [field, count] of [
    ["frames", 17],
    ["regions", 33],
    ["controls", 97],
    ["images", 2],
  ] as const) {
    const value = observation();
    capture(value);
    Object.assign(value, {
      [field]: Array.from({ length: count }, () => value[field][0]),
    });
    const parsed = navigationObservationSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(
        parsed.error.issues.some(
          (issue) => issue.code === "too_big" && issue.path[0] === field,
        ),
      ).toBe(true);
  }
});

test("the exact projection byte boundary includes escaped text and capture provenance", () => {
  const observed = observation();
  capture(observed);
  observed.controls = Array.from({ length: 40 }, (_, index) => ({
    ...structuredClone(observed.controls[0]),
    reference: { ...observed.native, controlId: `w0000000000000001-${index}` },
    label: '界"',
  }));
  const projected = () =>
    new TextEncoder().encode(
      JSON.stringify({
        ...observed,
        images: observed.images.map((image) => ({ ...image, image: "" })),
      }),
    ).length;
  let remaining = NAVIGATION_LIMITS.maxProjectionBytes - projected();
  expect(remaining).toBeGreaterThan(0);
  for (const control of observed.controls) {
    const added = Math.min(
      160 - control.label.length,
      Math.floor(remaining / 2),
    );
    control.label += '"'.repeat(added);
    remaining -= added * 2;
    if (remaining === 1 && control.label.length < 160) {
      control.label += "!";
      remaining--;
    }
  }
  expect(remaining).toBe(0);
  expect(projected()).toBe(NAVIGATION_LIMITS.maxProjectionBytes);
  expect(navigationObservationSchema.safeParse(observed).success).toBe(true);
  observed.images[0].masking.maskedRegions = 20;
  expect(projected()).toBe(NAVIGATION_LIMITS.maxProjectionBytes + 1);
  const rejected = navigationObservationSchema.safeParse(observed);
  expect(rejected.success).toBe(false);
  if (!rejected.success)
    expect(rejected.error.issues.map((issue) => issue.message)).toEqual([
      "Model projection exceeds its UTF-8 byte budget.",
    ]);
});

test("capture provenance binds all generations, native context, original age and PNG dimensions", () => {
  const observed = observation();
  capture(observed);
  const mutate: ((value: NavigationObservation) => void)[] = [
    (value) => {
      value.images[0].stamp.contextGeneration++;
    },
    (value) => {
      value.images[0].native.tabId++;
    },
    (value) => {
      value.images[0].capturedAtMs = 1006;
    },
    (value) => {
      value.images[0].maskedAtMs = 1011;
    },
    (value) => {
      value.observedAtMs = 25000;
      value.deadlineAtMs = 26001;
    },
    (value) => {
      value.images[0].width++;
    },
    (value) => {
      value.images[0].image = btoa("invalid PNG");
    },
    (value) => {
      value.images[0].image = "a".repeat(
        4 * Math.ceil(NAVIGATION_LIMITS.maxImageBytes / 3) + 4,
      );
    },
    (value) => {
      value.images[0].source.scaleX = 1;
    },
    (value) => {
      value.images[0].source.devicePixelRatio = 1;
    },
    (value) => {
      value.images[0].source.pixelBounds.x = 1;
    },
  ];
  for (const change of mutate) {
    const value = structuredClone(observed);
    change(value);
    expect(navigationObservationSchema.safeParse(value).success).toBe(false);
  }
  expect(
    navigationObservationSchema.safeParse({
      ...observed,
      images: [
        {
          ...observed.images[0],
          masking: { ...observed.images[0].masking, complete: false },
        },
      ],
    }).success,
  ).toBe(false);
});

test("measured VisualViewport and crop transforms include visual offsets without inferring DPR times zoom", () => {
  const observed = observation();
  const image = capture(observed);
  const viewport = observed.frames[0].viewport;
  viewport.width = 1280;
  viewport.height = 800;
  viewport.browserZoom = 1.25;
  viewport.visualViewport = {
    offsetLeft: 100,
    offsetTop: 80,
    pageLeft: 100,
    pageTop: 130,
    width: 640,
    height: 400,
    scale: 2,
  };
  image.source = {
    kind: "crop",
    cssBounds: { x: 120, y: 100, width: 320, height: 90 },
    pixelBounds: { x: 40, y: 40, width: 640, height: 180 },
    bitmapWidth: 1280,
    bitmapHeight: 800,
    scaleX: 2,
    scaleY: 2,
    devicePixelRatio: 2,
    browserZoom: 1.25,
  };
  expect(navigationObservationSchema.safeParse(observed).success).toBe(true);
  const wrongOrigin = structuredClone(observed);
  wrongOrigin.images[0].source.pixelBounds.x = 240;
  expect(navigationObservationSchema.safeParse(wrongOrigin).success).toBe(
    false,
  );
  const wrongPage = structuredClone(observed);
  wrongPage.frames[0].viewport.visualViewport.pageTop = 80;
  expect(navigationObservationSchema.safeParse(wrongPage).success).toBe(false);
  image.source.kind = "viewport";
  expect(navigationObservationSchema.safeParse(observed).success).toBe(false);
});

test("unsafe generations and nonfinite or unversioned native geometry fail closed", () => {
  const observed = observation();
  for (const value of [Number.NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const changed = structuredClone(observed);
    changed.stamp.requestGeneration = value;
    expect(navigationObservationSchema.safeParse(changed).success).toBe(false);
  }
  for (const value of [
    { ...observed.native, version: 2 },
    { ...observed.native, frameId: -1 },
    { ...observed.native, documentId: "" },
    { ...observed.native, url: "https://example.test" },
  ])
    expect(nativeBrowserReferenceSchema.safeParse(value).success).toBe(false);
  observed.frames[0].viewport.width = Infinity;
  expect(navigationObservationSchema.safeParse(observed).success).toBe(false);
});
