import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import {
  buildModelProjection,
  buildNavigationObservation,
} from "../../../packages/goal-planner/model-context";
import type { PageSnapshot } from "../../../packages/page-model";
import type { BrowserPerception } from "../../../packages/page-discovery/perception";
import {
  NAVIGATION_CONTRACT_VERSION,
  NAVIGATION_LIMITS,
  NAVIGATION_PROTOCOL,
  NATIVE_BROWSER_VERSION,
  joinNavigationDecision,
  navigationContextSchema,
  navigationDecisionSchema,
  navigationObservationSchema,
  nativeBrowserReferenceSchema,
  navigationProjectionBytes,
  type NavigationDecision,
  type NavigationObservation,
  type NavigationValidationContext,
} from "../../../packages/navigation-core/contracts-navigation";

const png = readFileSync("tests/fixtures/vision/light.png").toString("base64");
afterEach(() => vi.unstubAllGlobals());

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

function observation(): NavigationObservation {
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
function context(observed: NavigationObservation): NavigationValidationContext {
  return {
    currentStamp: { ...observed.stamp },
    currentNative: { ...observed.native },
    nowMs: 1020,
    requestStartedAtMs: 1000,
    requestDeadlineMs: 20000,
  };
}
function capture(observed: NavigationObservation) {
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
