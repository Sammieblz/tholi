import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const profiles = new Set(["storage", "telemetry"]);
const actions = new Set([
  "up",
  "down",
  "status",
  "logs",
  "migrate",
  "seed",
  "reset",
]);

function projectName(value) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value))
    throw new Error(
      "Use a lowercase Compose project name containing letters, numbers, _ or -.",
    );
  return value;
}

/** Create local-only credentials once. Never overwrite existing state or print secrets. */
export function initializeLocalEnvironment({
  envFile,
  project,
  ports = {},
  upgradeIdentity = false,
  upgradeWorker = false,
}) {
  let template = readFileSync(resolve(root, ".env.example"), "utf8");
  template = template.replace(
    /^([A-Z_]*(?:_PASSWORD|_SECRET_KEY)|STORAGE_ACCESS_KEY)=.*$/gm,
    (_, name) =>
      `${name}=${
        name === "THOLI_IDENTITY_FLOW_SECRET_KEY"
          ? randomBytes(32).toString("base64url")
          : randomBytes(24).toString("hex")
      }`,
  );
  const overrides = {
    ...(project ? { COMPOSE_PROJECT_NAME: projectName(project) } : {}),
    ...ports,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (
      name !== "COMPOSE_PROJECT_NAME" &&
      (!/^(API|OIDC|MAIL|STORAGE)_HOST_PORT$/.test(name) ||
        !/^\d+$/.test(String(value)) ||
        Number(value) < 1 ||
        Number(value) > 65535)
    )
      throw new Error("Invalid local environment override.");
    const pattern = new RegExp(`^${name}=.*$`, "m");
    if (!pattern.test(template))
      throw new Error(`Missing local setting: ${name}.`);
    template = template.replace(pattern, `${name}=${value}`);
  }
  const target = resolve(envFile);
  mkdirSync(dirname(target), { recursive: true });
  if (upgradeIdentity || upgradeWorker) {
    if (!existsSync(target))
      throw new Error("Initialize the local environment before upgrading it.");
    const existing = readFileSync(target, "utf8");
    const settings = parseEnv(existing);
    const additions = template.split(/\r?\n/).filter((line) => {
      const name = line.slice(0, line.indexOf("="));
      return (
        ((upgradeIdentity && name.startsWith("THOLI_IDENTITY_")) ||
          (upgradeWorker && name === "THOLI_WORKER_PASSWORD")) &&
        !(name in settings)
      );
    });
    if (additions.length)
      writeFileSync(
        target,
        `${existing}${existing.endsWith("\n") ? "" : "\n"}${additions.join("\n")}\n`,
        { mode: 0o600 },
      );
    return { envFile: target };
  }
  writeFileSync(target, template, { flag: "wx", mode: 0o600 });
  return { envFile: target };
}

/** Shared, import-safe command construction. Destructive teardown requires the project name. */
export function localStackArguments({
  action,
  envFile = resolve(root, ".env"),
  project,
  selectedProfiles = [],
  confirmDelete,
}) {
  if (!actions.has(action)) throw new Error("Unknown local stack action.");
  if (selectedProfiles.some((profile) => !profiles.has(profile)))
    throw new Error("Only the storage and telemetry profiles are supported.");
  const settings = parseEnv(readFileSync(envFile, "utf8"));
  const name = projectName(
    project ?? settings.COMPOSE_PROJECT_NAME ?? "tholi-local",
  );
  const args = [
    "compose",
    "--project-directory",
    root,
    "--env-file",
    resolve(envFile),
    "--project-name",
    name,
    "-f",
    resolve(root, "compose.yaml"),
  ];
  // Teardown includes optional services even if they were started in a different invocation.
  for (const profile of ["down", "reset"].includes(action)
    ? [...profiles]
    : selectedProfiles)
    args.push("--profile", profile);
  switch (action) {
    case "up":
      args.push("up", "--build", "--detach", "--wait", "--wait-timeout", "240");
      break;
    case "down":
      args.push("down", "--remove-orphans");
      break;
    case "status":
      args.push("ps");
      break;
    case "logs":
      args.push("logs", "--tail", "100");
      break;
    case "migrate":
      args.push(
        "exec",
        "-T",
        "postgres",
        "sh",
        "/docker-entrypoint-initdb.d/bootstrap.sh",
      );
      break;
    case "seed":
      args.push("exec", "-T", "oidc", "bash", "/opt/keycloak/data/seed.sh");
      break;
    case "reset":
      if (confirmDelete !== name)
        throw new Error(
          `Data deletion requires --confirm-delete ${name}. This removes this project's database, identity, mail and storage volumes.`,
        );
      args.push("down", "--remove-orphans", "--volumes");
      break;
  }
  return args;
}

/** Infrastructure bootstrap stays separate from versioned application migrations. */
export function localStackCommands(options) {
  const commands = [localStackArguments(options)];
  if (["migrate", "seed"].includes(options.action)) {
    const base = localStackArguments({ ...options, action: "status" }).slice(
      0,
      -1,
    );
    commands.push([
      ...base,
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "database-tools",
      options.action,
    ]);
  }
  return commands;
}

function main(args) {
  const [action, ...flags] = args;
  const options = { action, selectedProfiles: [] };
  for (let i = 0; i < flags.length; i += 2) {
    const value = flags[i + 1];
    if (!value || value.startsWith("--"))
      throw new Error("Every option requires a value.");
    switch (flags[i]) {
      case "--env-file":
        options.envFile = resolve(value);
        break;
      case "--project":
        options.project = value;
        break;
      case "--profile":
        options.selectedProfiles.push(value);
        break;
      case "--confirm-delete":
        options.confirmDelete = value;
        break;
      case "--upgrade-identity":
        if (action !== "init" || value !== "true")
          throw new Error(
            "Identity environment upgrades require init --upgrade-identity true.",
          );
        options.upgradeIdentity = true;
        break;
      case "--upgrade-worker":
        if (action !== "init" || value !== "true")
          throw new Error(
            "Worker environment upgrades require init --upgrade-worker true.",
          );
        options.upgradeWorker = true;
        break;
      default:
        throw new Error(`Unknown option: ${flags[i]}.`);
    }
  }
  if (action === "init") {
    const result = initializeLocalEnvironment({
      ...options,
      envFile: options.envFile ?? resolve(root, ".env"),
    });
    console.log(
      `${options.upgradeIdentity || options.upgradeWorker ? "Updated missing local settings in" : "Created"} ${result.envFile}. Keep local credentials private.`,
    );
    return;
  }
  for (const command of localStackCommands(options)) {
    const result = spawnSync("docker", command, {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error)
      throw new Error(
        "Docker could not start. Install Docker with Compose and start its Linux engine.",
      );
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
