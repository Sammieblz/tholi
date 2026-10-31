import { expect, test } from "vitest";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  assertOwnedSmokeProject,
  inspectLocalStack,
} from "../../../scripts/lib/local-stack-policy.mjs";
import {
  localStackArguments,
  localStackCommands,
  initializeLocalEnvironment,
} from "../../../scripts/local-stack.mjs";

test("identity environment upgrades preserve existing credentials and add missing settings once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-identity-env-"));
  const envFile = join(directory, ".env");
  try {
    const old =
      "COMPOSE_PROJECT_NAME=tholi-existing\nTHOLI_DB_PASSWORD=keep-this-local-value\nTHOLI_WEB_ORIGIN=http://127.0.0.1:5188\n";
    await writeFile(envFile, old);
    expect(() => initializeLocalEnvironment({ envFile })).toThrow();
    initializeLocalEnvironment({ envFile, upgradeIdentity: true });
    const upgraded = await readFile(envFile, "utf8");
    expect(upgraded.startsWith(old)).toBe(true);
    const env = parseEnv(upgraded);
    expect(env.THOLI_DB_PASSWORD).toBe("keep-this-local-value");
    expect(env.THOLI_WEB_ORIGIN).toBe("http://127.0.0.1:5188");
    expect(env.THOLI_IDENTITY_CLIENT_SECRET_KEY).toMatch(/^[a-f0-9]{48}$/);
    expect(
      Buffer.from(env.THOLI_IDENTITY_FLOW_SECRET_KEY ?? "", "base64url"),
    ).toHaveLength(32);
    expect(env.THOLI_IDENTITY_CHROMIUM_CALLBACKS).toMatch(
      /^https:\/\/.*\.chromiumapp\.org\/$/,
    );
    initializeLocalEnvironment({ envFile, upgradeIdentity: true });
    expect(await readFile(envFile, "utf8")).toBe(upgraded);
  } finally {
    await rm(envFile, { force: true });
    await rmdir(directory);
  }
});

test("worker and support credential upgrades preserve existing secrets and are idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-worker-env-"));
  const envFile = join(directory, ".env");
  try {
    const original =
      "THOLI_DB_PASSWORD=keep-runtime\nTHOLI_IDENTITY_CLIENT_SECRET_KEY=keep-identity\n";
    await writeFile(envFile, original);
    initializeLocalEnvironment({
      envFile,
      upgradeWorker: true,
      upgradeSupport: true,
    });
    const upgraded = await readFile(envFile, "utf8");
    expect(upgraded.startsWith(original)).toBe(true);
    expect(parseEnv(upgraded).THOLI_WORKER_PASSWORD).toMatch(/^[a-f0-9]{48}$/);
    expect(
      Buffer.from(parseEnv(upgraded).THOLI_FILE_LINK_SECRET_KEY!, "base64url"),
    ).toHaveLength(32);
    expect(parseEnv(upgraded).STORAGE_ACCESS_KEY).toMatch(/^[a-f0-9]{48}$/);
    initializeLocalEnvironment({
      envFile,
      upgradeWorker: true,
      upgradeSupport: true,
    });
    expect(await readFile(envFile, "utf8")).toBe(upgraded);
  } finally {
    await rm(envFile, { force: true });
    await rmdir(directory);
  }
});

function composeModel() {
  const image = "registry.test/local:1@sha256:" + "a".repeat(64);
  const service = () => ({
    image,
    networks: { application: null } as Record<string, null>,
    environment: {} as Record<string, string>,
    ports: [] as { host_ip: string; published: string; target: number }[],
    volumes: [] as { type: string; source: string }[],
  });
  return {
    name: "tholi-smoke-example-1234abcd",
    services: {
      api: {
        ...service(),
        build: { context: "." },
        user: "1000:1000",
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
      },
      worker: {
        ...service(),
        build: { context: "." },
        user: "1000:1000",
        read_only: true,
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges:true"],
        networks: { database: null, application: null } as Record<string, null>,
        environment: {
          THOLI_DATABASE_WORKER_URL:
            "postgresql://tholi_worker:synthetic@postgres/tholi",
        } as Record<string, string>,
      },
      postgres: {
        ...service(),
        volumes: [{ type: "volume", source: "postgres" }],
      },
      oidc: service(),
      mail: service(),
      storage: service(),
      gateway: { ...service(), networks: { application: null, ingress: null } },
    },
    networks: {
      database: { internal: true, external: false },
      application: { internal: true, external: false },
      ingress: { internal: false, external: false },
    },
    volumes: {
      postgres: {
        name: "tholi-smoke-example-1234abcd_postgres",
        external: false,
      },
    },
  };
}

