import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { withoutExternalModels } from "../../support/provider-network-guard";
import { createCustomerNavigationModel } from "../../../apps/api/src/adapters/customer-navigation-model";
import {
  CUSTOMER_PROVIDER_ENDPOINTS,
  CUSTOMER_PROVIDER_COUNT_ENDPOINTS,
} from "../../../apps/api/src/adapters/provider-network";
import { providerRoutingPolicyDigest } from "../../../apps/api/src/application/provider-connections";
import {
  ModelError,
  resolveModelBudget,
} from "../../../apps/api/src/application/model-contracts";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  type ProviderId,
} from "../../../packages/navigation-core/contracts-providers";
import {
  navigationModelObservation,
  navigationModelCapture,
} from "../../support/navigation-model-fixture";

const providers = ["openai", "anthropic", "openrouter"] as const;
test("the automated network guard blocks customer and managed model endpoints before DNS or dispatch", async () => {
  const network = vi.fn<typeof fetch>();
  const guarded = withoutExternalModels(network);
  for (const endpoint of [
    ...Object.values(CUSTOMER_PROVIDER_ENDPOINTS),
    ...Object.values(CUSTOMER_PROVIDER_COUNT_ENDPOINTS),
    "https://aiplatform.googleapis.com/v1/publishers/google/models/test:generateContent",
    "https://us-central1-aiplatform.googleapis.com/v1/test",
    "https://generativelanguage.googleapis.com/v1/test",
  ])
    await expect(guarded(endpoint)).rejects.toThrow(
      "External model requests are disabled",
    );
  expect(network).not.toHaveBeenCalled();
});
function harness(provider: ProviderId) {
  const definition = getProviderDefinition(provider),
    selection = {
      connectionId: randomUUID(),
      provider,
      model: definition.model,
      catalogRevision: PROVIDER_CATALOG_REVISION,
      routingPolicyVersion: definition.routingPolicyVersion,
      policyDigest: providerRoutingPolicyDigest(provider),
      revision: "1",
    };
  const controller = new AbortController(),
    input = {
      observation: navigationModelObservation(),
      budget: resolveModelBudget(),
    };
  const proposal = {
    kind: "guide",
    reference: input.observation.controls[0].reference,
    message: "Follow the highlighted Settings control.",
  };
  const text = JSON.stringify({ decision: proposal });
  const result: Record<string, unknown> =
    provider === "openai"
      ? {
          model: definition.model,
          status: "completed",
          output: [
            { type: "reasoning", summary: [] },
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text }],
            },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 30,
            total_tokens: 130,
            input_tokens_details: { cached_tokens: 10 },
            output_tokens_details: { reasoning_tokens: 7 },
          },
        }
      : provider === "anthropic"
        ? {
            model: definition.model,
            type: "message",
            role: "assistant",
            stop_reason: "end_turn",
            content: [
              {
                type: "thinking",
                thinking: "synthetic private chain",
                signature: "synthetic",
              },
              { type: "text", text },
            ],
            usage: {
              input_tokens: 80,
              cache_read_input_tokens: 10,
              cache_creation_input_tokens: 10,
              output_tokens: 30,
            },
          }
        : {
            model: definition.model,
            provider: "Anthropic",
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: text },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 30,
              total_tokens: 130,
              prompt_tokens_details: { cached_tokens: 10 },
              completion_tokens_details: { reasoning_tokens: 7 },
            },
          };
  const app = {
    selection,
    controller,
    input,
    proposal,
    result,
    context: {
      requestId: randomUUID(),
      deadlineAt: Date.now() + 10000,
      signal: controller.signal,
    },
    calls: [] as { url: string; init: RequestInit }[],
    events: [] as string[],
    generate: () => Response.json(result),
    count: () => Response.json({ input_tokens: 100 }),
  };
  const beforeSend = vi.fn(
    async (_signal: AbortSignal, stage: "count" | "generate") => {
      app.events.push("check:" + stage);
    },
  );
  async function withCredential<T>(
    _signal: AbortSignal,
    work: (key: string) => Promise<T>,
  ): Promise<T> {
    app.events.push("key");
    return work("synthetic-secret-key");
  }
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const phase =
        String(url).endsWith("input_tokens") ||
        String(url).endsWith("count_tokens")
          ? "count"
          : "generate";
      app.events.push("fetch:" + phase);
      app.calls.push({ url: String(url), init: init! });
      return phase === "count" ? app.count() : app.generate();
    },
  );
  const model = createCustomerNavigationModel(selection, {
    withCredential,
    beforeSend,
    fetch: fetcher,
  });
  return Object.assign(app, {
    withCredential,
    beforeSend,
    fetcher,
    infer: () => model.infer(input, app.context),
  });
}

