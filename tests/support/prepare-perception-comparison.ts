import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { evaluationProvenance } from "../../apps/api/src/evaluation-provenance";
import {
  operatorEvaluationManifestSha256,
  operatorEvaluationSha256,
  OPERATOR_EVALUATION_LIMITS,
} from "../../packages/navigation-core/contracts-evaluation";
import { serviceOrigin } from "../../packages/navigation-core/service-client";
import {
  buildComparisonPlan,
  comparisonHostPermissions,
} from "./perception-comparison";
import {
  permissionVariant,
  cleanupPermissionVariants,
} from "./permission-variant";
import { readNativeEvaluationSession } from "./evaluation-session";

/** Preparation reads an existing native session; it never signs in or calls a model. */
async function prepare() {
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      "session-file": { type: "string" },
      origin: { type: "string" },
      output: { type: "string" },
    },
  });
  if (
    !["fake", "vertex"].includes(values.provider || "") ||
    !values["session-file"] ||
    !values.origin ||
    !values.output
  )
    throw Error(
      "Explicit provider, native session, loopback origin and new output file are required.",
    );
  const origin = serviceOrigin(values.origin);
  if (new URL(origin).hostname !== "127.0.0.1")
    throw Error("The evaluation origin must remain on loopback.");
  const session = await readNativeEvaluationSession(values["session-file"]);
  if (
    session.serviceOrigin !== origin ||
    Date.parse(session.tokens.sessionExpiresAt) <= Date.now()
  )
    throw Error(
      "An active native operator session for this evaluation origin is required.",
    );
  const provenance = await evaluationProvenance();
  if (values.provider === "vertex" && !provenance.clean)
    throw Error("Live plan preparation requires committed, unchanged source.");
  const variant = await permissionVariant(comparisonHostPermissions(origin), {
    persistent: true,
  });
  const manifest = JSON.parse(
    await readFile(join(variant, "manifest.json"), "utf8"),
  );
  // Import the already-built entry as its own ESM module, preserving its main
  // guard instead of bundling CLI side effects into this preparation tool.
  const { MODEL_PRICE_REVISION } = await import(
    pathToFileURL(resolve("apps/api/dist/model-experiment.js")).href
  );
  const createdAtMs = Date.now();
  const provider = values.provider as "fake" | "vertex";
  const plan = buildComparisonPlan({
    version: 1,
    profile: "operator-evaluation",
    id: randomUUID(),
    provider,
    createdAtMs,
    expiresAtMs: createdAtMs + OPERATOR_EVALUATION_LIMITS.maxApprovalLifetimeMs,
    sourceRevision: provenance.sourceRevision,
    operator: {
      accountId: session.tokens.account.id,
      workspaceId: session.tokens.account.workspaceId,
      clientId: session.clientId,
    },
    hashes: {
      ...provenance.hashes,
      runtimeManifestSha256: await operatorEvaluationManifestSha256(manifest),
    },
    model: {
      api: "v1",
      project: process.env.THOLI_MODEL_PROJECT || "tholi-dev-ilunonsen",
      location: "global",
      id: provider === "fake" ? "tholi-deterministic-v1" : "gemini-3.8-flash",
      retentionProfile: "provider-default-acknowledged",
      priceRevision: MODEL_PRICE_REVISION,
    },
    budget: {
      maxInputTokens: 32768,
      maxOutputTokens: 2048,
      allowanceUsdMicros: 4900000,
    },
  });
  const raw = JSON.stringify(plan, null, 2) + "\n";
  await mkdir(dirname(resolve(values.output)), { recursive: true });
  await writeFile(values.output, raw, { flag: "wx" });
  process.stdout.write(
    JSON.stringify({
      planSha256: await operatorEvaluationSha256(raw),
      provider,
      configuredTrials: plan.trials.length,
      maxGenerations: plan.maxGenerations,
      cleanSource: provenance.clean,
      qualityCollectionAuthorized: false,
    }) + "\n",
  );
}
try {
  await prepare();
} catch {
  process.stderr.write(
    "Evaluation plan preparation refused. Check explicit inputs and current build provenance.\n",
  );
  process.exitCode = 1;
} finally {
  await cleanupPermissionVariants();
}
