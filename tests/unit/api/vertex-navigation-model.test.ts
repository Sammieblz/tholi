import { afterEach, expect, test, vi } from "vitest";
import {
  createVertexNavigationModel,
  validateVertexModelOptions,
  type VertexModelOptions,
} from "../../../apps/api/src/adapters/vertex-navigation-model";
import {
  ModelError,
  resolveModelBudget,
  type ModelErrorCode,
  type ModelOutcome,
} from "../../../apps/api/src/application/model-contracts";
import {
  navigationModelObservation,
  navigationModelCapture,
  navigationModelVertexResponse,
} from "../../support/navigation-model-fixture";

const options: VertexModelOptions = {
  api: "v1",
  project: "tholi-development",
  location: "global",
  model: "gemini-3.8-flash",
  retentionProfile: "provider-default-acknowledged",
};
const privateProviderText = "PRIVATE_PROVIDER_BODY_AND_CREDENTIAL";
function harness(location: VertexModelOptions["location"] = "global") {
  const controller = new AbortController();
  const input = {
    observation: navigationModelObservation(),
    budget: resolveModelBudget(),
  };
  const proposal = {
    kind: "guide",
    reference: { ...input.observation.controls[0].reference },
    message: "Follow the highlighted Settings control.",
  };
  const result = navigationModelVertexResponse(proposal, {
    prompt: 100,
    output: 20,
    thought: 5,
    cached: 10,
  });
  const app = {
    controller,
    input,
    proposal,
    result,
    context: {
      requestId: "server-correlation",
      deadlineAt: Date.now() + 10_000,
      signal: controller.signal,
    },
    count: (() => Response.json({ totalTokens: 100 })) as () =>
      Response | Promise<Response>,
    generate: (() => Response.json(result)) as () =>
      Response | Promise<Response>,
    calls: [] as { url: string; init: RequestInit }[],
    events: [] as string[],
  };
  const accessToken = vi.fn(async (_signal: AbortSignal) => {
    app.events.push("credentials");
    return "synthetic-token";
  });
  const authorizeGeneration = vi.fn(
    async (
      _signal: AbortSignal,
      _budget: { inputTokens: number; maxOutputTokens: number },
    ) => {
      app.events.push("authorize");
    },
  );
  const beforeSend = vi.fn(
    async (_signal: AbortSignal, phase: "count" | "generate") => {
      app.events.push("send:" + phase);
    },
  );
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const name = String(url).endsWith(":countTokens") ? "count" : "generate";
      app.events.push(name);
      app.calls.push({ url: String(url), init: init! });
      return name === "count" ? app.count() : app.generate();
    },
  );
  const model = createVertexNavigationModel(
    { ...options, location },
    { accessToken, beforeSend, authorizeGeneration, fetch: fetcher },
  );
  return Object.assign(app, {
    accessToken,
    beforeSend,
    authorizeGeneration,
    fetcher,
    infer: () => model.infer(input, app.context),
  });
}
async function rejection(
  app: ReturnType<typeof harness>,
  code: ModelErrorCode,
  outcome: ModelOutcome,
) {
  const error = await app.infer().then(
    () => {
      throw Error("Expected the adapter to reject");
    },
    (error) => error,
  );
  expect(error).toBeInstanceOf(ModelError);
  expect(error).toMatchObject({ code, outcome });
  const exposed = String(error) + JSON.stringify(error);
  for (const secret of [
    privateProviderText,
    "synthetic-token",
    app.input.observation.context.goal,
    app.input.observation.native.documentId,
  ].filter(Boolean))
    expect(exposed).not.toContain(secret);
  return error as ModelError;
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each([
  ["global", "aiplatform.googleapis.com"],
  ["us", "aiplatform.us.rep.googleapis.com"],
  ["eu", "aiplatform.eu.rep.googleapis.com"],
] as const)(
  "Vertex %s uses its exact v1 host, current JSON wire contract and measured usage",
  async (location, host) => {
    const app = harness(location);
    app.accessToken
      .mockResolvedValueOnce("first-token")
      .mockResolvedValueOnce("fresh-token");
    const result = await app.infer();
    expect(result.proposal).toEqual(app.proposal);
    expect(result.usage).toEqual({
      provider: "vertex",
      source: "measured",
      model: options.model,
      promptTokens: 100,
      outputTokens: 20,
      thoughtTokens: 5,
      cachedTokens: 10,
      totalTokens: 125,
    });
    expect(app.events).toEqual([
      "send:count",
      "count",
      "authorize",
      "send:generate",
      "generate",
    ]);
    expect(app.calls.map((call) => call.url)).toEqual(
      ["countTokens", "generateContent"].map(
        (method) =>
          `https://${host}/v1/projects/${options.project}/locations/${location}/publishers/google/models/${options.model}:${method}`,
      ),
    );
    const [count, generate] = app.calls.map((call) =>
      JSON.parse(String(call.init.body)),
    );
    const { model, ...countContent } = count;
    expect(model).toContain(
      `/locations/${location}/publishers/google/models/${options.model}`,
    );
    expect(countContent).toEqual(generate);
    expect(generate.generationConfig).toMatchObject({
      candidateCount: 1,
      maxOutputTokens: 2048,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseFormat: [
        {
          text: {
            mimeType: "APPLICATION_JSON",
            schema: { anyOf: expect.any(Array) },
          },
        },
      ],
    });
    for (const retired of [
      "responseSchema",
      "responseJsonSchema",
      "responseMimeType",
    ])
      expect(generate.generationConfig).not.toHaveProperty(retired);
    const variants =
      generate.generationConfig.responseFormat[0].text.schema.anyOf;
    expect(
      variants.map((variant: any) => variant.properties.kind.enum[0]).sort(),
    ).toEqual(["clarify", "guide", "request-observation", "unsupported"]);
    expect(JSON.stringify(variants)).not.toContain("$ref");
    const payload = JSON.parse(generate.contents[0].parts[0].text);
    expect(payload.controls[0].reference).toEqual(app.proposal.reference);
    expect(payload.frames[0]).not.toHaveProperty("native");
    for (const excluded of ["stamp", "native", "observedAtMs", "deadlineAtMs"])
      expect(payload).not.toHaveProperty(excluded);
    expect(JSON.stringify(generate)).not.toContain(
      app.input.observation.stamp.sessionId,
    );
    expect(generate).not.toHaveProperty("tools");
    expect(generate).not.toHaveProperty("cachedContent");
    expect(app.calls[0].init.headers).toMatchObject({
      Authorization: "Bearer first-token",
      "x-goog-user-project": options.project,
    });
    expect(app.calls[1].init.headers).toMatchObject({
      Authorization: "Bearer fresh-token",
    });
    for (const call of app.calls)
      expect(call.init).toMatchObject({
        method: "POST",
        redirect: "error",
        credentials: "omit",
        signal: expect.any(AbortSignal),
      });
    expect(app.authorizeGeneration).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      { inputTokens: 100, maxOutputTokens: 2048 },
    );
  },
);

