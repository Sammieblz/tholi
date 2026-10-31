// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  authenticationStage,
  discoverScreen,
} from "../../../packages/page-discovery/screen-state";
import { formContext } from "../../../packages/page-discovery/form-context";
import { NavigationCore } from "../../../packages/navigation-core/index";
import {
  SemanticIndex,
  MemoryDerivedStore,
} from "../../../packages/nlp/retrieval";
import { fixture } from "../../integration/nlp/fixtures";
import {
  accessibleName,
  accessibleRole,
} from "../../../packages/page-discovery/accessibility";
import { recognizeWithFallback } from "../../../packages/vision/processing";
import { scrollTarget } from "../../../packages/browser-adapter/scroll-target";

test("a declared icon name identifies its menu without using hidden decoration", () => {
  document.body.innerHTML =
    '<button aria-haspopup="menu"><svg role="img" aria-label="User menu"></svg><svg aria-hidden="true" aria-label="Delete account"></svg></button>';
  expect(accessibleName(document.querySelector("button")!)).toBe("User menu");
});

test("fresh target scrolling centers the target and yields to user scrolling", () => {
  document.body.innerHTML = "<button>Control</button>";
  const target = document.querySelector("button")!;
  target.scrollIntoView = vi.fn();
  let frame: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  try {
    scrollTarget(target);
    frame!(0);
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    scrollTarget(target);
    window.dispatchEvent(new Event("wheel"));
    frame!(0);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

const captureIdentity = {
  captureId: "00000000-0000-4000-8000-000000000038",
  scanId: "00000000-0000-4000-8000-000000000037",
  observationRevision: 4,
};
async function withCaptureFixture(
  html: string,
  run: (fixture: {
    visual: typeof import("../../../apps/extension/src/content/visual-guidance");
    rectangles: WeakMap<Node, DOMRect[]>;
    roots: WeakMap<HTMLElement, ShadowRoot>;
    animations: WeakMap<Element, Animation[]>;
  }) => Promise<void>,
) {
  document.body.innerHTML = html;
  const rectangles = new WeakMap<Node, DOMRect[]>(),
    roots = new WeakMap<HTMLElement, ShadowRoot>(),
    animations = new WeakMap<Element, Animation[]>();
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: 0,
    pageTop: 0,
    width: innerWidth,
    height: innerHeight,
    scale: 1,
  });
  const animationDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "getAnimations",
    ),
    rangeDescriptor = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getClientRects",
    );
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("chrome", {
    runtime: { getURL: () => "chrome-extension://test/" },
    dom: {
      openOrClosedShadowRoot: (host: HTMLElement) =>
        roots.get(host) || host.shadowRoot,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
    window.clearTimeout(handle),
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    return (rectangles.get(this) || []) as unknown as DOMRectList;
  });
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: function (this: Element) {
      return animations.get(this) || [];
    },
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: function (this: Range) {
      return rectangles.get(this.startContainer) || [];
    },
  });
  const visual =
    await import("../../../apps/extension/src/content/visual-guidance");
  const stop = visual.onVisualInvalidation(() => {});
  try {
    await run({ visual, rectangles, roots, animations });
  } finally {
    stop();
    if (animationDescriptor)
      Object.defineProperty(
        Element.prototype,
        "getAnimations",
        animationDescriptor,
      );
    else delete (Element.prototype as Partial<Element>).getAnimations;
    if (rangeDescriptor)
      Object.defineProperty(Range.prototype, "getClientRects", rangeDescriptor);
    else delete (Range.prototype as Partial<Range>).getClientRects;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}

