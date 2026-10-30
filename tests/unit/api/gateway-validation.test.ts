import { expect, it, vi } from "vitest";
import {
  inspectVmGateway,
  runGatewayChecks,
} from "../../../scripts/lib/gateway-validation.mjs";

const image =
  "nginx/nginx-unprivileged:1.30.6-alpine-slim@sha256:" + "a".repeat(64);
const base = {
  services: { gateway: { image }, api: { image: "existing-api:dev" } },
};
const resolved = () => ({
  services: {
    gateway: {
      image,
      user: "101:101",
      read_only: true,
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      ports: [
        { target: 8080, published: "80" },
        { target: 8443, published: "443" },
      ],
      volumes: [
        "nginx.conf",
        "tholi-proxy.conf",
        "tholi-api.conf",
        "tholi-upstream.conf",
        "tls",
      ].map((name) => ({
        type: "bind",
        read_only: true,
        target: `/etc/nginx/${name}`,
        source: "/operator/private",
      })),
    },
    api: { image: "existing-api:dev" },
    postgres: {},
    oidc: {},
    mail: {},
    storage: {},
  },
});

it("validates the resolved VM ingress boundary while keeping credentials out of evidence", () => {
  const config = resolved();
  expect(inspectVmGateway(config, base)).toEqual({
    image,
    apiImage: "existing-api:dev",
    targets: [8080, 8443],
  });
  expect(JSON.stringify(inspectVmGateway(config, base))).not.toContain(
    "/operator/private",
  );
});

it.each([
  "root",
  "writable",
  "capabilities",
  "privileges",
  "extra-port",
  "private-port",
  "different-api",
  "writable-cert",
  "extra-mount",
])("rejects unsafe resolved VM configuration: %s", (condition) => {
  const config = resolved();
  const gateway = config.services.gateway;
  if (condition === "root") gateway.user = "0:0";
  if (condition === "writable") gateway.read_only = false;
  if (condition === "capabilities") gateway.cap_drop = [];
  if (condition === "privileges") gateway.security_opt = [];
  if (condition === "extra-port")
    gateway.ports.push({ target: 18333, published: "18333" });
  if (condition === "private-port")
    Object.assign(config.services.postgres, {
      ports: [{ target: 5432, published: "5432" }],
    });
  if (condition === "different-api")
    config.services.api.image = "parallel-api:new";
  if (condition === "writable-cert") gateway.volumes.at(-1)!.read_only = false;
  if (condition === "extra-mount")
    gateway.volumes.push({
      type: "bind",
      read_only: true,
      target: "/var/run/docker.sock",
      source: "/operator/private",
    });
  expect(() => inspectVmGateway(config, base)).toThrow(
    "preserve private services",
  );
});

it("refuses gateway QA mutation outside its disposable project network", async () => {
  const docker = vi.fn(async () => ""),
    compose = vi.fn(async () => "");
  await expect(
    runGatewayChecks({
      docker,
      compose,
      config: {
        name: "tholi-smoke-example-1234abcd",
        networks: {
          application: { name: "someone-else_application", internal: true },
        },
        services: {
          ...base.services,
          api: { ...base.services.api, environment: {} },
        },
      },
      project: "tholi-smoke-example-1234abcd",
      directory: "/unused",
      envFile: "/unused",
    }),
  ).rejects.toThrow();
  expect(docker).not.toHaveBeenCalled();
  expect(compose).not.toHaveBeenCalled();
});

it("never reuses or removes a pre-existing standalone gateway check container", async () => {
  const project = "tholi-smoke-example-1234abcd";
  const docker = vi.fn(async (_args: string[]) => `${project}-tls-gateway\n`),
    compose = vi.fn(async () => "");
  await expect(
    runGatewayChecks({
      docker,
      compose,
      config: {
        name: project,
        networks: {
          application: { name: `${project}_application`, internal: true },
        },
        services: {
          ...base.services,
          api: { ...base.services.api, environment: {} },
        },
      },
      project,
      directory: "/unused",
      envFile: "/unused",
    }),
  ).rejects.toThrow("already in use");
  expect(docker).toHaveBeenCalledTimes(1);
  expect(docker.mock.calls[0][0][0]).toBe("ps");
  expect(compose).not.toHaveBeenCalled();
});
