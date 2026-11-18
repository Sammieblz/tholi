import { expect, test } from "vitest";
import { mkdtemp, writeFile, appendFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backendDeliveryPolicy,
  inspectBackendImage,
  backendArchiveConfigDigest,
  summarizeBackendScan,
  assertBackendPromotion,
  inspectBackendPromotionSource,
  inspectBackendScanDatabase,
  BACKEND_CANDIDATE_FILES,
  fileDigest,
  classifyBackendFailure,
  verifyBackendCandidateFiles,
} from "../../../scripts/lib/backend-delivery.mjs";

const sourceSha = "1".repeat(40);
const imageId = "sha256:" + "a".repeat(64);
const configDigest = "sha256:" + "d".repeat(64);
const now = Date.parse("2026-11-17T15:00:00Z");
test("backend failures retain only closed classes and never child output or exception details", () => {
  const privateMarker = "PRIVATE_PROVIDER_OUTPUT_SENTINEL";
  for (const [properties, expected] of [
    [
      { code: 125, stdout: privateMarker, stderr: privateMarker },
      { kind: "command-exit", exitCode: 125 },
    ],
    [
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stderr: privateMarker },
      { kind: "output-limit" },
    ],
    [{ code: "ENOENT", path: privateMarker }, { kind: "process-unavailable" }],
    [
      { code: "ETIMEDOUT", killed: true, cmd: privateMarker },
      { kind: "process-terminated" },
    ],
    [{ code: -1 }, { kind: "verification" }],
    [{ code: 999 }, { kind: "verification" }],
  ] as const) {
    const failure = Object.assign(new Error(privateMarker), properties),
      result = classifyBackendFailure(failure);
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain(privateMarker);
  }
  expect(classifyBackendFailure(new SyntaxError(privateMarker))).toEqual({
    kind: "invalid-json",
  });
  expect(classifyBackendFailure({ message: privateMarker, code: 125 })).toEqual(
    { kind: "verification" },
  );
});
const scan = () => ({
  SchemaVersion: 2,
  Trivy: { Version: backendDeliveryPolicy.scannerVersion },
  ArtifactType: "container_image",
  Metadata: { ImageID: configDigest },
  CreatedAt: new Date(now).toISOString(),
  Results: [
    {
      Packages: [{ Name: "synthetic-package" }],
      Vulnerabilities: [],
      Licenses: [{ Name: "MIT" }],
    },
  ],
});
const candidate = () => ({
  schemaVersion: 1,
  kind: "tholi-backend-candidate",
  sourceSha,
  sourceDirty: false,
  archiveExportApproved: true,
  image: {
    id: imageId,
    configDigest,
    platform: backendDeliveryPolicy.platform,
  },
  schemaDigest: "b".repeat(64),
  validation: {
    tier: "full",
    runId: "synthetic-full-1",
    status: "passed",
    externalModelCalls: 0,
  },
  security: { promotion: "eligible-for-review" },
});
const request = () => ({
  sourceSha,
  imageId,
  configDigest,
  runId: "synthetic-full-1",
  target: "vm-staging",
  deploymentApproved: true,
  releaseApproved: true,
  liveQualityAccepted: true,
  identityAccepted: true,
  manualChecksAccepted: true,
  licensesReviewed: true,
  rollback: { imageId, schemaDigest: "b".repeat(64) },
});

