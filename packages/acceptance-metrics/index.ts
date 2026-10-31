import { z } from "zod";
import { serviceErrorCodeSchema } from "../navigation-core/contracts-service";
import { navigationServiceStateSchema } from "../navigation-core/contracts-navigation";
const count = z.number().int().nonnegative();
export const acceptanceCaseSchema = z
  .object({
    id: z.string().min(1).max(180),
    suite: z.enum(["live", "fixture", "authored"]),
    supported: z.boolean(),
    completed: z.boolean(),
    unresolved: z.boolean(),
    stopped: z.boolean(),
    targets: z.array(z.boolean()).max(40),
    verifications: z.array(z.boolean()).max(40),
    falseSuccess: count,
    automation: count,
    secretLeaks: count,
    modelCalls: count,
  })
  .strict();
export type AcceptanceCase = z.infer<typeof acceptanceCaseSchema>;
export function summarize(cases: AcceptanceCase[]) {
  const ratio = (correct: number, total: number) => ({
    correct,
    total,
    rate: total ? correct / total : 0,
  });
  const targets = cases.flatMap((c) => c.targets),
    verifications = cases.flatMap((c) => c.verifications),
    supported = cases.filter((c) => c.supported);
  return {
    attempts: cases.length,
    targetPrecision: ratio(targets.filter(Boolean).length, targets.length),
    verificationPrecision: ratio(
      verifications.filter(Boolean).length,
      verifications.length,
    ),
    supportedCompletion: ratio(
      supported.filter((c) => c.completed).length,
      supported.length,
    ),
    unresolved: cases.filter((c) => c.unresolved).length,
    stopped: cases.filter((c) => c.stopped).length,
    falseSuccess: cases.reduce((n, c) => n + c.falseSuccess, 0),
    automation: cases.reduce((n, c) => n + c.automation, 0),
    secretLeaks: cases.reduce((n, c) => n + c.secretLeaks, 0),
    modelCalls: cases.reduce((n, c) => n + c.modelCalls, 0),
  };
}
export function acceptancePassed(
  summary: ReturnType<typeof summarize>,
  gates = {
    targetPrecision: 0.98,
    verificationPrecision: 0.95,
    supportedCompletion: 0.9,
    falseSuccess: 0,
    automation: 0,
    secretLeaks: 0,
  },
) {
  return (
    summary.targetPrecision.total > 0 &&
    summary.verificationPrecision.total > 0 &&
    summary.supportedCompletion.total > 0 &&
    summary.targetPrecision.rate >= gates.targetPrecision &&
    summary.verificationPrecision.rate >= gates.verificationPrecision &&
    summary.supportedCompletion.rate >= gates.supportedCompletion &&
    summary.falseSuccess <= gates.falseSuccess &&
    summary.automation <= gates.automation &&
    summary.secretLeaks <= gates.secretLeaks
  );
}

export const comparisonMeasurementSchema = z
  .object({
    trialId: z.string().uuid(),
    caseId: z.string().min(1).max(100),
    collection: z.enum(["measured", "blocked", "budget-stopped", "not-run"]),
    result: acceptanceCaseSchema.omit({ secretLeaks: true }).strip(),
    disposition: z.enum([
      "guide",
      "unsupported",
      "clarify",
      "request-observation",
      "safety-stop",
      "invalid-output",
      "unknown",
    ]),
    dispositionCorrect: z.boolean(),
    readiness: z.enum([
      "local",
      "terminal",
      "preflight-safety",
      "preflight-error",
      "unknown",
    ]),
    preflightErrorCode: serviceErrorCodeSchema.nullable().default(null),
    terminalState: navigationServiceStateSchema
      .innerType()
      .shape.state.exclude(["pending"])
      .nullable()
      .default(null),
    terminalErrorCode: serviceErrorCodeSchema.nullable().default(null),
    clientReservations: count.max(2),
    recoveryEpisodes: count,
    recoveredEpisodes: count,
    initialAcknowledgmentMs: z.number().nonnegative().nullable(),
    decisionMs: z.number().nonnegative().nullable(),
    workflowMs: z.number().nonnegative(),
    failureStage: z.enum([
      "none",
      "infrastructure",
      "admission",
      "readiness",
      "target",
      "verification",
      "privacy",
      "unknown",
    ]),
  })
  .strict();
export type ComparisonMeasurement = z.infer<typeof comparisonMeasurementSchema>;
export type ComparisonAttachment = {
  measurement: ComparisonMeasurement;
  planSha256: string;
  qualityCollection: boolean;
};
export type ComparisonExpectedTrial = {
  id: string;
  caseId: string;
  arm: "local" | "structured" | "multimodal";
  repetition: 0 | 1 | 2;
  split: "inspected-regression" | "fresh-holdout" | "synthetic";
  disposition: "complete" | ComparisonMeasurement["disposition"];
};

