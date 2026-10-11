import { z } from "zod";
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
