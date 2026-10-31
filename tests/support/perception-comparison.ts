import { createHash } from "node:crypto";
import { hostPermissionPattern } from "../../apps/extension/src/platform/host-permissions";
import { readFile } from "node:fs/promises";
import baseline from "../fixtures/navigation-baseline/corpus.json" with { type: "json" };
import holdout from "../fixtures/perception-comparison/fresh-holdout.json" with { type: "json" };
import synthetic from "../fixtures/perception-comparison/synthetic.json" with { type: "json" };
import {
  operatorEvaluationPlanSchema,
  operatorEvaluationSha256,
  OPERATOR_EVALUATION_LIMITS,
  type OperatorEvaluationPlan,
  type OperatorEvaluationTrial,
} from "../../packages/navigation-core/contracts-evaluation";
import { navigationServiceStateSchema } from "../../packages/navigation-core/contracts-navigation";

/** A local preflight error is not a provider response or an intentional refusal. */
export function comparisonProviderReadiness(
  raw: unknown,
  expected: {
    planSha256: string;
    trial: OperatorEvaluationTrial;
    provider: OperatorEvaluationPlan["provider"];
    requestId: string;
    lastGeneration: number;
  },
) {
  const parsed = navigationServiceStateSchema.safeParse(raw);
  if (!parsed.success) return;
  const state = parsed.data,
    binding = state.evaluation;
  if (
    state.profile !== "operator-evaluation" ||
    state.requestId !== expected.requestId ||
    binding?.planSha256 !== expected.planSha256 ||
    binding.trialId !== expected.trial.id ||
    binding.provider !== expected.provider ||
    binding.arm !== expected.trial.arm
  )
    return;
  const fresh =
    binding.generation === undefined
      ? expected.lastGeneration < 0
      : binding.generation > expected.lastGeneration;
  if (state.state === "error" && !state.transportRequestId && fresh)
    return { kind: "preflight-error" as const, state };
  return {
    kind:
      fresh &&
      binding.generation !== undefined &&
      !!state.transportRequestId &&
      state.state !== "pending"
        ? ("terminal" as const)
        : ("pending" as const),
    state,
  };
}

export type ComparisonCase = {
  id: string;
  app: string;
  goal: string;
  kind: string;
  target: string;
  url: string;
  split: "inspected-regression" | "fresh-holdout" | "synthetic";
  calibration: boolean;
  scope: string[];
  initialChoice?: string;
  reveal?: string;
  query?: string;
  path?: string;
  disposition?: string;
  html?: string;
  proof?: {
    heading: string;
    headingLevel?: number;
    bodyText?: string;
    entryHref?: string;
    entryHrefPrefix?: string;
    versionHistory?: boolean;
  };
};

export const comparisonCases: ComparisonCase[] = [
  ...baseline.cases.map((task) => {
    const url = baseline.apps[task.app as keyof typeof baseline.apps];
    const scope = [url];
    if (typeof task.path === "string") scope.push(new URL(task.path, url).href);
    if ("query" in task)
      scope.push(
        new URL(`/w/index.php?title=Casino_Royale_(novel)&${task.query}`, url)
          .href,
      );
    return {
      ...task,
      url,
      scope,
      split: "inspected-regression" as const,
      calibration: task.split === "calibration",
    };
  }),
  ...holdout.cases.map((task) => ({
    ...task,
    split: "fresh-holdout" as const,
    calibration: false,
    scope: task.path
      ? [task.url, new URL(task.path, task.url).href]
      : [task.url],
  })),
  ...synthetic.cases.map((task) => {
    const url = `http://127.0.0.1:5173/evaluation/${task.id}`;
    return {
      ...task,
      app: "synthetic",
      kind: "synthetic",
      target: "",
      url,
      scope: [url],
      split: "synthetic" as const,
      calibration: true,
    };
  }),
];

/** One declared fixture permission variant for preparation and every trial. */
export function comparisonHostPermissions(origin: string) {
  return [
    ...new Set([
      ...comparisonCases.flatMap((task) =>
        task.scope.map((url) => hostPermissionPattern(new URL(url).origin)),
      ),
      hostPermissionPattern(origin),
    ]),
  ];
}

// Stable experiment identifiers contain no goal, page or oracle content.
function trialId(key: string) {
  const bytes = createHash("sha256")
    .update(`tholi-evaluation-v1:${key}`)
    .digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Balanced cohorts and Latin arm rotations are fixed before collecting results. */
export const comparisonTrials: OperatorEvaluationTrial[] = (
  [0, 1, 2] as const
).flatMap((repetition) =>
  ([0, 1, 2] as const).flatMap((armPosition) =>
    Array.from({ length: 6 }, (_, block) => {
      const regressions = comparisonCases.filter(
        (task) => task.split === "inspected-regression",
      );
      const holdout = comparisonCases.filter(
        (task) => task.split === "fresh-holdout",
      );
      const negatives = comparisonCases.filter(
        (task) => task.split === "synthetic",
      );
      const group = [
        ...regressions.slice(block * 3, block * 3 + 3),
        holdout[block],
        negatives[block],
      ];
      const offset = (repetition + armPosition + block) % group.length;
      return group.map((_, index) => {
        const task = group[(index + offset) % group.length];
        const arms = ["local", "structured", "multimodal"] as const;
        const arm =
          arms[
            (armPosition + repetition + comparisonCases.indexOf(task)) %
              arms.length
          ];
        return {
          id: trialId(`${task.id}:${arm}:${repetition}`),
          caseId: task.id,
          arm,
          repetition,
        };
      });
    }).flat(),
  ),
);

/** The model/admission declaration never receives expected targets or outcomes. */
export function buildComparisonPlan(
  metadata: Omit<OperatorEvaluationPlan, "cases" | "trials" | "maxGenerations">,
) {
  return operatorEvaluationPlanSchema.parse({
    ...metadata,
    maxGenerations: OPERATOR_EVALUATION_LIMITS.maxGenerations,
    cases: comparisonCases.map((task) => ({
      id: task.id,
      goal: task.goal,
      split: task.split,
      scope: { urls: task.scope },
      maxGenerations: task.split === "synthetic" ? 1 : 2,
    })),
    trials: comparisonTrials,
  });
}

export async function readComparisonPlan(file: string) {
  const bytes = await readFile(file);
  if (bytes.length > OPERATOR_EVALUATION_LIMITS.maxPlanBytes)
    throw new Error("The evaluation declaration exceeds its bounded limit.");
  const raw = bytes.toString("utf8");
  const plan = operatorEvaluationPlanSchema.parse(JSON.parse(raw));
  const expected = buildComparisonPlan(plan);
  if (
    JSON.stringify(plan.cases) !== JSON.stringify(expected.cases) ||
    JSON.stringify(plan.trials) !== JSON.stringify(expected.trials)
  )
    throw new Error("The declared trial set or case scope was substituted.");
  return { raw, plan, sha256: await operatorEvaluationSha256(raw) };
}

/** Dry runs cover calibration/synthetic transport only, never a fresh holdout. */
export function comparisonTrialMayRun(
  task: ComparisonCase,
  provider: OperatorEvaluationPlan["provider"],
  mode: string | undefined,
) {
  if (mode === "quality") return provider === "vertex";
  return mode === "dry-run" && provider === "fake" && task.calibration;
}