test.each(providers)(
  "%s uses only its curated endpoint/model, bounded native request and measured usage with reasoning counted once",
  async (provider) => {
    const app = harness(provider),
      result = await app.infer();
    expect(result.proposal).toEqual(app.proposal);
    expect(result.usage).toMatchObject({
      version: 2,
      provider,
      source: "measured",
      model: app.selection.model,
      inputTokens: 100,
      outputTokens: 30,
      totalTokens: 130,
      cacheReadInputTokens: 10,
      reasoningOutputTokens: provider === "anthropic" ? null : 7,
    });
    expect(result.usage).toHaveProperty(
      "cacheWriteInputTokens",
      provider === "anthropic" ? 10 : null,
    );
    expect(app.calls.map((call) => call.url)).toEqual(
      provider === "openrouter"
        ? [CUSTOMER_PROVIDER_ENDPOINTS[provider]]
        : [
            CUSTOMER_PROVIDER_COUNT_ENDPOINTS[provider],
            CUSTOMER_PROVIDER_ENDPOINTS[provider],
          ],
    );
    expect(app.events).toEqual(
      provider === "openrouter"
        ? ["key", "check:generate", "fetch:generate"]
        : [
            "key",
            "check:count",
            "fetch:count",
            "key",
            "check:generate",
            "fetch:generate",
          ],
    );
    for (const call of app.calls) {
      expect(call.init).toMatchObject({
        method: "POST",
        redirect: "error",
        credentials: "omit",
      });
      expect(JSON.parse(String(call.init.body))).toMatchObject({
        model: app.selection.model,
      });
      expect(String(call.init.body)).not.toContain("synthetic-secret-key");
    }
    const wire = JSON.parse(String(app.calls.at(-1)!.init.body));
    expect(wire.stream).toBe(false);
    expect(wire).not.toHaveProperty("tools");
    if (provider === "openai")
      expect(wire).toMatchObject({
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 2048,
        text: {
          format: {
            type: "json_schema",
            strict: true,
            schema: { type: "object", required: ["decision"] },
          },
        },
      });
    if (provider === "anthropic")
      expect(wire).toMatchObject({
        thinking: { type: "adaptive" },
        max_tokens: 2048,
        output_config: { effort: "low", format: { type: "json_schema" } },
      });
    if (provider === "openrouter")
      expect(wire).toMatchObject({
        n: 1,
        reasoning: { effort: "low" },
        provider: {
          only: ["anthropic"],
          allow_fallbacks: false,
          require_parameters: true,
          data_collection: "deny",
        },
        response_format: { json_schema: { strict: true } },
      });
  },
);

test.each(providers)(
  "%s keeps missing required usage unknown and never retries or exposes provider content",
  async (provider) => {
    const app = harness(provider);
    delete app.result.usage;
    app.result.private = "PRIVATE_PROVIDER_BODY";
    const error = await app.infer().catch((error) => error);
    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({ code: "INVALID_USAGE", outcome: "unknown" });
    const exposed = String(error) + JSON.stringify(error);
    for (const secret of [
      "PRIVATE_PROVIDER_BODY",
      "synthetic-secret-key",
      app.input.observation.context.goal,
    ])
      expect(exposed).not.toContain(secret);
    expect(app.fetcher).toHaveBeenCalledTimes(
      provider === "openrouter" ? 1 : 2,
    );
  },
);

