import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";
import { artifactFiles } from "./artifact-files.mjs";
import { verifyBuildManifest } from "./build-manifest.mjs";
import { digest } from "./evidence.mjs";
import { runLocalStackSmoke } from "./local-stack-smoke.mjs";
import { runDeploymentProfileChecks } from "./check-deployment-profile.mjs";
import {
  backendCandidateDirectory as directory,
  backendRoot as root,
  backendDeliveryPolicy as policy,
  fileDigest,
  BACKEND_CANDIDATE_FILES,
  verifyBackendCandidateFiles,
  inspectBackendImage,
  backendArchiveConfigDigest,
  summarizeBackendScan,
  inspectBackendScanDatabase,
  classifyBackendFailure,
  assertBackendPromotion,
} from "./lib/backend-delivery.mjs";

const execute = promisify(execFile);
const command = async (file, args, timeout = 180000) =>
  (
    await execute(file, args, {
      cwd: root,
      encoding: "utf8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
const docker = (args, timeout) => command("docker", args, timeout);
const json = (file) =>
  readFile(resolve(directory, file), "utf8").then(JSON.parse);
const write = (name, value) =>
  writeFile(resolve(directory, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
const sourceSha = async () =>
  (await command("git", ["rev-parse", "HEAD"])).trim();

async function validate() {
  await verifyBuildManifest();
  // A new candidate never overwrites another image or evidence record.
  await mkdir(directory, { recursive: false });
  assert.equal(await realpath(directory), directory);
  const source = await sourceSha();
  const runId = process.env.THOLI_VALIDATION_RUN || randomUUID();
  const previousRunId = process.env.THOLI_VALIDATION_RUN;
  process.env.THOLI_VALIDATION_RUN = runId;
  const candidate = {
    schemaVersion: 1,
    kind: "tholi-backend-candidate",
    sourceSha: source,
    sourceDirty: !!(await command("git", ["status", "--porcelain"])).trim(),
    archiveExportApproved:
      process.env.THOLI_TEST_TIER === "full" &&
      process.env.THOLI_BACKEND_ARCHIVE_EXPORT === "1",
    validation: {
      tier: process.env.THOLI_TEST_TIER === "full" ? "full" : "pr",
      runId,
      status: "running",
      externalModelCalls: 0,
    },
    startedAt: new Date().toISOString(),
  };
  let stage = "image build";
  let cacheOwned = false;
  const cache = `tholi-scan-${randomUUID()}`;
  try {
    await docker(
      [
        "build",
        "--platform",
        policy.platform,
        "--file",
        "apps/api/Dockerfile",
        "--target",
        "runtime",
        "--build-arg",
        "THOLI_API_ARTIFACT_STAGE=prepared-api",
        "--label",
        `org.opencontainers.image.revision=${source}`,
        "--iidfile",
        resolve(directory, "image.id"),
        ".",
      ],
      600000,
    );
    const id = (await readFile(resolve(directory, "image.id"), "utf8")).trim();
    const [image] = JSON.parse(await docker(["image", "inspect", id]));
    candidate.image = inspectBackendImage(image, source);
    await docker([
      "image",
      "save",
      "--output",
      resolve(directory, "runtime.tar"),
      id,
    ]);
    // Docker saves with mode 0600. The scanner drops every capability, so
    // container root cannot read a host-user-owned archive without this
    // explicit read-only handoff. Keep the owner's write bit for cleanup.
    await chmod(resolve(directory, "runtime.tar"), 0o644);
    const manifest = JSON.parse(
      await command("tar", [
        "-xOf",
        resolve(directory, "runtime.tar"),
        "manifest.json",
      ]),
    );
    assert.ok(
      Array.isArray(manifest) && manifest.length > 0 && manifest.length <= 8,
    );
    const configs = [];
    for (const entry of manifest) {
      assert.match(
        entry.Config,
        /^(?:blobs\/sha256\/[a-f0-9]{64}|[a-f0-9]{64}\.json)$/,
      );
      const raw = await command("tar", [
        "-xOf",
        resolve(directory, "runtime.tar"),
        entry.Config,
      ]);
      const data = JSON.parse(raw);
      if (`${data.os}/${data.architecture}` === policy.platform)
        configs.push({ raw, name: entry.Config });
    }
    assert.equal(configs.length, 1);
    candidate.image.configDigest = backendArchiveConfigDigest(
      configs[0].raw,
      image,
      source,
    );
    assert.ok(
      configs[0].name.includes(
        candidate.image.configDigest.slice("sha256:".length),
      ),
    );
    const inspectFiles = `import {readFile,readdir} from 'node:fs/promises'; import {join} from 'node:path'; import {createHash} from 'node:crypto'; (${artifactFiles.toString()})('/app/apps/api/dist').then(value=>process.stdout.write(JSON.stringify(value)));`;
    candidate.apiArtifactFiles = JSON.parse(
      await docker([
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        candidate.image.id,
        "node",
        "--input-type=module",
        "-e",
        inspectFiles,
      ]),
    );
    assert.deepEqual(
      candidate.apiArtifactFiles,
      await artifactFiles(resolve(root, "apps/api/dist")),
    );
    await copyFile(
      resolve(root, "output/build-manifest.json"),
      resolve(directory, "client-build-manifest.json"),
    );
    console.log(
      "Backend image identity recorded; starting immutable stack checks.",
    );
    candidate.schemaFiles = await artifactFiles(
      resolve(root, "apps/api/src/database/migrations"),
    );
    candidate.schemaDigest = digest(candidate.schemaFiles);
    stage = "scanner cache allocation";
    assert.equal(
      (
        await docker([
          "volume",
          "ls",
          "--filter",
          `name=^${cache}$`,
          "--format",
          "{{.Name}}",
        ])
      ).trim(),
      "",
    );
    await docker([
      "volume",
      "create",
      "--label",
      `io.tholi.qa.owner=${cache}`,
      cache,
    ]);
    cacheOwned = true;
    const scanner = (args, network) =>
      docker(
        [
          "run",
          "--rm",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          "--memory",
          "2g",
          "--cpus",
          "2",
          "--pids-limit",
          "64",
          "--network",
          network,
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=64m",
          // OCI downloads exceed /tmp's small scratch limit. Their temporary
          // files belong to this run's already-owned, cleaned cache volume.
          "--env",
          "TMPDIR=/cache",
          "--mount",
          `type=volume,source=${cache},target=/cache`,
          "--mount",
          `type=bind,source=${directory},target=/scan,readonly`,
          policy.scannerImage,
          "image",
          "--cache-dir",
          "/cache",
          "--disable-telemetry",
          "--skip-version-check",
          ...args,
        ],
        600000,
      );
    // The only scanner egress downloads the public vulnerability database.
    stage = "public scanner database download";
    await scanner(["--download-db-only", "--no-progress"], "bridge");
    stage = "scanner database metadata read";
    const database = JSON.parse(
      await docker([
        "run",
        "--rm",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--network",
        "none",
        "--entrypoint",
        "/bin/cat",
        "--mount",
        `type=volume,source=${cache},target=/cache,readonly`,
        policy.scannerImage,
        "/cache/db/metadata.json",
      ]),
    );
    stage = "scanner database freshness verification";
    const databaseSummary = inspectBackendScanDatabase(database);
    await write("scan-database.json", database);
    stage = "offline immutable image scan";
    const scan = JSON.parse(
      await scanner(
        [
          "--input",
          "/scan/runtime.tar",
          "--skip-db-update",
          "--offline-scan",
          "--scanners",
          "vuln,license",
          "--license-full",
          "--list-all-pkgs",
          "--format",
          "json",
          "--no-progress",
        ],
        "none",
      ),
    );
    stage = "immutable scan evidence verification";
    candidate.security = {
      ...summarizeBackendScan(scan, candidate.image.configDigest),
      scannerImage: policy.scannerImage,
      database: databaseSummary,
    };
    await write("security.json", scan);
    stage = "immutable local, VM and replica checks";
    const smoke = await runLocalStackSmoke({
      optional: true,
      preparedImage: id,
      identityWeb: true,
    });
    assert.equal(smoke.status, "passed");
    assert.equal(smoke.images.api.id, id);
    assert.equal(smoke.images.worker.id, id);
    assert.equal(smoke.vm.image, id);
    assert.equal(smoke.websiteIdentity.passed, true);
    await write("smoke.json", smoke);
    stage = "offline deployment configuration";
    await write("profiles.json", await runDeploymentProfileChecks());
    stage = "verified candidate archive preparation";
    await pipeline(
      createReadStream(resolve(directory, "runtime.tar")),
      createGzip(),
      createWriteStream(resolve(directory, "runtime.tar.gz"), { flags: "wx" }),
    );
    // This exact temporary file was created above in this new, checked directory.
    await unlink(resolve(directory, "runtime.tar"));
    candidate.files = {};
    for (const name of BACKEND_CANDIDATE_FILES)
      candidate.files[name] = await fileDigest(resolve(directory, name));
    candidate.validation.status = "passed";
  } catch (error) {
    candidate.validation.status = "failed";
    candidate.failedStage = stage;
    candidate.failure = classifyBackendFailure(error);
    // Docker/provider output is not safe to copy into distributable evidence.
    process.exitCode = 1;
  } finally {
    if (cacheOwned) {
      try {
        const [cacheState] = JSON.parse(
          await docker(["volume", "inspect", cache]),
        );
        assert.equal(cacheState.Labels?.["io.tholi.qa.owner"], cache);
        await docker(["volume", "rm", cache]);
      } catch (error) {
        if (candidate.validation.status !== "failed") {
          candidate.failedStage = "owned scanner cache cleanup";
          candidate.failure = classifyBackendFailure(error);
        }
        candidate.validation.status = "failed";
        candidate.cleanupFailure = classifyBackendFailure(error);
        process.exitCode = 1;
      }
    }
    candidate.finishedAt = new Date().toISOString();
    await write("candidate.json", candidate);
    if (previousRunId === undefined) delete process.env.THOLI_VALIDATION_RUN;
    else process.env.THOLI_VALIDATION_RUN = previousRunId;
  }
  console.log(
    `Backend candidate ${candidate.validation.status}; promotion ${candidate.security?.promotion || "blocked"}.`,
  );
}

async function verify({ recordsOnly = false } = {}) {
  assert.equal(await realpath(directory), directory);
  const candidate = await json("candidate.json");
  assert.equal(candidate.schemaVersion, 1);
  assert.equal(candidate.kind, "tholi-backend-candidate");
  assert.equal(candidate.sourceSha, await sourceSha());
  assert.equal(candidate.validation.status, "passed");
  assert.equal(
    candidate.validation.runId,
    process.env.THOLI_VALIDATION_RUN,
    "Select the original coordinated validation run explicitly.",
  );
  assert.equal(candidate.validation.externalModelCalls, 0);
  await verifyBackendCandidateFiles(candidate, directory, { recordsOnly });
  assert.deepEqual(
    candidate.apiArtifactFiles,
    (await json("client-build-manifest.json"))["apps/api/dist"],
  );
  const smoke = await json("smoke.json");
  assert.equal(smoke.status, "passed");
  assert.equal(smoke.sourceSha, candidate.sourceSha);
  assert.equal(smoke.validation.runId, candidate.validation.runId);
  assert.equal(smoke.validation.tier, candidate.validation.tier);
  assert.equal(smoke.images.api.id, candidate.image.id);
  assert.equal(smoke.images.worker.id, candidate.image.id);
  assert.equal(smoke.vm.image, candidate.image.id);
  assert.equal(smoke.websiteIdentity.passed, true);
  assert.equal((await json("profiles.json")).status, "passed");
  const security = summarizeBackendScan(
    await json("security.json"),
    candidate.image.configDigest,
  );
  assert.deepEqual(candidate.security, {
    ...security,
    scannerImage: policy.scannerImage,
    database: inspectBackendScanDatabase(await json("scan-database.json")),
  });
  assert.deepEqual(
    candidate.schemaFiles,
    await artifactFiles(resolve(root, "apps/api/src/database/migrations")),
  );
  assert.equal(candidate.schemaDigest, digest(candidate.schemaFiles));
  return candidate;
}

try {
  const [action, ...args] = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (action === "review-promotion" && args.length === 1),
  );
  if (action === "validate") await validate();
  else if (action === "verify") {
    await verify();
    console.log("Backend candidate bytes and evidence match.");
  } else if (action === "verify-records") {
    await verify({ recordsOnly: true });
    console.log(
      "Backend validation records match; archive bytes are not checked by this records-only step.",
    );
  } else if (action === "review-promotion") {
    const requestPath = await realpath(resolve(args[0] || ""));
    const within = relative(
      await realpath(resolve(root, "output/qa")),
      requestPath,
    );
    assert.ok(
      within &&
        within !== ".." &&
        !within.startsWith(".." + sep) &&
        !isAbsolute(within),
    );
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    const candidate = await verify();
    console.log(JSON.stringify(assertBackendPromotion(candidate, request)));
  } else throw Error("Unknown backend delivery action.");
} catch {
  console.error(
    "Backend delivery refused: inspect candidate status, immutable bytes and reviewed approval evidence.",
  );
  process.exitCode = 1;
}
