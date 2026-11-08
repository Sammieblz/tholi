import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
const image =
  "hashicorp/terraform:1.13.5@sha256:6bbb82d575aa7bd4f0a2c6e3a0838ab9590426c08a71d7a2783643f01004d356";
const name = `tholi-iac-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  image,
  cloudProvisioned: false,
  externalModelCalls: 0,
  checks: [],
  status: "running",
};
const directory = resolve(root, "output/qa/deployment-profile", name);
let owned = false;
const docker = async (args) =>
  (
    await execute("docker", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 180000,
    })
  ).stdout;
try {
  if (
    (
      await docker([
        "volume",
        "ls",
        "--filter",
        `name=^${name}$`,
        "--format",
        "{{.Name}}",
      ])
    ).trim()
  )
    throw new Error("Refusing to reuse an existing IaC cache.");
  await docker([
    "volume",
    "create",
    "--label",
    `io.tholi.qa.owner=${name}`,
    name,
  ]);
  owned = true;
  const run = (args, network = "none") =>
    docker([
      "run",
      "--rm",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--memory",
      "1g",
      "--cpus",
      "2",
      "--pids-limit",
      "64",
      "--network",
      network,
      "--mount",
      `type=bind,source=${resolve(root, "infra")},target=/infra,readonly`,
      "--mount",
      `type=volume,source=${name},target=/cache`,
      "--env",
      "TF_DATA_DIR=/cache",
      "--env",
      "TMPDIR=/cache",
      "--env",
      "CHECKPOINT_DISABLE=1",
      "--workdir",
      "/infra/google",
      image,
      ...args,
    ]);
  await run(["fmt", "-check", "-recursive"]);
  report.checks.push("format");
  // Init downloads only the pinned provider. No home, ADC, token or state mount.
  await run(
    ["init", "-backend=false", "-lockfile=readonly", "-no-color"],
    "bridge",
  );
  report.checks.push("locked-provider-initialization-without-credentials");
  await run(["validate", "-no-color"]);
  report.checks.push("provider-schema-validation-with-network-disabled");
  const result = await run(["test", "-no-color"]);
  if (!/Success! \d+ passed, 0 failed\./.test(result))
    throw new Error("Mocked planning failed.");
  report.checks.push("mocked-plans-with-network-disabled");
  report.planning = result.trim();
  report.sourceFiles = {};
  const files = [
    "infra/capacity.json",
    "infra/local/postgres/bootstrap.sql",
    ...[
      ...(await readdir(resolve(root, "infra/google"))).filter((name) =>
        /\.(tf|mjs|sql)$/.test(name),
      ),
      "tests/profile.tftest.hcl",
      ".terraform.lock.hcl",
    ].map((name) => "infra/google/" + name),
  ];
  for (const file of files)
    report.sourceFiles[file] = createHash("sha256")
      .update(await readFile(resolve(root, file)))
      .digest("hex");
  report.status = "passed";
} catch {
  report.status = "failed";
  // Tool stderr can include operator values if a future configuration changes.
  // Rerun an offline focused command to inspect errors; never export raw stderr.
  report.diagnostic = "Offline deployment-profile validation failed.";
  process.exitCode = 1;
} finally {
  if (owned) {
    const volume = JSON.parse(await docker(["volume", "inspect", name]))[0];
    if (volume.Labels?.["io.tholi.qa.owner"] !== name)
      throw new Error("Refusing to remove an unowned IaC cache.");
    await docker(["volume", "rm", name]);
    report.cleanup = "owned provider cache removed";
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "validation.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  `Deployment-profile checks ${report.status}. Redacted evidence: ${directory}`,
);