test.each([
  { api: "v1beta1" },
  { project: "https://private.invalid" },
  { location: "us-central1" },
  { model: "gemini-2.5-flash" },
  { retentionProfile: "zero-retention" },
  { endpoint: "https://private.invalid" },
])("Vertex rejects unapproved operator options %j", (changes) => {
  expect(() => validateVertexModelOptions({ ...options, ...changes })).toThrow(
    ModelError,
  );
});

test("Vertex sends only admitted inline PNG bytes and their useful geometry, without capture identifiers", async () => {
  const app = harness();
  const image = navigationModelCapture(app.input.observation);
  await app.infer();
  const body = JSON.parse(String(app.calls[1].init.body));
  expect(body.contents[0].parts[1]).toEqual({
    inlineData: { mimeType: "image/png", data: image.image },
  });
  const geometry = JSON.parse(body.contents[0].parts[0].text).images[0];
  expect(geometry).toEqual({
    width: image.width,
    height: image.height,
    source: image.source,
  });
  for (const excluded of [
    "captureId",
    "maskedAtMs",
    "capturedAtMs",
    "stamp",
    "native",
  ])
    expect(geometry).not.toHaveProperty(excluded);
  expect(JSON.stringify(body)).not.toContain(image.captureId);
});

test.each(["maxImages", "maxImageBytes", "maxImagePixels"] as const)(
  "a lower %s image budget rejects before credentials or egress",
  async (key) => {
    const app = harness();
    navigationModelCapture(app.input.observation);
    app.input.budget[key] = key === "maxImages" ? 0 : 1;
    await rejection(app, "BUDGET_EXCEEDED", "not-sent");
    expect(app.accessToken).not.toHaveBeenCalled();
    expect(app.fetcher).not.toHaveBeenCalled();
    expect(app.authorizeGeneration).not.toHaveBeenCalled();
  },
);