test("complete capture masks all fields, frames and inherited closed-root text without reading values", async () => {
  await withCaptureFixture(
    '<input type="search"><select></select><textarea></textarea><div role="combobox"></div><iframe></iframe><div data-sensitive="true"><div id="host"></div></div>',
    async ({ visual, rectangles, roots }) => {
      const fields = [
        ...document.querySelectorAll(
          "input,select,textarea,[role=combobox],iframe",
        ),
      ];
      fields.forEach((field, index) =>
        rectangles.set(field, [new DOMRect(index * 40, 10, 30, 20)]),
      );
      const field = document.querySelector("input")!;
      const value = vi.spyOn(field, "value", "get").mockImplementation(() => {
        throw Error("Private value read");
      });
      const host = document.querySelector<HTMLElement>("#host")!,
        root = host.attachShadow({ mode: "closed" });
      roots.set(host, root);
      const text = document.createTextNode("SYNTHETIC_PRIVATE_GLYPHS");
      root.append(text);
      const textRead = vi
        .spyOn(text, "textContent", "get")
        .mockImplementation(() => {
          throw Error("Private text read");
        });
      rectangles.set(text, [new DOMRect(200, 30, 80, 16)]);
      const metadata = await visual.captureMetadata(
        captureIdentity,
        () => true,
      );
      expect(metadata.masks).toHaveLength(6);
      expect(metadata.masks).toContainEqual({
        x: 200,
        y: 30,
        width: 80,
        height: 16,
      });
      expect(JSON.stringify(metadata)).not.toContain("SYNTHETIC_PRIVATE");
      expect(value).not.toHaveBeenCalled();
      expect(textRead).not.toHaveBeenCalled();
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(true);
      root.append(document.createElement("input"));
      await Promise.resolve();
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(false);
    },
  );
});

test("a capture survives unchanged PageCoach rescans while retaining document, task, mutation, viewport and lifetime fences", async () => {
  await withCaptureFixture(
    "<button>Help</button>",
    async ({ visual, rectangles }) => {
      const rect = new DOMRect(10, 10, 120, 32);
      rectangles.set(document.querySelector("button")!, [rect]);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        rect,
      );
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const { PageCoach } =
          await import("../../../apps/extension/src/content/page-coach"),
        { interpretRequest } = await import("../../../packages/nlp/interpret"),
        { beginJourney } =
          await import("../../../packages/goal-planner/task-journey");
      vi.useFakeTimers();
      const coach = new PageCoach(vi.fn());
      coach.start();
      const request = interpretRequest("Find an unavailable winter workspace"),
        journey = beginJourney(request.original, location.origin);
      journey.requestTaskId = request.tasks[request.active].id;
      coach.view.request = request;
      coach.view.journey = journey;
      const prepare = async () => {
        visual.cancelCapture();
        // A new capture begins only after the previous intentional change has
        // drained the existing incremental observation and planning timers.
        await vi.advanceTimersByTimeAsync(300);
        const page = coach.getPage()!,
          perception = coach.getPerception(page)!,
          captureId = crypto.randomUUID();
        expect(perception).toBeDefined();
        const pending = visual.captureMetadata(
          {
            captureId,
            scanId: perception.root.scanId,
            observationRevision: page.revision,
          },
          coach.captureCurrent(page),
        );
        await vi.advanceTimersByTimeAsync(20);
        await pending;
        return { page, perception, captureId };
      };
      try {
        const first = await prepare();
        for (let index = 0; index < 3; index++) {
          const page = coach.getPage()!;
          expect(page).not.toBe(first.page);
          expect(coach.getPerception(page)?.root.scanId).not.toBe(
            first.perception.root.scanId,
          );
          expect(page.revision).toBe(first.page.revision);
          expect((await visual.checkCapture(first.captureId)).current).toBe(
            true,
          );
        }

        request.tasks[request.active].target = "A different destination";
        expect((await visual.checkCapture(first.captureId)).current).toBe(
          false,
        );
        const progress = await prepare();
        coach.view.verifiedSteps++;
        expect((await visual.checkCapture(progress.captureId)).current).toBe(
          false,
        );

        journey.workflow = {
          id: crypto.randomUUID(),
          requestTaskId: request.tasks[request.active].id,
          guideId: "github.repository",
          guideVersion: "1",
          original: request.original,
          objective: request.original,
          outcome: "review",
          revision: 0,
          entities: [],
          exclusions: [],
          activeMilestone: 0,
          verified: [],
          status: "active",
          reason: "Find a current control.",
        };
        const reviewing = await prepare();
        journey.workflow.status = "review";
        expect(journey.workflow.revision).toBe(0);
        expect((await visual.checkCapture(reviewing.captureId)).current).toBe(
          false,
        );
        journey.workflow = undefined;

        const replaced = await prepare(),
          button = document.querySelector("button")!,
          replacement = button.cloneNode(true) as HTMLElement;
        rectangles.set(replacement, [rect]);
        button.replaceWith(replacement);
        await Promise.resolve();
        expect(coach.getPage()!.revision).toBeGreaterThan(
          replaced.page.revision,
        );
        expect((await visual.checkCapture(replaced.captureId)).current).toBe(
          false,
        );

        const resized = await prepare(),
          beforeResize = visual.viewportRevision();
        window.dispatchEvent(new Event("resize"));
        expect(visual.viewportRevision()).toBeGreaterThan(beforeResize);
        expect((await visual.checkCapture(resized.captureId)).current).toBe(
          false,
        );

        const navigated = await prepare(),
          sourceDocument = document;
        vi.stubGlobal(
          "document",
          sourceDocument.implementation.createHTMLDocument(),
        );
        try {
          expect((await visual.checkCapture(navigated.captureId)).current).toBe(
            false,
          );
        } finally {
          vi.stubGlobal("document", sourceDocument);
        }

        const expiring = await prepare(),
          time = performance.now();
        coach.getPage();
        const clock = vi
          .spyOn(performance, "now")
          .mockReturnValue(time + 15001);
        try {
          expect((await visual.checkCapture(expiring.captureId)).current).toBe(
            false,
          );
        } finally {
          clock.mockRestore();
        }
        const stopped = await prepare();
        coach.stop();
        expect((await visual.checkCapture(stopped.captureId)).current).toBe(
          false,
        );
      } finally {
        coach.stop();
        vi.useRealTimers();
      }
    },
  );
});

