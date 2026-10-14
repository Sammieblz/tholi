import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApi } from "../../apps/api/src/server";
import { NavigationCore } from "../../packages/navigation-core";
import { MiniLM, SemanticIndex, MemoryDerivedStore } from "../../packages/nlp";
import { appFixture } from "./fixtures";
import {
  beginJourney,
  saveTask,
} from "../../packages/goal-planner/task-journey";
test("v2 real-model API parity, capabilities, authentication, privacy, persistence and deletion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "navigator-v2-")),
    database = join(directory, "test.sqlite"),
    token = "b".repeat(64),
    origin = "chrome-extension://" + "a".repeat(32);
  const options = {
      database,
      token,
      origins: [origin],
      models: resolve("assets/models"),
      worker: new URL("../../apps/api/dist/inference.js", import.meta.url),
    },
    headers = { authorization: "Bearer " + token, origin };
  let api = await createApi(options);
  const model = new MiniLM(resolve("assets/models") + "/"),
    core = new NavigationCore(
      new SemanticIndex(model, new MemoryDerivedStore()),
    );
  try {
    expect((await api.inject({ url: "/v2/health" })).statusCode).toBe(401);
    expect(
      (
        await api.inject({
          url: "/v2/health",
          headers: { ...headers, origin: "https://other.test" },
        })
      ).statusCode,
    ).toBe(403);
    const health = (await api.inject({ url: "/v2/health", headers })).json();
    expect(health.protocols).toEqual([1, 2]);
    expect(health.guides).toHaveLength(10);
    const observation = appFixture("cloudflare", "https://dash.cloudflare.com");
    observation.controls.push({
      ...observation.controls[0],
      id: "w1111111111111111-0",
      signature: "secret-item",
      label: "private-customer-repository",
      context: "private-customer-account",
    });
    const input = {
      requestId: crypto.randomUUID(),
      documentId: "v2doc",
      revision: observation.revision,
      observation,
      text: "Please help me publish a Pages website",
      strategy: "fastest" as const,
      protocolVersion: 2 as const,
      contextRevision: 7,
    };
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/observations",
          headers,
          payload: { observation },
        })
      ).statusCode,
    ).toBe(200);
    const envelope = {
      protocolVersion: 2,
      reference: { tabId: 7, frameId: 0, documentId: "delta-doc" },
      observation,
    };
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/observations",
          headers,
          payload: envelope,
        })
      ).statusCode,
    ).toBe(200);
    const delta = {
      protocolVersion: 2,
      documentId: "delta-doc",
      frameId: 0,
      baseRevision: observation.revision,
      revision: observation.revision + 1,
      upserts: [],
      removed: [observation.controls.at(-1)!.id],
      coverage: [],
    };
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/observations",
          headers,
          payload: delta,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/observations",
          headers,
          payload: delta,
        })
      ).statusCode,
    ).toBe(409);
    const response = await api.inject({
      method: "POST",
      url: "/v2/plans",
      headers,
      payload: input,
    });
    expect(response.statusCode, response.body).toBe(200);
    const remote = response.json(),
      local = await core.plan(input);
    expect(remote.plan).toEqual(local.plan);
    expect(remote.clarification).toEqual(local.clarification);
    expect(remote.contextRevision).toBe(7);
    expect(remote.workflow.objective).toBe(local.workflow?.objective);
    const choice = {
      ...input,
      request: remote.request,
      workflow: remote.workflow,
      choice: "workflow:method:git",
    };
    const planned = (
      await api.inject({
        method: "POST",
        url: "/v2/plans",
        headers,
        payload: choice,
      })
    ).json();
    expect(planned.plan.steps[0].label).toBe("Workers & Pages");
    const spec = (
      await api.inject({ url: "/v2/openapi.json", headers })
    ).json();
    expect(spec.paths["/v1/plans"]).toBeDefined();
    expect(spec.paths["/v2/plans"]).toBeDefined();
    const suggestion = await api.inject({
      method: "POST",
      url: "/v2/suggestions",
      headers,
      payload: { ...input, text: "Find Search" },
    });
    expect(suggestion.statusCode, suggestion.body).toBe(200);
    expect(suggestion.json().contextRevision).toBe(7);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/plans",
          headers,
          payload: { ...input, revision: 999 },
        })
      ).statusCode,
    ).toBe(400);
    const route = saveTask(
      beginJourney("Deploy private-customer-repository", observation.origin),
    );
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/routes",
          headers,
          payload: route,
        })
      ).statusCode,
    ).toBe(200);
    await api.close();
    api = await createApi(options);
    const routes = (
      await api.inject({
        url: "/v2/routes?origin=" + encodeURIComponent(observation.origin),
        headers,
      })
    ).json().routes;
    expect(routes).toHaveLength(1);
    expect(JSON.stringify(routes)).not.toContain("private-customer");
    const db = new DatabaseSync(database);
    try {
      for (const table of ["sites", "routes", "indexes", "embeddings"]) {
        const rows = db.prepare(`SELECT * FROM ${table}`).all();
        expect(JSON.stringify(rows)).not.toContain("private-customer");
      }
    } finally {
      db.close();
    }
    await api.inject({
      method: "POST",
      url: "/v2/forget",
      headers,
      payload: { origin: observation.origin },
    });
    expect(
      (
        await api.inject({
          url: "/v2/routes?origin=" + encodeURIComponent(observation.origin),
          headers,
        })
      ).json().routes,
    ).toEqual([]);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/clear",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await api.close();
    await model.dispose();
    if (
      !resolve(directory).startsWith(resolve(tmpdir()) + sep) ||
      !directory.includes("navigator-v2-")
    )
      throw Error("Unsafe cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});
