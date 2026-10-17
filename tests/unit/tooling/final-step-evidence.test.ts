import { expect, it } from "vitest";
import type { SessionView } from "../../../packages/shared-types/index";
import { hasFinalStepEvidence } from "../../support/final-step-evidence";

const before = {
  status: "running",
  verifiedSteps: 1,
  request: { id: "request", status: "active" },
  journey: { id: "journey", status: "active" },
  goalPlan: { status: "guiding", source: "semantics" },
} as SessionView;
const completed = {
  ...before,
  request: { ...before.request!, status: "completed" },
  journey: { ...before.journey!, status: "completed" },
  goalPlan: { ...before.goalPlan!, status: "completed" },
} satisfies SessionView;

it("retains the exact one-step receipt for ordinary interactions", () => {
  expect(
    hasFinalStepEvidence(
      before,
      { ...before, verifiedSteps: 2 },
      "focus",
      false,
    ),
  ).toBe(true);
  for (const verifiedSteps of [0, 3])
    expect(
      hasFinalStepEvidence(
        before,
        { ...completed, verifiedSteps },
        "choice",
        true,
      ),
    ).toBe(false);
});

it("accepts a state-only completion only with an independent positive oracle", () => {
  for (const kind of ["choice", "section"]) {
    expect(hasFinalStepEvidence(before, completed, kind, true)).toBe(true);
    expect(hasFinalStepEvidence(before, completed, kind, false)).toBe(false);
  }
});

it("rejects stale task and journey completions even if a counter advances", () => {
  for (const verifiedSteps of [1, 2]) {
    expect(
      hasFinalStepEvidence(
        before,
        {
          ...completed,
          verifiedSteps,
          request: { ...completed.request, id: "old" },
        },
        "choice",
        true,
      ),
    ).toBe(false);
    expect(
      hasFinalStepEvidence(
        before,
        {
          ...completed,
          verifiedSteps,
          journey: { ...completed.journey, id: "old" },
        },
        "choice",
        true,
      ),
    ).toBe(false);
  }
});

it("rejects stopped, paused, canceled and unresolved state-only observations", () => {
  expect(hasFinalStepEvidence(before, undefined, "choice", true)).toBe(false);
  for (const status of ["stopped", "paused", "checkpoint"] as const)
    expect(
      hasFinalStepEvidence(before, { ...completed, status }, "choice", true),
    ).toBe(false);
  for (const status of ["paused", "canceled", "active"] as const)
    expect(
      hasFinalStepEvidence(
        before,
        { ...completed, request: { ...completed.request, status } },
        "choice",
        true,
      ),
    ).toBe(false);
  expect(
    hasFinalStepEvidence(
      before,
      {
        ...completed,
        goalPlan: { ...completed.goalPlan, status: "unresolved" },
      },
      "choice",
      true,
    ),
  ).toBe(false);
});

it("cannot treat field focus or an opened menu as a state-only completion", () => {
  for (const kind of ["focus", "expand", "navigation", "action"])
    expect(hasFinalStepEvidence(before, completed, kind, true)).toBe(false);
});

it("requires a fresh semantic completion after a guiding baseline", () => {
  expect(hasFinalStepEvidence(completed, completed, "choice", true)).toBe(
    false,
  );
  expect(
    hasFinalStepEvidence(
      before,
      { ...completed, goalPlan: { ...completed.goalPlan, source: "memory" } },
      "choice",
      true,
    ),
  ).toBe(false);
});