test("capture inherits private shadow scope through assigned nodes without masking public siblings", async () => {
  await withCaptureFixture(
    '<div id="host">SYNTHETIC_PRIVATE_SLOT<span slot="public">Public sibling</span><span slot="private">SYNTHETIC_PRIVATE_NAMED</span><span slot="unmatched">Public unassigned</span></div>',
    async ({ visual, rectangles, roots }) => {
      const host = document.querySelector<HTMLElement>("#host")!,
        root = host.attachShadow({ mode: "closed" });
      root.innerHTML =
        '<div data-sensitive="true" style="width:0;height:0;overflow:visible"><slot></slot><slot name="private"></slot></div><slot name="public"></slot>';
      roots.set(host, root);
      const direct = host.firstChild!,
        named = host.querySelector('[slot="private"]')!,
        publicSibling = host.querySelector('[slot="public"]')!,
        unassigned = host.querySelector('[slot="unmatched"]')!;
      const readers = [direct, named.firstChild!].map((text) =>
        vi.spyOn(text, "textContent", "get").mockImplementation(() => {
          throw Error("Private slotted text read");
        }),
      );
      rectangles.set(direct, [new DOMRect(10, 10, 40, 10)]);
      rectangles.set(named, [new DOMRect(80, 10, 40, 10)]);
      rectangles.set(named.firstChild!, [new DOMRect(80, 10, 40, 10)]);
      rectangles.set(publicSibling, [new DOMRect(160, 10, 40, 10)]);
      rectangles.set(publicSibling.firstChild!, [new DOMRect(160, 10, 40, 10)]);
      rectangles.set(unassigned, [new DOMRect(240, 10, 40, 10)]);
      rectangles.set(unassigned.firstChild!, [new DOMRect(240, 10, 40, 10)]);
      // Finish initial distribution before the capture lease observes roots.
      await Promise.resolve();
      const metadata = await visual.captureMetadata(
        captureIdentity,
        () => true,
      );
      expect(metadata.masks).toEqual([
        { x: 10, y: 10, width: 40, height: 10 },
        { x: 80, y: 10, width: 40, height: 10 },
      ]);
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(true);
      for (const reader of readers) expect(reader).not.toHaveBeenCalled();
      expect(JSON.stringify(metadata)).not.toContain("SYNTHETIC_PRIVATE");
      expect(host.shadowRoot).toBeNull();
      const revision = visual.viewportRevision();
      root
        .querySelector("slot")!
        .dispatchEvent(new Event("slotchange", { bubbles: true }));
      expect(visual.viewportRevision()).toBeGreaterThan(revision);
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(false);
    },
  );
});

