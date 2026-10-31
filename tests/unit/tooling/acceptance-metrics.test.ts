import { it, expect } from "vitest";
import {
  acceptancePassed,
  summarize,
  summarizeComparison,
  comparisonMeasurementSchema,
  type AcceptanceCase,
  type ComparisonExpectedTrial,
  type ComparisonMeasurement,
} from "../../../packages/acceptance-metrics/index";
const c = (
  id: string,
  extra: Partial<AcceptanceCase> = {},
): AcceptanceCase => ({
  id,
  suite: "fixture",
  supported: true,
  completed: true,
  unresolved: false,
  stopped: false,
  targets: [true],
  verifications: [true],
  falseSuccess: 0,
  automation: 0,
  secretLeaks: 0,
  modelCalls: 0,
  ...extra,
});

it("comparison keeps missing, refused and budget-stopped trials in their declared denominators", () => {
  const expected: ComparisonExpectedTrial[] = [
    {
      id: "1",
      caseId: "positive",
      arm: "structured",
      repetition: 0,
      split: "fresh-holdout",
      disposition: "complete",
    },
    {
      id: "2",
      caseId: "positive",
      arm: "structured",
      repetition: 1,
      split: "fresh-holdout",
      disposition: "complete",
    },
    {
      id: "3",
      caseId: "negative",
      arm: "structured",
      repetition: 0,
      split: "synthetic",
      disposition: "unsupported",
    },
    {
      id: "4",
      caseId: "negative",
      arm: "structured",
      repetition: 1,
      split: "synthetic",
      disposition: "unsupported",
    },
  ];
  const record = (
    id: string,
    extra: Partial<ComparisonMeasurement> = {},
  ): ComparisonMeasurement => ({
    trialId: id,
    caseId: id === "1" || id === "2" ? "positive" : "negative",
    collection: "measured",
    result: c(id),
    disposition: "guide",
    dispositionCorrect: false,
    readiness: "terminal",
    preflightErrorCode: null,
    terminalState: "guiding",
    terminalErrorCode: null,
    clientReservations: 1,
    recoveryEpisodes: 0,
    recoveredEpisodes: 0,
    initialAcknowledgmentMs: 1,
    decisionMs: 2,
    workflowMs: 3,
    failureStage: "none",
    ...extra,
  });
  const summary = summarizeComparison(
    expected,
    [
      record("1", {
        collection: "budget-stopped",
        result: c("1", { completed: false }),
      }),
      record("3", { disposition: "invalid-output" }),
      record("4", { disposition: "unsupported", dispositionCorrect: true }),
    ],
    {
      measuredUsdMicros: 100,
      unknownReservedUsdMicros: 300,
      unknownAttempts: 1,
    },
  );
  expect(summary.supportedCompletion).toEqual({
    correct: 0,
    total: 2,
    rate: 0,
  });
  expect(summary.unsupportedCoverage).toEqual({
    correct: 1,
    total: 2,
    rate: 0.5,
  });
  expect(summary.missingAttempts).toBe(1);
  expect(summary.budgetStoppedAttempts).toBe(1);
  expect(summary.invalidOutputs).toBe(1);
  expect(summary.cost).toMatchObject({
    estimatedTotalUsdMicros: 400,
    perCompletedCloudTaskUsdMicros: null,
  });
  expect(summarizeComparison([], []).supportedCompletion.rate).toBeNull();
  const valid = comparisonMeasurementSchema.parse({
    ...record("1"),
    trialId: "00000000-0000-4000-8000-000000000001",
  });
  expect(
    comparisonMeasurementSchema.safeParse({
      ...valid,
      observation: { text: "private" },
    }).success,
  ).toBe(false);
});
it("counts refusals and failures instead of dropping them from completion", () => {
  const summary = summarize([
    c("good"),
    c("refused", {
      completed: false,
      unresolved: true,
      targets: [],
      verifications: [],
    }),
    c("wrong", {
      targets: [false],
      completed: false,
      verifications: [false],
      falseSuccess: 1,
    }),
  ]);
  expect(summary.targetPrecision).toEqual({ correct: 1, total: 2, rate: 0.5 });
  expect(summary.supportedCompletion.total).toBe(3);
  expect(summary.supportedCompletion.correct).toBe(1);
  expect(acceptancePassed(summary)).toBe(false);
});
it("does not turn empty denominators or negative-only cases into passing accuracy", () => {
  expect(acceptancePassed(summarize([]))).toBe(false);
  expect(
    acceptancePassed(
      summarize([
        c("negative", { supported: false, targets: [], verifications: [] }),
      ]),
    ),
  ).toBe(false);
  expect(acceptancePassed(summarize([c("valid")]))).toBe(true);
  expect(acceptancePassed(summarize([c("leak", { secretLeaks: 1 })]))).toBe(
    false,
  );
});