test("resolved local-stack policy returns only redacted deployment evidence", () => {
  const config = composeModel();
  config.services.postgres.environment.POSTGRES_PASSWORD =
    "local-secret-should-never-be-reported";
  config.services.gateway.ports.push({
    host_ip: "127.0.0.1",
    published: "18788",
    target: 8788,
  });
  const evidence = inspectLocalStack(config);
  expect(evidence.services).toEqual([
    "api",
    "gateway",
    "mail",
    "oidc",
    "postgres",
    "storage",
    "worker",
  ]);
  expect(evidence.ports).toEqual([
    { service: "gateway", host: "127.0.0.1", published: 18788, target: 8788 },
  ]);
  expect(evidence.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(evidence)).not.toContain(
    config.services.postgres.environment.POSTGRES_PASSWORD,
  );
  config.services.postgres.environment.POSTGRES_PASSWORD =
    "another-local-secret";
  expect(inspectLocalStack(config).fingerprint).not.toBe(evidence.fingerprint);
});

test("explicit local navigation transport remains fake and needs a boolean setting", () => {
  const config = composeModel();
  config.services.api.environment.THOLI_MODEL_PROVIDER = "fake";
  config.services.api.environment.THOLI_NAVIGATION_TRANSPORT_ENABLED = "true";
  expect(inspectLocalStack(config).services).toContain("api");
  for (const value of ["1", "yes", "TRUE", ""]) {
    config.services.api.environment.THOLI_NAVIGATION_TRANSPORT_ENABLED = value;
    expect(() => inspectLocalStack(config)).toThrow("explicit true or false");
  }
});

test.each([
  [
    "enabled telemetry without bounded logs",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.environment.THOLI_OBSERVABILITY_ENABLED = "true";
    },
  ],
  [
    "root worker",
    (config: ReturnType<typeof composeModel>) => {
      config.services.worker.user = "0:0";
    },
  ],
  [
    "worker with API credentials",
    (config: ReturnType<typeof composeModel>) => {
      config.services.worker.environment.THOLI_DATABASE_URL =
        "postgresql://tholi_runtime:secret@postgres/tholi";
    },
  ],
  [
    "worker with wrong role",
    (config: ReturnType<typeof composeModel>) => {
      config.services.worker.environment.THOLI_DATABASE_WORKER_URL =
        "postgresql://tholi_runtime:secret@postgres/tholi";
    },
  ],
  [
    "worker missing application network",
    (config: ReturnType<typeof composeModel>) => {
      delete config.services.worker.networks.application;
    },
  ],
  [
    "root API",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.user = "0:0";
    },
  ],
  [
    "writable API filesystem",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.read_only = false;
    },
  ],
  [
    "retained capabilities",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.cap_drop = [];
    },
  ],
  [
    "new privileges",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.security_opt = [];
    },
  ],
  [
    "mutable infrastructure image",
    (config: ReturnType<typeof composeModel>) => {
      config.services.oidc.image = "registry.test/oidc:latest";
    },
  ],
  [
    "external egress",
    (config: ReturnType<typeof composeModel>) => {
      config.networks.application.internal = false;
    },
  ],
  [
    "public port",
    (config: ReturnType<typeof composeModel>) => {
      config.services.gateway.ports.push({
        host_ip: "0.0.0.0",
        published: "8788",
        target: 8788,
      });
    },
  ],
  [
    "application ingress access",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.networks.ingress = null;
    },
  ],
  [
    "gateway credentials",
    (config: ReturnType<typeof composeModel>) => {
      config.services.gateway.environment.POSTGRES_PASSWORD = "must-not-leak";
    },
  ],
  [
    "direct private-service publishing",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.ports.push({
        host_ip: "127.0.0.1",
        published: "8788",
        target: 8788,
      });
    },
  ],
  [
    "provider credential",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.environment.GEMINI_API_KEY = "must-not-leak";
    },
  ],
  [
    "live model default",
    (config: ReturnType<typeof composeModel>) => {
      config.services.api.environment.THOLI_MODEL_PROVIDER = "gemini";
      config.services.api.environment.THOLI_NAVIGATION_TRANSPORT_ENABLED =
        "true";
    },
  ],
  [
    "SMTP relay",
    (config: ReturnType<typeof composeModel>) => {
      config.services.mail.environment.MP_SMTP_RELAY_HOST =
        "production-smtp.invalid";
    },
  ],
  [
    "SMTP forwarding",
    (config: ReturnType<typeof composeModel>) => {
      config.services.mail.environment.MP_SMTP_FORWARD_CONFIG =
        "/run/forward.yml";
    },
  ],
  [
    "external volume",
    (config: ReturnType<typeof composeModel>) => {
      config.volumes.postgres.external = true;
    },
  ],
  [
    "another project's volume",
    (config: ReturnType<typeof composeModel>) => {
      config.volumes.postgres.name = "developer_database";
    },
  ],
] as const)("local-stack policy rejects %s", (_name, change) => {
  const config = composeModel();
  change(config);
  expect(() => inspectLocalStack(config)).toThrow("Unsafe local stack:");
});