test("capture preserves fractional visible-edge private text without rounding viewport evidence", async () => {
  await withCaptureFixture(
    '<div data-sensitive="true" style="width:0;height:0;overflow:visible">SYNTHETIC_PRIVATE_EDGE</div>',
    async ({ visual, rectangles }) => {
      vi.stubGlobal("innerWidth", 955);
      vi.stubGlobal("innerHeight", 536);
      vi.stubGlobal("devicePixelRatio", 0.800000011920929);
      vi.stubGlobal(
        "visualViewport",
        Object.assign(new EventTarget(), {
          offsetLeft: 0,
          offsetTop: 0,
          pageLeft: 0,
          pageTop: 0,
          width: 936.25,
          height: 536.25,
          scale: 1,
        }),
      );
      const text = document.querySelector("[data-sensitive]")!.firstChild!;
      const read = vi
        .spyOn(text, "textContent", "get")
        .mockImplementation(() => {
          throw Error("Private text read");
        });
      rectangles.set(text, [new DOMRect(10, 536.05, 40, 0.15)]);
      const metadata = await visual.captureMetadata(
        captureIdentity,
        () => true,
      );
      expect(metadata.viewport).toMatchObject({
        width: 955,
        height: 536,
        devicePixelRatio: 0.800000011920929,
        visualViewport: { width: 936.25, height: 536.25 },
      });
      expect(metadata.masks).toHaveLength(1);
      expect(metadata.masks[0]).toMatchObject({ x: 10, y: 536.05, width: 40 });
      expect(metadata.masks[0].height).toBeCloseTo(0.15);
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(true);
      expect(read).not.toHaveBeenCalled();
      expect(JSON.stringify(metadata)).not.toContain("SYNTHETIC_PRIVATE_EDGE");
    },
  );
});

test("capture suppression restores exact style priorities, retains proof and rejects foreign tokens", async () => {
  await withCaptureFixture(
    '<div data-tholi-ui style="opacity: .7 !important; visibility: visible; transition-duration: 3s !important; animation-duration: 2s !important">UI</div>',
    async ({ visual }) => {
      const overlay = document.querySelector<HTMLElement>("[data-tholi-ui]")!,
        original = overlay.style.cssText;
      await visual.captureMetadata(captureIdentity, () => true);
      overlay.style.outlineWidth = "2px";
      const expected = document.createElement("div");
      expected.style.cssText = original;
      expected.style.outlineWidth = "2px";
      expect(overlay.style.getPropertyValue("opacity")).toBe("0");
      visual.restoreOverlay("00000000-0000-4000-8000-000000000099");
      expect(overlay.style.getPropertyValue("opacity")).toBe("0");
      visual.restoreOverlay(captureIdentity.captureId);
      expect(overlay.style.cssText).toBe(expected.style.cssText);
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(true);
      document.body.append(
        Object.assign(document.createElement("div"), {
          id: "navigator-visual-suggestion",
        }),
      );
      await Promise.resolve();
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(false);
      expect(overlay.style.cssText).toBe(expected.style.cssText);
    },
  );
});

test("capture proof rejects geometric changes, animation, painted overflow and excessive masks", async () => {
  await withCaptureFixture(
    '<input><div id="moving"></div>',
    async ({ visual, rectangles, animations }) => {
      const input = document.querySelector("input")!,
        moving = document.querySelector("#moving")!;
      rectangles.set(input, [new DOMRect(10, 10, 100, 30)]);
      await visual.captureMetadata(captureIdentity, () => true);
      rectangles.set(input, [new DOMRect(15, 10, 100, 30)]);
      expect(
        (await visual.checkCapture(captureIdentity.captureId)).current,
      ).toBe(false);
      animations.set(moving, [
        { playState: "running", pending: false } as Animation,
      ]);
      await expect(
        visual.captureMetadata(captureIdentity, () => true),
      ).rejects.toThrow("Complete private capture evidence");
      animations.delete(moving);
      input.style.textShadow = "none";
      rectangles.set(
        input,
        Array.from(
          { length: 5001 },
          (_, index) => new DOMRect(index % 100, Math.floor(index / 100), 1, 1),
        ),
      );
      await Promise.resolve();
      await expect(
        visual.captureMetadata(captureIdentity, () => true),
      ).rejects.toThrow("Complete private capture evidence");
      input.style.textShadow = "0 0 8px black";
      rectangles.set(input, [new DOMRect(10, 10, 100, 30)]);
      await Promise.resolve();
      await expect(
        visual.captureMetadata(captureIdentity, () => true),
      ).rejects.toThrow("Complete private capture evidence");
      input.style.textShadow = "none";
      await Promise.resolve();
      // jsdom omits backdrop-filter from computed styles. Model the native
      // computed value here; browser pixel fixtures exercise actual CSS paint.
      const nativeStyle = getComputedStyle;
      vi.stubGlobal("getComputedStyle", (element: Element) => {
        const style = nativeStyle(element);
        if (element === moving)
          Object.defineProperty(style, "backdropFilter", {
            value: "blur(8px)",
          });
        return style;
      });
      await expect(
        visual.captureMetadata(captureIdentity, () => true),
      ).rejects.toThrow("Complete private capture evidence");
    },
  );
});

