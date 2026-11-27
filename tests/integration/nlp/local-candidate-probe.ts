import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import os from "node:os";
import {
  MiniLM,
  SemanticIndex,
  MemoryDerivedStore,
} from "../../../packages/nlp";
import { localRankingProfile } from "../../../packages/nlp/profiles";
import { interpretRequest } from "../../../packages/nlp/interpret";
import { fixture } from "./fixtures";

const lock = JSON.parse(
  await readFile("assets/local-candidates-lock.json", "utf8"),
);
for (const profile of lock.profiles)
  for (const [name, entry] of Object.entries(profile.files) as [
    string,
    { bytes: number; sha256: string },
  ][]) {
    const bytes = await readFile(
      resolve("assets/local-candidates", profile.model, name),
    );
    if (
      bytes.byteLength !== entry.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      throw new Error("Candidate assets failed integrity verification.");
  }
// This probe never admits a cloud provider or discovers remote model assets.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("EXTERNAL_NETWORK_DISABLED");
};
const requests = [
  ["Find account settings", "Settings"],
  ["Show notification preferences", "Notifications"],
  ["Find help", "Help"],
  ["Open contact", "Contact"],
  ["View history", "View history"],
] as const;
const results = [];
try {
  for (const id of ["baseline", "bge-small", "e5-small"] as const) {
    const profile = localRankingProfile(id, true),
      model = new MiniLM(
        resolve(
          id === "baseline" ? "assets/models" : "assets/local-candidates",
        ) + "/",
        undefined,
        profile,
      );
    const index = new SemanticIndex(model, new MemoryDerivedStore()),
      started = performance.now();
    const measurements = [];
    try {
      await model.embed(["offline qualification startup"]);
      const coldMs = performance.now() - started;
      for (const [request, expected] of requests) {
        const started = performance.now(),
          task = interpretRequest(request).tasks[0];
        const ranked = await index.rank(fixture(), task);
        measurements.push({
          expected,
          selected: ranked.find((r) => r.eligible)?.control.label,
          elapsedMs: performance.now() - started,
        });
      }
      results.push({
        id,
        revision: index.modelRevision,
        coldMs,
        measurements,
        rssBytes: process.memoryUsage().rss,
      });
    } finally {
      await model.dispose();
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}
await mkdir("output/qa/local-candidates", { recursive: true });
await writeFile(
  "output/qa/local-candidates/ranking-probe.json",
  JSON.stringify(
    {
      schemaVersion: 1,
      purpose:
        "Calibration probe only. Not a task-completion, 8 GB, browser or vision qualification.",
      os: process.platform,
      arch: process.arch,
      node: process.version,
      hostMemoryBytes: os.totalmem(),
      externalModelCalls: 0,
      promoted: false,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Local candidate calibration collected. Production promotion remains disabled.",
);
