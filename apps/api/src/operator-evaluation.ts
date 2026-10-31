import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  OPERATOR_EVALUATION_LIMITS,
  operatorEvaluationApprovalSchema,
  operatorEvaluationBindingSchema,
  operatorEvaluationMetadataSchema,
  operatorEvaluationPlanSchema,
  type OperatorEvaluationBinding,
} from "../../../packages/navigation-core/contracts-evaluation";
import {
  ModelError,
  modelErrorCodeSchema,
  modelUsageSchema,
  type ModelOutcome,
  type ModelUsage,
} from "./application/model-contracts";
import {
  boundedFile,
  estimateModelCostUsdMicros,
  MODEL_PRICE_REVISION,
  priceReviewExpiresAt,
} from "./model-experiment";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.number().int().nonnegative().safe();
const finishSchema = z
  .object({
    type: z.literal("finished"),
    claimId: z.string().uuid(),
    outcome: z.enum(["not-sent", "reported", "unknown"]),
    usage: modelUsageSchema.optional(),
    costUsdMicros: money.optional(),
    proposalKind: z
      .enum(["guide", "clarify", "unsupported", "request-observation"])
      .optional(),
    proposalSha256: sha.optional(),
    errorCode: modelErrorCodeSchema.optional(),
    knownSentinelLeak: z.boolean().optional(),
  })
  .strict();
const eventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("opened"),
      version: z.literal(1),
      planSha256: sha,
      provider: z.enum(["fake", "vertex"]),
      model: z.string().min(1).max(100),
      approvalId: z.string().uuid().optional(),
      allowanceUsdMicros: money,
      reservationUsdMicros: money,
      priceRevision: z.literal(MODEL_PRICE_REVISION),
    })
    .strict(),
  z
    .object({
      type: z.literal("claimed"),
      claimId: z.string().uuid(),
      binding: operatorEvaluationBindingSchema,
      inputSha256: sha,
      reservedUsdMicros: money,
    })
    .strict(),
  z
    .object({ type: z.literal("authorized"), claimId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("dispatch-intent"),
      claimId: z.string().uuid(),
      phase: z.enum(["count", "generate"]),
      requestSha256: sha,
    })
    .strict(),
  finishSchema,
  z
    .object({
      type: z.literal("stopped"),
      reason: z.enum([
        "budget",
        "unknown",
        "invalid-usage",
        "over-reservation",
        "configuration",
        "privacy",
      ]),
    })
    .strict(),
  z.object({ type: z.literal("closed") }).strict(),
]);
type EvaluationEvent = z.infer<typeof eventSchema>;
const recordSchema = z
  .object({
    sequence: z.number().int().nonnegative().safe(),
    previousSha256: sha,
    event: eventSchema,
  })
  .strict();
type EvaluationRecord = z.infer<typeof recordSchema>;
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const initialHash = "0".repeat(64);
type DispatchPhase = "count" | "generate";
function dispatchAllowed(
  provider: "fake" | "vertex",
  claim: {
    authorized: boolean;
    dispatchPhases: Set<DispatchPhase>;
  },
  phase: DispatchPhase,
) {
  return (
    !claim.dispatchPhases.has(phase) &&
    (phase === "count"
      ? provider === "vertex" && !claim.authorized
      : claim.authorized &&
        (provider === "fake" || claim.dispatchPhases.has("count")))
  );
}