test("invalid observation contracts do not probe ADC or send content", async () => {
  const app = harness();
  app.input.observation.context.goal = "";
  await rejection(app, "INVALID_INPUT", "not-sent");
  expect(app.accessToken).not.toHaveBeenCalled();
  expect(app.fetcher).not.toHaveBeenCalled();
});

test.each([undefined, 0, -1, 1.5, "100"])(
  "invalid provider token count %s cannot authorize generation",
  async (totalTokens) => {
    const app = harness();
    app.count = () => Response.json({ totalTokens });
    await rejection(app, "INVALID_USAGE", "not-sent");
    expect(app.calls).toHaveLength(1);
    expect(app.authorizeGeneration).not.toHaveBeenCalled();
  },
);

test("an actual input token count over budget stops before permit and generation", async () => {
  const app = harness();
  app.input.budget.maxInputTokens = 99;
  await rejection(app, "BUDGET_EXCEEDED", "not-sent");
  expect(app.calls).toHaveLength(1);
  expect(app.authorizeGeneration).not.toHaveBeenCalled();
});

test("generation requires the application permit and rechecks cancellation after the final credential wait", async () => {
  const denied = harness();
  denied.authorizeGeneration.mockRejectedValue(
    new ModelError("BUDGET_EXCEEDED"),
  );
  await rejection(denied, "BUDGET_EXCEEDED", "not-sent");
  expect(denied.calls).toHaveLength(1);
  expect(denied.accessToken).toHaveBeenCalledTimes(1);
  const cancelled = harness();
  cancelled.accessToken
    .mockImplementationOnce(async () => "first-token")
    .mockImplementationOnce(async () => {
      cancelled.controller.abort();
      return "late-token";
    });
  await rejection(cancelled, "CANCELLED", "not-sent");
  expect(cancelled.authorizeGeneration).toHaveBeenCalledTimes(1);
  expect(cancelled.calls).toHaveLength(1);
});

test("every egress approval follows fresh credentials and immediately precedes its own request", async () => {
  const app = harness();
  await app.infer();
  expect(app.events).toEqual([
    "credentials",
    "send:count",
    "count",
    "authorize",
    "credentials",
    "send:generate",
    "generate",
  ]);
  expect(app.beforeSend.mock.calls.map((call) => call[1])).toEqual([
    "count",
    "generate",
  ]);
});

test.each(["count", "generate"] as const)(
  "an expired approval at the %s send prevents that request after credentials",
  async (phase) => {
    const app = harness();
    app.beforeSend.mockImplementation(async (_signal, next) => {
      if (next === phase) throw new ModelError("BUDGET_EXCEEDED");
    });
    await rejection(app, "BUDGET_EXCEEDED", "not-sent");
    expect(app.accessToken).toHaveBeenCalledTimes(phase === "count" ? 1 : 2);
    expect(app.calls).toHaveLength(phase === "count" ? 0 : 1);
    expect(app.authorizeGeneration).toHaveBeenCalledTimes(
      phase === "count" ? 0 : 1,
    );
  },
);

