import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const backendDeliveryPolicy = Object.freeze(
  JSON.parse(
    await readFile(
      new URL("../../config/backend-delivery.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** Child-process output can contain credentials. Retain only a closed failure class. */
export function classifyBackendFailure(error) {
  if (!(error instanceof Error)) return { kind: "verification" };
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return { kind: "output-limit" };
  if (["ENOENT", "EACCES", "EPERM"].includes(error.code))
    return { kind: "process-unavailable" };
  if (error.killed === true) return { kind: "process-terminated" };
  if (Number.isSafeInteger(error.code) && error.code > 0 && error.code <= 255) {
    const stderr =
      typeof error.stderr === "string" ? error.stderr.slice(-64000) : "";
    const diagnostic = [
      [/read-only file system/i, "filesystem-read-only"],
      [/permission denied/i, "permission-denied"],
      [/no space left on device/i, "storage-full"],
      [
        /TOOMANYREQUESTS|too many requests|status(?: code)?:? 429/i,
        "registry-rate-limit",
      ],
      [
        /UNAUTHORIZED|authentication required|status(?: code)?:? 401|status(?: code)?:? 403/i,
        "registry-access-denied",
      ],
      [
        /x509:|certificate verify failed|certificate signed by unknown authority/i,
        "tls-verification",
      ],
      [
        /unknown (?:flag|command)|flag provided but not defined/i,
        "invalid-arguments",
      ],
      [
        /connection refused|network is unreachable|i\/o timeout|TLS handshake timeout|no such host/i,
        "network-unavailable",
      ],
    ].find(([pattern]) => pattern.test(stderr))?.[1];
    return {
      kind: "command-exit",
      exitCode: error.code,
      ...(diagnostic ? { diagnostic } : {}),
    };
  }
  if (error instanceof SyntaxError) return { kind: "invalid-json" };
  return { kind: "verification" };
}

export async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export const BACKEND_CANDIDATE_FILES = Object.freeze([
  "client-build-manifest.json",
  "profiles.json",
  "runtime.tar.gz",
  "scan-database.json",
  "security.json",
  "smoke.json",
]);

export async function verifyBackendCandidateFiles(
  candidate,
  directory,
  { recordsOnly = false } = {},
) {
  assert.deepEqual(
    Object.keys(candidate.files).sort(),
    BACKEND_CANDIDATE_FILES,
    "Unlisted backend artifact files.",
  );
  for (const name of BACKEND_CANDIDATE_FILES) {
    assert.match(candidate.files[name], /^[a-f0-9]{64}$/);
    if (recordsOnly && name === "runtime.tar.gz") continue;
    const path = resolve(directory, name);
    const metadata = await lstat(path);
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    assert.ok(
      metadata.size <=
        (name === "runtime.tar.gz" ? 2 * 1024 ** 3 : 16 * 1024 ** 2),
    );
    assert.equal(
      await fileDigest(path),
      candidate.files[name],
      "Candidate bytes differ: " + name,
    );
  }
}

/** Closed image metadata, never container environment or Docker host details. */
export function inspectBackendImage(image, sourceSha) {
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    `${image.Os}/${image.Architecture}`,
    backendDeliveryPolicy.platform,
  );
  assert.equal(image.Config?.User, "node");
  assert.deepEqual(image.Config?.Cmd, ["node", "apps/api/dist/service.js"]);
  assert.equal(
    image.Config?.Labels?.["org.opencontainers.image.revision"],
    sourceSha,
  );
  return { id: image.Id, platform: backendDeliveryPolicy.platform };
}

/** Containerd and classic stores expose different IDs. Bind the runnable
 * archive config and actual filesystem separately from the local store ID. */
export function backendArchiveConfigDigest(raw, image, sourceSha) {
  const config = JSON.parse(raw);
  inspectBackendImage(
    {
      Id: image.Id,
      Os: config.os,
      Architecture: config.architecture,
      Config: config.config,
    },
    sourceSha,
  );
  assert.deepEqual(config.rootfs?.diff_ids, image.RootFS?.Layers);
  for (const key of [
    "User",
    "Cmd",
    "Entrypoint",
    "Env",
    "WorkingDir",
    "Labels",
    "ExposedPorts",
    "Volumes",
    "StopSignal",
  ])
    assert.deepEqual(config.config[key] ?? null, image.Config[key] ?? null);
  return "sha256:" + createHash("sha256").update(raw).digest("hex");
}

/** A scan finding is retained evidence, never implicit risk acceptance. */
export function summarizeBackendScan(scan, configDigest, now = Date.now()) {
  assert.equal(scan.SchemaVersion, 2);
  assert.equal(scan.ArtifactType, "container_image");
  assert.equal(scan.Trivy?.Version, backendDeliveryPolicy.scannerVersion);
  assert.equal(scan.Metadata?.ImageID, configDigest);
  assert.ok(Array.isArray(scan.Results) && scan.Results.length > 0);
  const created = Date.parse(scan.CreatedAt);
  assert.ok(Number.isFinite(created) && created <= now + 300000);
  assert.ok(
    now - created <= backendDeliveryPolicy.maximumScanAgeHours * 3600000,
  );
  const counts = Object.fromEntries(
    ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"].map((key) => [key, 0]),
  );
  let packages = 0;
  let licenses = 0;
  for (const result of scan.Results) {
    if (result.Packages !== undefined)
      assert.ok(Array.isArray(result.Packages));
    packages += (result.Packages || []).length;
    for (const finding of result.Vulnerabilities || []) {
      assert.ok(Object.hasOwn(counts, finding.Severity));
      counts[finding.Severity]++;
    }
    licenses += (result.Licenses || []).length;
  }
  assert.ok(packages > 0, "A scan must include its package inventory.");
  return {
    configDigest,
    createdAt: scan.CreatedAt,
    packages,
    licenses,
    counts,
    promotion: backendDeliveryPolicy.blockedSeverities.some(
      (key) => counts[key] > 0,
    )
      ? "blocked"
      : "eligible-for-review",
  };
}

export function inspectBackendScanDatabase(metadata, now = Date.now()) {
  assert.equal(metadata.Version, 2);
  const downloadedAt = Date.parse(metadata.DownloadedAt);
  const updatedAt = Date.parse(metadata.UpdatedAt);
  assert.ok(Number.isFinite(downloadedAt) && Number.isFinite(updatedAt));
  assert.ok(downloadedAt <= now + 300000 && updatedAt <= now + 300000);
  assert.ok(
    now - downloadedAt <= backendDeliveryPolicy.maximumScanAgeHours * 3600000,
  );
  assert.ok(
    now - updatedAt <= 72 * 3600000,
    "Vulnerability database is stale.",
  );
  return {
    version: metadata.Version,
    updatedAt: metadata.UpdatedAt,
    downloadedAt: metadata.DownloadedAt,
  };
}

/** Ordinary PR evidence never grants production or full certification. */
export function assertBackendPromotion(candidate, request) {
  assert.equal(candidate.schemaVersion, 1);
  assert.equal(candidate.kind, "tholi-backend-candidate");
  assert.equal(candidate.sourceDirty, false);
  assert.equal(candidate.archiveExportApproved, true);
  assert.equal(candidate.sourceSha, request.sourceSha);
  assert.equal(candidate.image.id, request.imageId);
  assert.match(candidate.image.configDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(candidate.image.configDigest, request.configDigest);
  assert.match(candidate.image.id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(candidate.image.platform, backendDeliveryPolicy.platform);
  assert.equal(candidate.validation.tier, "full");
  assert.equal(candidate.validation.runId, request.runId);
  assert.notEqual(request.runId, "uncoordinated");
  assert.equal(candidate.validation.status, "passed");
  assert.equal(candidate.validation.externalModelCalls, 0);
  assert.equal(candidate.security.promotion, "eligible-for-review");
  assert.equal(request.licensesReviewed, true);
  assert.ok(
    [
      "vm-staging",
      "google-staging",
      "vm-production",
      "google-production",
    ].includes(request.target),
  );
  assert.equal(request.deploymentApproved, true);
  assert.equal(request.releaseApproved, true);
  assert.equal(request.liveQualityAccepted, true);
  assert.equal(request.identityAccepted, true);
  assert.equal(request.manualChecksAccepted, true);
  assert.equal(
    request.rollback.imageId,
    candidate.image.id,
    "Only the tested same-schema rollback is supported by this candidate.",
  );
  assert.equal(request.rollback.schemaDigest, candidate.schemaDigest);
  if (request.target.endsWith("production")) {
    assert.equal(request.staging?.status, "passed");
    assert.equal(request.staging.imageId, candidate.image.id);
    assert.equal(request.staging.configDigest, candidate.image.configDigest);
    assert.equal(request.staging.sourceSha, candidate.sourceSha);
    assert.equal(request.staging.schemaDigest, candidate.schemaDigest);
    assert.equal(
      request.staging.target,
      request.target.replace("production", "staging"),
    );
  }
  return {
    target: request.target,
    imageId: candidate.image.id,
    execution: "not-performed",
  };
}

/** Check GitHub's read-only run/protection metadata before a review job starts. */
export function inspectBackendPromotionSource(
  run,
  environment,
  { repository, sourceSha, target },
) {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  assert.ok(
    [
      "vm-staging",
      "google-staging",
      "vm-production",
      "google-production",
    ].includes(target),
  );
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.head_sha, sourceSha);
  assert.equal(run.head_branch, "main");
  assert.equal(run.path, ".github/workflows/full-validation.yml");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.ok(["workflow_dispatch", "schedule", "push"].includes(run.event));
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  assert.equal(environment.name, "backend-" + target);
  assert.equal(environment.can_admins_bypass, false);
  assert.ok(
    environment.protection_rules?.some(
      (rule) =>
        rule.type === "required_reviewers" && rule.reviewers?.length > 0,
    ),
  );
  assert.equal(environment.deployment_branch_policy?.protected_branches, true);
  return {
    runId: `${run.id}-${run.run_attempt}`,
    artifact: `backend-candidate-${run.run_attempt}`,
    imageArtifact: `backend-image-${run.run_attempt}`,
    environment: environment.name,
  };
}

export const backendRoot = fileURLToPath(new URL("../../", import.meta.url));
export const backendCandidateDirectory = resolve(
  backendRoot,
  "output/backend-candidate",
);