/** Fixed declaration denominators do not shrink when collection or admission stops. */
export function summarizeComparison(
  expected: ComparisonExpectedTrial[],
  received: ComparisonMeasurement[],
  cost?: {
    measuredUsdMicros: number;
    unknownReservedUsdMicros: number;
    unknownAttempts: number;
  },
) {
  const ratio = (correct: number, total: number) => ({
    correct,
    total,
    rate: total ? correct / total : null,
  });
  const ids = new Set(expected.map((trial) => trial.id));
  const valid = expected.flatMap((trial) => {
    const matches = received.filter(
      (record) => record.trialId === trial.id && record.caseId === trial.caseId,
    );
    return matches.length === 1 ? [{ trial, record: matches[0] }] : [];
  });
  const completed = valid.filter(
    ({ trial, record }) =>
      trial.disposition === "complete" &&
      record.collection === "measured" &&
      record.result.completed,
  ).length;
  const cloudCompleted = valid.filter(
    ({ trial, record }) =>
      trial.arm !== "local" &&
      trial.disposition === "complete" &&
      record.collection === "measured" &&
      record.result.completed,
  ).length;
  const percentile = (values: number[], fraction: number) =>
    values.length
      ? [...values].sort((a, b) => a - b)[
          Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)
        ]
      : null;
  const decisions = valid.flatMap(({ record }) =>
    record.decisionMs === null ? [] : [record.decisionMs],
  );
  return {
    configuredAttempts: expected.length,
    measuredAttempts: valid.filter(
      ({ record }) => record.collection === "measured",
    ).length,
    missingAttempts: expected.length - valid.length,
    duplicateAttempts:
      received.length - new Set(received.map((record) => record.trialId)).size,
    unexpectedAttempts: received.filter((record) => !ids.has(record.trialId))
      .length,
    blockedAttempts: valid.filter(
      ({ record }) => record.collection === "blocked",
    ).length,
    budgetStoppedAttempts: valid.filter(
      ({ record }) => record.collection === "budget-stopped",
    ).length,
    notRunAttempts: valid.filter(
      ({ record }) => record.collection === "not-run",
    ).length,
    supportedCompletion: ratio(
      completed,
      expected.filter((trial) => trial.disposition === "complete").length,
    ),
    latency: {
      decisionSamples: decisions.length,
      decisionP50Ms: percentile(decisions, 0.5),
      decisionP95Ms: percentile(decisions, 0.95),
      workflowP95Ms: percentile(
        valid
          .filter(({ record }) => record.collection === "measured")
          .map(({ record }) => record.workflowMs),
        0.95,
      ),
    },
    paired: Object.fromEntries(
      (["structured", "multimodal"] as const).map((arm) => {
        const local = expected.filter(
          (trial) => trial.arm === "local" && trial.disposition === "complete",
        );
        let measured = 0,
          gained = 0,
          regressed = 0,
          unchanged = 0;
        for (const trial of local) {
          const base = valid.find((item) => item.trial.id === trial.id)?.record;
          const compared = valid.find(
            (item) =>
              item.trial.arm === arm &&
              item.trial.caseId === trial.caseId &&
              item.trial.repetition === trial.repetition,
          )?.record;
          if (
            base?.collection !== "measured" ||
            compared?.collection !== "measured"
          )
            continue;
          measured++;
          if (!base.result.completed && compared.result.completed) gained++;
          else if (base.result.completed && !compared.result.completed)
            regressed++;
          else unchanged++;
        }
        return [
          arm,
          {
            configuredPairs: local.length,
            measuredPairs: measured,
            missingPairs: local.length - measured,
            gained,
            regressed,
            unchanged,
          },
        ];
      }),
    ),
    unsupportedCoverage: ratio(
      valid.filter(
        ({ trial, record }) =>
          trial.disposition === "unsupported" &&
          record.collection === "measured" &&
          record.disposition === "unsupported" &&
          record.dispositionCorrect,
      ).length,
      expected.filter((trial) => trial.disposition === "unsupported").length,
    ),
    invalidOutputs: valid.filter(
      ({ record }) => record.disposition === "invalid-output",
    ).length,
    preflightSafetyStops: valid.filter(
      ({ record }) => record.readiness === "preflight-safety",
    ).length,
    clientTerminalTrials: valid.filter(
      ({ record }) => record.readiness === "terminal",
    ).length,
    recovery: ratio(
      valid.reduce((sum, { record }) => sum + record.recoveredEpisodes, 0),
      valid.reduce((sum, { record }) => sum + record.recoveryEpisodes, 0),
    ),
    dispositions: Object.fromEntries(
      ["clarify", "request-observation", "safety-stop", "grounded-guide"].map(
        (kind) => [
          kind,
          ratio(
            valid.filter(
              ({ trial, record }) =>
                trial.disposition ===
                  (kind === "grounded-guide" ? "guide" : kind) &&
                record.collection === "measured" &&
                record.dispositionCorrect,
            ).length,
            expected.filter(
              (trial) =>
                trial.disposition ===
                (kind === "grounded-guide" ? "guide" : kind),
            ).length,
          ),
        ],
      ),
    ),
    targets: ratio(
      valid.flatMap(({ record }) => record.result.targets).filter(Boolean)
        .length,
      valid.flatMap(({ record }) => record.result.targets).length,
    ),
    verifications: ratio(
      valid.flatMap(({ record }) => record.result.verifications).filter(Boolean)
        .length,
      valid.flatMap(({ record }) => record.result.verifications).length,
    ),
    falseSuccess: valid.reduce(
      (sum, { record }) => sum + record.result.falseSuccess,
      0,
    ),
    automation: valid.reduce(
      (sum, { record }) => sum + record.result.automation,
      0,
    ),
    secretLeaks: null,
    privacyMeasurement:
      "Use the authoritative provider-boundary sentinel audit; unobserved privacy is not zero leaks.",
    allEmittedTargetPrecision: null,
    targetMetricScope:
      "Accepted locally bound targets observed by the collector; rejected or unbound model targets are not counted here.",
    cost: cost
      ? {
          ...cost,
          estimatedTotalUsdMicros:
            cost.measuredUsdMicros + cost.unknownReservedUsdMicros,
          cloudCompletedTasks: cloudCompleted,
          perCompletedCloudTaskUsdMicros:
            cloudCompleted && !cost.unknownAttempts
              ? cost.measuredUsdMicros / cloudCompleted
              : null,
        }
      : null,
  };
}