test.each(["count", "generate"] as const)(
  "cancellation during the final %s approval cannot dispatch the request",
  async (phase) => {
    const app = harness();
    app.beforeSend.mockImplementation(async (_signal, next) => {
      if (next === phase) app.controller.abort();
    });
    await rejection(app, "CANCELLED", "not-sent");
    expect(app.calls).toHaveLength(phase === "count" ? 0 : 1);
  },
);

test.each(["count", "generate"] as const)(
  "an uncooperative final %s approval is bounded before dispatch",
  async (phase) => {
    vi.useFakeTimers();
    const app = harness();
    app.context.deadlineAt = Date.now() + 20;
    app.beforeSend.mockImplementation(async (_signal, next) => {
      if (next === phase) await new Promise(() => {});
    });
    const pending = rejection(app, "DEADLINE_EXCEEDED", "not-sent");
    await vi.advanceTimersByTimeAsync(21);
    await pending;
    expect(app.calls).toHaveLength(phase === "count" ? 0 : 1);
  },
);

test.each(["abort", "expired", "excessive"] as const)(
  "%s context admission performs no work",
  async (kind) => {
    const app = harness();
    if (kind === "abort") app.controller.abort();
    else
      app.context.deadlineAt = Date.now() + (kind === "expired" ? -1 : 30_000);
    await rejection(
      app,
      kind === "abort"
        ? "CANCELLED"
        : kind === "expired"
          ? "DEADLINE_EXCEEDED"
          : "BUDGET_EXCEEDED",
      "not-sent",
    );
    expect(app.accessToken).not.toHaveBeenCalled();
    expect(app.fetcher).not.toHaveBeenCalled();
  },
);

test("an uncooperative credential supplier is bounded by the actual server deadline", async () => {
  vi.useFakeTimers();
  const app = harness();
  app.context.deadlineAt = Date.now() + 20;
  app.accessToken.mockImplementation(() => new Promise(() => {}));
  const pending = rejection(app, "DEADLINE_EXCEEDED", "not-sent");
  await vi.advanceTimersByTimeAsync(21);
  await pending;
  expect(app.fetcher).not.toHaveBeenCalled();
});

