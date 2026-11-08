import assert from "node:assert/strict";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnedSmokeProject } from "./local-stack-policy.mjs";
import {
  inspectVmGateway,
  syntheticCertificate,
} from "./gateway-validation.mjs";
import { verifyDatabaseRestore } from "./database-validation.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const capacity = JSON.parse(
  await readFile(resolve(root, "infra/capacity.json"), "utf8"),
);

/** Inspect resolved values without returning secrets or operator paths. */
export function inspectVmProfile(config, image) {
  assert.match(
    image,
    /^sha256:[a-f0-9]{64}$|^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/,
  );
  const services = config.services;
  const gateway = inspectVmGateway(config, {
    services: { api: { image }, gateway: services.gateway },
  });
  for (const [name, role, key, pool] of [
    ["api", "tholi_runtime", "THOLI_DATABASE_URL", capacity.vm.apiPool],
    [
      "worker",
      "tholi_worker",
      "THOLI_DATABASE_WORKER_URL",
      capacity.vm.workerPool,
    ],
    ["database-migrate", "tholi_migrator", "THOLI_DATABASE_MIGRATION_URL", 1],
  ]) {
    const service = services[name],
      env = service.environment;
    assert.equal(service.image, image);
    assert.equal(service.build, undefined);
    assert.equal(service.user, "1000:1000");
    assert.equal(service.read_only, true);
    assert.ok(service.cap_drop.includes("ALL"));
    assert.ok(service.security_opt.includes("no-new-privileges:true"));
    assert.equal(env.NODE_ENV, "production");
    assert.equal(Number(env.THOLI_DATABASE_POOL_MAX), pool);
    for (const other of [
      "THOLI_DATABASE_URL",
      "THOLI_DATABASE_WORKER_URL",
      "THOLI_DATABASE_MIGRATION_URL",
    ])
      assert.equal(Boolean(env[other]), other === key);
    const url = new URL(env[key]);
    assert.equal(decodeURIComponent(url.username), role);
    assert.equal(url.hostname, "postgres");
    assert.equal(url.pathname, "/tholi");
  }
  const env = services.api.environment;
  assert.equal(env.THOLI_MODEL_PROVIDER, "fake");
  assert.equal(env.THOLI_NAVIGATION_TRANSPORT_ENABLED, "false");
  assert.equal(env.THOLI_BYOK_ENABLED, "false");
  for (const key of [
    "THOLI_IDENTITY_ISSUER",
    "THOLI_IDENTITY_AUTHORIZATION_ENDPOINT",
    "THOLI_IDENTITY_TOKEN_ENDPOINT",
    "THOLI_IDENTITY_JWKS_URI",
    "THOLI_IDENTITY_LOGOUT_ENDPOINT",
    "THOLI_IDENTITY_WEB_ORIGIN",
    "THOLI_SERVICE_PUBLIC_ORIGIN",
  ])
    assert.equal(new URL(env[key]).protocol, "https:");
  assert.ok(
    !Object.keys(services.worker.environment).some((key) =>
      key.startsWith("THOLI_IDENTITY_"),
    ),
  );
  const c = capacity.vm;
  assert.equal(
    c.apiReplicas * c.apiPool +
      c.workerReplicas * c.workerPool +
      c.identityConnections +
      c.migrationConnections +
      c.operationsConnections +
      c.rolloutConnections +
      c.headroomConnections,
    c.databaseConnections,
  );
  assert.ok(
    services.postgres.command.includes(
      "max_connections=" + c.databaseConnections,
    ),
  );
  assert.equal(config.networks.database.internal, true);
  return {
    ...gateway,
    capacity: c,
    productionIdentity: true,
    externalModels: false,
  };
}

async function secureProbe({ ca }) {
  const https = await import("node:https");
  const assert = (await import("node:assert/strict")).default;
  const get = (path) =>
    new Promise((resolve, reject) => {
      const request = https.get(
        {
          host: "gateway",
          port: 8443,
          servername: "api.example.test",
          ca,
          headers: { Host: "api.example.test" },
          path,
        },
        (response) => {
          response.resume();
          response.on("end", () =>
            resolve({ status: response.statusCode, headers: response.headers }),
          );
        },
      );
      request.setTimeout(5000, () =>
        request.destroy(new Error("Private TLS probe timed out.")),
      );
      request.once("error", reject);
    });
  assert.equal((await get("/health/ready")).status, 200);
  const start = await get(
    "/api/v1/auth/authorize?clientId=web&action=signin&destination=account",
  );
  assert.equal(start.status, 302);
  const target = new URL(start.headers.location);
  assert.equal(target.origin, "https://identity.example.test");
  assert.equal(
    target.searchParams.get("redirect_uri"),
    "https://api.example.test/api/v1/auth/callback",
  );
  assert.ok(
    start.headers["set-cookie"].every(
      (value) =>
        /; Secure(?:;|$)/.test(value) && /; HttpOnly(?:;|$)/.test(value),
    ),
  );
  return {
    tlsVerified: true,
    secureCookie: true,
    canonicalCallback: true,
    oidcProviderContacted: false,
  };
}

