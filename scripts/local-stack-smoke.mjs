import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseEnv } from "node:util";
import {
  initializeLocalEnvironment,
  localStackArguments,
  localStackCommands,
} from "./local-stack.mjs";
import {
  assertOwnedSmokeProject,
  inspectLocalStack,
} from "./lib/local-stack-policy.mjs";
import { runGatewayChecks } from "./lib/gateway-validation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

async function reservePorts() {
  const servers = [];
  try {
    const ports = {};
    for (const key of ["API", "OIDC", "MAIL", "STORAGE"]) {
      const server = createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      ports[key + "_HOST_PORT"] = server.address().port;
    }
    return ports;
  } finally {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}

async function jsonResponse(url, init) {
  const parsed = new URL(url);
  const target = parsed.origin + parsed.pathname;
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    throw new Error(
      `Local HTTP probe failed for ${target}: ${error.cause?.code || error.message}`,
    );
  }
}

function requireCheck(condition, message = "Local stack assertion failed.") {
  if (!condition) throw new Error(message);
}

// Runs inside the API container, using only its existing Node executable.
async function privateNetworkProbe({ issuer, marker, telemetry }) {
  const { createConnection } = await import("node:net");
  if (process.getuid() === 0) throw new Error("API is running as root.");
  const discovery = await fetch(
    "http://oidc:8080/realms/tholi-local/.well-known/openid-configuration",
    { signal: AbortSignal.timeout(10000) },
  );
  if (!discovery.ok || (await discovery.json()).issuer !== issuer)
    throw new Error("Internal OIDC discovery failed.");
  const externalReachable = await new Promise((resolve) => {
    const socket = createConnection({ host: "1.1.1.1", port: 443 });
    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("connect", () => finish(true));
  });
  if (externalReachable)
    throw new Error("Isolated API reached an external network.");
  if (marker) {
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: "mail", port: 1025 });
      const commands = [
        [220, "EHLO tholi-smoke.invalid"],
        [250, "MAIL FROM:<smoke@example.invalid>"],
        [250, "RCPT TO:<capture@example.invalid>"],
        [250, "DATA"],
        [
          354,
          `From: smoke@example.invalid\r\nTo: capture@example.invalid\r\nSubject: ${marker}\r\nMessage-ID: <${marker}@example.invalid>\r\n\r\nSynthetic local stack verification.\r\n.`,
        ],
        [250, "QUIT"],
        [221, null],
      ];
      let step = 0;
      let buffer = "";
      socket.setEncoding("utf8");
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("Local SMTP timed out."));
      });
      socket.once("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, boundary).trimEnd();
          buffer = buffer.slice(boundary + 1);
          const reply = /^(\d{3})([ -])/.exec(line);
          if (!reply || reply[2] === "-") continue;
          const [expected, command] = commands[step++] || [];
          if (Number(reply[1]) !== expected) {
            socket.destroy();
            reject(new Error("Local SMTP rejected the synthetic message."));
            return;
          }
          if (command === null) {
            socket.end();
            resolve();
            return;
          }
          socket.write(command + "\r\n");
        }
      });
    });
  }
  if (telemetry) {
    const health = await fetch("http://telemetry:13133/", {
      signal: AbortSignal.timeout(10000),
    });
    if (!health.ok) throw new Error("Collector health failed.");
    const now = BigInt(Date.now()) * 1000000n;
    const response = await fetch("http://telemetry:4318/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "tholi-local-smoke" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "local-stack-smoke" },
                spans: [
                  {
                    traceId: "1234567890abcdef1234567890abcdef",
                    spanId: "1234567890abcdef",
                    name: "synthetic-local-probe",
                    kind: 1,
                    startTimeUnixNano: now.toString(),
                    endTimeUnixNano: (now + 1000000n).toString(),
                  },
                ],
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (
      !response.ok ||
      Number((await response.json()).partialSuccess?.rejectedSpans || 0) !== 0
    )
      throw new Error("Collector rejected synthetic OTLP.");
  }
  return {
    uid: process.getuid(),
    internalIssuer: true,
    externalEgressBlocked: true,
    mailSubmitted: !!marker,
    otlpAccepted: !!telemetry,
  };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function signedS3Request({
  endpoint,
  accessKey,
  secretKey,
  method,
  path,
  body = "",
}) {
  const url = new URL(path, endpoint);
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const payload = sha256(body);
  const headers = `host:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${stamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method,
    url.pathname,
    "",
    headers,
    signedHeaders,
    payload,
  ].join("\n");
  const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
  const key = [day, "us-east-1", "s3", "aws4_request"].reduce(
    (key, part) => hmac(key, part),
    Buffer.from("AWS4" + secretKey),
  );
  const signature = createHmac("sha256", key)
    .update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha256(canonical)}`)
    .digest("hex");
  try {
    return await fetch(url, {
      method,
      headers: {
        "x-amz-date": stamp,
        "x-amz-content-sha256": payload,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      ...(method === "GET" ? {} : { body }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new Error(
      `Local S3 ${method} failed for ${url.origin}${url.pathname}: ${error.cause?.code || error.message}`,
    );
  }
}

/** This smoke owns a fresh project and never deletes the developer's local stack. */
export async function runLocalStackSmoke({ optional = false } = {}) {
  const project = `tholi-smoke-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const directory = resolve(root, "output/qa/local-stack", project);
  const envFile = resolve(directory, ".env");
  const reportPath = resolve(directory, "smoke.json");
  const selectedProfiles = [];
  const report = {
    schemaVersion: 1,
    project,
    startedAt: new Date().toISOString(),
    optional,
    checks: [],
    liveGemini: "disabled; adapter and billing guard belong to later tickets",
    status: "running",
  };
  let stage = "initialization";
  let safeProject = false;
  let environmentCreated = false;
  let config;
  const secrets = new Set();
  let lastDiagnostic;
  const sanitize = (value) => {
    let text = String(value || "No additional diagnostic available.");
    for (const secret of [...secrets].sort((a, b) => b.length - a.length))
      text = text.replaceAll(secret, "[redacted]");
    return text
      .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
      .slice(-4000);
  };
  const check = (name, details = {}) => {
    report.checks.push({ name, passed: true, ...details });
    console.log("Local-stack check passed: " + name);
  };
  const base = () =>
    localStackArguments({
      action: "status",
      envFile,
      project,
      selectedProfiles,
    }).slice(0, -1);
  const docker = async (args, timeout = 30000, environment = {}) => {
    try {
      return (
        await execute("docker", args, {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          timeout,
          env: { ...process.env, ...environment },
        })
      ).stdout;
    } catch (error) {
      lastDiagnostic = sanitize(error.stderr || error.message);
      throw new Error("Docker operation failed during " + stage + ".");
    }
  };
  const compose = (args, timeout) => docker([...base(), ...args], timeout);
  const nodeProbe = async (input) => {
    const source = `(${privateNetworkProbe.toString()})(${JSON.stringify(input)}).then(result=>process.stdout.write(JSON.stringify(result)),error=>{process.stderr.write((error.message||"Local private-network probe failed.")+"\\n");process.exitCode=1;});`;
    return JSON.parse(
      await compose([
        "exec",
        "-T",
        "api",
        "node",
        "--input-type=module",
        "-e",
        source,
      ]),
    );
  };
  try {
    const ports = await reservePorts();
    initializeLocalEnvironment({ envFile, project, ports });
    environmentCreated = true;
    const environment = await readFile(envFile, "utf8");
    const settings = parseEnv(environment);
    for (const line of environment.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (
        separator > 0 &&
        /(?:PASSWORD|SECRET|TOKEN|KEY)$/.test(line.slice(0, separator))
      ) {
        const value = line.slice(separator + 1);
        if (value) secrets.add(value);
      }
    }
    await mkdir(directory, { recursive: true });
    const git = await execute("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    report.sourceSha = git.stdout.trim();
    report.dockerfileSha256 = sha256(
      await readFile(resolve(root, "apps/api/Dockerfile")),
    );
    report.sourceDirty = !!(
      await execute("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      })
    ).stdout.trim();
    stage = "Compose safety policy";
    config = JSON.parse(await compose(["config", "--format", "json"]));
    requireCheck(config.name === project);
    assertOwnedSmokeProject(config.name, project);
    report.configuration = inspectLocalStack(config);
    safeProject = true;
    check("resolved-compose-safety");
    // The contract suite must own a fresh schema before the API starts using it.
    // Full startup subsequently runs the same dedicated migration initializer.
    stage = "fresh PostgreSQL startup";
    await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "240", "postgres"],
      600000,
    );
    stage = "real PostgreSQL migrations and repository contracts";
    const testImage = `${project}-postgres-tests:dev`;
    await docker(
      [
        "build",
        "--file",
        "apps/api/Dockerfile",
        "--target",
        "postgres-tests",
        "--tag",
        testImage,
        ".",
      ],
      600000,
    );
    const databaseConnection = (user, password) =>
      `postgresql://${user}:${encodeURIComponent(password)}@postgres:5432/tholi`;
    const runPostgresImage = async (mode = []) =>
      JSON.parse(
        await docker(
          [
            "run",
            "--rm",
            "--network",
            config.networks.database.name,
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            "--memory",
            "256m",
            "--pids-limit",
            "64",
            "--env",
            "THOLI_DATABASE_URL",
            "--env",
            "THOLI_DATABASE_MIGRATION_URL",
            "--env",
            "THOLI_DATABASE_WORKER_URL",
            "--env",
            "THOLI_SUPPORT_PROBE_API_URL",
            testImage,
            ...mode,
          ],
          120000,
          {
            THOLI_DATABASE_URL: databaseConnection(
              "tholi_runtime",
              settings.THOLI_DB_PASSWORD,
            ),
            THOLI_DATABASE_MIGRATION_URL: databaseConnection(
              "tholi_migrator",
              settings.THOLI_MIGRATION_PASSWORD,
            ),
            THOLI_DATABASE_WORKER_URL: databaseConnection(
              "tholi_worker",
              settings.THOLI_WORKER_PASSWORD,
            ),
            THOLI_SUPPORT_PROBE_API_URL: "http://api:8788",
          },
        ),
      );
    const postgresChecks = await runPostgresImage();
    requireCheck(postgresChecks.passed && postgresChecks.checks.length > 0);
    check("real-postgres-migrations-and-repositories", postgresChecks);
    stage = "clean stack build and startup";
    await compose(
      ["up", "--build", "--detach", "--wait", "--wait-timeout", "240"],
      600000,
    );
    check("clean-stack-startup");
    stage = "idempotent local database bootstrap and identity seed";
    for (const action of ["migrate", "seed", "migrate", "seed"])
      for (const command of localStackCommands({ action, envFile, project }))
        await docker(command, 90000);
    check("idempotent-bootstrap-and-local-seed");
    stage = "actual reverse-proxy, TLS and direct API boundaries";
    const gatewayChecks = await runGatewayChecks({
      docker,
      compose,
      config,
      project,
      directory,
      envFile,
    });
    requireCheck(
      gatewayChecks.checks.length > 0 &&
        gatewayChecks.checks.every((result) => result.passed === true),
      "Gateway transport checks must actually run and pass.",
    );
    for (const { name, passed, ...details } of gatewayChecks.checks)
      check(name, details);
    report.gatewayConfigurationHashes = gatewayChecks.configurationHashes;
    stage = "actual independent worker effect and acknowledgement";
    const workerProbe = await runPostgresImage([
      "node",
      "/app/postgres-check.mjs",
      "--worker-runtime-probe",
    ]);
    requireCheck(workerProbe.passed);
    check("actual-worker-effect-and-atomic-completion", workerProbe);
    stage = "actual support mail and private diagnostic lifecycle";
    const supportProbe = await runPostgresImage([
      "node",
      "/app/postgres-check.mjs",
      "--support-runtime-probe",
    ]);
    requireCheck(supportProbe.passed);
    const { deletedObject, ...supportEvidence } = supportProbe;
    requireCheck(
      deletedObject &&
        /^[a-f0-9-]{36}$/.test(deletedObject.workspaceId) &&
        /^[a-f0-9-]{36}$/.test(deletedObject.fileId),
    );
    const absent = await signedS3Request({
      endpoint: `http://127.0.0.1:${ports.STORAGE_HOST_PORT}`,
      accessKey: settings.STORAGE_ACCESS_KEY,
      secretKey: settings.STORAGE_SECRET_KEY,
      method: "GET",
      path: `/tholi-local/exports/${deletedObject.workspaceId}/${deletedObject.fileId}.json`,
    });
    requireCheck(
      absent.status === 404,
      "The expired diagnostic object is still present in private storage.",
    );
    check("actual-support-mail-and-private-diagnostics", supportEvidence);
    check("expired-diagnostic-object-physically-absent");
    if (supportProbe.requestId) {
      const deliveries = await jsonResponse(
        `http://127.0.0.1:${ports.MAIL_HOST_PORT}/api/v1/messages`,
      );
      requireCheck(
        Array.isArray(deliveries.messages) && deliveries.messages.length <= 20,
        "Unexpected local capture count.",
      );
      let correlated = 0;
      for (const message of deliveries.messages) {
        requireCheck(
          typeof message.ID === "string" && /^[a-zA-Z0-9-]+$/.test(message.ID),
        );
        const captured = await jsonResponse(
          `http://127.0.0.1:${ports.MAIL_HOST_PORT}/api/v1/message/${message.ID}`,
        );
        if (
          typeof captured.Text === "string" &&
          captured.Text.includes(supportProbe.requestId)
        )
          correlated++;
      }
      requireCheck(
        correlated === 2,
        "The support operator message and verified-account receipt were not both captured.",
      );
      check("support-operator-and-account-receipt-captured");
    }
    stage = "PostgreSQL application backup and restore";
    // Quiesce the only autonomous writer while comparing the restored snapshot.
    await compose(["stop", "worker"], 30000);
    const backup = await compose(
      [
        "exec",
        "-T",
        "postgres",
        "sh",
        "-ec",
        'PGPASSWORD="$THOLI_MIGRATION_PASSWORD" pg_dump --host=127.0.0.1 --username=tholi_migrator --dbname=tholi --format=custom --file=/tmp/tholi-smoke.dump; psql --username=postgres --dbname=postgres --set=ON_ERROR_STOP=1 --command="CREATE DATABASE tholi_restore OWNER tholi_migrator TEMPLATE template0"; PGPASSWORD="$THOLI_MIGRATION_PASSWORD" pg_restore --host=127.0.0.1 --username=tholi_migrator --dbname=tholi_restore --single-transaction --exit-on-error /tmp/tholi-smoke.dump; rm /tmp/tholi-smoke.dump',
      ],
      90000,
    );
    requireCheck(backup.includes("CREATE DATABASE"));
    const applicationDigest = `DO $check$ DECLARE entry record; content text; BEGIN
      CREATE TEMP TABLE restore_digests (name text, digest text);
      FOR entry IN SELECT tablename FROM pg_tables WHERE schemaname = 'tholi' ORDER BY tablename LOOP
        EXECUTE format('SELECT md5(COALESCE(jsonb_agg(document ORDER BY document::text)::text, ''[]'')) FROM (SELECT to_jsonb(source_record) AS document FROM tholi.%I source_record) records', entry.tablename) INTO content;
        INSERT INTO restore_digests VALUES (entry.tablename, content);
      END LOOP;
    END $check$;
    SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY name)::text) FROM restore_digests d;`;
    const digests = [];
    for (const database of ["tholi", "tholi_restore"]) {
      digests.push(
        (
          await compose([
            "exec",
            "-T",
            "postgres",
            "sh",
            "-ec",
            'PGPASSWORD="$THOLI_MIGRATION_PASSWORD" psql --host=127.0.0.1 --username=tholi_migrator --dbname="$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="$2"',
            "tholi-restore-check",
            database,
            applicationDigest,
          ])
        ).trim(),
      );
    }
    requireCheck(
      /^[a-f0-9]{32}$/.test(digests[0].split(/\r?\n/).at(-1)) &&
        digests[0] === digests[1],
      "Restored application records differ from the source database.",
    );
    const restored = await compose([
      "exec",
      "-T",
      "postgres",
      "sh",
      "-ec",
      'PGPASSWORD="$THOLI_DB_PASSWORD" psql --host=127.0.0.1 --username=tholi_runtime --dbname=tholi_restore --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align --command="$1"',
      "tholi-runtime-restore-check",
      `BEGIN;
       SET LOCAL tholi.account_id = '00000000-0000-4000-8000-000000000028';
       SET LOCAL tholi.workspace_id = '00000000-0000-4000-8000-000000000029';
       SELECT count(*) = 1 FROM tholi.accounts
        WHERE id = '00000000-0000-4000-8000-000000000028'::uuid;
       COMMIT;`,
    ]);
    requireCheck(
      restored.trim() === "t",
      "The actual runtime role cannot read restored application records.",
    );
    check("application-backup-restore-with-runtime-readback");
    stage = "worker restart after backup verification";
    await compose(
      [
        "up",
        "--detach",
        "--no-deps",
        "--wait",
        "--wait-timeout",
        "90",
        "worker",
      ],
      120000,
    );
    stage = "PostgreSQL role and schema privileges";
    const roleRows = JSON.parse(
      await compose([
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "tholi",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atc",
        "SELECT json_build_object('roles', (SELECT json_agg(json_build_object('name',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls,'connections',rolconnlimit) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('tholi_runtime','tholi_migrator','tholi_identity','tholi_worker')), 'runtimeConnect',has_database_privilege('tholi_runtime','tholi','CONNECT'), 'runtimeCreateSchema',has_database_privilege('tholi_runtime','tholi','CREATE'), 'runtimeCreateObjects',has_schema_privilege('tholi_runtime','public','CREATE'));",
      ]),
    );
    const roleLimits = {
      tholi_runtime: 8,
      tholi_worker: 4,
      tholi_migrator: 2,
      tholi_identity: 6,
    };
    requireCheck(
      roleRows.roles?.length === 4 &&
        roleRows.roles.every(
          (role) =>
            !role.superuser &&
            !role.bypassRls &&
            role.connections === roleLimits[role.name],
        ),
      "PostgreSQL role isolation or connection limits differ from the local budget.",
    );
    requireCheck(
      roleRows.runtimeConnect &&
        !roleRows.runtimeCreateSchema &&
        !roleRows.runtimeCreateObjects,
      "The runtime database role must connect without schema or object creation authority.",
    );
    check("postgres-role-privileges-and-pool-budgets", {
      roles: roleRows.roles,
      runtimeConnect: true,
      runtimeCreateSchema: false,
      runtimeCreateObjects: false,
    });
    const api = `http://127.0.0.1:${ports.API_HOST_PORT}`;
    const issuer = `http://localhost:${ports.OIDC_HOST_PORT}/realms/tholi-local`;
    const discoveryUrl = `http://127.0.0.1:${ports.OIDC_HOST_PORT}/realms/tholi-local/.well-known/openid-configuration`;
    stage = "host API liveness";
    const live = await jsonResponse(api + "/health/live");
    requireCheck(
      live.profile === "service" &&
        live.status === "ok" &&
        Array.isArray(live.capabilities) &&
        live.capabilities.length === 0,
      "API does not match the service process health contract.",
    );
    stage = "host API readiness";
    requireCheck(
      (await jsonResponse(api + "/health/ready")).status === "ready",
    );
    stage = "host canonical OIDC discovery";
    requireCheck((await jsonResponse(discoveryUrl)).issuer === issuer);
    stage = "private network, egress and local SMTP";
    const marker = project + "-capture";
    check(
      "nonroot-internal-network-and-smtp",
      await nodeProbe({ issuer, marker }),
    );
    const captured = await jsonResponse(
      `http://127.0.0.1:${ports.MAIL_HOST_PORT}/api/v1/messages`,
    );
    requireCheck(JSON.stringify(captured).includes(marker));
    check("synthetic-invalid-domain-mail-captured");
    const ids = (await compose(["ps", "--quiet"]))
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const containers = JSON.parse(await docker(["inspect", ...ids]));
    requireCheck(containers.length === 7);
    const expected = [
      "api",
      "worker",
      "postgres",
      "oidc",
      "mail",
      "gateway",
      "storage",
    ].sort();
    requireCheck(
      JSON.stringify(
        containers
          .map((item) => item.Config.Labels["com.docker.compose.service"])
          .sort(),
      ) === JSON.stringify(expected),
    );
    report.images = Object.fromEntries(
      containers.map((item) => [
        item.Config.Labels["com.docker.compose.service"],
        { id: item.Image, configured: item.Config.Image },
      ]),
    );
    const runtimeApi = containers.find(
      (item) => item.Config.Labels["com.docker.compose.service"] === "api",
    );
    const runtimeWorker = containers.find(
      (item) => item.Config.Labels["com.docker.compose.service"] === "worker",
    );
    requireCheck(
      runtimeWorker &&
        runtimeWorker.Image === runtimeApi.Image &&
        runtimeWorker.State.Health?.Status === "healthy" &&
        runtimeWorker.Config.Cmd?.includes("apps/api/dist/worker.js"),
      "The independent worker must run the application image and pass live polling health.",
    );
    check("independent-worker-polling-health", {
      sameImage: true,
      publicPorts: false,
    });
    requireCheck(
      runtimeApi.HostConfig.ReadonlyRootfs &&
        runtimeApi.HostConfig.CapDrop?.includes("ALL") &&
        runtimeApi.HostConfig.SecurityOpt?.some((value) =>
          value.startsWith("no-new-privileges"),
        ),
    );
    for (const item of containers) {
      requireCheck(
        item.Config.Labels["com.docker.compose.project"] === project,
      );
      const serviceName = item.Config.Labels["com.docker.compose.service"];
      const names = Object.keys(item.NetworkSettings.Networks);
      requireCheck(names.length > 0);
      const networks = JSON.parse(
        await docker(["network", "inspect", ...names]),
      );
      requireCheck(
        networks.every(
          (network) =>
            network.Labels["com.docker.compose.project"] === project &&
            (network.Internal ||
              (serviceName === "gateway" &&
                network.Name === project + "_ingress")),
        ),
      );
    }
    check("running-container-identity-and-network-policy");
    stage = "retained database data across recreation";
    const sentinel = randomBytes(16).toString("hex");
    await compose([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "tholi",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `CREATE TABLE public._tholi_smoke (marker text PRIMARY KEY); INSERT INTO public._tholi_smoke VALUES ('${sentinel}');`,
    ]);
    await compose(["down", "--remove-orphans"], 90000);
    await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "240"],
      300000,
    );
    const retained = await compose([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "tholi",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      "SELECT marker FROM public._tholi_smoke;",
    ]);
    requireCheck(
      retained.trim() === sentinel,
      "Synthetic PostgreSQL data was not retained after recreation.",
    );
    requireCheck((await jsonResponse(discoveryUrl)).issuer === issuer);
    check("postgres-marker-and-identity-retained-after-down-up");
    if (optional) {
      stage = "optional local profiles";
      selectedProfiles.push("storage", "telemetry");
      const expanded = JSON.parse(
        await compose(["config", "--format", "json"]),
      );
      report.optionalConfiguration = inspectLocalStack(expanded);
      await compose(
        ["up", "--detach", "--wait", "--wait-timeout", "240"],
        300000,
      );
      stage = "private object storage";
      const environment = await readFile(envFile, "utf8");
      const setting = (key) =>
        environment
          .split(/\r?\n/)
          .find((line) => line.startsWith(key + "="))
          ?.slice(key.length + 1);
      const settings = {
        endpoint: `http://127.0.0.1:${ports.STORAGE_HOST_PORT}`,
        accessKey: setting("STORAGE_ACCESS_KEY"),
        secretKey: setting("STORAGE_SECRET_KEY"),
      };
      requireCheck(settings.accessKey && settings.secretKey);
      const bucket =
        expanded.services.storage.environment?.S3_BUCKET || "tholi-local";
      const path = `/${bucket}/smoke-${randomBytes(6).toString("hex")}.txt`;
      const body = "Synthetic private local stack object.";
      stage = "signed private object upload";
      const uploaded = await signedS3Request({
        ...settings,
        method: "PUT",
        path,
        body,
      });
      requireCheck(
        uploaded.ok,
        `Local signed S3 PUT returned HTTP ${uploaded.status}.`,
      );
      stage = "signed private object download";
      const signed = await signedS3Request({
        ...settings,
        method: "GET",
        path,
      });
      requireCheck(
        signed.ok && (await signed.text()) === body,
        `Local signed S3 GET returned HTTP ${signed.status} or different content.`,
      );
      stage = "anonymous private object denial";
      const anonymous = await fetch(new URL(path, settings.endpoint), {
        signal: AbortSignal.timeout(10000),
      });
      requireCheck(
        [401, 403].includes(anonymous.status),
        "Anonymous private object retrieval was not denied.",
      );
      check("signed-private-s3-put-get-and-anonymous-denial");
      stage = "local telemetry ingestion";
      check(
        "collector-health-and-synthetic-otlp",
        await nodeProbe({ issuer, telemetry: true }),
      );
      const expandedIds = (await compose(["ps", "--quiet"]))
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const expandedContainers = JSON.parse(
        await docker(["inspect", ...expandedIds]),
      );
      report.storageAndTelemetryImages = Object.fromEntries(
        expandedContainers
          .filter((item) =>
            ["storage", "telemetry"].includes(
              item.Config.Labels["com.docker.compose.service"],
            ),
          )
          .map((item) => [
            item.Config.Labels["com.docker.compose.service"],
            { id: item.Image, configured: item.Config.Image },
          ]),
      );
      requireCheck(Object.keys(report.storageAndTelemetryImages).length === 2);
    }
    stage = "explicit reset and clean application seed";
    assertOwnedSmokeProject(project, report.project);
    await docker(
      localStackArguments({
        action: "reset",
        envFile,
        project,
        confirmDelete: project,
      }),
      120000,
    );
    await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "240"],
      300000,
    );
    const empty = await compose([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "tholi",
      "-Atc",
      "SELECT to_regclass('tholi.schema_migrations') IS NOT NULL AND to_regclass('public._tholi_smoke') IS NULL AND NOT EXISTS (SELECT FROM tholi.accounts);",
    ]);
    requireCheck(
      empty.trim() === "t",
      "Explicit reset retained the previous database state.",
    );
    for (const action of ["migrate", "seed"])
      for (const command of localStackCommands({ action, envFile, project }))
        await docker(command, 90000);
    const seeded = await compose([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "tholi",
      "-Atc",
      "SELECT count(*) = 1 AND bool_and(id = '00000000-0000-4000-8000-000000000028'::uuid) FROM tholi.accounts;",
    ]);
    requireCheck(
      seeded.trim() === "t",
      "The reset application seed is not the single synthetic account.",
    );
    check("explicit-volume-reset-and-fresh-application-seed");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failedStage = stage;
    report.diagnostic = lastDiagnostic || sanitize(error.message);
    if (safeProject) {
      try {
        const logs = await execute(
          "docker",
          [
            ...base(),
            "logs",
            "--no-color",
            "--tail",
            "30",
            ...(selectedProfiles.length ? ["storage", "telemetry"] : []),
          ],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 15000,
            maxBuffer: 1024 * 1024,
          },
        );
        report.containerDiagnostic = sanitize(logs.stdout + logs.stderr);
      } catch {
        // Keep the primary failure if the failed container has no retrievable logs.
      }
    }
  } finally {
    if (safeProject) {
      stage = "disposable smoke project cleanup";
      try {
        assertOwnedSmokeProject(project, report.project);
        await docker(
          localStackArguments({
            action: "reset",
            envFile,
            project,
            confirmDelete: project,
          }),
          120000,
        );
        report.cleanup = "owned project and volumes removed";
      } catch (error) {
        report.cleanup =
          "failed; inspect the named disposable project before retrying cleanup";
        report.cleanupDiagnostic = lastDiagnostic || sanitize(error.message);
        report.status = "failed";
      }
    }
    if (environmentCreated && !report.cleanup?.startsWith("failed"))
      await rm(envFile, { force: true });
    report.finishedAt = new Date().toISOString();
    await mkdir(directory, { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    `Local-stack smoke ${report.status}. Redacted evidence: ${reportPath}`,
  );
  if (report.status !== "passed")
    throw new Error(
      "Local-stack smoke failed during " + (report.failedStage || stage) + ".",
    );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--optional") || args.length > 1) {
    console.error("Usage: node scripts/local-stack-smoke.mjs [--optional]");
    process.exitCode = 1;
  } else {
    try {
      await runLocalStackSmoke({ optional: args.includes("--optional") });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
