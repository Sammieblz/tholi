import { randomUUID } from "node:crypto";
import {
  operatorEvaluationPlanSchema,
  type OperatorEvaluationPlan,
} from "../../packages/navigation-core/contracts-evaluation";
import { MODEL_PRICE_REVISION } from "../../apps/api/src/model-experiment";

/** Contract-only synthetic declarations, never the independent quality holdout. */
export function operatorEvaluationPlanFixture(
  options: {
    provider?: "fake" | "vertex";
    now?: number;
    operator?: OperatorEvaluationPlan["operator"];
    runtimeManifestSha256?: string;
  } = {},
): OperatorEvaluationPlan {
  const now = options.now ?? Date.now();
  const provider = options.provider ?? "fake";
  const digest = "a".repeat(64);
  const cases = Array.from({ length: 30 }, (_, index) => {
    const split =
      index < 18
        ? "inspected-regression"
        : index < 24
          ? "fresh-holdout"
          : "synthetic";
    return {
      id: `contract-case-${index}`,
      goal: "Find Help",
      split,
      scope: {
        urls: [
          split === "synthetic"
            ? `http://127.0.0.1:5173/contract-${index}`
            : "https://github.com/microsoft/vscode",
        ],
      },
      maxGenerations: split === "synthetic" ? 1 : 2,
    };
  });
  return operatorEvaluationPlanSchema.parse({
    version: 1,
    profile: "operator-evaluation",
    id: randomUUID(),
    provider,
    operator: options.operator ?? {
      accountId: randomUUID(),
      workspaceId: randomUUID(),
      clientId: "extension-chromium",
    },
    createdAtMs: now,
    expiresAtMs: now + 60000,
    sourceRevision: "b".repeat(40),
    hashes: {
      sourceSha256: digest,
      extensionBuildSha256: digest,
      buildManifestSha256: digest,
      runtimeManifestSha256: options.runtimeManifestSha256 ?? digest,
      promptSha256: digest,
      observationSchemaSha256: digest,
      capturePolicySha256: digest,
      protocolSha256: digest,
      corpusSha256: digest,
      holdoutSha256: digest,
    },
    model: {
      api: "v1",
      project: "tholi-model-fixture",
      location: "global",
      id: provider === "fake" ? "tholi-deterministic-v1" : "gemini-3.8-flash",
      retentionProfile: "provider-default-acknowledged",
      priceRevision: MODEL_PRICE_REVISION,
    },
    budget: {
      maxInputTokens: 32768,
      maxOutputTokens: 2048,
      allowanceUsdMicros: 4900000,
    },
    maxGenerations: 324,
    cases,
    trials: cases.flatMap((item) =>
      [0, 1, 2].flatMap((repetition) =>
        ["local", "structured", "multimodal"].map((arm) => ({
          id: randomUUID(),
          caseId: item.id,
          arm,
          repetition,
        })),
      ),
    ),
  });
}