/** Same image in a distinct production-style Compose project inside the local VM. */
export async function runVmChecks({
  docker,
  project: sourceProject,
  directory,
  image,
  testImage,
  settings,
}) {
  assertOwnedSmokeProject(sourceProject, sourceProject);
  const project = sourceProject.replace("tholi-smoke-", "tholi-smoke-vm");
  assertOwnedSmokeProject(project, project);
  const temporary = resolve(directory, "vm-profile");
  const tlsDirectory = resolve(temporary, "tls");
  assert.equal(
    temporary,
    resolve(root, "output/qa/local-stack", sourceProject, "vm-profile"),
  );
  const files = [
    "api.env",
    "worker.env",
    "migration.env",
    "postgres.env",
    "compose.env",
    "qa.yaml",
    "tls/openssl.cnf",
    "tls/privkey.pem",
    "tls/fullchain.pem",
  ];
  const envFile = resolve(temporary, "compose.env");
  const base = [
    "compose",
    "--project-directory",
    root,
    "--env-file",
    envFile,
    "--project-name",
    project,
    "--file",
    resolve(root, "infra/vm/compose.yaml"),
  ];
  const compose = (args, timeout = 90000) =>
    docker(
      [...base, "--file", resolve(temporary, "qa.yaml"), ...args],
      timeout,
    );
  let owned = false;
  let created = false;
  try {
    for (const resource of ["container", "volume", "network"]) {
      const command =
        resource === "container" ? ["ps", "--all"] : [resource, "ls"];
      assert.equal(
        (
          await docker([
            ...command,
            "--filter",
            `label=com.docker.compose.project=${project}`,
            "--format",
            "{{.ID}}",
          ])
        ).trim(),
        "",
        "Refusing to reuse an existing VM fixture project.",
      );
    }
    await mkdir(temporary, { recursive: false, mode: 0o700 });
    created = true;
    // The host-private parent protects QA env files. Only this traversable TLS
    // child is bind-mounted for UID 101; mounting the 0700 parent fails on Linux.
    await mkdir(tlsDirectory, { mode: 0o755 });
    const ca = await syntheticCertificate(tlsDirectory);
    const connection = (role, password) =>
      `postgresql://${role}:${encodeURIComponent(password)}@postgres:5432/tholi`;
    const environments = {
      "api.env": {
        THOLI_DATABASE_URL: connection(
          "tholi_runtime",
          settings.THOLI_DB_PASSWORD,
        ),
        THOLI_IDENTITY_ISSUER: "https://identity.example.test/realms/tholi",
        THOLI_IDENTITY_AUTHORIZATION_ENDPOINT:
          "https://identity.example.test/auth",
        THOLI_IDENTITY_TOKEN_ENDPOINT: "https://identity.example.test/token",
        THOLI_IDENTITY_JWKS_URI: "https://identity.example.test/certs",
        THOLI_IDENTITY_LOGOUT_ENDPOINT: "https://identity.example.test/logout",
        THOLI_IDENTITY_CLIENT_ID: "tholi-service",
        THOLI_IDENTITY_CLIENT_SECRET_KEY:
          settings.THOLI_IDENTITY_CLIENT_SECRET_KEY,
        THOLI_IDENTITY_FLOW_SECRET_KEY: settings.THOLI_IDENTITY_FLOW_SECRET_KEY,
        THOLI_IDENTITY_WEB_ORIGIN: "https://example.test",
        THOLI_SERVICE_ORIGINS: "https://example.test",
        THOLI_SERVICE_PUBLIC_ORIGIN: "https://api.example.test",
        THOLI_SUPPORT_ENABLED: "false",
      },
      "worker.env": {
        THOLI_DATABASE_WORKER_URL: connection(
          "tholi_worker",
          settings.THOLI_WORKER_PASSWORD,
        ),
        THOLI_SUPPORT_ENABLED: "false",
      },
      "migration.env": {
        THOLI_DATABASE_MIGRATION_URL: connection(
          "tholi_migrator",
          settings.THOLI_MIGRATION_PASSWORD,
        ),
      },
      "postgres.env": {
        POSTGRES_PASSWORD: settings.POSTGRES_ADMIN_PASSWORD,
        THOLI_DB_PASSWORD: settings.THOLI_DB_PASSWORD,
        THOLI_WORKER_PASSWORD: settings.THOLI_WORKER_PASSWORD,
        THOLI_MIGRATION_PASSWORD: settings.THOLI_MIGRATION_PASSWORD,
        OIDC_DB_PASSWORD: settings.OIDC_DB_PASSWORD,
      },
      "compose.env": {
        THOLI_SERVICE_IMAGE: image,
        THOLI_TLS_DIRECTORY: tlsDirectory.replaceAll("\\", "/"),
        ...Object.fromEntries(
          ["API", "WORKER", "MIGRATION", "POSTGRES"].map((role) => [
            `THOLI_VM_${role}_ENV`,
            resolve(temporary, role.toLowerCase() + ".env").replaceAll(
              "\\",
              "/",
            ),
          ]),
        ),
      },
    };
    for (const [file, values] of Object.entries(environments)) {
      assert.ok(
        Object.values(values).every(
          (value) => typeof value === "string" && !/[\r\n$#"]/.test(value),
        ),
      );
      await writeFile(
        resolve(temporary, file),
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
        { mode: 0o600 },
      );
    }
    const config = JSON.parse(
      await docker([...base, "config", "--format", "json"]),
    );
    assert.equal(config.name, project);
    const policy = inspectVmProfile(config, image);
    for (const [kind, resources] of [
      ["volume", config.volumes],
      ["network", config.networks],
    ])
      for (const resource of Object.values(resources))
        assert.equal(
          (
            await docker([
              kind,
              "ls",
              "--filter",
              `name=^${resource.name}$`,
              "--format",
              "{{.ID}}",
            ])
          ).trim(),
          "",
          "Refusing to reuse an existing named VM resource.",
        );
    // QA never exposes VM ingress to the host or permits external provider traffic.
    await writeFile(
      resolve(temporary, "qa.yaml"),
      "services:\n  gateway:\n    ports: !override []\nnetworks:\n  application:\n    internal: true\n",
      { mode: 0o600 },
    );
    owned = true;
    await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "120"],
      180000,
    );
    const checks = [];
    const record = (name, details = {}) => {
      checks.push({ name, passed: true, ...details });
      console.log("VM check passed: " + name);
    };
    record("standalone-production-vm-profile", policy);
    for (const [setting, expected] of Object.entries({
      log_error_verbosity: "terse",
      log_min_error_statement: "panic",
      log_parameter_max_length_on_error: "0",
      log_parameter_max_length: "0",
      log_statement: "none",
      log_min_duration_statement: "-1",
    })) {
      assert.equal(
        (
          await compose([
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "postgres",
            "-d",
            "tholi",
            "-Atc",
            `SHOW ${setting}`,
          ])
        ).trim(),
        expected,
      );
    }
    const ids = (await compose(["ps", "--quiet", "api", "worker"]))
      .trim()
      .split(/\s+/);
    const inspected = JSON.parse(await docker(["inspect", ...ids]));
    assert.equal(inspected.length, 2);
    assert.ok(inspected.every((item) => item.Image === image));
    record("local-vm-api-worker-identical-image", { image });
    const probe = `(${secureProbe.toString()})(${JSON.stringify({ ca })}).then(v=>process.stdout.write(JSON.stringify(v)),()=>process.exitCode=1)`;
    const secure = JSON.parse(
      await compose([
        "exec",
        "-T",
        "api",
        "node",
        "--input-type=module",
        "-e",
        probe,
      ]),
    );
    record("production-tls-cookie-and-callback", secure);
    // The existing operator lock rejects overlap promptly, rather than queuing
    // another migration. Treat only that exact known result as a busy operator.
    const migrationProbe = `import {runDatabaseCommand} from './apps/api/dist/database-cli.js';
      try {await runDatabaseCommand('migrate');console.log('migration-complete')}
      catch(error){if(error instanceof Error && error.message==='Another database migration is already running.')console.log('migration-busy');else process.exitCode=1}`;
    const migrations = await Promise.all(
      [1, 2].map(() =>
        compose([
          "run",
          "--rm",
          "--no-deps",
          "database-migrate",
          "node",
          "--input-type=module",
          "-e",
          migrationProbe,
        ]),
      ),
    );
    assert.ok(
      migrations.some((result) => result.trim() === "migration-complete"),
    );
    assert.ok(
      migrations.every((result) =>
        ["migration-complete", "migration-busy"].includes(result.trim()),
      ),
    );
    await compose(["run", "--rm", "--no-deps", "database-migrate"]);
    await compose([
      "exec",
      "-T",
      "api",
      "node",
      "apps/api/dist/database-cli.js",
      "verify",
    ]);
    record("same-migrations-serialized-and-runtime-verified");
    const wrapper = await readFile(
      resolve(root, "infra/google/migrate-with-proxy.mjs"),
      "utf8",
    );
    const proxyFixture = `import {createServer} from 'node:http';
      let proxyStopped=false;
      const proxy=createServer((request,response)=>{if(request.method!=='POST'||request.url!=='/quitquitquit'){response.writeHead(404);response.end();return}proxyStopped=true;response.end();proxy.close(()=>process.stdout.write('proxy-stopped\\n'))});
      await new Promise(resolve=>proxy.listen(9091,'127.0.0.1',resolve));
      const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();\n`;
    const supervised = await compose([
      "run",
      "--rm",
      "--no-deps",
      "database-migrate",
      "node",
      "--input-type=module",
      "-e",
      proxyFixture + wrapper,
    ]);
    assert.ok(supervised.includes("proxy-stopped"));
    const failedMigration = await compose([
      "run",
      "--rm",
      "--no-deps",
      "-e",
      "THOLI_DATABASE_POOL_MAX=0",
      "database-migrate",
      "node",
      "--input-type=module",
      "-e",
      proxyFixture +
        wrapper +
        "\nif(process.exitCode!==1||!proxyStopped){process.exitCode=2}else{process.exitCode=0;process.stdout.write('migration-failed-and-proxy-stopped\\n')}",
    ]);
    assert.ok(failedMigration.includes("migration-failed-and-proxy-stopped"));
    record(
      "google-job-supervision-with-real-local-migration-and-synthetic-proxy",
    );
    const runtime = JSON.parse(
      await docker(
        [
          "run",
          "--rm",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges:true",
          "--network",
          config.networks.database.name,
          "--network",
          config.networks.application.name,
          "--env",
          "THOLI_DATABASE_URL",
          "--env",
          "THOLI_DATABASE_MIGRATION_URL",
          testImage,
          "node",
          "/app/postgres-check.mjs",
          "--profile-runtime-probe",
        ],
        30000,
        {
          THOLI_DATABASE_URL: environments["api.env"].THOLI_DATABASE_URL,
          THOLI_DATABASE_MIGRATION_URL:
            environments["migration.env"].THOLI_DATABASE_MIGRATION_URL,
        },
      ),
    );
    assert.equal(runtime.passed, true);
    record("production-http-with-controlled-database-identity", {
      authenticatedRead: runtime.authenticatedRead,
      missingProofDenied: runtime.missingProofDenied,
      nativeOidcVerified: false,
    });
    let rejected = false;
    try {
      await compose(
        [
          "run",
          "--rm",
          "--no-deps",
          "-e",
          "THOLI_MODEL_PROVIDER=vertex",
          "api",
        ],
        30000,
      );
    } catch {
      rejected = true;
    }
    assert.ok(
      rejected,
      "An invalid candidate must fail before serving traffic.",
    );
    await compose(
      [
        "up",
        "--detach",
        "--no-deps",
        "--force-recreate",
        "--wait",
        "--wait-timeout",
        "90",
        "api",
      ],
      120000,
    );
    await compose([
      "exec",
      "-T",
      "api",
      "node",
      "apps/api/dist/database-cli.js",
      "verify",
    ]);
    record("invalid-candidate-fails-closed-and-known-configuration-recovers");
    await compose(["stop", "worker"]);
    record(
      "vm-backup-restore-and-scoped-runtime-readback",
      await verifyDatabaseRestore({ compose, project, scope: runtime.scope }),
    );
    await compose(["down", "--timeout", "10"], 60000);
    await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "120"],
      180000,
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
      "-Atc",
      `SELECT count(*)=1 FROM tholi.accounts WHERE id='${runtime.scope.accountId}'::uuid`,
    ]);
    assert.equal(retained.trim(), "t");
    record("vm-restart-retains-application-data");
    return {
      passed: true,
      project,
      image,
      checks,
      execution: "local Docker Linux VM; not a remote VM or Google deployment",
    };
  } finally {
    if (owned) {
      assertOwnedSmokeProject(project, project);
      await compose(
        ["down", "--volumes", "--remove-orphans", "--timeout", "10"],
        60000,
      );
    }
    if (created) {
      for (const file of files)
        await rm(resolve(temporary, file), { force: true });
      await rmdir(tlsDirectory);
      await rmdir(temporary);
    }
  }
}