test("capture cancellation and the short suppression watchdog restore UI even before paint acknowledgment", async () => {
  await withCaptureFixture(
    '<div data-tholi-ui style="opacity: .8 !important">UI</div>',
    async ({ visual }) => {
      const overlay = document.querySelector<HTMLElement>("[data-tholi-ui]")!,
        original = overlay.style.cssText;
      vi.useFakeTimers();
      vi.stubGlobal("requestAnimationFrame", () => 1);
      try {
        const pending = visual.captureMetadata(captureIdentity, () => true);
        const failed = expect(pending).rejects.toThrow(
          "Complete private capture evidence",
        );
        await vi.advanceTimersByTimeAsync(1000);
        await failed;
        expect(overlay.style.cssText).toBe(original);
        expect(
          (await visual.checkCapture(captureIdentity.captureId)).current,
        ).toBe(false);
        const cancelled = visual.captureMetadata(captureIdentity, () => true);
        const cancelledResult = expect(cancelled).rejects.toThrow(
          "Complete private capture evidence",
        );
        await Promise.resolve();
        const { setGuidanceVisible } =
          await import("../../../packages/overlay-ui/presentation-gate");
        setGuidanceVisible(false);
        await cancelledResult;
        setGuidanceVisible(true);
        expect(overlay.style.cssText).toBe(original);
      } finally {
        const { setGuidanceVisible } =
          await import("../../../packages/overlay-ui/presentation-gate");
        setGuidanceVisible(true);
        vi.useRealTimers();
      }
    },
  );
});

test("OTP metadata and split verification widgets never read credentials", () => {
  document.body.innerHTML =
    '<form><h1>Two-step verification</h1><input autocomplete="one-time-code"><button>Verify</button></form>';
  const field = document.querySelector("input")!;
  Object.defineProperty(field, "value", {
    get() {
      throw new Error("Credential read");
    },
  });
  expect(authenticationStage(document.querySelector("form")!)).toBe(
    "two-factor",
  );
  expect(
    formContext(document.querySelector("button")!, new Map()),
  ).toMatchObject({ authentication: "credentials", stage: "two-factor" });
  document.body.innerHTML =
    '<form><h1>Verify your identity</h1><input inputmode="numeric" maxlength="1"><input inputmode="numeric" maxlength="1"></form>';
  expect(
    authenticationStage(
      document.querySelector("form")!,
      "Verify your identity",
    ),
  ).toBe("two-factor");
  document.body.innerHTML =
    '<form><input type="search" placeholder="Search products"></form>';
  expect(authenticationStage(document.querySelector("form")!)).toBeUndefined();
  document.body.innerHTML =
    '<form><div style="display:none"><input autocomplete="one-time-code"><input type="password"></div><input type="search"><button>Search</button></form>';
  expect(authenticationStage(document.querySelector("form")!)).toBeUndefined();
  expect(
    formContext(document.querySelector("button")!, new Map())?.authentication,
  ).toBeUndefined();
  document.body.innerHTML =
    '<form><h1>Public profile</h1><input autocomplete="username"><button>Save profile</button></form>';
  expect(
    authenticationStage(document.querySelector("form")!, "Public profile"),
  ).toBeUndefined();
  document.body.innerHTML =
    '<form><h1>Sign in</h1><input autocomplete="username"><button>Continue</button></form>';
  expect(authenticationStage(document.querySelector("form")!, "Sign in")).toBe(
    "credentials",
  );
});