test.each(["count", "generation"] as const)(
  "an invalid %s response media type closes its unread body",
  async (stage) => {
    const app = harness();
    const cancel = vi.fn();
    app[stage === "count" ? "count" : "generate"] = () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Type": "text/plain" },
      });
    await rejection(
      app,
      "INVALID_OUTPUT",
      stage === "count" ? "not-sent" : "unknown",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

test.each(["count", "generation"] as const)(
  "a stalled %s body read is cancelled by the deadline",
  async (stage) => {
    vi.useFakeTimers();
    const app = harness();
    app.context.deadlineAt = Date.now() + 20;
    const cancel = vi.fn();
    app[stage === "count" ? "count" : "generate"] = () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Type": "application/json" },
      });
    const pending = rejection(
      app,
      "DEADLINE_EXCEEDED",
      stage === "count" ? "not-sent" : "unknown",
    );
    await vi.advanceTimersByTimeAsync(21);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

test.each(["count", "generation"] as const)(
  "a streamed oversized %s reply is cancelled without trusting Content-Length",
  async (stage) => {
    const app = harness();
    app.input.budget.maxResponseBytes = 100;
    const cancel = vi.fn();
    app[stage === "count" ? "count" : "generate"] = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(" ".repeat(101)));
          },
          cancel,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "1",
          },
        },
      );
    await rejection(
      app,
      "BUDGET_EXCEEDED",
      stage === "count" ? "not-sent" : "unknown",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

test.each(["count", "generation"] as const)(
  "raw %s HTTP errors remain sanitized and never retry",
  async (stage) => {
    const app = harness();
    app[stage === "count" ? "count" : "generate"] = () =>
      new Response(privateProviderText, {
        status: 429,
        headers: { "Retry-After": "120" },
      });
    const error = await rejection(
      app,
      "THROTTLED",
      stage === "count" ? "not-sent" : "unknown",
    );
    expect(error.retryAfterMs).toBe(60000);
    expect(app.calls).toHaveLength(stage === "count" ? 1 : 2);
  },
);

test("a post-dispatch network failure has unknown outcome and cannot cause a second generation", async () => {
  const app = harness();
  app.generate = async () => {
    throw Error(privateProviderText);
  };
  await rejection(app, "UNAVAILABLE", "unknown");
  expect(app.calls).toHaveLength(2);
});

test.each([
  [
    "missing",
    (value: any) => {
      delete value.usageMetadata;
    },
  ],
  [
    "mismatched total",
    (value: any) => {
      value.usageMetadata.totalTokenCount++;
    },
  ],
  [
    "negative",
    (value: any) => {
      value.usageMetadata.promptTokenCount = -1;
    },
  ],
  [
    "foreign model",
    (value: any) => {
      value.modelVersion = privateProviderText;
    },
  ],
  [
    "impossible cache",
    (value: any) => {
      value.usageMetadata.cachedContentTokenCount = 101;
    },
  ],
  [
    "unrequested tool usage",
    (value: any) => {
      value.usageMetadata.toolUsePromptTokenCount = 1;
    },
  ],
] as const)(
  "%s usage is not fabricated as a free response",
  async (_name, mutate) => {
    const app = harness();
    mutate(app.result);
    await rejection(app, "INVALID_USAGE", "unknown");
    expect(app.calls).toHaveLength(2);
  },
);

test("over-budget measured usage is retained for reconciliation", async () => {
  const app = harness();
  app.input.budget.maxOutputTokens = 24;
  const error = await rejection(app, "BUDGET_EXCEEDED", "reported");
  expect(error.usage?.totalTokens).toBe(125);
  expect(error.usage?.thoughtTokens).toBe(5);
});

test.each([
  [
    "truncation",
    "BUDGET_EXCEEDED",
    (value: any) => {
      value.candidates[0].finishReason = "MAX_TOKENS";
    },
  ],
  [
    "safety refusal",
    "PROVIDER_ERROR",
    (value: any) => {
      value.candidates[0].finishReason = "SAFETY";
    },
  ],
  [
    "blocked prompt",
    "PROVIDER_ERROR",
    (value: any) => {
      value.promptFeedback = { blockReason: "SAFETY" };
      value.candidates = [];
    },
  ],
  [
    "tool invocation",
    "INVALID_OUTPUT",
    (value: any) => {
      value.candidates[0].content.parts[0] = {
        functionCall: { name: privateProviderText },
      };
    },
  ],
  [
    "multiple candidates",
    "INVALID_OUTPUT",
    (value: any) => {
      value.candidates.push(value.candidates[0]);
    },
  ],
  [
    "invalid JSON",
    "INVALID_OUTPUT",
    (value: any) => {
      value.candidates[0].content.parts[0].text =
        "```json\n" + privateProviderText;
    },
  ],
  [
    "unknown proposal fields",
    "INVALID_OUTPUT",
    (value: any) => {
      value.candidates[0].content.parts[0].text = JSON.stringify({
        kind: "unsupported",
        reason: "No supported target.",
        execute: privateProviderText,
      });
    },
  ],
] as const)(
  "%s is rejected while preserving measured provider usage",
  async (_name, code, mutate) => {
    const app = harness();
    mutate(app.result);
    const error = await rejection(app, code, "reported");
    expect(error.usage?.totalTokens).toBe(125);
  },
);

test("invalid UTF8 and redirected replies cannot become accepted JSON", async () => {
  const malformed = harness();
  malformed.generate = () =>
    new Response(new Uint8Array([255]), {
      headers: { "Content-Type": "application/json" },
    });
  await rejection(malformed, "INVALID_OUTPUT", "unknown");
  const redirected = harness();
  redirected.count = () => {
    const reply = Response.json({ totalTokens: 100 });
    Object.defineProperty(reply, "redirected", { value: true });
    return reply;
  };
  await rejection(redirected, "INVALID_OUTPUT", "not-sent");
  expect(redirected.calls).toHaveLength(1);
});
