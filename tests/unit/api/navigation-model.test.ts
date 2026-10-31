import { afterEach, expect, test, vi } from "vitest";
import type {
  NavigationModel,
  ServiceRequestContext,
} from "../../../apps/api/src/capabilities";
import { createNavigationModelService } from "../../../apps/api/src/application/navigation";
import { createFakeNavigationModel } from "../../../apps/api/src/adapters/fake-navigation-model";
import {
  MODEL_LIMITS,
  ModelError,
  modelUsageSchema,
  resolveModelBudget,
  type ModelUsage,
} from "../../../apps/api/src/application/model-contracts";
import {
  navigationModelObservation,
  navigationModelValidation,
  navigationModelCapture,
} from "../../support/navigation-model-fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const usage: ModelUsage = {
  provider: "fake",
  source: "fake",
  model: "tholi-deterministic-v1",
  promptTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
};
type ModelResponse = Awaited<ReturnType<NavigationModel["infer"]>>;
function fixture(model: NavigationModel = createFakeNavigationModel()) {
  const observation = navigationModelObservation(),
    current = navigationModelValidation(observation),
    controller = new AbortController();
  const context: ServiceRequestContext = {
    requestId: "actual-server-correlation",
    deadlineAt: Date.now() + 1000,
    signal: controller.signal,
  };
  return {
    observation,
    current,
    context,
    controller,
    model,
    service: createNavigationModelService(model),
  };
}
function provider(
  proposal: unknown,
  rawUsage: unknown = usage,
): NavigationModel {
  return {
    infer: vi.fn(async () => ({ proposal, usage: rawUsage as ModelUsage })),
  };
}

test("fake inference is deterministic, uses actual eligible references and echoes only submitted identity", async () => {
  const app = fixture();
  const original = structuredClone(app.observation);
  const first = await app.service.propose(
    app.observation,
    () => app.current,
    app.context,
  );
  const second = await app.service.propose(
    app.observation,
    () => app.current,
    app.context,
  );
  expect(first).toEqual(second);
  expect(first.decision.stamp).toEqual(app.observation.stamp);
  expect(first.decision.native).toEqual(app.observation.native);
  expect(first.decision.decision).toMatchObject({
    kind: "guide",
    reference: app.observation.controls[0].reference,
  });
  expect(first.usage).toEqual(usage);
  expect(app.observation).toEqual(original);
  expect(first.decision).not.toHaveProperty("serverTiming");
});

test("the fake refuses unavailable or consequential controls instead of inventing a target", async () => {
  const app = fixture();
  app.observation.controls[0].risk = "consequential";
  expect(
    (await app.service.propose(app.observation, () => app.current, app.context))
      .decision.decision.kind,
  ).toBe("unsupported");
});

test("invalid, stale and expired client context is refused before any model work", async () => {
  const model = provider({ kind: "unsupported", reason: "No target." }),
    app = fixture(model);
  await expect(
    app.service.propose(
      { ...app.observation, extra: true },
      () => app.current,
      app.context,
    ),
  ).rejects.toMatchObject({ code: "INVALID_INPUT", outcome: "not-sent" });
  app.current.currentStamp.requestGeneration++;
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "STALE_CONTEXT", outcome: "not-sent" });
  app.current.currentStamp = { ...app.observation.stamp };
  app.current.nowMs = app.observation.deadlineAtMs;
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED", outcome: "not-sent" });
  expect(model.infer).not.toHaveBeenCalled();
});

test.each([
  ["truncated JSON", '{"kind":"guide"'],
  ["executable coordinates", { kind: "guide", x: 10, y: 20 }],
  ["invented completion", { kind: "completed" }],
  [
    "duplicate choices",
    {
      kind: "clarify",
      question: "Which target?",
      choices: [
        { id: "same", label: "First" },
        { id: "same", label: "Second" },
      ],
    },
  ],
  [
    "unsanitized text",
    { kind: "unsupported", reason: "Contact private@example.test" },
  ],
])(
  "rejects %s proposals through the canonical response schema",
  async (_, proposal) => {
    const app = fixture(provider(proposal));
    await expect(
      app.service.propose(app.observation, () => app.current, app.context),
    ).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      outcome: "reported",
      usage,
    });
  },
);

test("known-reference validation rejects invented and ineligible targets and region requests", async () => {
  const observed = navigationModelObservation();
  const model = provider({
    kind: "guide",
    reference: {
      ...observed.controls[0].reference,
      controlId: "w0000000000000001-99",
    },
    message: "Open this control.",
  });
  const app = fixture(model);
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
  vi.mocked(model.infer).mockResolvedValue({
    proposal: {
      kind: "guide",
      reference: observed.controls[0].reference,
      message: "Open this control.",
    },
    usage,
  });
  app.observation.controls[0].enabled = false;
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "INELIGIBLE_REFERENCE" });
  vi.mocked(model.infer).mockResolvedValue({
    proposal: {
      kind: "request-observation",
      reason: "layout",
      message: "Inspect this area.",
      regionId: "invented-region",
    },
    usage,
  });
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
});

test("a provider cannot mutate the observation allowlist used to validate its reply", async () => {
  const model: NavigationModel = {
    async infer({ observation }) {
      observation.controls[0].reference.controlId = "w0000000000000001-99";
      return {
        proposal: {
          kind: "guide",
          reference: observation.controls[0].reference,
          message: "Open this control.",
        },
        usage,
      };
    },
  };
  const app = fixture(model),
    original = structuredClone(app.observation);
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "UNKNOWN_REFERENCE" });
  expect(app.observation).toEqual(original);
});

