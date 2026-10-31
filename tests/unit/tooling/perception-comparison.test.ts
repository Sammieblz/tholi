import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  writeFile,
  rm,
  mkdir,
  mkdtemp,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import {
  buildComparisonPlan,
  comparisonCases,
  comparisonTrials,
  comparisonTrialMayRun,
  comparisonProviderReadiness,
  readComparisonPlan,
} from "../../support/perception-comparison";

it("attributes preflight errors only to the retained request and current trial, while provider terminals require a fresh generation and transport", () => {
  const trial = comparisonTrials.find((item) => item.arm === "multimodal")!;
  const requestId = "00000000-0000-4000-8000-000000000001";
  const expected = {
    planSha256: "a".repeat(64),
    trial,
    provider: "fake" as const,
    requestId,
    lastGeneration: -1,
  };
  const state = {
    profile: "operator-evaluation",
    requestId,
    state: "error",
    code: "FORBIDDEN",
    evaluation: {
      planSha256: expected.planSha256,
      trialId: trial.id,
      provider: "fake",
      arm: "multimodal",
    },
  };
  expect(comparisonProviderReadiness(state, expected)?.kind).toBe(
    "preflight-error",
  );
  expect(
    comparisonProviderReadiness({ ...state, code: undefined }, expected)?.state
      .code,
  ).toBeUndefined();
  expect(
    comparisonProviderReadiness(
      { ...state, requestId: randomUUID() },
      expected,
    ),
  ).toBeUndefined();
  expect(
    comparisonProviderReadiness(
      { ...state, evaluation: { ...state.evaluation, trialId: randomUUID() } },
      expected,
    ),
  ).toBeUndefined();
  expect(
    comparisonProviderReadiness(state, { ...expected, lastGeneration: 0 })
      ?.kind,
  ).toBe("pending");
  const bound = {
    ...state,
    state: "guiding",
    evaluation: { ...state.evaluation, generation: 0 },
  };
  expect(comparisonProviderReadiness(bound, expected)).toBeUndefined();
  const dispatched = { ...bound, transportRequestId: randomUUID() };
  expect(comparisonProviderReadiness(dispatched, expected)?.kind).toBe(
    "terminal",
  );
  expect(
    comparisonProviderReadiness(dispatched, { ...expected, lastGeneration: 0 })
      ?.kind,
  ).toBe("pending");
});
import type { OperatorEvaluationPlan } from "../../../packages/navigation-core/contracts-evaluation";
import {
  permissionVariant,
  cleanupPermissionVariants,
} from "../../support/permission-variant";
import {
  claimNativeEvaluationSession,
  readNativeEvaluationSession,
} from "../../support/evaluation-session";

it("allows preparation reads but claims an initial native session only once across concurrent collectors", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "tholi-evaluation-session-test-"),
  );
  const file = join(directory, "session.json");
  const tokens = {
    accessToken: "a".repeat(43),
    refreshToken: "r".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z",
    sessionExpiresAt: "2099-01-02T00:00:00.000Z",
    sessionId: randomUUID(),
    account: { id: randomUUID(), workspaceId: randomUUID(), revision: "1" },
  };
  const wrapper = {
    version: 1,
    serviceOrigin: "http://127.0.0.1:57140",
    authorizationOrigin: "http://127.0.0.1:57135",
    callback: `https://${"a".repeat(32)}.chromiumapp.org/`,
    clientId: "extension-chromium",
    tokens,
  };
  try {
    await writeFile(file, JSON.stringify(wrapper));
    const first = await readNativeEvaluationSession(file),
      second = await readNativeEvaluationSession(file);
    const results = await Promise.allSettled([
      claimNativeEvaluationSession(first, join(directory, "claims")),
      claimNativeEvaluationSession(second, join(directory, "claims")),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      claimNativeEvaluationSession(
        { ...first, callback: `https://${"b".repeat(32)}.chromiumapp.org/` },
        join(directory, "claims"),
      ),
    ).rejects.toThrow("already been claimed");
    expect((await readNativeEvaluationSession(file)).tokens.refreshToken).toBe(
      tokens.refreshToken,
    );
  } finally {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith("tholi-evaluation-session-test-")
    )
      throw Error("Unexpected session fixture path");
    await rm(target, { recursive: true, force: true });
  }
});