test.each(providers)(
  "%s retains measured usage when content/model/finish validation fails",
  async (provider) => {
    const app = harness(provider);
    app.result.model = "unapproved-substitute";
    await expect(app.infer()).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      outcome: "reported",
      usage: { version: 2, totalTokens: 130 },
    });
  },
);

test.each(providers)(
  "%s rechecks authorization after key resolution and immediately before outbound generation",
  async (provider) => {
    const app = harness(provider);
    app.beforeSend.mockImplementation(async (_signal, stage) => {
      if (stage === "generate") throw Error("revoked");
    });
    await expect(app.infer()).rejects.toMatchObject({ outcome: "not-sent" });
    expect(
      app.calls.filter(
        (call) => call.url === CUSTOMER_PROVIDER_ENDPOINTS[provider],
      ),
    ).toHaveLength(0);
  },
);

test.each(providers)(
  "%s cancellation during the dispatch authorization await prevents generation",
  async (provider) => {
    const app = harness(provider);
    app.beforeSend.mockImplementation(async (_signal, stage) => {
      if (stage === "generate") app.controller.abort();
    });
    await expect(app.infer()).rejects.toMatchObject({
      code: "CANCELLED",
      outcome: "not-sent",
    });
    expect(
      app.calls.filter(
        (call) => call.url === CUSTOMER_PROVIDER_ENDPOINTS[provider],
      ),
    ).toHaveLength(0);
  },
);

test.each(providers)(
  "%s bounds generated response bytes and reports unknown outcomes for lost generation responses",
  async (provider) => {
    const app = harness(provider);
    app.input.budget.maxResponseBytes = 1024;
    app.generate = () =>
      new Response(JSON.stringify({ private: "x".repeat(2048) }), {
        headers: { "Content-Type": "application/json" },
      });
    await expect(app.infer()).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      outcome: "unknown",
    });
  },
);

test.each(["openai", "anthropic"] as const)(
  "%s preflight rejects over-budget count without starting generation",
  async (provider) => {
    const app = harness(provider);
    app.count = () => Response.json({ input_tokens: 32769 });
    await expect(app.infer()).rejects.toMatchObject({
      code: "BUDGET_EXCEEDED",
      outcome: "not-sent",
    });
    expect(app.calls).toHaveLength(1);
  },
);

test("OpenRouter never accepts an upstream substitute and uses a local byte/image input ceiling without a synthetic count request", async () => {
  const app = harness("openrouter");
  app.result.provider = "Other upstream";
  await expect(app.infer()).rejects.toMatchObject({
    code: "INVALID_OUTPUT",
    outcome: "reported",
  });
  const tight = harness("openrouter");
  tight.input.budget.maxInputTokens = 100;
  await expect(tight.infer()).rejects.toMatchObject({
    code: "BUDGET_EXCEEDED",
    outcome: "not-sent",
  });
  expect(tight.calls).toHaveLength(0);
});

test("unreported optional usage breakdowns stay null and incomplete Anthropic cache accounting stays unknown", async () => {
  for (const provider of ["openai", "openrouter"] as const) {
    const app = harness(provider);
    app.result.usage =
      provider === "openai"
        ? { input_tokens: 100, output_tokens: 30, total_tokens: 130 }
        : { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 };
    expect((await app.infer()).usage).toMatchObject({
      cacheReadInputTokens: null,
      cacheWriteInputTokens: null,
      reasoningOutputTokens: null,
    });
  }
  const app = harness("anthropic");
  app.result.usage = { input_tokens: 100, output_tokens: 30 };
  await expect(app.infer()).rejects.toMatchObject({
    code: "INVALID_USAGE",
    outcome: "unknown",
  });
});

