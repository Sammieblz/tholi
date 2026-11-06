import { expect, test, vi } from "vitest";
import { reuseNavigationKnowledge } from "../../../packages/goal-planner/knowledge-reuse";
import { planGoal } from "../../../packages/goal-planner";
import {
  navigationKnowledgeSnapshotDigest,
  serializeNavigationKnowledge,
  type RetrievedNavigationKnowledge,
} from "../../../packages/navigation-core/contracts-navigation-knowledge";
import { navigationKnowledgeQueryFromObservation } from "../../../packages/navigation-core/navigation-knowledge-projection";
import { navigationModelObservation } from "../../support/navigation-model-fixture";
import type { PageSnapshot } from "../../../packages/page-model";

async function fixture() {
  const now = Date.now(),
    origin = "https://example.test";
  const observation = navigationModelObservation();
  observation.observedAtMs = now - 10;
  observation.deadlineAtMs = now + 1000;
  observation.context.goal = "Open Settings";
  observation.omissions = { frames: 0, regions: 0, controls: 0, reasons: [] };
  const context = {
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
        observedAt: new Date(now - 1000).toISOString(),
        successes: 1,
        failures: 0,
      },
    ],
  };
  const knowledge: RetrievedNavigationKnowledge = {
    context,
    contextDigest: (await serializeNavigationKnowledge(context)).digest,
    snapshotDigest: "0".repeat(64),
    sources: [{ artifactId: crypto.randomUUID(), revision: "1" }],
    siteSettings: { origin, revision: "1" },
    diagnostics: { candidates: 1, selected: 1, omitted: 0, reason: "matched" },
  };
  const bind = async () => {
    knowledge.contextDigest = (
      await serializeNavigationKnowledge(knowledge.context!)
    ).digest;
    knowledge.snapshotDigest = await navigationKnowledgeSnapshotDigest(
      navigationKnowledgeQueryFromObservation(observation, origin),
      knowledge,
    );
  };
  await bind();
  return { observation, origin, knowledge, now, bind };
}

test("a compatible private route binds the fresh native control and needs zero provider dispatches", async () => {
  const f = await fixture(),
    dispatch = vi.fn(async () => ({
      kind: "unsupported" as const,
      reason: "Fallback",
    }));
  const choose = async () =>
    (await reuseNavigationKnowledge(
      f.observation,
      f.origin,
      f.knowledge,
      f.now,
    )) ?? dispatch();
  const proposal = await choose();
  expect(proposal).toMatchObject({
    kind: "guide",
    reference: f.observation.controls[0].reference,
  });
  expect(dispatch).not.toHaveBeenCalled();
  expect(proposal).not.toHaveProperty("completed");
  f.observation.controls[0].label = "Help";
  expect((await choose()).kind).toBe("unsupported");
  expect(dispatch).toHaveBeenCalledOnce();
});

test("ambiguous current controls, stale facts, partial state and negated or multi-task requests cannot reuse a historical route", async () => {
  const ambiguous = await fixture();
  ambiguous.observation.controls.push({
    ...ambiguous.observation.controls[0],
    reference: {
      ...ambiguous.observation.controls[0].reference,
      controlId: "w0000000000000001-2",
    },
  });
  expect(
    await reuseNavigationKnowledge(
      ambiguous.observation,
      ambiguous.origin,
      ambiguous.knowledge,
      ambiguous.now,
    ),
  ).toBeUndefined();
  const stale = await fixture();
  stale.knowledge.context!.facts[0].observedAt = new Date(
    stale.now - 31 * 86400000,
  ).toISOString();
  await stale.bind();
  expect(
    await reuseNavigationKnowledge(
      stale.observation,
      stale.origin,
      stale.knowledge,
      stale.now,
    ),
  ).toBeUndefined();
  for (const goal of [
    "Open Settings without changing language",
    "Open Settings and then open Help",
    "Sign in",
  ]) {
    const f = await fixture();
    f.observation.context.goal = goal;
    await f.bind();
    expect(
      await reuseNavigationKnowledge(
        f.observation,
        f.origin,
        f.knowledge,
        f.now,
      ),
    ).toBeUndefined();
  }
  const partial = await fixture();
  partial.observation.omissions.reasons.push("partial-scan");
  expect(
    await reuseNavigationKnowledge(
      partial.observation,
      partial.origin,
      partial.knowledge,
      partial.now,
    ),
  ).toBeUndefined();
  for (const unavailable of [
    { visible: false },
    { enabled: false },
    { occluded: true },
  ]) {
    const f = await fixture();
    Object.assign(f.observation.controls[0], unavailable);
    await f.bind();
    expect(
      await reuseNavigationKnowledge(
        f.observation,
        f.origin,
        f.knowledge,
        f.now,
      ),
    ).toBeUndefined();
  }
});

test("a control that becomes consequential stays with the existing local review owner", async () => {
  const f = await fixture();
  f.observation.controls[0].risk = "consequential";
  expect(
    await reuseNavigationKnowledge(f.observation, f.origin, f.knowledge, f.now),
  ).toBeUndefined();
  const control = f.observation.controls[0];
  const page: PageSnapshot = {
    origin: f.origin,
    path: "/",
    pageKey: "current-page",
    stateKey: "current-state",
    templateKey: "current-template",
    fingerprint: "current-structure",
    revision: 1,
    language: "en",
    layout: "wide",
    partial: false,
    controls: [
      {
        id: control.reference.controlId,
        signature: "current-control",
        role: control.role,
        label: control.label,
        context: "",
        group: "",
        kind: control.kind,
        risk: control.risk,
        visible: true,
        enabled: true,
        inViewport: true,
        revealIds: [],
      },
    ],
  };
  expect(planGoal(page, f.observation.context.goal).issue).toBe(
    "consequential",
  );
});