/** Content-free replay. An unfinished claim retains its full possible liability. */
function auditRecords(records: EvaluationRecord[]) {
  const header = records[0]?.event;
  if (header?.type !== "opened") throw new ModelError("CONFIGURATION");
  if (
    header.allowanceUsdMicros !==
      OPERATOR_EVALUATION_LIMITS.allowanceUsdMicros ||
    header.model !==
      (header.provider === "fake"
        ? "tholi-deterministic-v1"
        : "gemini-3.8-flash") ||
    header.reservationUsdMicros !==
      (header.provider === "fake"
        ? 0
        : estimateModelCostUsdMicros(
            "global",
            OPERATOR_EVALUATION_LIMITS.maxInputTokens,
            OPERATOR_EVALUATION_LIMITS.maxOutputTokens,
          ))
  )
    throw new ModelError("CONFIGURATION");
  const claims = new Map<
    string,
    {
      binding: OperatorEvaluationBinding;
      inputSha256: string;
      reservedUsdMicros: number;
      authorized: boolean;
      dispatchPhases: Set<DispatchPhase>;
      result?: z.infer<typeof finishSchema>;
    }
  >();
  const slots = new Set<string>();
  let settledUsdMicros = 0,
    closed = false;
  let stopped: string | undefined;
  for (const { event } of records.slice(1)) {
    if (closed) throw new ModelError("CONFIGURATION");
    if (event.type === "claimed") {
      const slot = `${event.binding.trialId}:${event.binding.generation}`;
      if (
        claims.has(event.claimId) ||
        slots.has(slot) ||
        stopped ||
        event.binding.planSha256 !== header.planSha256 ||
        event.reservedUsdMicros !== header.reservationUsdMicros ||
        [...claims.values()].some((item) => !item.result)
      )
        throw new ModelError("CONFIGURATION");
      slots.add(slot);
      if (
        settledUsdMicros + event.reservedUsdMicros >
        header.allowanceUsdMicros
      )
        throw new ModelError("CONFIGURATION");
      claims.set(event.claimId, {
        ...event,
        authorized: false,
        dispatchPhases: new Set(),
      });
    } else if (event.type === "authorized") {
      const claim = claims.get(event.claimId);
      if (!claim || claim.authorized || claim.result || stopped)
        throw new ModelError("CONFIGURATION");
      claim.authorized = true;
    } else if (event.type === "dispatch-intent") {
      const claim = claims.get(event.claimId);
      if (
        !claim ||
        claim.result ||
        stopped ||
        !dispatchAllowed(header.provider, claim, event.phase)
      )
        throw new ModelError("CONFIGURATION");
      claim.dispatchPhases.add(event.phase);
    } else if (event.type === "finished") {
      const claim = claims.get(event.claimId);
      if (!claim || claim.result) throw new ModelError("CONFIGURATION");
      if (event.outcome === "reported") {
        const usage = event.usage;
        if (
          !usage ||
          usage.provider !== header.provider ||
          usage.model !== header.model ||
          (header.provider === "vertex" && usage.promptTokens === 0) ||
          !claim.authorized ||
          event.costUsdMicros !==
            (header.provider === "fake"
              ? 0
              : estimateModelCostUsdMicros(
                  "global",
                  usage.promptTokens,
                  usage.outputTokens + usage.thoughtTokens,
                ))
        )
          throw new ModelError("CONFIGURATION");
        settledUsdMicros += event.costUsdMicros!;
      } else if (event.usage || event.costUsdMicros !== undefined)
        throw new ModelError("CONFIGURATION");
      claim.result = event;
      if (event.outcome === "unknown") stopped = "unknown";
      if (
        event.costUsdMicros !== undefined &&
        event.costUsdMicros > claim.reservedUsdMicros
      )
        stopped = "over-reservation";
    } else if (event.type === "stopped") stopped = event.reason;
    else if (event.type === "closed") closed = true;
    else throw new ModelError("CONFIGURATION");
  }
  const retained = [...claims.values()].filter(
    (item) => !item.result || item.result.outcome === "unknown",
  );
  const reservedUsdMicros = retained.reduce(
    (sum, item) => sum + item.reservedUsdMicros,
    0,
  );
  return {
    version: 1 as const,
    profile: "operator-evaluation" as const,
    planSha256: header.planSha256,
    provider: header.provider,
    approvalId: header.approvalId,
    allowanceUsdMicros: header.allowanceUsdMicros,
    settledUsdMicros,
    reservedUsdMicros,
    liabilityUsdMicros: settledUsdMicros + reservedUsdMicros,
    claimedGenerations: claims.size,
    authorizedGenerations: [...claims.values()].filter(
      (item) => item.authorized,
    ).length,
    countDispatchIntents: [...claims.values()].filter((item) =>
      item.dispatchPhases.has("count"),
    ).length,
    generationDispatchIntents: [...claims.values()].filter((item) =>
      item.dispatchPhases.has("generate"),
    ).length,
    unresolvedGenerations: retained.length,
    knownSentinelLeaks: [...claims.values()].filter(
      (item) => item.result?.knownSentinelLeak,
    ).length,
    stopped,
    closed,
    records: structuredClone(records),
  };
}
export type OperatorEvaluationAudit = ReturnType<typeof auditRecords>;

