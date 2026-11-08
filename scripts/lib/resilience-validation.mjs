import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnedSmokeProject } from "./local-stack-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
/** Extends the owned local smoke. No Docker socket, credentials or user profiles enter test output. */
export async function runResilienceChecks({
  docker,
  base,
  project,
  config,
  image,
  testImage,
  settings,
}) {
  assertOwnedSmokeProject(project, project);
  const replicaBase = [
    ...base,
    "--file",
    resolve(root, "infra/local/compose.replicas.yaml"),
  ];
  const compose = (args, timeout = 60000) =>
    docker([...replicaBase, ...args], timeout);
  const name = `${project}-resilience`;
  const containers = Object.fromEntries(
    ["api", "worker"].map((service) => [
      service,
      [1, 2].map((index) => `${project}-${service}-${index}`),
    ]),
  );
  const owned = async (container) => {
    assert.ok(
      Object.values(containers).flat().includes(container) ||
        container === name,
    );
    const inspected = JSON.parse(await docker(["inspect", container]))[0];
    assert.equal(
      inspected.Config.Labels["com.docker.compose.project"] ??
        inspected.Config.Labels["io.tholi.qa.owner"],
      project,
    );
    return inspected;
  };
  const ready = async (container) => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const state = (await owned(container)).State;
      if (state.Health?.Status === "healthy") return;
      if (state.Status !== "running")
        throw Error("Owned replica stopped unexpectedly.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Error("Owned replica readiness deadline exceeded.");
  };
  let coordinatorCreated = false;
  const paused = new Set();
  try {
    assert.equal(
      (
        await docker([
          "ps",
          "--all",
          "--filter",
          `name=^${name}$`,
          "--format",
          "{{.ID}}",
        ])
      ).trim(),
      "",
    );
    await compose(
      [
        "up",
        "--no-build",
        "--detach",
        "--wait",
        "--wait-timeout",
        "120",
        "api",
        "worker",
      ],
      180000,
    );
    const replicas = await Promise.all(
      Object.values(containers).flat().map(owned),
    );
    assert.equal(replicas.length, 4);
    assert.ok(replicas.every((replica) => replica.Image === image));
    const hardware = JSON.parse(
      await docker(["info", "--format", "{{json .}}"]),
    );
    const connection = (role, password) =>
      `postgresql://${role}:${encodeURIComponent(password)}@postgres:5432/tholi`;
    await docker(
      [
        "run",
        "--detach",
        "--name",
        name,
        "--label",
        `io.tholi.qa.owner=${project}`,
        "--network",
        config.networks.database.name,
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=1m,mode=1777",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--memory",
        "384m",
        "--cpus",
        "1",
        "--pids-limit",
        "64",
        "--env",
        "THOLI_DATABASE_URL",
        "--env",
        "THOLI_DATABASE_MIGRATION_URL",
        "--env",
        "THOLI_RESILIENCE_ORIGINS",
        testImage,
        "node",
        "/app/postgres-check.mjs",
        "--resilience-runtime-probe",
      ],
      30000,
      {
        THOLI_DATABASE_URL: connection(
          "tholi_runtime",
          settings.THOLI_DB_PASSWORD,
        ),
        THOLI_DATABASE_MIGRATION_URL: connection(
          "tholi_migrator",
          settings.THOLI_MIGRATION_PASSWORD,
        ),
        THOLI_RESILIENCE_ORIGINS: JSON.stringify(
          containers.api.map((host) => `http://${host}:8788`),
        ),
      },
    );
    coordinatorCreated = true;
    const phases = [
      "api-1-stopped",
      "api-1-restored",
      "api-2-stopped",
      "api-2-restored",
      "competition-workers-paused",
      "competition-workers-resumed",
      "workers-paused",
      "workers-resumed",
      "worker-1-stopped",
      "worker-1-restored",
      "worker-2-stopped",
      "worker-2-restored",
      "apis-stopped-for-fault-fixture",
      "apis-restored-after-fault-fixture",
    ];
    for (const phase of phases) {
      const deadline = Date.now() + 90000;
      let found = false;
      while (Date.now() < deadline) {
        const logs = await docker(["logs", name]);
        if (
          logs.split(/\r?\n/).some((line) => line === JSON.stringify({ phase }))
        ) {
          found = true;
          break;
        }
        if ((await owned(name)).State.Status !== "running")
          throw Error("Resilience coordinator stopped before " + phase + ".");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(found, "Missing bounded resilience phase " + phase);
      const replica = /^(api|worker)-([12])-(stopped|restored)$/.exec(phase);
      if (replica) {
        const container = containers[replica[1]][Number(replica[2]) - 1];
        await owned(container);
        if (replica[3] === "stopped")
          await docker(["stop", "--time", "10", container], 20000);
        else {
          await docker(["start", container]);
          await ready(container);
        }
      } else if (
        ["workers-paused", "competition-workers-paused"].includes(phase)
      ) {
        for (const container of containers.worker) {
          await owned(container);
          await docker(["pause", container]);
          paused.add(container);
        }
      } else if (
        ["workers-resumed", "competition-workers-resumed"].includes(phase)
      ) {
        for (const container of paused) {
          await owned(container);
          await docker(["unpause", container]);
          paused.delete(container);
        }
      } else if (phase === "apis-stopped-for-fault-fixture") {
        for (const container of containers.api) {
          await owned(container);
          await docker(["stop", "--time", "10", container], 20000);
        }
      } else if (phase === "apis-restored-after-fault-fixture") {
        for (const container of containers.api) {
          await owned(container);
          await docker(["start", container]);
          await ready(container);
        }
      }
      await docker([
        "exec",
        name,
        "node",
        "--input-type=module",
        "-e",
        `import {writeFileSync} from 'node:fs';writeFileSync('/tmp/tholi-resilience-${phase}','ready',{flag:'wx',mode:0o600});`,
      ]);
    }
    const deadline = Date.now() + 60000;
    while ((await owned(name)).State.Running) {
      assert.ok(
        Date.now() < deadline,
        "Resilience coordinator completion deadline.",
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const state = (await owned(name)).State;
    const logs = await docker(["logs", name]);
    assert.equal(state.ExitCode, 0, "Resilience coordinator failed.");
    const report = logs
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((item) => item.passed === true);
    assert.ok(report?.checks.length >= 10);
    return {
      ...report,
      image,
      hardware: {
        operatingSystem: hardware.OperatingSystem,
        architecture: hardware.Architecture,
        cpus: hardware.NCPU,
        memoryBytes: hardware.MemTotal,
        dockerServer: hardware.ServerVersion,
      },
      replicas: replicas.map((replica) => ({
        role: replica.Config.Labels["com.docker.compose.service"],
        image: replica.Image,
        memoryBytes: replica.HostConfig.Memory,
        cpuNano: replica.HostConfig.NanoCpus,
      })),
      nativeCloud: false,
    };
  } catch (error) {
    if (coordinatorCreated) {
      const logs = await docker(["logs", name]);
      const stages = logs
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{"failedStage":'))
        .map((line) => JSON.parse(line).failedStage);
      const statuses = logs
        .split(/\r?\n/)
        .filter((line) => line.startsWith('{"httpFailure":'))
        .map((line) => JSON.parse(line).httpFailure)
        .filter(
          (value) =>
            ["GET", "POST", "PATCH", "DELETE"].includes(value.method) &&
            Number.isInteger(value.status) &&
            Number.isInteger(value.expected) &&
            [0, 1].includes(value.replica),
        );
      if (
        stages.length &&
        stages.every((stage) => /^[a-z-]{1,80}$/.test(stage))
      )
        throw Error(
          "Resilience coordinator failed at " +
            stages.join(", ") +
            "." +
            (statuses.length ? " HTTP " + JSON.stringify(statuses) : ""),
        );
    }
    throw error;
  } finally {
    for (const container of paused) {
      await owned(container);
      await docker(["unpause", container]);
    }
    if (coordinatorCreated) {
      await owned(name);
      await docker(["rm", "--force", name]);
    }
  }
}