test("screen classification distinguishes review and outcome without claiming success", () => {
  document.body.innerHTML = "<main><h1>Review cancellation</h1></main>";
  const heading = document.querySelector("h1")!;
  const rectangle = {
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    top: 0,
    left: 0,
    right: 100,
    bottom: 30,
    toJSON() {},
  };
  heading.getBoundingClientRect = () => rectangle;
  heading.getClientRects = () => [rectangle] as any;
  expect(discoverScreen([document], [], false).kind).toBe("review");
  document.body.innerHTML = "<main><h1>Prime membership</h1></main>";
  expect(
    discoverScreen([document], [], false, [
      {
        kind: "failure",
        subject: "Prime membership",
        text: "Cancellation failed",
        revision: 1,
      },
    ]).kind,
  ).toBe("outcome");
  document.body.innerHTML =
    '<main><h1>Independent catalogue</h1><input autocomplete="one-time-code"></main>';
  const otp = document.querySelector("input")!;
  otp.getBoundingClientRect = () => rectangle;
  otp.getClientRects = () => [rectangle] as any;
  expect(discoverScreen([document], [], false).kind).toBe("normal");
  document.querySelector("h1")!.textContent = "Two-step verification";
  expect(discoverScreen([document], [], false).kind).toBe("two-factor");
});