/** Audit never resumes or rewrites a consumed operator claim. */
export async function readOperatorEvaluationAudit(journalFile: string) {
  const bytes = await boundedFile(journalFile, 4 * 1024 * 1024);
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  if (!text.endsWith("\n")) throw new ModelError("CONFIGURATION");
  let previous = initialHash;
  const records = text
    .slice(0, -1)
    .split("\n")
    .map((line, index) => {
      const record = recordSchema.parse(JSON.parse(line));
      if (record.sequence !== index || record.previousSha256 !== previous)
        throw new ModelError("CONFIGURATION");
      previous = hash(line);
      return record;
    });
  return auditRecords(records);
}

export interface OperatorEvaluationClaim {
  readonly id: string;
  readonly binding: OperatorEvaluationBinding;
  readonly inputSha256: string;
}
export interface OperatorEvaluationFinish {
  outcome: ModelOutcome;
  usage?: ModelUsage;
  error?: ModelError;
  proposalKind?: z.infer<typeof finishSchema>["proposalKind"];
  proposalSha256?: string;
  knownSentinelLeak?: boolean;
}
interface ClaimState {
  claim: OperatorEvaluationClaim;
  authorized: boolean;
  dispatchPhases: Set<DispatchPhase>;
  finish?: Promise<void>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Offline/fake admission never loads ADC or a provider. Live calls need a new exact-plan approval. */
export async function openOperatorEvaluation(options: {
  planFile: string;
  approvalFile?: string;
  stateDirectory: string;
}) {
  const planBytes = await boundedFile(
    options.planFile,
    OPERATOR_EVALUATION_LIMITS.maxPlanBytes,
  );
  const plan = freeze(
    operatorEvaluationPlanSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          planBytes,
        ),
      ),
    ),
  );
  const planSha256 = hash(planBytes);
  if (Date.now() < plan.createdAtMs || Date.now() >= plan.expiresAtMs)
    throw new ModelError("CONFIGURATION");
  let approval: z.infer<typeof operatorEvaluationApprovalSchema> | undefined;
  let approvalHash: string | undefined;
  if (plan.provider === "vertex") {
    if (
      !options.approvalFile ||
      Date.now() >= priceReviewExpiresAt ||
      plan.model.priceRevision !== MODEL_PRICE_REVISION
    )
      throw new ModelError("CONFIGURATION");
    const bytes = await boundedFile(
      options.approvalFile,
      OPERATOR_EVALUATION_LIMITS.maxApprovalBytes,
    );
    approval = operatorEvaluationApprovalSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
    approvalHash = hash(bytes);
    if (
      approval.planSha256 !== planSha256 ||
      approval.approvedAtMs > Date.now() ||
      approval.expiresAtMs <= Date.now() ||
      approval.expiresAtMs > plan.expiresAtMs
    )
      throw new ModelError("CONFIGURATION");
  }
  if (!isAbsolute(options.stateDirectory))
    throw new ModelError("CONFIGURATION");
  await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
  const stateDirectory = await realpath(options.stateDirectory);
  const actual = resolve(stateDirectory),
    configured = resolve(options.stateDirectory);
  if (
    process.platform === "win32"
      ? actual.toLowerCase() !== configured.toLowerCase()
      : actual !== configured
  )
    throw new ModelError("CONFIGURATION");
  const journalFile = join(
    stateDirectory,
    `${approval?.id ?? "evaluation-" + plan.id}.jsonl`,
  );
  let journal: Awaited<ReturnType<typeof open>>;
  try {
    journal = await open(journalFile, "wx", 0o600);
  } catch {
    throw new ModelError("CONFIGURATION");
  }
  const reservation =
    plan.provider === "fake"
      ? 0
      : estimateModelCostUsdMicros(
          "global",
          plan.budget.maxInputTokens,
          plan.budget.maxOutputTokens,
        );
  const records: EvaluationRecord[] = [];
  let previous = initialHash,
    fault = false,
    closed = false;
  let active: ClaimState | undefined;
  const states = new WeakMap<OperatorEvaluationClaim, ClaimState>();
  let serial: Promise<unknown> = Promise.resolve();
  const transaction = <T>(operation: () => Promise<T>): Promise<T> => {
    const work = serial.then(operation);
    serial = work.catch(() => {});
    return work;
  };
  const append = async (event: EvaluationEvent) => {
    if (fault || closed) throw new ModelError("CONFIGURATION");
    const record = recordSchema.parse({
      sequence: records.length,
      previousSha256: previous,
      event,
    });
    const line = JSON.stringify(record);
    try {
      await journal.writeFile(line + "\n");
      await journal.sync();
      records.push(record);
      previous = hash(line);
    } catch {
      fault = true;
      throw new ModelError("CONFIGURATION", { outcome: "unknown" });
    }
  };
  try {
    await append({
      type: "opened",
      version: 1,
      planSha256,
      provider: plan.provider,
      model: plan.model.id,
      approvalId: approval?.id,
      allowanceUsdMicros: plan.budget.allowanceUsdMicros,
      reservationUsdMicros: reservation,
      priceRevision: MODEL_PRICE_REVISION,
    });
  } catch (error) {
    await journal.close();
    throw error;
  }
  const guard = async (signal?: AbortSignal) => {
    if (fault || closed || auditRecords(records).stopped)
      throw new ModelError("CONFIGURATION");
    if (signal?.aborted) throw new ModelError("CANCELLED");
    const now = Date.now();
    if (
      now >= plan.expiresAtMs ||
      (approval && (now >= approval.expiresAtMs || now >= priceReviewExpiresAt))
    )
      throw new ModelError("CONFIGURATION");
    if (
      hash(
        await boundedFile(
          options.planFile,
          OPERATOR_EVALUATION_LIMITS.maxPlanBytes,
        ),
      ) !== planSha256 ||
      (approval &&
        hash(
          await boundedFile(
            options.approvalFile!,
            OPERATOR_EVALUATION_LIMITS.maxApprovalBytes,
          ),
        ) !== approvalHash)
    )
      throw new ModelError("CONFIGURATION");
    if (signal?.aborted) throw new ModelError("CANCELLED");
    if (
      closed ||
      fault ||
      Date.now() >= plan.expiresAtMs ||
      (approval && Date.now() >= approval.expiresAtMs)
    )
      throw new ModelError("CONFIGURATION");
  };
  const current = (claim: OperatorEvaluationClaim, finishing = false) => {
    const state = states.get(claim);
    if (!state || state !== active || (!finishing && state.finish))
      throw new ModelError("CONFIGURATION");
    return state;
  };
  return {
    plan,
    planSha256,
    journalFile,
    metadata: operatorEvaluationMetadataSchema.parse({
      profile: "operator-evaluation",
      planSha256,
      provider: plan.provider,
      runtimeManifestSha256: plan.hashes.runtimeManifestSha256,
      expiresAtMs: Math.min(
        plan.expiresAtMs,
        approval?.expiresAtMs ?? plan.expiresAtMs,
      ),
    }),
    claim: (raw: OperatorEvaluationBinding, inputSha256: string) =>
      transaction(async () => {
        await guard();
        const binding = operatorEvaluationBindingSchema.parse(raw);
        sha.parse(inputSha256);
        const trial = plan.trials.find((item) => item.id === binding.trialId);
        const task =
          trial && plan.cases.find((item) => item.id === trial.caseId);
        if (
          active ||
          binding.planSha256 !== planSha256 ||
          !trial ||
          trial.arm === "local" ||
          !task ||
          binding.generation >= task.maxGenerations
        )
          throw new ModelError("CONFIGURATION");
        const claimed = records.flatMap(({ event }) =>
          event.type === "claimed" ? [event] : [],
        );
        const sameTrial = claimed.filter(
          (item) => item.binding.trialId === trial.id,
        );
        if (
          claimed.length >= plan.maxGenerations ||
          sameTrial.length !== binding.generation
        )
          throw new ModelError("CONFIGURATION");
        if (binding.generation === 1) {
          const previous = records.flatMap(({ event }) =>
            event.type === "finished" && event.claimId === sameTrial[0].claimId
              ? [event]
              : [],
          )[0];
          if (
            previous?.outcome !== "reported" ||
            previous.errorCode !== undefined ||
            !["guide", "request-observation"].includes(
              previous.proposalKind || "",
            )
          )
            throw new ModelError("CONFIGURATION");
        }
        const audit = auditRecords(records);
        if (
          audit.liabilityUsdMicros + reservation >
          plan.budget.allowanceUsdMicros
        ) {
          await append({ type: "stopped", reason: "budget" });
          throw new ModelError("BUDGET_EXCEEDED");
        }
        const claim = freeze({
          id: randomUUID(),
          binding: { ...binding },
          inputSha256,
        });
        const state: ClaimState = {
          claim,
          authorized: false,
          dispatchPhases: new Set(),
        };
        active = state;
        states.set(claim, state);
        await append({
          type: "claimed",
          claimId: claim.id,
          binding,
          inputSha256,
          reservedUsdMicros: reservation,
        });
        return claim;
      }),
    /** A durable intent does not prove that a provider received the request. */
    beforeSend: (
      claim: OperatorEvaluationClaim,
      signal: AbortSignal,
      phase?: DispatchPhase,
      requestSha256?: string,
    ) =>
      transaction(async () => {
        const state = current(claim);
        await guard(signal);
        current(claim);
        if (!phase) {
          if (requestSha256 !== undefined)
            throw new ModelError("CONFIGURATION");
          return;
        }
        if (
          !requestSha256 ||
          !sha.safeParse(requestSha256).success ||
          !dispatchAllowed(plan.provider, state, phase)
        )
          throw new ModelError("CONFIGURATION");
        await append({
          type: "dispatch-intent",
          claimId: claim.id,
          phase,
          requestSha256,
        });
        state.dispatchPhases.add(phase);
      }),
    authorizeGeneration: (
      claim: OperatorEvaluationClaim,
      signal: AbortSignal,
    ) =>
      transaction(async () => {
        const state = current(claim);
        await guard(signal);
        current(claim);
        if (state.authorized) throw new ModelError("CONFIGURATION");
        await append({ type: "authorized", claimId: claim.id });
        state.authorized = true;
      }),
    finish: (
      claim: OperatorEvaluationClaim,
      result: OperatorEvaluationFinish,
    ): Promise<void> => {
      const state = states.get(claim);
      if (!state) return Promise.reject(new ModelError("CONFIGURATION"));
      if (state.finish) return state.finish;
      const work = transaction(async () => {
        current(claim, true);
        let outcome = result.outcome,
          usage: ModelUsage | undefined,
          costUsdMicros: number | undefined;
        let reason:
          | "unknown"
          | "invalid-usage"
          | "over-reservation"
          | "privacy"
          | undefined;
        if (outcome === "reported") {
          const parsed = modelUsageSchema.safeParse(result.usage);
          if (
            !parsed.success ||
            !state.authorized ||
            parsed.data.provider !== plan.provider ||
            parsed.data.model !== plan.model.id ||
            (plan.provider === "vertex" && parsed.data.promptTokens === 0)
          ) {
            outcome = "unknown";
            reason = "invalid-usage";
          } else {
            usage = parsed.data;
            costUsdMicros =
              plan.provider === "fake"
                ? 0
                : estimateModelCostUsdMicros(
                    "global",
                    usage.promptTokens,
                    usage.outputTokens + usage.thoughtTokens,
                  );
            if (
              costUsdMicros > reservation ||
              usage.promptTokens > plan.budget.maxInputTokens ||
              usage.outputTokens + usage.thoughtTokens >
                plan.budget.maxOutputTokens
            )
              reason = "over-reservation";
          }
        } else if (outcome === "unknown") reason = "unknown";
        if (result.knownSentinelLeak) reason = "privacy";
        const errorCode =
          reason === "invalid-usage"
            ? "INVALID_USAGE"
            : result.error
              ? modelErrorCodeSchema.parse(result.error.code)
              : undefined;
        await append(
          finishSchema.parse({
            type: "finished",
            claimId: claim.id,
            outcome,
            usage,
            costUsdMicros,
            proposalKind:
              outcome === "reported" && !result.error
                ? result.proposalKind
                : undefined,
            proposalSha256: result.proposalSha256,
            knownSentinelLeak: result.knownSentinelLeak,
            errorCode,
          }),
        );
        if (reason) await append({ type: "stopped", reason });
        active = undefined;
      });
      state.finish = work;
      return work;
    },
    audit: (): OperatorEvaluationAudit => {
      if (fault) throw new ModelError("CONFIGURATION", { outcome: "unknown" });
      return auditRecords(records);
    },
    close: () =>
      transaction(async () => {
        if (closed) return;
        try {
          if (!fault) await append({ type: "closed" });
        } finally {
          closed = true;
          await journal.close();
        }
      }),
  };
}
export type OperatorEvaluationRuntime = Awaited<
  ReturnType<typeof openOperatorEvaluation>
>;