test("candidate verification rejects changed bytes and unlisted artifact paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-backend-artifact-"));
  try {
    const files: Record<string, string> = {};
    for (const name of BACKEND_CANDIDATE_FILES) {
      const path = join(directory, name);
      await writeFile(path, "synthetic frozen " + name);
      files[name] = await fileDigest(path);
    }
    await verifyBackendCandidateFiles({ files }, directory);
    await appendFile(join(directory, "runtime.tar.gz"), "changed");
    await expect(
      verifyBackendCandidateFiles({ files }, directory),
    ).rejects.toThrow("Candidate bytes differ");
    await writeFile(
      join(directory, "runtime.tar.gz"),
      "synthetic frozen runtime.tar.gz",
    );
    await unlink(join(directory, "runtime.tar.gz"));
    await verifyBackendCandidateFiles({ files }, directory, {
      recordsOnly: true,
    });
    await expect(
      verifyBackendCandidateFiles({ files }, directory),
    ).rejects.toThrow();
    await expect(
      verifyBackendCandidateFiles(
        { files: { ...files, "../outside": "a".repeat(64) } },
        directory,
      ),
    ).rejects.toThrow("Unlisted backend artifact files");
  } finally {
    await rm(directory, { recursive: true });
  }
});

const imageFixture = () => ({
  Id: imageId,
  Os: "linux",
  Architecture: "amd64",
  RootFS: { Layers: ["sha256:" + "e".repeat(64)] },
  Config: {
    User: "node",
    Cmd: ["node", "apps/api/dist/service.js"],
    Env: ["SYNTHETIC_SECRET=excluded"],
    Labels: { "org.opencontainers.image.revision": sourceSha },
  },
});

test("runtime inspection binds the supported image and entrypoint to its source without exporting environment", () => {
  const image = imageFixture();
  expect(inspectBackendImage(image, sourceSha)).toEqual({
    id: imageId,
    platform: "linux/amd64",
  });
  expect(() =>
    inspectBackendImage({ ...image, Architecture: "arm64" }, sourceSha),
  ).toThrow();
  expect(() => inspectBackendImage(image, "2".repeat(40))).toThrow();
  expect(() =>
    inspectBackendImage(
      { ...image, Config: { ...image.Config, User: "root" } },
      sourceSha,
    ),
  ).toThrow();
});

test("archive binding distinguishes a store index ID from its runnable configuration and refuses changed filesystem or environment", () => {
  const image = imageFixture();
  const value = {
    os: image.Os,
    architecture: image.Architecture,
    config: image.Config,
    rootfs: { diff_ids: image.RootFS.Layers },
  };
  const raw = JSON.stringify(value);
  const bound = backendArchiveConfigDigest(raw, image, sourceSha);
  expect(bound).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(bound).not.toBe(image.Id);
  expect(() =>
    backendArchiveConfigDigest(
      JSON.stringify({ ...value, rootfs: { diff_ids: [] } }),
      image,
      sourceSha,
    ),
  ).toThrow();
  expect(() =>
    backendArchiveConfigDigest(
      JSON.stringify({
        ...value,
        config: { ...value.config, Env: ["changed"] },
      }),
      image,
      sourceSha,
    ),
  ).toThrow();
});

test("complete fresh image scans retain findings and block severe or unclassified risk", () => {
  const metadata = {
    Version: 2,
    DownloadedAt: new Date(now).toISOString(),
    UpdatedAt: new Date(now - 3600000).toISOString(),
  };
  expect(inspectBackendScanDatabase(metadata, now).version).toBe(2);
  expect(() =>
    inspectBackendScanDatabase(metadata, now + 25 * 3600000),
  ).toThrow();
  expect(() =>
    inspectBackendScanDatabase({ ...metadata, UpdatedAt: "invalid" }, now),
  ).toThrow();
  expect(summarizeBackendScan(scan(), configDigest, now)).toMatchObject({
    packages: 1,
    licenses: 1,
    promotion: "eligible-for-review",
  });
  for (const Severity of ["HIGH", "CRITICAL", "UNKNOWN"]) {
    const value = scan();
    (value.Results[0].Vulnerabilities as unknown[]) = [{ Severity }];
    expect(summarizeBackendScan(value, configDigest, now).promotion).toBe(
      "blocked",
    );
  }
  expect(() =>
    summarizeBackendScan(scan(), "sha256:" + "c".repeat(64), now),
  ).toThrow();
  expect(() =>
    summarizeBackendScan(scan(), configDigest, now + 25 * 3600000),
  ).toThrow();
  expect(() =>
    summarizeBackendScan({ ...scan(), Results: [] }, configDigest, now),
  ).toThrow();
});