test.each(providers)(
  "%s includes masked image bytes and historical untrusted hints in the same counted request budget",
  async (provider) => {
    const app = harness(provider);
    const image = navigationModelCapture(app.input.observation);
    const knowledge = {
      version: 1 as const,
      facts: [
        {
          kind: "observed-route" as const,
          steps: [
            {
              role: "button" as const,
              label: "Settings",
              kind: "control" as const,
              operation: "reveal" as const,
            },
          ],
          observedAt: "2026-11-05T12:00:00.000Z",
          successes: 1,
          failures: 0,
        },
      ],
    };
    const model = createCustomerNavigationModel(app.selection, {
      withCredential: app.withCredential,
      beforeSend: app.beforeSend,
      fetch: app.fetcher,
    });
    await model.infer({ ...app.input, knowledge }, app.context);
    for (const call of app.calls) {
      const body = String(call.init.body);
      expect(body).toContain(image.image);
      expect(body).toContain("historicalHints");
      expect(body).toContain("potentially stale evidence");
      expect(body).not.toContain("artifactId");
    }
  },
);

test("catalog policy and model selection cannot be substituted through factory input", () => {
  const app = harness("openai"),
    dependencies = {
      withCredential: app.withCredential,
      beforeSend: app.beforeSend,
      fetch: app.fetcher,
    };
  for (const changed of [
    { model: "other" },
    { catalogRevision: "other" },
    { routingPolicyVersion: "other" },
    { policyDigest: "f".repeat(64) },
  ])
    expect(() =>
      createCustomerNavigationModel(
        { ...app.selection, ...changed },
        dependencies,
      ),
    ).toThrow(ModelError);
});

type SocketScenario =
  | "success"
  | "refusal"
  | "output-limit"
  | "truncated"
  | "throttled"
  | "timeout"
  | "invalid-usage"
  | "stream-limit";
