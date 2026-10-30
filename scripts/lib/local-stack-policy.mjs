import { createHash } from "node:crypto";

const requiredServices = [
  "api",
  "worker",
  "postgres",
  "oidc",
  "mail",
  "gateway",
  "storage",
];
const credentialKeys = new Set([
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
]);

function requirePolicy(condition, message) {
  if (!condition) throw new Error("Unsafe local stack: " + message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Validate Compose's resolved JSON model, without printing environment values. */
export function inspectLocalStack(config) {
  requirePolicy(config && typeof config === "object", "missing Compose model.");
  const services = config.services || {};
  const networks = config.networks || {};
  for (const name of requiredServices)
    requirePolicy(services[name], `missing ${name} service.`);
  const api = services.api;
  requirePolicy(
    (api.environment?.THOLI_MODEL_PROVIDER || "fake") === "fake",
    "the local stack must use the fake model provider.",
  );
  for (const name of ["api", "worker"]) {
    const service = services[name];
    const user = String(service.user || "").split(":")[0];
    requirePolicy(
      user && !["0", "root"].includes(user),
      `${name} must run as a non-root user.`,
    );
    requirePolicy(
      service.read_only === true,
      `${name} root filesystem must be read-only.`,
    );
    requirePolicy(
      service.cap_drop?.includes("ALL"),
      `${name} must drop all Linux capabilities.`,
    );
    requirePolicy(
      service.security_opt?.some((option) =>
        /^no-new-privileges(?::|=)true$/.test(option),
      ),
      `${name} must disallow gaining new privileges.`,
    );
  }
  const worker = services.worker;
  requirePolicy(
    worker.image === api.image,
    "worker and API must use the same application image.",
  );
  requirePolicy(
    Object.keys(worker.networks || {}).length === 2 &&
      worker.networks.database !== undefined &&
      worker.networks.application !== undefined,
    "worker requires private database and mail/storage application networks.",
  );
  requirePolicy(
    Object.keys(worker.environment || {}).every(
      (key) =>
        [
          "NODE_ENV",
          "NODE_OPTIONS",
          "THOLI_DATABASE_WORKER_URL",
          "THOLI_DATABASE_POOL_MAX",
          "THOLI_SUPPORT_ENABLED",
        ].includes(key) ||
        ["THOLI_WORKER_", "THOLI_OBJECT_", "THOLI_SMTP_"].some((prefix) =>
          key.startsWith(prefix),
        ),
    ),
    "worker must not receive runtime, migration, identity or provider credentials.",
  );
  requirePolicy(
    new URL(worker.environment?.THOLI_DATABASE_WORKER_URL || "invalid:")
      .username === "tholi_worker",
    "local worker requires its distinct SQL role.",
  );
  const ports = [];
  const images = {};
  for (const [name, service] of Object.entries(services)) {
    requirePolicy(!service.privileged, `${name} must not be privileged.`);
    requirePolicy(
      !service.network_mode,
      `${name} must use isolated Compose networks.`,
    );
    requirePolicy(
      !service.container_name,
      `${name} must keep project-scoped container names.`,
    );
    requirePolicy(
      service.build || /^.+@sha256:[a-f0-9]{64}$/.test(service.image || ""),
      `${name} image must use an immutable digest.`,
    );
    images[name] = service.image || "local-build";
    const memberships = Object.keys(service.networks || {});
    requirePolicy(
      memberships.length > 0,
      `${name} needs an explicit isolated network.`,
    );
    for (const network of memberships)
      requirePolicy(
        networks[network] &&
          !networks[network].external &&
          (networks[network]?.internal === true ||
            (name === "gateway" && network === "ingress")),
        `${name} cannot join an external-egress network.`,
      );
    if (name === "gateway")
      requirePolicy(
        memberships.length === 2 &&
          memberships.includes("ingress") &&
          memberships.includes("application"),
        "gateway requires separate ingress and private application networks.",
      );
    for (const port of service.ports || []) {
      requirePolicy(
        name === "gateway",
        "only the local gateway may publish host ports.",
      );
      requirePolicy(
        ["127.0.0.1", "::1"].includes(port.host_ip),
        `${name} published ports must bind loopback.`,
      );
      requirePolicy(
        /^\d+$/.test(String(port.published)) &&
          Number(port.published) > 0 &&
          Number(port.published) <= 65535,
        `${name} needs one explicit host port per binding.`,
      );
      ports.push({
        service: name,
        host: port.host_ip,
        published: Number(port.published),
        target: Number(port.target),
      });
    }
    for (const [key, value] of Object.entries(service.environment || {})) {
      if (value === undefined || value === null || value === "") continue;
      requirePolicy(
        !credentialKeys.has(key),
        `${name} cannot receive cloud provider credentials.`,
      );
      if (name === "gateway")
        requirePolicy(
          !/(?:PASSWORD|SECRET|TOKEN|KEY)(?:_|$)/.test(key),
          "gateway must not receive application credentials.",
        );
      if (/^MP_SMTP_(?:RELAY|FORWARD)/.test(key))
        requirePolicy(
          key === "MP_SMTP_RELAY_ALL" &&
            [false, "false", "0", 0].includes(value),
          "mail capture must not relay or forward messages.",
        );
    }
    for (const mount of service.volumes || []) {
      if (mount.type !== "volume") continue;
      const volume = config.volumes?.[mount.source];
      requirePolicy(
        volume && !volume.external,
        `${name} requires project-owned named volumes.`,
      );
      if (volume.name)
        requirePolicy(
          volume.name.startsWith(config.name + "_"),
          `${name} volume names must stay inside the Compose project.`,
        );
    }
  }
  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify(canonical(config)))
      .digest("hex"),
    services: Object.keys(services).sort(),
    images,
    ports,
    networks: Object.keys(networks).sort(),
  };
}

/** Never allow the disposable smoke runner to tear down a developer's project. */
export function assertOwnedSmokeProject(project, allocatedProject) {
  requirePolicy(
    project === allocatedProject &&
      /^tholi-smoke-[a-z0-9]+-[a-f0-9]{8}$/.test(project),
    "smoke cleanup requires its exact allocated disposable project.",
  );
}
