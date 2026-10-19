import { it, expect, vi, afterEach } from "vitest";
import {
  LocalModel,
  modelAvailability,
} from "../../../apps/extension/src/inference/browser-language-model";
import type { PageSnapshot } from "../../../packages/page-model/index";
import {
  InferenceQueue,
  inferencePriority,
} from "../../../packages/nlp/work-queue";
const page: PageSnapshot = {
  origin: "https://example.org",
  path: "/",
  pageKey: "page",
  stateKey: "state",
  templateKey: "template",
  fingerprint: "structure",
  revision: 1,
  layout: "wide",
  language: "en",
  partial: false,
  controls: [
    {
      id: "w0000000000000000-1",
      signature: "control",
      role: "button",
      label: "Help",
      description: "Find the documentation",
      popup: "dialog",
      context: "Navigation",
      scope: "page",
      group: "Navigation",
      kind: "action",
      visible: true,
      enabled: true,
      inViewport: true,
      revealIds: [],
      risk: "ordinary",
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("coalesces obsolete planning, prioritizes foreground work and cancels without stale delivery", async () => {
  const started: string[] = [],
    release = new Map<string, () => void>();
  const queue = new InferenceQueue<string, string>(async (value) => {
    started.push(value);
    await new Promise<void>((resolve) => release.set(value, resolve));
    return value;
  }, 2);
  const background = queue
    .submit("suggest", "document", 1, "suggest")
    .catch((e) => e.message);
  const replaced = queue
    .submit("old", "document", 0, "old")
    .catch((e) => e.message);
  const latest = queue
    .submit("new", "document", 0, "new")
    .catch((e) => e.message);
  const deferred = queue
    .submit("another-suggestion", "document", 1, "unused")
    .catch((e) => e.message);
  expect(await background).toContain("canceled");
  expect(await replaced).toContain("canceled");
  expect(await deferred).toContain("deferred");
  const automatic = queue
    .submit(
      "old-continuation",
      "document",
      inferencePriority({ request: {} }, false),
      "unused",
    )
    .catch((e) => e.message);
  expect(await automatic).toContain("deferred");
  expect(inferencePriority({ request: {}, choice: "decision" }, false)).toBe(0);
  expect(inferencePriority({}, true)).toBe(2);
  release.get("suggest")!();
  await vi.waitFor(() => expect(started).toEqual(["suggest", "new"]));
  queue.cancel();
  expect(await latest).toContain("canceled");
  release.get("new")!();
  await Promise.resolve();
  expect(started).not.toContain("old");
});
it("reports unavailable API and never creates a remote inference dependency", async () => {
  vi.stubGlobal("LanguageModel", undefined);
  expect(await modelAvailability()).toBe("unavailable");
  expect(() => new LocalModel().enable(() => {})).toThrow("unavailable");
});
it("uses structured local output constrained to discovered IDs and treats labels as untrusted", async () => {
  const prompt = vi.fn().mockResolvedValue(
      JSON.stringify({
        controlIds: [page.controls[0].id],
        confidence: 0.9,
        intent: {
          target: "Help",
          context: "",
          scope: "page",
          operation: "locate",
        },
      }),
    ),
    destroy = vi.fn();
  const requestDestroy = vi.fn();
  const clone = vi.fn().mockResolvedValue({ prompt, destroy: requestDestroy });
  const create = vi.fn().mockResolvedValue({ clone, destroy });
  vi.stubGlobal("LanguageModel", {
    availability: async () => "available",
    create,
  });
  const model = new LocalModel();
  await model.enable(() => {});
  expect(create.mock.calls[0][0].initialPrompts[0].content).toContain(
    "untrusted data",
  );
  const proposed = await model.propose(
    page,
    "Help",
    new AbortController().signal,
  );
  expect(proposed.controlIds).toEqual([page.controls[0].id]);
  expect(proposed.intent?.target).toBe("Help");
  expect(clone).toHaveBeenCalledOnce();
  expect(requestDestroy).toHaveBeenCalledOnce();
  expect(JSON.parse(prompt.mock.calls[0][0]).controls[0]).toMatchObject({
    description: "Find the documentation",
    popup: "dialog",
    scope: "page",
  });
  expect(
    prompt.mock.calls[0][1].responseConstraint.properties.controlIds.items.enum,
  ).toEqual([page.controls[0].id]);
  expect(JSON.parse(prompt.mock.calls[0][0]).controls[0]).not.toHaveProperty(
    "destination",
  );
  prompt.mockResolvedValue('{"selector":"#malicious"}');
  await expect(
    model.propose(page, "Help", new AbortController().signal),
  ).rejects.toThrow();
  expect(requestDestroy).toHaveBeenCalledTimes(2);
  await model.close();
  expect(destroy).toHaveBeenCalledOnce();
});
it("rejects invented IDs even if a model ignores the response constraint, and aborts without inference", async () => {
  const prompt = vi.fn().mockResolvedValue(
    JSON.stringify({
      controlIds: ["w0000000000000000-999"],
      confidence: 1,
      intent: {
        target: "Help",
        context: "",
        scope: "any",
        operation: "locate",
      },
    }),
  );
  const destroy = vi.fn(),
    clone = vi.fn().mockResolvedValue({ prompt, destroy });
  vi.stubGlobal("LanguageModel", {
    create: async () => ({ clone, destroy: vi.fn() }),
  });
  const model = new LocalModel();
  await model.enable(() => {});
  await expect(
    model.propose(page, "Help", new AbortController().signal),
  ).rejects.toThrow("Ungrounded");
  expect(destroy).toHaveBeenCalledOnce();
  const aborted = new AbortController();
  aborted.abort();
  await expect(model.propose(page, "Help", aborted.signal)).rejects.toThrow();
  expect(clone).toHaveBeenCalledOnce();
  await model.close();
});

it("recovers a local inference host after cancellation and ignores replies from the disposed worker", async () => {
  const workers: any[] = [];
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => "chrome-extension://test/" + path },
  });
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: any;
      onerror: any;
      onmessageerror: any;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
    },
  );
  const { createInferenceHost } =
    await import("../../../apps/extension/src/inference/worker-host");
  const host = createInferenceHost();
  try {
    const canceled = host.request({ type: "PLAN_NLP", id: "old" });
    await host.request({ type: "CANCEL_NLP" });
    expect(await canceled).toEqual({ id: "old", error: "Planning canceled." });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const fresh = host.request({ type: "PLAN_NLP", id: "fresh" });
    workers[0].onmessage({ data: { id: "old", value: "stale" } });
    workers[1].onmessage({ data: { id: "fresh", value: "current" } });
    expect(await fresh).toEqual({ id: "fresh", value: "current" });
    const failed = host.request({ type: "PLAN_NLP", id: "failed" });
    workers[1].onerror({ preventDefault: vi.fn() });
    expect((await failed).error).toMatch(/failed/);
    const recovered = host.request({ type: "PLAN_NLP", id: "recovered" });
    workers[2].onmessage({ data: { id: "recovered", value: "recovered" } });
    expect((await recovered).value).toBe("recovered");
  } finally {
    host.dispose();
  }
});
