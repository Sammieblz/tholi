import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { inspectBackendPromotionSource } from "./lib/backend-delivery.mjs";

try {
  const repository = process.env.GITHUB_REPOSITORY;
  const sourceSha = process.env.GITHUB_SHA;
  const run = process.env.BACKEND_SOURCE_RUN;
  const target = process.env.BACKEND_PROMOTION_TARGET;
  assert.match(repository || "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(run || "", /^[1-9][0-9]{0,15}$/);
  assert.ok(
    [
      "vm-staging",
      "google-staging",
      "vm-production",
      "google-production",
    ].includes(target),
  );
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  const get = async (path) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    assert.equal(response.status, 200);
    assert.ok(Number(response.headers.get("content-length") || 0) <= 1048576);
    return response.json();
  };
  // Missing/unprotected environments fail before GitHub could implicitly create one.
  const result = inspectBackendPromotionSource(
    await get(`actions/runs/${run}`),
    await get(`environments/backend-${target}`),
    { repository, sourceSha, target },
  );
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `artifact=${result.artifact}\nimage_artifact=${result.imageArtifact}\nrun_id=${result.runId}\nenvironment=${result.environment}\n`,
  );
} catch {
  console.error(
    "Promotion review refused: require a matching successful main full run and an existing protected review environment.",
  );
  process.exitCode = 1;
}