test.each(providers)(
  "%s crosses a real local HTTP socket with guarded auth, success, refusals, truncation, throttling, deadline and bounded usage/stream failure",
  async (provider) => {
    const app = harness(provider),
      nativeFetch = globalThis.fetch;
    let scenario: SocketScenario = "success";
    const requests: {
      path: string;
      authorization: string | undefined;
      apiKey: string | undefined;
      version: string | undefined;
      body: Record<string, unknown>;
    }[] = [];
    const pending = new Set<ServerResponse>();
    const server = createServer((request, response) => {
      void (async () => {
        const parts: Buffer[] = [];
        for await (const chunk of request)
          parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body: Record<string, unknown> = JSON.parse(
          Buffer.concat(parts).toString("utf8"),
        );
        requests.push({
          path: request.url!,
          authorization: request.headers.authorization,
          apiKey: request.headers["x-api-key"] as string | undefined,
          version: request.headers["anthropic-version"] as string | undefined,
          body,
        });
        response.setHeader("Content-Type", "application/json");
        if (
          request.url?.endsWith("input_tokens") ||
          request.url?.endsWith("count_tokens")
        ) {
          response.end(JSON.stringify({ input_tokens: 100 }));
          return;
        }
        if (scenario === "timeout") {
          pending.add(response);
          response.once("close", () => pending.delete(response));
          return;
        }
        if (scenario === "throttled") {
          response.statusCode = 429;
          response.setHeader("Retry-After", "2");
          response.end(
            JSON.stringify({ error: { message: "PRIVATE_PROVIDER_ERROR" } }),
          );
          return;
        }
        if (scenario === "truncated") {
          response.write('{"usage":');
          response.flushHeaders();
          response.socket?.destroy();
          return;
        }
        if (scenario === "stream-limit") {
          response.write('{"private":"');
          for (let part = 0; part < 40; part++)
            response.write("x".repeat(1024));
          response.end('"}');
          return;
        }
        const result = structuredClone(app.result);
        if (scenario === "invalid-usage") delete result.usage;
        if (scenario === "refusal") {
          if (provider === "openai")
            result.output = [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "refusal", refusal: "PRIVATE_REFUSAL" }],
              },
            ];
          else if (provider === "anthropic") result.stop_reason = "refusal";
          else
            result.choices = [
              {
                finish_reason: "content_filter",
                message: { role: "assistant", content: "PRIVATE_REFUSAL" },
              },
            ];
        }
        if (scenario === "output-limit") {
          if (provider === "openai") result.status = "incomplete";
          else if (provider === "anthropic") result.stop_reason = "max_tokens";
          else
            result.choices = [
              {
                finish_reason: "length",
                message: { role: "assistant", content: "partial" },
              },
            ];
        }
        response.end(JSON.stringify(result));
      })().catch(() => {
        response.statusCode = 500;
        response.end('{"error":"synthetic fixture failure"}');
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing local fixture address.");
    const localOrigin = `http://127.0.0.1:${address.port}`;
    const guard = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((target, init) => {
        const url = new URL(String(target));
        if (url.origin !== localOrigin)
          throw Error("External HTTP is disabled in provider fixtures.");
        return nativeFetch(target, init);
      });
    const localFetch: typeof fetch = (target, init) => {
      const canonical = String(target);
      const allowed: string[] = [
        CUSTOMER_PROVIDER_ENDPOINTS[provider],
        ...(provider === "openrouter"
          ? []
          : [CUSTOMER_PROVIDER_COUNT_ENDPOINTS[provider]]),
      ];
      if (!allowed.includes(canonical))
        throw Error("Unapproved provider destination.");
      return globalThis.fetch(localOrigin + new URL(canonical).pathname, init);
    };
    try {
      const model = createCustomerNavigationModel(app.selection, {
        withCredential: app.withCredential,
        beforeSend: app.beforeSend,
        fetch: localFetch,
      });
      const invoke = () =>
        model.infer(app.input, {
          ...app.context,
          deadlineAt: Date.now() + (scenario === "timeout" ? 120 : 5000),
        });
      const success = await invoke();
      expect(success.proposal).toEqual(app.proposal);
      expect(success.usage.totalTokens).toBe(130);
      for (const next of [
        "refusal",
        "output-limit",
        "truncated",
        "throttled",
        "timeout",
        "invalid-usage",
        "stream-limit",
      ] as const) {
        scenario = next;
        const before = requests.length;
        const error = await invoke().then(
          () => {
            throw Error("Expected rejection.");
          },
          (error) => error,
        );
        expect(error).toBeInstanceOf(ModelError);
        expect(error.outcome).toBe(
          ["refusal", "output-limit"].includes(next) ? "reported" : "unknown",
        );
        if (next === "output-limit" || next === "stream-limit")
          expect(error.code).toBe("BUDGET_EXCEEDED");
        if (next === "throttled")
          expect(error).toMatchObject({
            code: "THROTTLED",
            retryAfterMs: 2000,
          });
        if (next === "timeout") expect(error.code).toBe("DEADLINE_EXCEEDED");
        if (next === "invalid-usage") expect(error.code).toBe("INVALID_USAGE");
        expect(requests.length - before).toBe(
          provider === "openrouter" ? 1 : 2,
        );
        for (const value of [
          "synthetic-secret-key",
          "PRIVATE_REFUSAL",
          "PRIVATE_PROVIDER_ERROR",
        ])
          expect(String(error) + JSON.stringify(error)).not.toContain(value);
      }
      for (const request of requests) {
        expect(request.body.model).toBe(app.selection.model);
        expect(request.body).not.toHaveProperty("apiKey");
        if (provider === "anthropic") {
          expect(request.apiKey).toBe("synthetic-secret-key");
          expect(request.version).toBe(
            getProviderDefinition("anthropic").requestPolicy.anthropicVersion,
          );
          expect(request.authorization).toBeUndefined();
        } else {
          expect(request.authorization).toBe("Bearer synthetic-secret-key");
          expect(request.apiKey).toBeUndefined();
        }
      }
      expect(
        guard.mock.calls.every(
          ([target]) => new URL(String(target)).origin === localOrigin,
        ),
      ).toBe(true);
    } finally {
      guard.mockRestore();
      for (const response of pending) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