test("adapted accessibility handles role fallback, icon names and no editable reads", () => {
  document.body.innerHTML =
    '<button role="invalid button"><svg><title>Account menu</title></svg></button><select multiple aria-label="Choose languages"></select><button><img alt="Search"></button><input aria-label="Private input">';
  expect(accessibleRole(document.querySelector("button")!)).toBe("button");
  expect(accessibleRole(document.querySelector("select")!)).toBe("listbox");
  expect(accessibleName(document.querySelector("button")!)).toBe(
    "Account menu",
  );
  expect(accessibleName(document.querySelectorAll("button")[1])).toBe("Search");
  Object.defineProperty(document.querySelector("input")!, "value", {
    get() {
      throw Error("Private value read");
    },
  });
  expect(accessibleName(document.querySelector("input")!)).toBe("");
  document.body.innerHTML =
    '<button id="password-settings">Password and security</button><input id="secret-token" value="PRIVATE">';
  expect(accessibleName(document.querySelector("button")!)).toBe(
    "Password and security",
  );
  expect(accessibleName(document.querySelector("input")!)).toBe("");
  document.body.innerHTML =
    '<button id="password-settings">Password and security<span id="secret-token">PRIVATE_SECRET</span></button>';
  expect(accessibleName(document.querySelector("button")!)).toBe(
    "Password and security",
  );
});
test("OCR backend failure falls back locally and cancellation prevents a fallback", async () => {
  const calls: Record<string, unknown>[] = [],
    local = { engine: "tesseract-6.0.1-eng-fast" } as any;
  const prepared = {
    requestId: crypto.randomUUID(),
    journeyId: crypto.randomUUID(),
    contextRevision: 1,
    documentId: "native-document",
    observationRevision: 2,
    viewportRevision: 3,
    captureId: crypto.randomUUID(),
    image: readFileSync("tests/fixtures/vision/light.png").toString("base64"),
    width: 640,
    height: 180,
    cssWidth: 640,
    cssHeight: 180,
  };
  const backend = vi.fn(async (input: unknown) => {
    expect(input).toEqual(prepared);
    throw Error("Service down");
  });
  const services = {
    browser: async (message: Record<string, unknown>) => {
      calls.push(message);
      return message.prepareOnly ? prepared : local;
    },
    backend,
  };
  const capture = {
    image: "RAW_CAPTURE_SENTINEL",
    metadata: { source: "private-device-only" },
    engine: "tesseract",
  };
  expect(
    await recognizeWithFallback(
      capture,
      services,
      true,
      new AbortController().signal,
    ),
  ).toBe(local);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual({ ...capture, prepareOnly: true });
  expect(calls[1]).toEqual({ prepared, engine: capture.engine });
  expect(calls[1]).not.toHaveProperty("image");
  expect(calls[1]).not.toHaveProperty("metadata");
  expect(backend).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  calls.length = 0;
  await expect(
    recognizeWithFallback(
      capture,
      {
        ...services,
        backend: async () => {
          controller.abort();
          throw Error("Canceled");
        },
      },
      true,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  expect(calls[0].prepareOnly).toBe(true);
  calls.length = 0;
  backend.mockClear();
  expect(
    await recognizeWithFallback(
      capture,
      services,
      false,
      new AbortController().signal,
    ),
  ).toBe(local);
  expect(calls).toEqual([capture]);
  expect(backend).not.toHaveBeenCalled();
});

test("only explicit current Prime status can establish an already canceled membership", async () => {
  const core = new NavigationCore(
    new SemanticIndex(
      {
        embed: async (texts) =>
          texts.map(() =>
            Array.from({ length: 384 }, (_, i) => Number(i === 0)),
          ),
        dispose: async () => {},
      },
      new MemoryDerivedStore(),
    ),
  );
  const page = {
    ...fixture(),
    origin: "https://www.amazon.com",
    controls: [],
    signals: [
      {
        kind: "status" as const,
        subject: "Audible membership",
        text: "Your membership was canceled.",
        revision: 1,
      },
    ],
  };
  const input = {
    requestId: crypto.randomUUID(),
    documentId: "status",
    revision: 1,
    observation: page,
    text: "Cancel my Prime subscription",
    strategy: "fastest" as const,
    protocolVersion: 2 as const,
  };
  expect((await core.plan(input)).plan?.status).not.toBe("completed");
  page.signals[0].subject = "Prime membership";
  expect((await core.plan(input)).plan?.status).toBe("completed");
  page.signals[0].text = "Your Prime membership was not canceled.";
  expect((await core.plan(input)).plan?.status).not.toBe("completed");
  page.signals[0].text = "Your Prime membership ends when you cancel.";
  expect((await core.plan(input)).plan?.status).not.toBe("completed");
  page.signals[0].text = "Your Prime membership was canceled.";
  page.controls = [
    { ...fixture().controls[0], label: "Prime", kind: "navigation" },
  ] as any;
  expect(
    (await core.plan({ ...input, text: "Cancel my Kindle subscription" })).plan
      ?.status,
  ).not.toBe("completed");
  page.signals[0].text = "You are not a Prime member.";
  const missing = await core.plan(input);
  expect(missing.plan?.status).not.toBe("completed");
  expect(missing.plan?.reason).toContain("no active Prime membership");
  expect(missing.plan?.recoveryStage).toBe("waiting");
  expect(missing.workflow?.status).toBe("waiting");
});

test("Prime destination survives an arbitrarily old 2FA handoff and resumes", async () => {
  const core = new NavigationCore(
    new SemanticIndex(
      {
        embed: async (texts) =>
          texts.map(() =>
            Array.from({ length: 384 }, (_, i) => Number(i === 0)),
          ),
        dispose: async () => {},
      },
      new MemoryDerivedStore(),
    ),
  );
  const page = {
    ...fixture(),
    origin: "https://www.amazon.com",
    screen: { kind: "two-factor" as const, evidence: "field-metadata" },
    controls: [],
  };
  const input = {
    requestId: crypto.randomUUID(),
    documentId: "otp",
    revision: 1,
    observation: page,
    text: "Help me cancel my Amazon Prime subscription",
    strategy: "fastest" as const,
    protocolVersion: 2 as const,
    contextRevision: 0,
  };
  const waiting = await core.plan(input);
  expect(waiting.workflow?.status).toBe("waiting");
  expect(waiting.request?.original).toBe(input.text);
  expect(waiting.plan?.status).not.toBe("completed");
  const next = {
    ...page,
    screen: { kind: "normal" as const, evidence: "live-controls" },
    revision: 2,
    controls: [
      {
        ...fixture().controls[0],
        label: "Account & Lists",
        kind: "navigation" as const,
        context: "",
        signature: "account",
        risk: "ordinary" as const,
      },
    ],
  };
  const resumed = await core.plan({
    ...input,
    documentId: "account",
    revision: 2,
    observation: next,
    request: waiting.request,
    workflow: waiting.workflow,
  });
  expect(resumed.request?.id).toBe(waiting.request?.id);
  expect(resumed.plan?.steps[0]?.label).toBe("Account & Lists");
});