test("promotion review refuses PR, dirty, unrelated, incomplete or security-blocked candidates", () => {
  expect(assertBackendPromotion(candidate(), request())).toEqual({
    target: "vm-staging",
    imageId,
    execution: "not-performed",
  });
  const invalid = [
    { ...candidate(), sourceDirty: true },
    { ...candidate(), archiveExportApproved: false },
    { ...candidate(), sourceSha: "2".repeat(40) },
    { ...candidate(), validation: { ...candidate().validation, tier: "pr" } },
    {
      ...candidate(),
      validation: { ...candidate().validation, runId: "other-run" },
    },
    {
      ...candidate(),
      validation: { ...candidate().validation, status: "failed" },
    },
    { ...candidate(), security: { promotion: "blocked" } },
  ];
  for (const value of invalid)
    expect(() => assertBackendPromotion(value, request())).toThrow();
  for (const key of [
    "deploymentApproved",
    "releaseApproved",
    "liveQualityAccepted",
    "identityAccepted",
    "manualChecksAccepted",
    "licensesReviewed",
  ])
    expect(() =>
      assertBackendPromotion(candidate(), { ...request(), [key]: false }),
    ).toThrow();
  expect(() =>
    assertBackendPromotion(candidate(), {
      ...request(),
      rollback: { imageId, schemaDigest: "changed-schema" },
    }),
  ).toThrow();
});

test("production review requires matching platform staging evidence for the same source, image and schema", () => {
  const production = { ...request(), target: "google-production" };
  expect(() => assertBackendPromotion(candidate(), production)).toThrow();
  const staging = {
    status: "passed",
    target: "google-staging",
    sourceSha,
    imageId,
    configDigest,
    schemaDigest: "b".repeat(64),
  };
  expect(
    assertBackendPromotion(candidate(), { ...production, staging }).execution,
  ).toBe("not-performed");
  for (const patch of [
    { target: "vm-staging" },
    { imageId: "other-image" },
    { configDigest: "other-config" },
    { status: "failed" },
    { sourceSha: "other-source" },
    { schemaDigest: "older-schema" },
  ])
    expect(() =>
      assertBackendPromotion(candidate(), {
        ...production,
        staging: { ...staging, ...patch },
      }),
    ).toThrow();
});

test("promotion workflow rejects foreign or PR evidence and unprotected review environments", () => {
  const expected = {
    repository: "Sammieblz/tholi",
    sourceSha,
    target: "vm-staging",
  };
  const run = {
    id: 10,
    run_attempt: 2,
    repository: { full_name: expected.repository },
    head_repository: { full_name: expected.repository },
    head_sha: sourceSha,
    head_branch: "main",
    path: ".github/workflows/full-validation.yml",
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
  };
  const environment = {
    name: "backend-vm-staging",
    can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: true },
    protection_rules: [
      { type: "required_reviewers", reviewers: [{ type: "User" }] },
    ],
  };
  expect(
    inspectBackendPromotionSource(run, environment, expected),
  ).toMatchObject({ runId: "10-2", artifact: "backend-candidate-2" });
  for (const patch of [
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_sha: "2".repeat(40) },
    { path: ".github/workflows/ci.yml" },
    { conclusion: "failure" },
    { head_repository: { full_name: "someone/fork" } },
  ])
    expect(() =>
      inspectBackendPromotionSource(
        { ...run, ...patch },
        environment,
        expected,
      ),
    ).toThrow();
  for (const patch of [
    { can_admins_bypass: true },
    { protection_rules: [] },
    { name: "production" },
    { deployment_branch_policy: null },
  ])
    expect(() =>
      inspectBackendPromotionSource(
        run,
        { ...environment, ...patch },
        expected,
      ),
    ).toThrow();
});
