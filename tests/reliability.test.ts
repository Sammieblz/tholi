import { expect, test, vi } from "vitest";
import {
  authenticationStage,
  discoverScreen,
} from "../packages/page-discovery/screen-state";
import { formContext } from "../packages/page-discovery/form-context";
import { NavigationCore } from "../packages/navigation-core";
import { SemanticIndex, MemoryDerivedStore } from "../packages/nlp/retrieval";
import { fixture } from "./nlp/fixtures";
import {
  accessibleName,
  accessibleRole,
} from "../packages/page-discovery/accessibility";
import { recognizeWithFallback } from "../packages/vision/processing";
import { scrollTarget } from "../packages/browser-adapter/scroll-target";

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

test("capture masks editable fields and frames even when frame DOM access is granted", async () => {
  document.body.innerHTML =
    '<input><iframe src="https://example.com"></iframe>';
  for (const element of document.querySelectorAll("input,iframe"))
    element.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      width: 100,
      height: 30,
      right: 110,
      bottom: 50,
      top: 20,
      left: 10,
      toJSON() {},
    });
  // Capture masking is independent of the document-lifetime mutation observer.
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  try {
    const { captureMetadata, onVisualInvalidation } =
      await import("../apps/extension/src/visual-guidance");
    expect(captureMetadata().masks).toHaveLength(2);
    const invalidated = vi.fn();
    const stop = onVisualInvalidation(invalidated);
    window.dispatchEvent(new Event("resize"));
    expect(invalidated).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new Event("resize"));
    expect(invalidated).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
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
  const calls: boolean[] = [],
    local = { engine: "tesseract-6.0.1-eng-fast" } as any;
  const services = {
    browser: async (message: Record<string, unknown>) => {
      calls.push(!!message.prepareOnly);
      return local;
    },
    backend: async () => {
      throw Error("Service down");
    },
  };
  expect(
    await recognizeWithFallback(
      {},
      services,
      true,
      new AbortController().signal,
    ),
  ).toBe(local);
  expect(calls).toEqual([true, false]);
  const controller = new AbortController();
  calls.length = 0;
  await expect(
    recognizeWithFallback(
      {},
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
  expect(calls).toEqual([true]);
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
