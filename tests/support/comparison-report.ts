import type { OperatorEvaluationAudit } from "../../apps/api/src/operator-evaluation";
import {
  comparisonMeasurementSchema,
  summarizeComparison,
  type ComparisonExpectedTrial,
  type ComparisonAttachment,
} from "../../packages/acceptance-metrics";
import {
  comparisonCases,
  comparisonTrials,
  readComparisonPlan,
} from "./perception-comparison";

/** Shared by collection and closed-journal finalization; never a quality oracle. */
export async function comparisonEvidence(
  cases: { comparison?: ComparisonAttachment }[],
  options: {
    mode?: string;
    planFile?: string;
    journalFile?: string;
    audit?: OperatorEvaluationAudit;
  } = {},
) {
  const expected: ComparisonExpectedTrial[] = comparisonTrials.map((trial) => {
    const task = comparisonCases.find((item) => item.id === trial.caseId)!;
    return {
      ...trial,
      split: task.split,
      disposition:
        task.split === "synthetic"
          ? task.disposition === "grounded-guide"
            ? "guide"
            : task.disposition
          : "complete",
    } as ComparisonExpectedTrial;
  });
  const records = cases.flatMap((item) => {
    const parsed = comparisonMeasurementSchema.safeParse(
      item.comparison?.measurement,
    );
    return parsed.success ? [parsed.data] : [];
  });
  let plan: Awaited<ReturnType<typeof readComparisonPlan>> | undefined;
  let audit: OperatorEvaluationAudit | undefined;
  try {
    if (options.planFile) plan = await readComparisonPlan(options.planFile);
    audit =
      options.audit ??
      (options.journalFile
        ? await (
            await import("../../apps/api/src/operator-evaluation")
          ).readOperatorEvaluationAudit(options.journalFile)
        : undefined);
    if (
      audit &&
      (!plan ||
        audit.planSha256 !== plan.sha256 ||
        audit.provider !== plan.plan.provider)
    )
      throw Error("The journal and declaration do not match.");
  } catch {
    audit = undefined;
  }
  const trialProvider = audit
    ? expected.map((trial) => {
        const claims = audit!.records.flatMap(({ event }) =>
          event.type === "claimed" && event.binding.trialId === trial.id
            ? [event]
            : [],
        );
        const claimIds = new Set(claims.map((claim) => claim.claimId));
        const events = audit!.records
          .map(({ event }) => event)
          .filter((event) => "claimId" in event && claimIds.has(event.claimId));
        const finished = events.flatMap((event) =>
          event.type === "finished" ? [event] : [],
        );
        const record = records.find((item) => item.trialId === trial.id);
        if (
          record &&
          finished.some((event) => event.proposalKind === "request-observation")
        ) {
          record.recoveryEpisodes = 1;
          record.recoveredEpisodes =
            record.result.completed &&
            finished.some((event) => event.proposalKind === "guide")
              ? 1
              : 0;
        }
        return {
          trialId: trial.id,
          clientReservations: record?.clientReservations ?? null,
          claimedGenerations: claims.length,
          authorizedGenerations: events.filter(
            (event) => event.type === "authorized",
          ).length,
          countDispatchIntents: events.filter(
            (event) =>
              event.type === "dispatch-intent" && event.phase === "count",
          ).length,
          generationDispatchIntents: events.filter(
            (event) =>
              event.type === "dispatch-intent" && event.phase === "generate",
          ).length,
          acceptedProposalKinds: finished.flatMap((event) =>
            event.proposalKind ? [event.proposalKind] : [],
          ),
          rejectedOutputCodes: finished.flatMap((event) =>
            event.errorCode ? [event.errorCode] : [],
          ),
          knownSentinelLeaks: finished.filter(
            (event) => event.knownSentinelLeak,
          ).length,
        };
      })
    : null;
  const costFor = (ids: Set<string>) => {
    if (!audit) return undefined;
    const claims = audit.records.flatMap(({ event }) =>
      event.type === "claimed" && ids.has(event.binding.trialId) ? [event] : [],
    );
    let measuredUsdMicros = 0,
      unknownReservedUsdMicros = 0,
      unknownAttempts = 0;
    for (const claim of claims) {
      const finished = audit.records.flatMap(({ event }) =>
        event.type === "finished" && event.claimId === claim.claimId
          ? [event]
          : [],
      )[0];
      if (finished?.outcome === "reported")
        measuredUsdMicros += finished.costUsdMicros ?? 0;
      else if (!finished || finished.outcome === "unknown") {
        unknownReservedUsdMicros += claim.reservedUsdMicros;
        unknownAttempts++;
      }
    }
    return { measuredUsdMicros, unknownReservedUsdMicros, unknownAttempts };
  };
  const summarize = (trials: ComparisonExpectedTrial[]) => {
    const ids = new Set(trials.map((trial) => trial.id));
    return summarizeComparison(
      trials,
      records.filter((record) => ids.has(record.trialId)),
      costFor(ids),
    );
  };
  const mode =
    options.mode === "quality"
      ? "quality"
      : options.mode === "dry-run"
        ? "dry-run"
        : "disabled";
  const summary = summarizeComparison(
    expected,
    records,
    costFor(new Set(expected.map((trial) => trial.id))),
  );
  const samePlan =
    !!plan &&
    cases.length === comparisonTrials.length &&
    cases.every((item) => item.comparison?.planSha256 === plan!.sha256);
  const completeMeasured =
    summary.measuredAttempts === expected.length &&
    summary.missingAttempts === 0 &&
    summary.duplicateAttempts === 0 &&
    summary.unexpectedAttempts === 0;
  return {
    experimentMode: mode,
    configuredComparisonAttempts: expected.length,
    qualityEvidenceAvailable:
      mode === "quality" &&
      plan?.plan.provider === "vertex" &&
      samePlan &&
      completeMeasured &&
      !!audit?.closed &&
      audit.unresolvedGenerations === 0,
    betaGateDecision: "pending independent measured review",
    clientTerminalMeaning:
      "A matched current client attempt ended; the durable journal independently determines provider exposure.",
    declaration: plan
      ? {
          planSha256: plan.sha256,
          id: plan.plan.id,
          provider: plan.plan.provider,
          sourceRevision: plan.plan.sourceRevision,
          hashes: plan.plan.hashes,
          model: plan.plan.model,
          budget: plan.plan.budget,
          maxGenerations: plan.plan.maxGenerations,
        }
      : null,
    privacyAudit: audit
      ? {
          knownSentinelLeaks: audit.knownSentinelLeaks,
          closed: audit.closed,
          scope:
            "Known synthetic sentinel at the provider-send boundary; broader privacy remains subject to independent safety review.",
        }
      : null,
    trialProvider,
    comparison: summary,
    byArm: Object.fromEntries(
      (["local", "structured", "multimodal"] as const).map((arm) => [
        arm,
        summarize(expected.filter((trial) => trial.arm === arm)),
      ]),
    ),
    byCohort: Object.fromEntries(
      (["inspected-regression", "fresh-holdout", "synthetic"] as const).map(
        (split) => [
          split,
          summarize(expected.filter((trial) => trial.split === split)),
        ],
      ),
    ),
    byApp: Object.fromEntries(
      ["wikipedia", "github", "synthetic"].map((app) => {
        const ids = new Set(
          comparisonCases
            .filter((task) => task.app === app)
            .map((task) => task.id),
        );
        return [
          app,
          summarize(expected.filter((trial) => ids.has(trial.caseId))),
        ];
      }),
    ),
    costJournal: audit ? { ...audit, provisional: !audit.closed } : null,
  };
}
