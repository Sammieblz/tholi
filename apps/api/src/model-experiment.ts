import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  NAVIGATION_LIMITS,
  type NavigationValidationContext,
} from "../../../packages/navigation-core/contracts-navigation";
import { parseModelExperimentConfig, type Environment } from "./config";
import { createNavigationModelService } from "./application/navigation";
import { ModelError, type ModelUsage } from "./application/model-contracts";
import { createFakeNavigationModel } from "./adapters/fake-navigation-model";
import {
  createVertexNavigationModel,
  type VertexModelDependencies,
  type VertexModelOptions,
} from "./adapters/vertex-navigation-model";
import { createGoogleModelAccessToken } from "./adapters/google-model-auth";
import { isMainModule } from "./runtime";

export const MODEL_PRICE_REVISION = "vertex-3.8-standard-2026-10-31";
export const priceReviewExpiresAt = Date.parse("2027-01-01T00:00:00Z");
const inputLimit = NAVIGATION_LIMITS.maxEnvelopeBytes + 65536;
const inputSchema = z
  .object({
    version: z.literal(1),
    observation: z.unknown(),
    validation: z.unknown(),
  })
  .strict();
const approvalSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    approvedAtMs: z.number().int().nonnegative().safe(),
    expiresAtMs: z.number().int().positive().safe(),
    approvedData: z.literal(true),
    approvedSpending: z.literal(true),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    api: z.literal("v1"),
    project: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
    location: z.enum(["global", "us", "eu"]),
    model: z.literal("gemini-3.8-flash"),
    retentionProfile: z.literal("provider-default-acknowledged"),
    maxCostUsdMicros: z.number().int().positive().max(10000000),
    priceRevision: z.literal(MODEL_PRICE_REVISION),
  })
  .strict();

/** Standard rates, without assuming later promotional credits or cache discounts. */
export function estimateModelCostUsdMicros(
  location: VertexModelOptions["location"],
  promptTokens: number,
  outputTokens: number,
): number {
  if (
    !Number.isSafeInteger(promptTokens) ||
    promptTokens < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  )
    throw new ModelError("INVALID_USAGE");
  const [inputNanos, outputNanos] =
    location === "global" ? [1500n, 7500n] : [1650n, 8250n];
  const micros =
    (BigInt(promptTokens) * inputNanos +
      BigInt(outputTokens) * outputNanos +
      999n) /
    1000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ModelError("INVALID_USAGE");
  return Number(micros);
}

export async function boundedFile(
  file: string,
  limit: number,
): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit)
      throw new ModelError("INVALID_INPUT");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new ModelError("INVALID_INPUT");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export interface ModelExperimentOptions {
  inputFile: string;
  approvalFile?: string;
}
export interface ModelExperimentDependencies {
  accessToken?: VertexModelDependencies["accessToken"];
  fetch?: typeof fetch;
}

