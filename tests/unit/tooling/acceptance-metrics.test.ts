import { it, expect } from "vitest";
import {
  acceptancePassed,
  summarize,
  type AcceptanceCase,
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
