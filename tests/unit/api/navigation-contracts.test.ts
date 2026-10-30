import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
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
  type NavigationDecision,
  type NavigationObservation,
  type NavigationValidationContext,
} from "../../../packages/navigation-core/contracts-navigation";

const png = readFileSync("tests/fixtures/vision/light.png").toString("base64");
afterEach(() => vi.unstubAllGlobals());

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
