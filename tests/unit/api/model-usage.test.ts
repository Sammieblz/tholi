import { expect, test } from "vitest";
import {
  modelUsageSchema,
  modelUsageTotals,
  normalizeModelUsage,
  type ModelUsageV2,
} from "../../../apps/api/src/application/model-contracts";

const measured: ModelUsageV2 = {
  version: 2,
  provider: "anthropic",
  source: "measured",
  model: "synthetic-model",
  inputTokens: 20,
  outputTokens: 12,
  cacheReadInputTokens: 3,
  cacheWriteInputTokens: 4,
  reasoningOutputTokens: 8,
  totalTokens: 32,
};

test("versioned usage counts reasoning once while preserving historical measured usage", () => {
  expect(modelUsageTotals(modelUsageSchema.parse(measured))).toEqual({
    inputTokens: 20,
    outputTokens: 12,
  });
  const legacy = {
    provider: "vertex",
    source: "measured",
    model: "historical-model",
    promptTokens: 20,
    outputTokens: 4,
    thoughtTokens: 8,
    cachedTokens: 3,
    totalTokens: 32,
  } as const;
  expect(modelUsageSchema.parse(legacy)).toEqual(legacy);
  expect(modelUsageTotals(legacy)).toEqual({
    inputTokens: 20,
    outputTokens: 12,
  });
  expect(normalizeModelUsage(legacy)).toMatchObject({
    version: 2,
    inputTokens: 20,
    outputTokens: 12,
    cacheReadInputTokens: 3,
    cacheWriteInputTokens: null,
    reasoningOutputTokens: 8,
  });
});

test("unreported breakdowns remain unknown and inconsistent provider totals are rejected", () => {
  const unknown = {
    ...measured,
    cacheReadInputTokens: null,
    cacheWriteInputTokens: null,
    reasoningOutputTokens: null,
  };
  expect(modelUsageSchema.parse(unknown)).toEqual(unknown);
  for (const invalid of [
    { ...measured, totalTokens: 40 },
    { ...measured, reasoningOutputTokens: 13 },
    { ...measured, cacheReadInputTokens: 19 },
    { ...measured, source: "fake" },
    { ...measured, outputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...measured, cacheWriteInputTokens: undefined },
  ])
    expect(modelUsageSchema.safeParse(invalid).success).toBe(false);
});