const metadata: Omit<
  OperatorEvaluationPlan,
  "cases" | "trials" | "maxGenerations"
> = {
  version: 1,
  profile: "operator-evaluation",
  id: "00000000-0000-4000-8000-000000000001",
  provider: "fake",
  createdAtMs: 1000,
  expiresAtMs: 2000,
  sourceRevision: "a".repeat(40),
  operator: {
    accountId: "00000000-0000-4000-8000-000000000002",
    workspaceId: "00000000-0000-4000-8000-000000000003",
    clientId: "extension-chromium",
  },
  hashes: {
    sourceSha256: "a".repeat(64),
    extensionBuildSha256: "b".repeat(64),
    buildManifestSha256: "c".repeat(64),
    runtimeManifestSha256: "d".repeat(64),
    promptSha256: "e".repeat(64),
    observationSchemaSha256: "f".repeat(64),
    capturePolicySha256: "a".repeat(64),
    protocolSha256: "b".repeat(64),
    corpusSha256: "c".repeat(64),
    holdoutSha256: "d".repeat(64),
  },
  model: {
    api: "v1",
    project: "tholi-dev-ilunonsen",
    location: "global",
    id: "tholi-deterministic-v1",
    retentionProfile: "provider-default-acknowledged",
    priceRevision: "test-only",
  },
  budget: {
    maxInputTokens: 32768,
    maxOutputTokens: 2048,
    allowanceUsdMicros: 4900000,
  },
};

it("predeclares every paired tuple and slot without exporting the independent oracle", () => {
  const plan = buildComparisonPlan(metadata);
  expect(plan.cases).toHaveLength(30);
  expect(plan.trials).toHaveLength(270);
  expect(new Set(plan.trials.map((trial) => trial.id)).size).toBe(270);
  expect(plan.maxGenerations).toBe(324);
  expect(
    new Set(plan.trials.slice(0, 30).map((trial) => trial.caseId)).size,
  ).toBe(30);
  for (let start = 0; start < plan.trials.length; start += 5) {
    const splits = plan.trials
      .slice(start, start + 5)
      .map(
        (trial) =>
          comparisonCases.find((task) => task.id === trial.caseId)!.split,
      );
    expect(
      splits.filter((split) => split === "inspected-regression"),
    ).toHaveLength(3);
    expect(splits.filter((split) => split === "fresh-holdout")).toHaveLength(1);
    expect(splits.filter((split) => split === "synthetic")).toHaveLength(1);
  }
  for (const task of comparisonCases) {
    const trials = comparisonTrials.filter((trial) => trial.caseId === task.id);
    expect(trials).toHaveLength(9);
    for (const repetition of [0, 1, 2])
      expect(
        new Set(
          trials
            .filter((trial) => trial.repetition === repetition)
            .map((trial) => trial.arm),
        ),
      ).toEqual(new Set(["local", "structured", "multimodal"]));
    expect(
      new Set(
        [0, 1, 2].map(
          (repetition) =>
            trials.find((trial) => trial.repetition === repetition)?.arm,
        ),
      ).size,
    ).toBe(3);
  }
  expect(
    plan.cases.every(
      (task) =>
        Object.keys(task).sort().join() ===
        ["id", "goal", "split", "scope", "maxGenerations"].sort().join(),
    ),
  ).toBe(true);
  expect(
    plan.trials
      .filter((trial) => trial.arm !== "local")
      .reduce(
        (slots, trial) =>
          slots +
          plan.cases.find((task) => task.id === trial.caseId)!.maxGenerations,
        0,
      ),
  ).toBe(324);
});

