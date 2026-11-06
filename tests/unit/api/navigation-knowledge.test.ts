import { expect, test } from "vitest";
import { rankNavigationKnowledge } from "../../../apps/api/src/application/navigation-knowledge";
import {
  assertNavigationKnowledgeKeys,
  navigationKnowledgeSnapshotDigest,
  navigationKnowledgeQuerySchema,
  serializeNavigationKnowledge,
} from "../../../packages/navigation-core/contracts-navigation-knowledge";
import { savedDataArtifactSchema } from "../../../packages/navigation-core/contracts-saved-data";
import { savedNavigationKnowledgeFixture } from "../../support/saved-data-fixture";

test("private navigation hints require fresh matching structure and fit the remaining perception budget", async () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const artifact = await savedNavigationKnowledgeFixture(
    undefined,
    new Date(now).toISOString(),
  );
  const query = navigationKnowledgeQuerySchema.parse({
    origin: artifact.data.origin,
    query: "Find Help",
    controls: [{ role: "button", label: "Settings", kind: "control" }],
  });
  const record = {
    id: artifact.id,
    revision: "1",
    updatedAt: new Date(now).toISOString(),
    data: artifact.data,
  };
  const signal = new AbortController().signal;
  const ranked = await rankNavigationKnowledge(query, [record], signal, now);
  expect(ranked.context?.facts[0].steps[0].label).toBe("Settings");
  expect(ranked.sources).toEqual([{ artifactId: artifact.id, revision: "1" }]);
  expect(JSON.stringify(ranked.context)).not.toMatch(
    new RegExp(`${artifact.id}|${artifact.data.states[0].key}`),
  );
  expect(
    (
      await rankNavigationKnowledge(
        { ...query, maxContextBytes: 0 },
        [record],
        signal,
        now,
      )
    ).context,
  ).toBeNull();
  expect(
    (
      await rankNavigationKnowledge(
        { ...query, controls: [] },
        [record],
        signal,
        now,
      )
    ).context,
  ).toBeNull();
  expect(
    (
      await rankNavigationKnowledge(
        query,
        [record],
        signal,
        now + 31 * 86400000,
      )
    ).context,
  ).toBeNull();
  expect(
    (
      await rankNavigationKnowledge(
        query,
        [
          {
            ...record,
            data: {
              ...record.data,
              edges: record.data.edges.map((edge) => ({
                ...edge,
                failures: edge.successes,
              })),
            },
          },
        ],
        signal,
        now,
      )
    ).context,
  ).toBeNull();
});

test("graph keys disclose only reproducible approved structure and snapshot digests bind source and site choice revisions", async () => {
  const artifact = await savedNavigationKnowledgeFixture();
  expect(savedDataArtifactSchema.safeParse(artifact).success).toBe(false);
  await expect(assertNavigationKnowledgeKeys(artifact.data)).resolves.toEqual(
    artifact.data,
  );
  await expect(
    assertNavigationKnowledgeKeys({
      ...artifact.data,
      controls: artifact.data.controls.map((control, index) =>
        index ? control : { ...control, key: "0".repeat(64) },
      ),
    }),
  ).rejects.toThrow();
  const query = navigationKnowledgeQuerySchema.parse({
    origin: artifact.data.origin,
    query: "Find Help",
    controls: [],
  });
  const context = { version: 1 as const, facts: [] };
  const serialized = await serializeNavigationKnowledge(context);
  expect(serialized.bytes).toBe(
    new TextEncoder().encode(serialized.json).length,
  );
  const value = {
    contextDigest: serialized.digest,
    sources: [{ artifactId: artifact.id, revision: "1" }],
    siteSettings: { origin: artifact.data.origin, revision: "1" },
  };
  const digest = await navigationKnowledgeSnapshotDigest(query, value);
  expect(
    await navigationKnowledgeSnapshotDigest(query, {
      ...value,
      sources: [{ artifactId: artifact.id, revision: "2" }],
    }),
  ).not.toBe(digest);
  expect(
    await navigationKnowledgeSnapshotDigest(query, {
      ...value,
      siteSettings: { ...value.siteSettings, revision: "2" },
    }),
  ).not.toBe(digest);
});
