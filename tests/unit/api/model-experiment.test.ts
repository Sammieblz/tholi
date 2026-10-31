import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  MODEL_PRICE_REVISION,
  estimateModelCostUsdMicros,
  runModelExperiment,
} from "../../../apps/api/src/model-experiment";
import { createGoogleModelAccessToken } from "../../../apps/api/src/adapters/google-model-auth";
import {
  openOperatorEvaluation,
  readOperatorEvaluationAudit,
  type OperatorEvaluationRuntime,
} from "../../../apps/api/src/operator-evaluation";
import {
  ModelError,
  resolveModelBudget,
} from "../../../apps/api/src/application/model-contracts";
import { createEvaluationPolicy } from "../../../apps/api/src/model-evaluation";
import { operatorEvaluationPlanFixture } from "../../support/operator-evaluation-fixture";
import { operatorEvaluationPlanSchema } from "../../../packages/navigation-core/contracts-evaluation";
import {
  NAVIGATION_LIMITS,
  navigationTransportInputSchema,
} from "../../../packages/navigation-core/contracts-navigation";
import {
  navigationModelCapture,
  navigationModelObservation,
  navigationModelValidation,
  navigationModelVertexResponse,
} from "../../support/navigation-model-fixture";

const sdk = vi.hoisted(() => ({
  loaded: vi.fn(),
  options: vi.fn(),
  token: vi.fn<() => Promise<string>>(),
}));
vi.mock("google-auth-library", () => {
  sdk.loaded();
  return {
    GoogleAuth: class {
      constructor(options: unknown) {
        sdk.options(options);
      }
      getAccessToken() {
        return sdk.token();
      }
    },
  };
});
const directories: string[] = [];
const evaluations: OperatorEvaluationRuntime[] = [];
const fixtureNow = Date.parse("2026-10-31T12:00:00Z");
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sdk.options.mockClear();
  sdk.token.mockReset();
  for (const evaluation of evaluations.splice(0)) await evaluation.close();
  for (const directory of directories.splice(0)) {
    const actual = await realpath(directory),
      parent = await realpath(tmpdir());
    if (
      !isAbsolute(directory) ||
      actual !== directory ||
      !actual.startsWith(parent + sep + "tholi-model-experiment-")
    )
      throw Error(
        "Refusing cleanup outside the owned model experiment directory.",
      );
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "tholi-model-experiment-")),
  );
  directories.push(directory);
  let now = fixtureNow;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const observation = navigationModelObservation();
  observation.context.goal = "SYNTHETIC_PRIVATE_GOAL";
  navigationModelCapture(observation);
  const input = Buffer.from(
    JSON.stringify({
      version: 1,
      observation,
      validation: navigationModelValidation(observation),
    }),
  );
  const inputFile = join(directory, "input.json"),
    approvalFile = join(directory, "approval.json"),
    stateDirectory = join(directory, "state");
  await writeFile(inputFile, input);
  const approval: Record<string, unknown> = {
    version: 1,
    id: randomUUID(),
    approvedAtMs: now,
    expiresAtMs: now + 60000,
    approvedData: true,
    approvedSpending: true,
    inputSha256: createHash("sha256").update(input).digest("hex"),
    api: "v1",
    project: "tholi-model-fixture",
    location: "global",
    model: "gemini-3.8-flash",
    retentionProfile: "provider-default-acknowledged",
    maxCostUsdMicros: 1000,
    priceRevision: MODEL_PRICE_REVISION,
  };
  const env = {
    THOLI_MODEL_PROVIDER: "vertex",
    THOLI_MODEL_API: "v1",
    THOLI_MODEL_PROJECT: "tholi-model-fixture",
    THOLI_MODEL_REGION: "global",
    THOLI_MODEL_ID: "gemini-3.8-flash",
    THOLI_MODEL_RETENTION_PROFILE: "provider-default-acknowledged",
    THOLI_MODEL_EXPERIMENT_STATE_DIR: stateDirectory,
    THOLI_MODEL_MAX_INPUT_TOKENS: "64",
    THOLI_MODEL_MAX_OUTPUT_TOKENS: "8",
  };
  const proposal = { kind: "unsupported", reason: "Private output marker" };
  const accessToken = vi.fn(
    async (_signal: AbortSignal) => "SYNTHETIC_ACCESS_TOKEN",
  );
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith(":countTokens")
      ? Response.json({ totalTokens: 4 })
      : Response.json(
          navigationModelVertexResponse(proposal, {
            prompt: 4,
            output: 3,
            thought: 2,
          }),
        ),
  );
  const approve = () => writeFile(approvalFile, JSON.stringify(approval));
  const run = () =>
    runModelExperiment({ inputFile, approvalFile }, env, {
      accessToken,
      fetch: fetcher,
    });
  const journal = async () =>
    (
      await readFile(
        join(stateDirectory, String(approval.id) + ".jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return {
    directory,
    inputFile,
    approvalFile,
    stateDirectory,
    observation,
    input,
    approval,
    env,
    accessToken,
    fetcher,
    approve,
    run,
    journal,
    setNow: (value: number) => {
      now = value;
    },
  };
}

test("fake operator default invokes no credentials or fetch and reports no private observation content", async () => {
  const app = await fixture();
  const globalFetch = vi.fn();
  vi.stubGlobal("fetch", globalFetch);
  const result = await runModelExperiment(
    { inputFile: app.inputFile, approvalFile: "never-read-approval" },
    { GOOGLE_APPLICATION_CREDENTIALS: "UNREAD_CREDENTIAL_PATH" },
    { accessToken: app.accessToken, fetch: app.fetcher },
  );
  expect(result).toMatchObject({
    provider: "fake",
    accepted: true,
    approved: false,
    outcome: "reported",
    allowanceUsdMicros: 0,
    reservedUsdMicros: 0,
    usage: { provider: "fake", source: "fake", totalTokens: 0 },
  });
  expect(app.accessToken).not.toHaveBeenCalled();
  expect(app.fetcher).not.toHaveBeenCalled();
  expect(globalFetch).not.toHaveBeenCalled();
  expect(sdk.options).not.toHaveBeenCalled();
  expect(sdk.loaded).not.toHaveBeenCalled();
  expect(await readdir(app.directory)).toEqual(["input.json"]);
  const serialized = JSON.stringify(result);
  for (const privateValue of [
    "SYNTHETIC_PRIVATE_GOAL",
    "Settings",
    app.observation.native.documentId,
    app.directory,
    app.observation.images[0].image.slice(0, 64),
  ])
    expect(serialized).not.toContain(privateValue);
});

test("missing approval refuses the live experiment before credentials or network", async () => {
  const app = await fixture();
  await expect(
    runModelExperiment({ inputFile: app.inputFile }, app.env, {
      accessToken: app.accessToken,
      fetch: app.fetcher,
    }),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  expect(app.accessToken).not.toHaveBeenCalled();
  expect(app.fetcher).not.toHaveBeenCalled();
});

test.each([
  [
    "expired",
    (permit: Record<string, unknown>) => {
      permit.expiresAtMs = fixtureNow;
    },
  ],
  [
    "future",
    (permit: Record<string, unknown>) => {
      permit.approvedAtMs = fixtureNow + 1;
    },
  ],
  [
    "overlong",
    (permit: Record<string, unknown>) => {
      permit.expiresAtMs = fixtureNow + 3600001;
    },
  ],
  [
    "unapproved data",
    (permit: Record<string, unknown>) => {
      permit.approvedData = false;
    },
  ],
  [
    "unapproved spending",
    (permit: Record<string, unknown>) => {
      permit.approvedSpending = false;
    },
  ],
  [
    "different data",
    (permit: Record<string, unknown>) => {
      permit.inputSha256 = "0".repeat(64);
    },
  ],
  [
    "different model",
    (permit: Record<string, unknown>) => {
      permit.model = "another-model";
    },
  ],
  [
    "different region",
    (permit: Record<string, unknown>) => {
      permit.location = "us";
    },
  ],
  [
    "different project",
    (permit: Record<string, unknown>) => {
      permit.project = "other-model-project";
    },
  ],
  [
    "unreviewed prices",
    (permit: Record<string, unknown>) => {
      permit.priceRevision = "unreviewed";
    },
  ],
  [
    "excess allowance",
    (permit: Record<string, unknown>) => {
      permit.maxCostUsdMicros = 10000001;
    },
  ],
  [
    "path-shaped approval ID",
    (permit: Record<string, unknown>) => {
      permit.id = "../outside";
    },
  ],
])("rejects %s approval before token or HTTP use", async (_, mutate) => {
  const app = await fixture();
  mutate(app.approval);
  await app.approve();
  await expect(app.run()).rejects.toBeDefined();
  expect(app.accessToken).not.toHaveBeenCalled();
  expect(app.fetcher).not.toHaveBeenCalled();
  expect(await readdir(app.directory)).not.toContain("state");
});

test("approved inference reserves the configured ceiling when measured input exceeds the count estimate", async () => {
  const app = await fixture();
  app.fetcher.mockImplementation(async (url) =>
    String(url).endsWith(":countTokens")
      ? Response.json({ totalTokens: 4 })
      : Response.json(
          navigationModelVertexResponse(
            { kind: "unsupported", reason: "Private output marker" },
            { prompt: 64, output: 3, thought: 2 },
          ),
        ),
  );
  await app.approve();
  const result = await app.run();
  expect(result).toMatchObject({
    provider: "vertex",
    accepted: true,
    approved: true,
    outcome: "reported",
    proposalKind: "unsupported",
    usage: {
      promptTokens: 64,
      outputTokens: 3,
      thoughtTokens: 2,
      totalTokens: 69,
    },
  });
  expect(result.reservedUsdMicros).toBe(
    estimateModelCostUsdMicros("global", 64, 8),
  );
  expect(result.estimatedCostUsdMicros).toBe(
    estimateModelCostUsdMicros("global", 64, 5),
  );
  expect(app.fetcher).toHaveBeenCalledTimes(2);
  expect(app.accessToken).toHaveBeenCalledTimes(2);
  const records = await app.journal();
  expect(records.map((record) => record.status)).toEqual([
    "claimed",
    "reserved",
    "finished",
  ]);
  const serialized = JSON.stringify(records);
  for (const privateValue of [
    "SYNTHETIC_PRIVATE_GOAL",
    "Private output marker",
    "SYNTHETIC_ACCESS_TOKEN",
    app.observation.native.documentId,
    app.inputFile,
    app.observation.images[0].image.slice(0, 64),
  ])
    expect(serialized).not.toContain(privateValue);
});

test("one approval is claimed atomically across concurrent operator invocations", async () => {
  const app = await fixture();
  await app.approve();
  const results = await Promise.allSettled([app.run(), app.run()]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const winner = results.find((result) => result.status === "fulfilled");
  expect(winner?.status === "fulfilled" && winner.value.accepted).toBe(true);
  expect(app.fetcher).toHaveBeenCalledTimes(2);
  expect((await app.journal()).map((record) => record.status)).toEqual([
    "claimed",
    "reserved",
    "finished",
  ]);
});

test("an allowance covering only the count estimate blocks generation without claiming an unwritten reservation", async () => {
  const app = await fixture();
  app.approval.maxCostUsdMicros = estimateModelCostUsdMicros("global", 4, 8);
  await app.approve();
  expect(await app.run()).toMatchObject({
    accepted: false,
    errorCode: "BUDGET_EXCEEDED",
    outcome: "not-sent",
    reservedUsdMicros: 0,
  });
  expect(app.fetcher).toHaveBeenCalledOnce();
  expect(String(app.fetcher.mock.calls[0][0])).toMatch(/:countTokens$/);
  expect((await app.journal()).map((record) => record.status)).toEqual([
    "claimed",
    "finished",
  ]);
});

test.each(["changed", "revoked", "expired"] as const)(
  "a %s permit during credentials blocks the first send",
  async (change) => {
    const app = await fixture();
    if (change === "expired") app.approval.expiresAtMs = fixtureNow + 500;
    await app.approve();
    app.accessToken.mockImplementation(async () => {
      if (change === "expired") app.setNow(Number(app.approval.expiresAtMs));
      else if (change === "revoked") await unlink(app.approvalFile);
      else
        await writeFile(
          app.approvalFile,
          JSON.stringify({ ...app.approval, approvedData: false }),
        );
      return "SYNTHETIC_ACCESS_TOKEN";
    });
    const result = await app.run();
    expect(result.accepted).toBe(false);
    expect(app.fetcher).not.toHaveBeenCalled();
  },
);

test.each(["changed", "revoked", "expired"] as const)(
  "a %s permit after count blocks the generation send",
  async (change) => {
    const app = await fixture();
    if (change === "expired") app.approval.expiresAtMs = fixtureNow + 500;
    await app.approve();
    app.fetcher.mockImplementation(async () => {
      if (change === "expired") app.setNow(Number(app.approval.expiresAtMs));
      else if (change === "revoked") await unlink(app.approvalFile);
      else
        await writeFile(
          app.approvalFile,
          JSON.stringify({ ...app.approval, approvedSpending: false }),
        );
      return Response.json({ totalTokens: 4 });
    });
    const result = await app.run();
    expect(result.accepted).toBe(false);
    expect(app.fetcher).toHaveBeenCalledOnce();
  },
);

test("an uncertain generation consumes its approval and cannot be retried with that permit", async () => {
  const app = await fixture();
  await app.approve();
  app.fetcher.mockImplementation(async (url) => {
    if (String(url).endsWith(":countTokens"))
      return Response.json({ totalTokens: 4 });
    throw Error("SYNTHETIC_PRIVATE_PROVIDER_BODY");
  });
  expect(await app.run()).toMatchObject({
    accepted: false,
    outcome: "unknown",
    errorCode: "UNAVAILABLE",
  });
  await expect(app.run()).rejects.toMatchObject({ code: "CONFIGURATION" });
  expect(app.fetcher).toHaveBeenCalledTimes(2);
  const records = await app.journal();
  expect(records.at(-1).report.outcome).toBe("unknown");
  expect(JSON.stringify(records)).not.toContain(
    "SYNTHETIC_PRIVATE_PROVIDER_BODY",
  );
});

test("bounded regular inputs and approval files are checked before live state or network use", async () => {
  const app = await fixture();
  await app.approve();
  await writeFile(
    app.inputFile,
    Buffer.alloc(NAVIGATION_LIMITS.maxEnvelopeBytes + 65537),
  );
  await expect(app.run()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await writeFile(app.inputFile, app.input);
  await writeFile(app.approvalFile, Buffer.alloc(8193));
  await expect(app.run()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    runModelExperiment({ inputFile: app.directory }, {}),
  ).rejects.toBeDefined();
  expect(app.accessToken).not.toHaveBeenCalled();
  expect(app.fetcher).not.toHaveBeenCalled();
});

test("existing claims and aliased state directories cannot be overwritten or used for paid calls", async () => {
  const app = await fixture();
  await app.approve();
  await mkdir(app.stateDirectory);
  const claim = join(app.stateDirectory, String(app.approval.id) + ".jsonl");
  await writeFile(claim, "EXISTING_OPERATOR_CLAIM");
  await expect(app.run()).rejects.toMatchObject({ code: "CONFIGURATION" });
  expect(await readFile(claim, "utf8")).toBe("EXISTING_OPERATOR_CLAIM");
  const alias = join(app.directory, "state-alias");
  await symlink(app.stateDirectory, alias, "junction");
  try {
    await expect(
      runModelExperiment(
        { inputFile: app.inputFile, approvalFile: app.approvalFile },
        { ...app.env, THOLI_MODEL_EXPERIMENT_STATE_DIR: alias },
        { accessToken: app.accessToken, fetch: app.fetcher },
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION" });
  } finally {
    await unlink(alias);
  }
  expect(app.accessToken).not.toHaveBeenCalled();
  expect(app.fetcher).not.toHaveBeenCalled();
});

test("ADC remains lazy for cancelled work and suppresses sensitive SDK failures", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const accessToken = createGoogleModelAccessToken("tholi-model-fixture");
  expect(sdk.options).not.toHaveBeenCalled();
  await expect(accessToken(cancelled.signal)).rejects.toMatchObject({
    code: "CANCELLED",
  });
  expect(sdk.options).not.toHaveBeenCalled();
  sdk.token.mockRejectedValue(Error("SYNTHETIC_PRIVATE_CREDENTIAL_PATH"));
  await expect(accessToken(new AbortController().signal)).rejects.toMatchObject(
    { code: "CONFIGURATION", message: "The model configuration is invalid." },
  );
  expect(sdk.options).toHaveBeenCalledOnce();
  expect(sdk.options.mock.calls[0][0]).toMatchObject({
    projectId: "tholi-model-fixture",
    clientOptions: {
      forceRefreshOnFailure: false,
      transporterOptions: { retry: false, maxRedirects: 0 },
    },
  });
});

test("ADC coalesces one signal and aborts an uncooperative SDK without accepting a late token", async () => {
  let lateFailure!: (reason: Error) => void;
  sdk.token.mockImplementation(
    () =>
      new Promise((_, reject) => {
        lateFailure = reject;
      }),
  );
  const controller = new AbortController(),
    accessToken = createGoogleModelAccessToken("tholi-model-fixture"),
    first = accessToken(controller.signal);
  expect(accessToken(controller.signal)).toBe(first);
  for (let turn = 0; turn < 20 && !sdk.token.mock.calls.length; turn++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sdk.token).toHaveBeenCalledOnce();
  controller.abort();
  await expect(first).rejects.toMatchObject({ code: "CANCELLED" });
  lateFailure(Error("SYNTHETIC_PRIVATE_LATE_SDK_ERROR"));
  await Promise.resolve();
});

async function batchFixture(provider: "fake" | "vertex" = "vertex") {
  const app = await fixture();
  const plan = operatorEvaluationPlanFixture({ provider, now: fixtureNow });
  const planFile = join(app.directory, "evaluation-plan.json");
  const planJson = JSON.stringify(plan, null, 2);
  const planSha256 = createHash("sha256").update(planJson).digest("hex");
  await writeFile(planFile, planJson);
  const approval = {
    version: 1,
    id: randomUUID(),
    planSha256,
    approvedAtMs: fixtureNow,
    expiresAtMs: fixtureNow + 60000,
    approvedData: true,
    approvedSpending: true,
    allowanceUsdMicros: 4900000,
  };
  if (provider === "vertex")
    await writeFile(app.approvalFile, JSON.stringify(approval));
  const start = async (approved = provider === "vertex") => {
    const runtime = await openOperatorEvaluation({
      planFile,
      stateDirectory: app.stateDirectory,
      ...(approved ? { approvalFile: app.approvalFile } : {}),
    });
    evaluations.push(runtime);
    return runtime;
  };
  const trials = plan.trials.filter((trial) => trial.arm !== "local");
  const binding = (index = 0, generation: 0 | 1 = 0) => ({
    planSha256,
    trialId: trials[index].id,
    generation,
  });
  return {
    ...app,
    plan,
    planFile,
    planJson,
    planSha256,
    approval,
    start,
    trials,
    binding,
  };
}
const vertexUsage = (promptTokens = 32768, outputTokens = 2048) => ({
  provider: "vertex" as const,
  source: "measured" as const,
  model: "gemini-3.8-flash",
  promptTokens,
  outputTokens,
  thoughtTokens: 0,
  cachedTokens: 0,
  totalTokens: promptTokens + outputTokens,
});

async function policyFixture(provider: "fake" | "vertex" = "fake") {
  const app = await batchFixture(provider);
  const runtime = await app.start();
  const controller = new AbortController();
  const observation = structuredClone(app.observation);
  observation.context.goal = app.plan.cases[0].goal;
  observation.images = [];
  const input = navigationTransportInputSchema.parse({
    profile: "operator-evaluation",
    requestId: randomUUID(),
    evaluation: app.binding(),
    observation,
    validation: navigationModelValidation(observation),
    policy: { timeoutMs: 1000 },
  });
  const scope = {
    principal: {
      accountId: app.plan.operator.accountId,
      clientId: "extension-chromium",
      clientKind: "extension" as const,
    },
    workspaceId: app.plan.operator.workspaceId,
    context: {
      requestId: randomUUID(),
      deadlineAt: fixtureNow + 10000,
      signal: controller.signal,
    },
    revalidate: vi.fn(async () => {}),
  };
  return {
    ...app,
    runtime,
    input,
    scope,
    controller,
    policy: createEvaluationPolicy(runtime),
  };
}

test("operator policy rejects actor, goal and arm image mismatches before acquiring spending", async () => {
  const app = await policyFixture();
  const claim = vi.spyOn(app.runtime, "claim");
  const wrongGoal = structuredClone(app.input);
  wrongGoal.observation.context.goal = "Not the frozen goal";
  const wrongImages = structuredClone(app.input);
  wrongImages.observation.images = app.observation.images;
  const missingImages = structuredClone(app.input);
  if (missingImages.profile === "operator-evaluation")
    missingImages.evaluation = app.binding(1);
  for (const [input, scope] of [
    [
      app.input,
      {
        ...app.scope,
        principal: { ...app.scope.principal, accountId: randomUUID() },
      },
    ],
    [app.input, { ...app.scope, workspaceId: randomUUID() }],
    [
      app.input,
      {
        ...app.scope,
        principal: { ...app.scope.principal, clientId: "extension-firefox" },
      },
    ],
    [wrongGoal, app.scope],
    [wrongImages, app.scope],
    [missingImages, app.scope],
  ] as const)
    await expect(app.policy.prepare(input, scope)).rejects.toMatchObject({
      code: "CONFIGURATION",
    });
  expect(claim).not.toHaveBeenCalled();
  expect(app.scope.revalidate).not.toHaveBeenCalled();
  expect(app.runtime.audit().claimedGenerations).toBe(0);
});

test("operator fake policy uses admitted budgets and phase binding without ADC, and halted settlement prevents release", async () => {
  const app = await policyFixture();
  const fetcher = vi.fn(() => {
    throw Error("Unexpected provider access");
  });
  vi.stubGlobal("fetch", fetcher);
  const operation = await app.policy.prepare(app.input, app.scope);
  expect(operation.budget).toMatchObject({
    maxInputTokens: 32768,
    maxOutputTokens: 2048,
    maxImages: 0,
  });
  const result = await operation.model.infer(
    {
      observation: app.input.observation,
      budget: resolveModelBudget(operation.budget),
    },
    app.scope.context,
  );
  expect(app.runtime.audit()).toMatchObject({
    provider: "fake",
    claimedGenerations: 1,
    authorizedGenerations: 1,
    countDispatchIntents: 0,
    generationDispatchIntents: 1,
  });
  expect(app.scope.revalidate.mock.calls.length).toBeGreaterThanOrEqual(3);
  const realAudit = app.runtime.audit();
  vi.spyOn(app.runtime, "audit").mockImplementation(() => ({
    ...realAudit,
    stopped: "invalid-usage",
  }));
  await expect(operation.finish({ usage: result.usage })).rejects.toMatchObject(
    { code: "INVALID_USAGE" },
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(sdk.options).not.toHaveBeenCalled();
  await app.runtime.close();
  expect(
    (await readOperatorEvaluationAudit(app.runtime.journalFile))
      .reservedUsdMicros,
  ).toBe(0);
});

test("operator policy settles an acquired but undispatched cancelled claim as no-send", async () => {
  const app = await policyFixture("vertex");
  const operation = await app.policy.prepare(app.input, app.scope);
  expect(app.runtime.audit().reservedUsdMicros).toBe(64512);
  app.controller.abort();
  let failure: ModelError | undefined;
  try {
    await operation.model.infer(
      {
        observation: app.input.observation,
        budget: resolveModelBudget(operation.budget),
      },
      app.scope.context,
    );
  } catch (error) {
    if (error instanceof ModelError) failure = error;
    else throw error;
  }
  expect(failure?.code).toBe("CANCELLED");
  await operation.finish({ error: failure });
  const audit = app.runtime.audit();
  expect(audit).toMatchObject({
    reservedUsdMicros: 0,
    settledUsdMicros: 0,
    countDispatchIntents: 0,
    generationDispatchIntents: 0,
    unresolvedGenerations: 0,
  });
  expect(audit.records.at(-1)?.event).toMatchObject({
    type: "finished",
    outcome: "not-sent",
  });
  expect(sdk.options).not.toHaveBeenCalled();
});

test("operator policy rejects a known input canary before provider work and journals only the safety flag", async () => {
  const app = await policyFixture("vertex");
  app.input.observation.controls[0].label = "EVALUATION_PRIVATE_SENTINEL";
  await expect(app.policy.prepare(app.input, app.scope)).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  const audit = app.runtime.audit();
  expect(audit).toMatchObject({
    stopped: "privacy",
    knownSentinelLeaks: 1,
    countDispatchIntents: 0,
    generationDispatchIntents: 0,
    reservedUsdMicros: 0,
  });
  expect(JSON.stringify(audit)).not.toContain("EVALUATION_PRIVATE_SENTINEL");
  expect(sdk.options).not.toHaveBeenCalled();
});

test("operator policy contains a known output canary without persisting or treating it as intentional refusal", async () => {
  const fake =
    await import("../../../apps/api/src/adapters/fake-navigation-model");
  const original = fake.createFakeNavigationModel();
  vi.spyOn(fake, "createFakeNavigationModel").mockReturnValue({
    async infer(input, context) {
      const result = await original.infer(input, context);
      return {
        ...result,
        proposal: {
          kind: "unsupported",
          reason: "EVALUATION_PRIVATE_SENTINEL",
        },
      };
    },
  });
  const app = await policyFixture();
  const operation = await app.policy.prepare(app.input, app.scope);
  let failure: ModelError | undefined;
  try {
    await operation.model.infer(
      {
        observation: app.input.observation,
        budget: resolveModelBudget(operation.budget),
      },
      app.scope.context,
    );
  } catch (error) {
    if (error instanceof ModelError) failure = error;
    else throw error;
  }
  expect(failure?.code).toBe("INVALID_OUTPUT");
  await operation.finish({ error: failure, usage: failure?.usage });
  const audit = app.runtime.audit();
  expect(audit).toMatchObject({
    stopped: "privacy",
    knownSentinelLeaks: 1,
    settledUsdMicros: 0,
    reservedUsdMicros: 0,
  });
  expect(audit.records.at(-2)?.event).toMatchObject({
    type: "finished",
    outcome: "reported",
    errorCode: "INVALID_OUTPUT",
  });
  expect(JSON.stringify(audit)).not.toContain("EVALUATION_PRIVATE_SENTINEL");
  expect(
    audit.records.flatMap(({ event }) =>
      event.type === "finished" ? [event.proposalKind] : [],
    ),
  ).toEqual([undefined]);
});

test("operator dry runs are truthful fake reports, preserve frozen cohorts and never start ADC or Google requests", async () => {
  const app = await batchFixture("fake");
  const fetcher = vi.fn(() => {
    throw Error("Unexpected cloud request");
  });
  vi.stubGlobal("fetch", fetcher);
  const runtime = await app.start();
  const claim = await runtime.claim(app.binding(), "c".repeat(64));
  await runtime.authorizeGeneration(claim, new AbortController().signal);
  await expect(
    runtime.beforeSend(
      claim,
      new AbortController().signal,
      "count",
      "c".repeat(64),
    ),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.beforeSend(
    claim,
    new AbortController().signal,
    "generate",
    "d".repeat(64),
  );
  await runtime.finish(claim, {
    outcome: "reported",
    proposalKind: "unsupported",
    usage: {
      provider: "fake",
      source: "fake",
      model: "tholi-deterministic-v1",
      promptTokens: 0,
      outputTokens: 0,
      thoughtTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    },
  });
  expect(runtime.audit()).toMatchObject({
    provider: "fake",
    settledUsdMicros: 0,
    reservedUsdMicros: 0,
    countDispatchIntents: 0,
    generationDispatchIntents: 1,
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(sdk.options).not.toHaveBeenCalled();
  expect(
    operatorEvaluationPlanSchema.safeParse({
      ...app.plan,
      cases: app.plan.cases.slice(1),
    }).success,
  ).toBe(false);
  const cases = structuredClone(app.plan.cases);
  Object.assign(cases[0], { expectedTarget: "oracle-must-not-enter-plan" });
  expect(
    operatorEvaluationPlanSchema.safeParse({ ...app.plan, cases }).success,
  ).toBe(false);
});

test("operator live admission needs a new exact-plan approval and refuses consumed claims without network use", async () => {
  const app = await batchFixture();
  await expect(app.start(false)).rejects.toMatchObject({
    code: "CONFIGURATION",
  });
  await writeFile(
    app.approvalFile,
    JSON.stringify({ ...app.approval, planSha256: "f".repeat(64) }),
  );
  await expect(app.start()).rejects.toMatchObject({ code: "CONFIGURATION" });
  await writeFile(app.approvalFile, JSON.stringify(app.approval));
  const runtime = await app.start();
  await expect(app.start()).rejects.toMatchObject({ code: "CONFIGURATION" });
  expect(runtime.audit().claimedGenerations).toBe(0);
  expect(app.fetcher).not.toHaveBeenCalled();
  expect(sdk.options).not.toHaveBeenCalled();
});

test("operator dispatch intents bind exact body hashes and cannot repeat or generate before counted authorization", async () => {
  const app = await batchFixture();
  const runtime = await app.start();
  const claim = await runtime.claim(app.binding(), "c".repeat(64));
  const signal = new AbortController().signal;
  await expect(
    runtime.beforeSend(claim, signal, "generate", "d".repeat(64)),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.beforeSend(claim, signal, "count", "e".repeat(64));
  await expect(
    runtime.beforeSend(claim, signal, "count", "e".repeat(64)),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await expect(
    runtime.beforeSend(claim, signal, "generate", "d".repeat(64)),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.authorizeGeneration(claim, signal);
  await runtime.beforeSend(claim, signal, "generate", "d".repeat(64));
  await expect(
    runtime.beforeSend(claim, signal, "generate", "d".repeat(64)),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.finish(claim, {
    outcome: "reported",
    usage: vertexUsage(4, 3),
    proposalKind: "unsupported",
  });
  await runtime.close();
  const audit = await readOperatorEvaluationAudit(runtime.journalFile);
  expect(audit).toMatchObject({
    countDispatchIntents: 1,
    generationDispatchIntents: 1,
    authorizedGenerations: 1,
  });
  expect(
    audit.records.flatMap(({ event }) =>
      event.type === "dispatch-intent" ? [event.requestSha256] : [],
    ),
  ).toEqual(["e".repeat(64), "d".repeat(64)]);
  expect(app.fetcher).not.toHaveBeenCalled();
  expect(sdk.options).not.toHaveBeenCalled();
});

test("operator reservations settle measured cost before reuse and stop at the aggregate allowance", async () => {
  const app = await batchFixture();
  const runtime = await app.start();
  const signal = new AbortController().signal;
  const first = await runtime.claim(app.binding(), "d".repeat(64));
  expect(runtime.audit()).toMatchObject({
    settledUsdMicros: 0,
    reservedUsdMicros: 64512,
  });
  await runtime.authorizeGeneration(first, signal);
  await runtime.finish(first, {
    outcome: "reported",
    usage: vertexUsage(100, 10),
    proposalKind: "unsupported",
  });
  expect(runtime.audit()).toMatchObject({
    settledUsdMicros: 225,
    reservedUsdMicros: 0,
  });
  for (let index = 1; index <= 75; index++) {
    const claim = await runtime.claim(app.binding(index), "d".repeat(64));
    await runtime.authorizeGeneration(claim, signal);
    await runtime.finish(claim, {
      outcome: "reported",
      usage: vertexUsage(),
      proposalKind: "unsupported",
    });
  }
  expect(runtime.audit().settledUsdMicros).toBe(225 + 75 * 64512);
  await expect(
    runtime.claim(app.binding(76), "d".repeat(64)),
  ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
  expect(runtime.audit()).toMatchObject({
    stopped: "budget",
    claimedGenerations: 76,
    reservedUsdMicros: 0,
  });
  await runtime.close();
  const audit = await readOperatorEvaluationAudit(runtime.journalFile);
  expect(audit).toMatchObject({
    closed: true,
    stopped: "budget",
    settledUsdMicros: 225 + 75 * 64512,
  });
  expect(audit.liabilityUsdMicros).toBeLessThanOrEqual(4900000);
});

test("operator claims and finalization are one-shot; uncertain results retain liability and stop the run", async () => {
  const app = await batchFixture();
  const runtime = await app.start();
  const claim = await runtime.claim(app.binding(), "e".repeat(64));
  const signal = new AbortController().signal;
  await expect(runtime.beforeSend({ ...claim }, signal)).rejects.toMatchObject({
    code: "CONFIGURATION",
  });
  await expect(
    runtime.claim(app.binding(), "e".repeat(64)),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.authorizeGeneration(claim, signal);
  await expect(
    runtime.authorizeGeneration(claim, signal),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  const finish = runtime.finish(claim, {
    outcome: "unknown",
    error: new ModelError("UNAVAILABLE", { outcome: "unknown" }),
  });
  expect(runtime.finish(claim, { outcome: "not-sent" })).toBe(finish);
  await finish;
  expect(runtime.audit()).toMatchObject({
    stopped: "unknown",
    reservedUsdMicros: 64512,
    settledUsdMicros: 0,
  });
  await expect(
    runtime.claim(app.binding(1), "e".repeat(64)),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.close();
  expect(
    (await readOperatorEvaluationAudit(runtime.journalFile)).reservedUsdMicros,
  ).toBe(64512);
});

test("operator hooks recheck original approval bytes and interrupted claims never resume as free work", async () => {
  const app = await batchFixture();
  const runtime = await app.start();
  const claim = await runtime.claim(app.binding(), "f".repeat(64));
  await writeFile(app.approvalFile, JSON.stringify(app.approval) + " ");
  await expect(
    runtime.beforeSend(claim, new AbortController().signal),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  await runtime.close();
  const audit = await readOperatorEvaluationAudit(runtime.journalFile);
  expect(audit).toMatchObject({
    unresolvedGenerations: 1,
    reservedUsdMicros: 64512,
  });
  await expect(app.start()).rejects.toMatchObject({ code: "CONFIGURATION" });
  const original = await readFile(runtime.journalFile, "utf8");
  await writeFile(runtime.journalFile, original.slice(0, -1));
  await expect(
    readOperatorEvaluationAudit(runtime.journalFile),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
});

test("operator journal sync failure forbids further dispatch or optimistic settlement", async () => {
  const app = await batchFixture();
  const runtime = await app.start();
  const claim = await runtime.claim(app.binding(), "a".repeat(64));
  const probe = await open(join(app.directory, "prototype-probe"), "w");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  vi.spyOn(prototype, "sync").mockRejectedValueOnce(
    Error("PRIVATE_JOURNAL_FAILURE"),
  );
  await expect(
    runtime.authorizeGeneration(claim, new AbortController().signal),
  ).rejects.toMatchObject({ code: "CONFIGURATION", outcome: "unknown" });
  await expect(
    runtime.beforeSend(claim, new AbortController().signal),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  expect(() => runtime.audit()).toThrow("The model configuration is invalid.");
  await runtime.close();
  const audit = await readOperatorEvaluationAudit(runtime.journalFile);
  expect(audit).toMatchObject({
    unresolvedGenerations: 1,
    reservedUsdMicros: 64512,
  });
  expect(JSON.stringify(audit)).not.toContain("PRIVATE_JOURNAL_FAILURE");
});

test.each(["missing-usage", "over-reservation", "privacy"] as const)(
  "operator %s stops without inventing a free or successful outcome",
  async (scenario) => {
    const app = await batchFixture();
    const runtime = await app.start();
    const claim = await runtime.claim(app.binding(), "b".repeat(64));
    await runtime.authorizeGeneration(claim, new AbortController().signal);
    await runtime.finish(
      claim,
      scenario === "privacy"
        ? {
            outcome: "not-sent",
            knownSentinelLeak: true,
            error: new ModelError("INVALID_INPUT"),
          }
        : {
            outcome: "reported",
            usage:
              scenario === "missing-usage"
                ? undefined
                : vertexUsage(32769, 2048),
            error: new ModelError("INVALID_OUTPUT"),
            proposalKind: "unsupported",
          },
    );
    const audit = runtime.audit();
    expect(audit.stopped).toBe(
      scenario === "missing-usage" ? "invalid-usage" : scenario,
    );
    expect(
      audit.records.flatMap(({ event }) =>
        event.type === "finished" ? [event.proposalKind] : [],
      ),
    ).toEqual([undefined]);
    if (scenario === "missing-usage")
      expect(audit.reservedUsdMicros).toBe(64512);
    if (scenario === "over-reservation")
      expect(audit.settledUsdMicros).toBeGreaterThan(64512);
    if (scenario === "privacy") expect(audit.knownSentinelLeaks).toBe(1);
  },
);