/** One local operator experiment, separate from account credits and production quotas. */
export async function runModelExperiment(
  options: ModelExperimentOptions,
  env: Environment = process.env,
  dependencies: ModelExperimentDependencies = {},
) {
  const config = parseModelExperimentConfig(env);
  const bytes = await boundedFile(options.inputFile, inputLimit);
  const input = inputSchema.parse(JSON.parse(bytes.toString("utf8")));
  const inputSha256 = createHash("sha256").update(bytes).digest("hex");
  const runId = randomUUID();
  let claim: Awaited<ReturnType<typeof open>> | undefined;
  let allowance = 0;
  let reserved = 0;
  let approved = false;
  let approvalId: string | undefined;
  let reservationWrite: Promise<void> | undefined;
  let beforeSend: VertexModelDependencies["beforeSend"] = async () => {
    throw new ModelError("CONFIGURATION");
  };
  let authorizeGeneration: VertexModelDependencies["authorizeGeneration"] =
    async () => {
      throw new ModelError("CONFIGURATION");
    };
  if (config.provider === "vertex") {
    if (!options.approvalFile || Date.now() >= priceReviewExpiresAt)
      throw new ModelError("CONFIGURATION");
    const approvalBytes = await boundedFile(options.approvalFile, 8192);
    const approvalHash = createHash("sha256")
      .update(approvalBytes)
      .digest("hex");
    const approval = approvalSchema.parse(
      JSON.parse(approvalBytes.toString("utf8")),
    );
    const now = Date.now();
    if (
      approval.approvedAtMs > now ||
      approval.expiresAtMs <= now ||
      approval.expiresAtMs <= approval.approvedAtMs ||
      approval.expiresAtMs - approval.approvedAtMs > 3600000 ||
      approval.inputSha256 !== inputSha256 ||
      Object.entries(config.options).some(
        ([key, value]) => approval[key as keyof typeof approval] !== value,
      )
    )
      throw new ModelError("CONFIGURATION");
    await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
    const stateDirectory = await realpath(config.stateDirectory);
    const actualState = resolve(stateDirectory);
    const configuredState = resolve(config.stateDirectory);
    if (
      process.platform === "win32"
        ? actualState.toLowerCase() !== configuredState.toLowerCase()
        : actualState !== configuredState
    )
      throw new ModelError("CONFIGURATION");
    // Exclusive creation is shared by concurrent invocations using this durable
    // operator state directory. A failed/uncertain run needs a fresh approval.
    try {
      claim = await open(
        join(stateDirectory, `${approval.id}.jsonl`),
        "wx",
        0o600,
      );
    } catch {
      throw new ModelError("CONFIGURATION");
    }
    approvalId = approval.id;
    allowance = approval.maxCostUsdMicros;
    try {
      await claim.writeFile(
        JSON.stringify({
          version: 1,
          runId,
          approvalId,
          inputSha256,
          status: "claimed",
          allowanceUsdMicros: allowance,
          priceRevision: MODEL_PRICE_REVISION,
        }) + "\n",
      );
      await claim.sync();
    } catch {
      await claim.close();
      throw new ModelError("CONFIGURATION");
    }
    approved = true;
    beforeSend = async (signal) => {
      signal.throwIfAborted();
      if (
        Date.now() >= approval.expiresAtMs ||
        Date.now() >= priceReviewExpiresAt
      )
        throw new ModelError("CONFIGURATION");
      const current = await boundedFile(options.approvalFile!, 8192);
      if (createHash("sha256").update(current).digest("hex") !== approvalHash)
        throw new ModelError("CONFIGURATION");
      signal.throwIfAborted();
      if (
        Date.now() >= approval.expiresAtMs ||
        Date.now() >= priceReviewExpiresAt
      )
        throw new ModelError("CONFIGURATION");
    };
    let generated = false;
    authorizeGeneration = async (signal) => {
      signal.throwIfAborted();
      if (generated || Date.now() >= approval.expiresAtMs)
        throw new ModelError("CONFIGURATION");
      const candidate = estimateModelCostUsdMicros(
        config.options.location,
        // CountTokens is admission evidence, not a hard bound on the final
        // measured prompt. Reserve the configured ceiling before generation.
        config.budget.maxInputTokens,
        config.budget.maxOutputTokens,
      );
      if (candidate > allowance) throw new ModelError("BUDGET_EXCEEDED");
      generated = true;
      reservationWrite = (async () => {
        await claim!.writeFile(
          JSON.stringify({ status: "reserved", reservedUsdMicros: candidate }) +
            "\n",
        );
        await claim!.sync();
        reserved = candidate;
      })();
      await reservationWrite;
      signal.throwIfAborted();
    };
  }
  const controller = new AbortController();
  const started = Date.now();
  const elapsedStart = performance.now();
  const report = {
    version: 1,
    runId,
    provider: config.provider,
    ...(config.provider === "vertex" ? config.options : {}),
    inputSha256,
    priceRevision: MODEL_PRICE_REVISION,
    approved,
    ...(approvalId ? { approvalId } : {}),
    allowanceUsdMicros: allowance,
    reservedUsdMicros: 0,
    elapsedMs: 0,
    outcome: "not-sent" as "not-sent" | "unknown" | "reported",
    accepted: false,
    proposalKind: undefined as string | undefined,
    usage: undefined as ModelUsage | undefined,
    estimatedCostUsdMicros: undefined as number | undefined,
    errorCode: undefined as string | undefined,
    budget: config.budget,
  };
  try {
    const model =
      config.provider === "fake"
        ? createFakeNavigationModel()
        : createVertexNavigationModel(config.options, {
            accessToken:
              dependencies.accessToken ??
              createGoogleModelAccessToken(config.options.project),
            fetch: dependencies.fetch,
            authorizeGeneration,
            beforeSend,
          });
    const validation = input.validation as NavigationValidationContext;
    const result = await createNavigationModelService(model).propose(
      input.observation,
      () => ({
        ...validation,
        nowMs: validation.nowMs + Math.floor(performance.now() - elapsedStart),
      }),
      {
        requestId: runId,
        deadlineAt: started + config.timeoutMs,
        signal: controller.signal,
      },
      config.budget,
    );
    report.accepted = true;
    report.proposalKind = result.decision.decision.kind;
    report.usage = result.usage;
    report.outcome = "reported";
  } catch (error) {
    const safe =
      error instanceof ModelError ? error : new ModelError("INVALID_INPUT");
    report.errorCode = safe.code;
    report.outcome = safe.outcome;
    report.usage = safe.usage;
  } finally {
    controller.abort();
    report.elapsedMs = Math.ceil(performance.now() - elapsedStart);
    await reservationWrite?.catch(() => {});
    report.reservedUsdMicros = reserved;
    if (config.provider === "vertex" && report.usage) {
      try {
        report.estimatedCostUsdMicros = estimateModelCostUsdMicros(
          config.options.location,
          report.usage.promptTokens,
          report.usage.outputTokens + report.usage.thoughtTokens,
        );
      } catch {
        report.errorCode = "INVALID_USAGE";
        report.outcome = "unknown";
        report.usage = undefined;
      }
    }
    if (claim) {
      try {
        await claim.writeFile(
          JSON.stringify({ status: "finished", report }) + "\n",
        );
        await claim.sync();
      } finally {
        await claim.close();
      }
    }
  }
  return report;
}

if (isMainModule(import.meta.url)) {
  try {
    const args = parseArgs({
      options: { input: { type: "string" }, approval: { type: "string" } },
    });
    if (!args.values.input) throw new ModelError("CONFIGURATION");
    const report = await runModelExperiment({
      inputFile: args.values.input,
      approvalFile: args.values.approval,
    });
    process.stdout.write(JSON.stringify(report) + "\n");
    if (!report.accepted) process.exitCode = 1;
  } catch {
    process.stderr.write(
      "Tholi model experiment refused. Check bounded input, configuration and explicit approval.\n",
    );
    process.exitCode = 1;
  }
}