test("smoke cleanup requires both a disposable name and its exact allocation", () => {
  const project = "tholi-smoke-example-1234abcd";
  expect(() => assertOwnedSmokeProject(project, project)).not.toThrow();
  expect(() => assertOwnedSmokeProject("tholi-local", "tholi-local")).toThrow();
  expect(() =>
    assertOwnedSmokeProject(project, "tholi-smoke-other-1234abcd"),
  ).toThrow();
  expect(() =>
    assertOwnedSmokeProject("tholi-smoke-example-1234abcd extra", project),
  ).toThrow();
});

test("regular teardown preserves volumes and reset requires an explicit matching project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-compose-policy-"));
  const envFile = join(directory, ".env");
  const project = "tholi-policy-test";
  try {
    await writeFile(envFile, `COMPOSE_PROJECT_NAME="${project}" # local\n`);
    const options = { envFile };
    for (const action of ["migrate", "seed"] as const) {
      const commands = localStackCommands({ ...options, action });
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual(localStackArguments({ ...options, action }));
      expect(commands[1].slice(-6)).toEqual([
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "database-tools",
        action,
      ]);
    }
    expect(localStackArguments({ ...options, action: "down" })).not.toContain(
      "--volumes",
    );
    const down = localStackArguments({ ...options, action: "down" });
    expect(down[down.indexOf("--project-name") + 1]).toBe(project);
    expect(() => localStackArguments({ ...options, action: "reset" })).toThrow(
      "--confirm-delete",
    );
    expect(() =>
      localStackArguments({
        ...options,
        action: "reset",
        confirmDelete: "another-project",
      }),
    ).toThrow("--confirm-delete");
    expect(
      localStackArguments({
        ...options,
        action: "reset",
        confirmDelete: project,
      }),
    ).toContain("--volumes");
    expect(() =>
      localStackArguments({
        ...options,
        action: "up",
        selectedProfiles: ["live-gemini"],
      }),
    ).toThrow("Only the storage and telemetry profiles");
    await writeFile(envFile, "COMPOSE_PROJECT_NAME=../../bad\n");
    expect(() => localStackArguments({ ...options, action: "down" })).toThrow(
      "Compose project name",
    );
  } finally {
    if (
      !resolve(directory).startsWith(
        resolve(tmpdir()) + sep + "tholi-compose-policy-",
      )
    )
      throw new Error(
        "Refusing cleanup outside the local policy test directory.",
      );
    await rm(directory, { recursive: true, force: true });
  }
});