test("post-model context replacement discards a valid-looking reply", async () => {
  const app = fixture();
  vi.spyOn(app.model, "infer").mockImplementation(async () => {
    app.current.currentNative.documentId = "replacement-document";
    return { proposal: { kind: "unsupported", reason: "No target." }, usage };
  });
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({ code: "STALE_CONTEXT", outcome: "reported" });
});

test.each([20, MODEL_LIMITS.maxDeadlineMs + 5000])(
  "server deadlines are independent of the client clock and cap an uncooperative %ims call",
  async (requestedMs) => {
    vi.useFakeTimers();
    const model: NavigationModel = {
        infer: vi.fn(() => new Promise<ModelResponse>(() => {})),
      },
      app = fixture(model);
    const result = app.service.propose(app.observation, () => app.current, {
      ...app.context,
      deadlineAt: Date.now() + requestedMs,
    });
    const rejected = expect(result).rejects.toMatchObject({
      code: "DEADLINE_EXCEEDED",
      outcome: "unknown",
    });
    await vi.advanceTimersByTimeAsync(
      Math.min(requestedMs, MODEL_LIMITS.maxDeadlineMs),
    );
    await rejected;
    expect(vi.mocked(model.infer).mock.calls[0][1].signal.aborted).toBe(true);
  },
);

test("caller cancellation propagates to the adapter and cannot become a late proposal", async () => {
  const model: NavigationModel = {
      infer: vi.fn(() => new Promise<ModelResponse>(() => {})),
    },
    app = fixture(model);
  const result = app.service.propose(
    app.observation,
    () => app.current,
    app.context,
  );
  await Promise.resolve();
  app.controller.abort();
  await expect(result).rejects.toMatchObject({
    code: "CANCELLED",
    outcome: "unknown",
  });
  expect(vi.mocked(model.infer).mock.calls[0][1].signal.aborted).toBe(true);
  const next = fixture(model);
  next.controller.abort();
  await expect(
    next.service.propose(next.observation, () => next.current, next.context),
  ).rejects.toMatchObject({ code: "CANCELLED", outcome: "not-sent" });
  expect(model.infer).toHaveBeenCalledOnce();
});

test("usage is measured separately from fake output and invalid or over-budget totals are rejected", async () => {
  const measured = {
    ...usage,
    provider: "vertex",
    source: "measured",
    model: "configured-model",
    promptTokens: 4,
    outputTokens: 3,
    thoughtTokens: 2,
    cachedTokens: 1,
    totalTokens: 9,
  } as const;
  const model = provider(
      { kind: "unsupported", reason: "No target." },
      measured,
    ),
    app = fixture(model);
  expect(
    (await app.service.propose(app.observation, () => app.current, app.context))
      .usage,
  ).toEqual(measured);
  await expect(
    app.service.propose(app.observation, () => app.current, app.context, {
      maxOutputTokens: 4,
    }),
  ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED", usage: measured });
  vi.mocked(model.infer).mockResolvedValue({
    proposal: { kind: "unsupported", reason: "No target." },
    usage: { ...measured, totalTokens: 8 },
  });
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({
    code: "INVALID_USAGE",
    outcome: "unknown",
    usage: undefined,
  });
  expect(
    modelUsageSchema.safeParse({ ...measured, cachedTokens: 5 }).success,
  ).toBe(false);
});

test.each([
  ["missing response", undefined],
  [
    "missing usage",
    { proposal: { kind: "unsupported", reason: "No target." } },
  ],
])("%s cannot establish reported model usage", async (_, raw) => {
  const app = fixture({
    infer: vi.fn(async () => raw as ModelResponse),
  });
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({
    code: "INVALID_USAGE",
    outcome: "unknown",
    usage: undefined,
  });
});

test("budgets only decrease and encoded responses obey their own bound", async () => {
  expect(resolveModelBudget({ maxOutputTokens: 1 }).maxOutputTokens).toBe(1);
  expect(() =>
    resolveModelBudget({ maxInputTokens: MODEL_LIMITS.maxInputTokens + 1 }),
  ).toThrow(ModelError);
  const app = fixture(
    provider({ kind: "unsupported", reason: "A bounded response." }),
  );
  await expect(
    app.service.propose(app.observation, () => app.current, app.context, {
      maxResponseBytes: 1,
    }),
  ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
});

test("image budgets are enforced against admitted pixels before provider work", async () => {
  const model = provider({ kind: "unsupported", reason: "No target." }),
    app = fixture(model);
  const image = navigationModelCapture(app.observation);
  for (const budget of [
    { maxImages: 0 },
    { maxImageBytes: Buffer.byteLength(image.image, "base64") - 1 },
    { maxImagePixels: image.width * image.height - 1 },
  ])
    await expect(
      app.service.propose(
        app.observation,
        () => app.current,
        app.context,
        budget,
      ),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED", outcome: "not-sent" });
  expect(model.infer).not.toHaveBeenCalled();
});

test("safe errors preserve bounded retry and reported usage without provider bodies", async () => {
  const model: NavigationModel = {
      infer: vi.fn(async () => {
        throw Error("PRIVATE_PROVIDER_BODY_AND_KEY");
      }),
    },
    app = fixture(model);
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toMatchObject({
    code: "PROVIDER_ERROR",
    outcome: "unknown",
    message: "The model provider could not complete the request.",
  });
  const throttled = new ModelError("THROTTLED", {
    outcome: "reported",
    retryAfterMs: 100,
    usage,
  });
  vi.mocked(model.infer).mockRejectedValue(throttled);
  await expect(
    app.service.propose(app.observation, () => app.current, app.context),
  ).rejects.toBe(throttled);
  expect(
    new ModelError("THROTTLED", { retryAfterMs: 60001 }).retryAfterMs,
  ).toBeUndefined();
});