it("offline selection excludes every fresh holdout and cannot run a Vertex trial", () => {
  expect(
    comparisonCases.filter((task) =>
      comparisonTrialMayRun(task, "fake", "dry-run"),
    ),
  ).toHaveLength(18);
  for (const task of comparisonCases) {
    if (task.split === "fresh-holdout")
      expect(comparisonTrialMayRun(task, "fake", "dry-run")).toBe(false);
    expect(comparisonTrialMayRun(task, "vertex", "dry-run")).toBe(false);
    expect(comparisonTrialMayRun(task, "fake", "quality")).toBe(false);
    expect(comparisonTrialMayRun(task, "fake", undefined)).toBe(false);
  }
});

it("reading a plan rejects substituted scopes and preserves its exact approved bytes", async () => {
  const file = join(tmpdir(), `tholi-comparison-${randomUUID()}.json`);
  const plan = buildComparisonPlan(metadata);
  try {
    const raw = JSON.stringify(plan, null, 2) + "\n";
    await writeFile(file, raw);
    const read = await readComparisonPlan(file);
    expect(read.raw).toBe(raw);
    const reformatted = JSON.stringify(plan);
    await writeFile(file, reformatted);
    expect((await readComparisonPlan(file)).sha256).not.toBe(read.sha256);
    plan.cases[0].scope.urls = ["https://en.wikipedia.org/wiki/Unexpected"];
    await writeFile(file, JSON.stringify(plan));
    await expect(readComparisonPlan(file)).rejects.toThrow("substituted");
  } finally {
    await rm(file, { force: true });
  }
});

it("operator fixture variants reuse a stable grant-only path, reject changed bytes and survive ephemeral cleanup", async () => {
  const workspace = await mkdtemp(
    join(tmpdir(), "tholi-permission-regression-"),
  );
  const built = join(workspace, "dist", "extension");
  await mkdir(built, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: "Fixture",
    version: "0.11.0",
    host_permissions: ["https://en.wikipedia.org/*"],
    background: { service_worker: "background.js" },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  };
  await writeFile(join(built, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(built, "background.js"), "fixed fixture bytes");
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(workspace);
  try {
    const grants = ["https://github.com/*", "http://127.0.0.1/*"];
    const persistent = await permissionVariant(grants, { persistent: true });
    expect(
      await permissionVariant([...grants].reverse(), { persistent: true }),
    ).toBe(persistent);
    expect(
      persistent.startsWith(
        join(workspace, "output", "qa", "permission-variants"),
      ),
    ).toBe(true);
    const changedManifest = JSON.parse(
      await readFile(join(persistent, "manifest.json"), "utf8"),
    );
    expect({
      ...changedManifest,
      host_permissions: manifest.host_permissions,
    }).toEqual(manifest);
    expect(await readFile(join(persistent, "background.js"), "utf8")).toBe(
      "fixed fixture bytes",
    );
    const temporary = await permissionVariant(grants);
    await cleanupPermissionVariants();
    await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(persistent)).isDirectory()).toBe(true);
    for (const file of ["background.js", "manifest.json"]) {
      const path = join(persistent, file);
      const original = await readFile(path);
      await writeFile(path, "unexpected changed bytes");
      await expect(
        permissionVariant(grants, { persistent: true }),
      ).rejects.toThrow("bytes differ");
      expect(await readFile(path, "utf8")).toBe("unexpected changed bytes");
      await writeFile(path, original);
    }
    expect(
      await permissionVariant(["https://github.com/*"], { persistent: true }),
    ).not.toBe(persistent);
    await writeFile(
      join(built, "background.js"),
      "a different immutable build",
    );
    expect(await permissionVariant(grants, { persistent: true })).not.toBe(
      persistent,
    );
  } finally {
    await cleanupPermissionVariants();
    cwd.mockRestore();
    await rm(workspace, { recursive: true, force: true });
  }
});
