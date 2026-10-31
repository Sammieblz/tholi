import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
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
import { NAVIGATION_LIMITS } from "../../../packages/navigation-core/contracts-navigation";
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
const fixtureNow = Date.parse("2026-10-31T12:00:00Z");
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sdk.options.mockClear();
  sdk.token.mockReset();
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
