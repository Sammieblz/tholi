import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApi } from "../../../apps/api/src/server";
import apiPackage from "../../../apps/api/package.json";
import {
  MiniLM,
  SemanticIndex,
  MemoryDerivedStore,
} from "../../../packages/nlp/index";
import { NavigationCore } from "../../../packages/navigation-core/index";
import { fixture } from "./fixtures";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
test("authenticated API uses the shared real NLP core, explicit CORS, SQLite persistence and deletion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "navigator-api-test-")),
    database = join(directory, "test.sqlite"),
    token = "a".repeat(64),
    origin = "chrome-extension://" + "a".repeat(32),
    firefoxOrigin = "moz-extension://01234567-89ab-cdef-0123-456789abcdef";
  const options = {
    database,
    token,
    origins: [origin, firefoxOrigin],
    models: resolve("assets/models"),
    worker: new URL("../../../apps/api/dist/inference.js", import.meta.url),
  };
  let app = await createApi(options);
  const model = new MiniLM(resolve("assets/models") + "/"),
    core = new NavigationCore(
      new SemanticIndex(model, new MemoryDerivedStore()),
    );
  const headers = { authorization: "Bearer " + token, origin };
  try {
    expect((await app.inject({ url: "/v1/health" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/v1/health",
          headers: { ...headers, origin: "https://untrusted.test" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/v1/health", headers })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          url: "/v1/health",
          headers: { ...headers, origin: firefoxOrigin },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/v1/health",
          headers: {
            ...headers,
            origin: firefoxOrigin.replace("01234567", "ffffffff"),
          },
        })
      ).statusCode,
    ).toBe(403);
    await expect(
      createApi({ ...options, origins: ["moz-extension://*"] }),
    ).rejects.toThrow("explicitly name");
    const observation = fixture(),
      input = {
        requestId: crypto.randomUUID(),
        documentId: "api-fixture",
        revision: 1,
        observation,
        text: "Can you help me find Languages?",
        strategy: "fastest" as const,
      };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/observations",
          headers,
          payload: { observation },
        })
      ).statusCode,
    ).toBe(200);
    const response = await app.inject({
      method: "POST",
      url: "/v1/plans",
      headers,
      payload: input,
    });
    expect(response.statusCode, response.body).toBe(200);
    const local = await core.plan(input),
      remote = response.json();
    expect(remote.plan).toEqual(local.plan);
    expect(
      remote.request.tasks.map((t: any) => ({
        target: t.target,
        operation: t.operation,
      })),
    ).toEqual(
      local.request!.tasks.map((t) => ({
        target: t.target,
        operation: t.operation,
      })),
    );
    const specification = (
      await app.inject({ url: "/v1/openapi.json", headers })
    ).json();
    expect(specification.paths["/v1/plans"]).toBeDefined();
    expect(specification.info).toMatchObject({
      title: "Tholi single-owner API",
      version: apiPackage.version,
    });
    const route = saveTask(beginJourney("Open Languages", observation.origin));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/routes",
          headers,
          payload: route,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/plans",
          headers,
          payload: { ...input, revision: 2 },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
    app = await createApi(options);
    expect(
      (
        await app.inject({
          url: "/v1/routes?origin=" + encodeURIComponent(observation.origin),
          headers,
        })
      ).json().routes,
    ).toEqual([route]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/routes/" + route.id,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/v1/routes?origin=" + encodeURIComponent(observation.origin),
          headers,
        })
      ).json().routes,
    ).toEqual([]);
    const suggestions = await app.inject({
      method: "POST",
      url: "/v1/suggestions",
      headers,
      payload: input,
    });
    expect(suggestions.statusCode, suggestions.body).toBe(200);
    expect(suggestions.json().suggestions[0].label).toBe("Languages");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/forget",
          headers,
          payload: { origin: observation.origin },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/plans",
          headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/clear",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    await model.dispose();
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir())) ||
      !target.includes("navigator-api-test-")
    )
      throw new Error("Unsafe test cleanup");
    await rm(target, { recursive: true, force: true });
  }
});
