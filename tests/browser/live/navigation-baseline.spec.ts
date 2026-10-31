import { test, expect } from "../../support/browser-test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import corpus from "../../fixtures/navigation-baseline/corpus.json" with { type: "json" };
import { openNavigatorExtension } from "../../support/navigator-extension";
import {
  chromiumProbe,
  runGoalContract,
  sample,
  settlePageTop,
} from "../../support/acceptance-runner";
import { prepareNavigationOracle } from "../../support/navigation-oracle";
import { registerPerceptionComparison } from "../../support/perception-comparison-runner";
import * as modelProjection from "../../../packages/goal-planner/model-context";
import { NAVIGATION_LIMITS } from "../../../packages/navigation-core/contracts-navigation";
import {
  journeySchema,
  pageSnapshotSchema,
  type PageControl,
} from "../../../packages/page-model";
import { z } from "zod";

// Keep this content-free QA boundary runnable on the unchanged product before
// the projection-report producer is introduced. It never enters model input.
const count = z.number().int().nonnegative().nullable();
const projectionReportSchema = z
  .object({
    version: z.literal(1),
    format: z.literal("legacy"),
    status: z.literal("ready"),
    counts: z
      .object({
        indexedCandidates: count,
        snapshotControls: count,
        composedControls: z.number().int().nonnegative(),
        rankedControls: count,
        projectedControls: count,
        composedRegions: count,
        projectedRegions: count,
        composedFrames: count,
        projectedFrames: count,
        compositionOmittedControls: count,
        modelOmittedControls: count,
      })
      .strict(),
    projectionBytes: count,
    partial: z.boolean(),
    reasons: z.array(
      z.enum([
        "budget",
        "inaccessible-frame",
        "privacy",
        "unsupported",
        "not-eligible",
        "partial-scan",
        "hierarchy-truncated",
        "ambiguous-control",
        "missing-perception",
        "stale-perception",
        "invalid-perception",
      ]),
    ),
  })
  .strict();

// Collection success means a measurement was acquired, not that Tholi succeeded.
// This opt-in project never participates in release certification.
test.beforeAll(async () => {
  const bytes = await readFile(
    "tests/fixtures/navigation-baseline/corpus.json",
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    (
      await readFile("tests/fixtures/navigation-baseline/corpus.sha256", "utf8")
    ).trim(),
  );
  expect(corpus.cases).toHaveLength(18);
  expect(new Set(corpus.cases.map((task) => task.id)).size).toBe(18);
});

const comparison = process.env.THOLI_BROWSER_GROUP === "perception-comparison";
if (comparison) registerPerceptionComparison();
for (const task of comparison ? [] : corpus.cases) {
  test(`${task.id}: ${task.goal}`, async ({}, info) => {
    const pregrantedOrigins =
      task.app === "github" ? ["https://github.com/*"] : [];
    const app = await openNavigatorExtension(
      corpus.viewport,
      pregrantedOrigins,
    );
    const result = sample(task.id, "live");
    const url = corpus.apps[task.app as keyof typeof corpus.apps];
    const definition = await readFile(
      "tests/fixtures/navigation-baseline/corpus.json",
    );
    const observations: Record<string, unknown>[] = [];
    let phase = "setup";
    let collectorFailure = false;
    let failure: string | undefined;
    let outcome: (() => Promise<boolean>) | undefined;
    const started = performance.now();
    const measurement: Record<string, unknown> = {
      caseId: task.id,
      split: task.split,
      goal: task.goal,
      mode: "local",
      observationProtocol: "get-page-pair-v1",
      pregrantedOrigins,
      url,
      initialState: corpus.initialState,
      viewport: corpus.viewport,
      browser: app.context.browser()!.version(),
      corpusSha256: createHash("sha256").update(definition).digest("hex"),
      protocolSha256: createHash("sha256")
        .update(
          await readFile("docs/development/testing/navigation-baseline.md"),
        )
        .digest("hex"),
      collectorSha256: createHash("sha256")
        .update(
          await readFile("tests/browser/live/navigation-baseline.spec.ts"),
        )
        .digest("hex"),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
      },
      decisionTimeoutMs: corpus.timeoutMs,
      sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      workingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
      oracle: task,
      result,
      observations,
    };
    try {
      const installed = await app.panel.evaluate(() =>
        chrome.runtime.getManifest(),
      );
      const built = JSON.parse(
        await readFile("dist/extension/manifest.json", "utf8"),
      );
      expect(installed).toEqual({
        ...built,
        host_permissions: [...built.host_permissions, ...pregrantedOrigins],
      });
      measurement.runtimeManifestSha256 = createHash("sha256")
        .update(JSON.stringify(installed))
        .digest("hex");
      const response = await app.page.goto(url, {
        waitUntil: "domcontentloaded",
      });
      expect(
        response?.ok(),
        "The public page must load before measuring navigation",
      ).toBe(true);
      const {
        target,
        reveal,
        sectionLink,
        revealed,
        label,
        matchesTarget,
        outcome: declaredOutcome,
        targetHref,
      } = await prepareNavigationOracle(
        app,
        task,
        url,
        corpus.viewport,
        corpus.timeoutMs,
      );
      outcome = declaredOutcome;
      if (targetHref) measurement.targetHref = targetHref;
      await app.page.evaluate(settlePageTop);
      await app.start();
      const probe = chromiumProbe(app);
      const observe = async (view: any) => {
        if (!view?.page) return;
        const matching = view.page.controls.filter(
          (c: PageControl) =>
            label.test(c.label) && (!matchesTarget || matchesTarget(c)),
        );
        let projection: ReturnType<typeof modelProjection.modelContext>;
        let report: z.infer<typeof projectionReportSchema> | null = null;
        let pair: any;
        let matchingPair: PageControl[];
        let serialized: string;
        let projectionBytes: number;
        let referenceIntegrity: {
          openerReferences: number;
          missingOpeners: number;
          regionReferences: number | null;
          missingRegions: number | null;
          parentReferences: number | null;
          missingParents: number | null;
        };
        try {
          pair = await app.panel.evaluate(() =>
            chrome.runtime.sendMessage({ type: "GET_PAGE" }),
          );
          if (!pair || pair.error) throw Error("Fresh page unavailable");
          pair.page = pageSnapshotSchema.parse(pair.page);
          pair.journey = pair.journey
            ? journeySchema.parse(pair.journey)
            : undefined;
          const args = [pair.page, task.goal, pair.journey, pair.perception];
          const builder = Reflect.get(modelProjection, "buildModelProjection");
          if (typeof builder === "function") {
            const built = Reflect.apply(builder, undefined, args);
            if (!built || typeof built !== "object")
              throw Error("Malformed projection result");
            projection = Reflect.get(built, "context");
            report = projectionReportSchema.parse(Reflect.get(built, "report"));
          } else {
            projection = Reflect.apply(
              modelProjection.modelContext,
              undefined,
              args,
            );
          }
          if (
            !projection ||
            !Array.isArray(projection.controls) ||
            projection.controls.some(
              (control) =>
                typeof control.id !== "string" ||
                !Array.isArray(control.revealIds) ||
                control.revealIds.some((id) => typeof id !== "string"),
            )
          )
            throw Error("Malformed projection");
          serialized = JSON.stringify(projection);
          projectionBytes = new TextEncoder().encode(serialized).length;
          if (
            report &&
            (report.projectionBytes !== projectionBytes ||
              report.counts.projectedControls !== projection.controls.length)
          )
            throw Error("Projection report does not match its payload");
          matchingPair = pair.page.controls.filter(
            (control: PageControl) =>
              label.test(control.label) &&
              (!matchesTarget || matchesTarget(control)),
          );
          const ids = new Set(projection.controls.map((control) => control.id));
          const openers = projection.controls.flatMap(
            (control) => control.revealIds,
          );
          const rawRegions: unknown = Reflect.get(projection, "regions");
          if (
            rawRegions !== undefined &&
            (!Array.isArray(rawRegions) ||
              rawRegions.some(
                (region) =>
                  !region ||
                  typeof region.id !== "string" ||
                  (region.parentId !== undefined &&
                    typeof region.parentId !== "string"),
              ))
          )
            throw Error("Malformed projected regions");
          const regions = rawRegions as
            { id: string; parentId?: string }[] | undefined;
          const regionIds =
            regions && new Set(regions.map((region) => region.id));
          const regionReferences = projection.controls.flatMap((control) => {
            const regionId = Reflect.get(control, "regionId");
            return typeof regionId === "string" ? [regionId] : [];
          });
          const parents = regions?.flatMap((region) =>
            region.parentId ? [region.parentId] : [],
          );
          referenceIntegrity = {
            openerReferences: openers.length,
            missingOpeners: openers.filter((id) => !ids.has(id)).length,
            regionReferences: regionIds ? regionReferences.length : null,
            missingRegions: regionIds
              ? regionReferences.filter((id) => !regionIds.has(id)).length
              : null,
            parentReferences: parents?.length ?? null,
            missingParents: regionIds
              ? parents!.filter((id) => !regionIds.has(id)).length
              : null,
          };
        } catch {
          collectorFailure = true;
          throw Error(
            "Fresh page projection measurement unavailable or malformed.",
          );
        }
        const selected = view.page.controls.find(
          (c: PageControl) => c.id === view.selectedControlId,
        );
        observations.push({
          elapsedMs: Math.round(performance.now() - started),
          requestId: view.request?.id,
          status: view.goalPlan?.status,
          issue: view.goalPlan?.issue,
          revision: view.page.revision,
          indexedControls: view.page.indexedControls,
          snapshotControls: view.page.controls.length,
          partial: view.page.partial,
          coverage: view.page.coverage,
          expectedInSnapshot: matching.length,
          expectedInModelContext: projection.controls.filter((c) =>
            matchingPair.some((m) => m.id === c.id),
          ).length,
          modelContextControls: projection.controls.length,
          modelContextCharacters: serialized.length,
          modelContextBytes: projectionBytes,
          modelContextWithinBudget:
            projectionBytes <= NAVIGATION_LIMITS.maxProjectionBytes,
          projectionReport: report,
          referenceIntegrity,
          getPage: {
            revision: pair.page.revision,
            indexedControls: pair.page.indexedControls,
            snapshotControls: pair.page.controls.length,
            partial: pair.page.partial,
            coverage: pair.page.coverage,
            expectedInSnapshot: matchingPair.length,
            sameOriginalRevision: pair.page.revision === view.page.revision,
            perceptionAvailable: !!pair.perception,
            perceptionMatchesPage: pair.perception
              ? pair.perception.pageRevision === pair.page.revision
              : null,
          },
          selected: selected
            ? {
                label: selected.label,
                kind: selected.kind,
                scope: selected.scope,
                destination: selected.destination,
                inViewport: selected.inViewport,
              }
            : null,
        });
      };
      phase = "navigation";
      const planningStarted = performance.now();
      await runGoalContract(
        {
          ...probe,
          setGoal: async (goal) => {
            const reply = await probe.setGoal(goal);
            expect(reply.view.embeddingActivity.llmCalls).toBe(0);
            measurement.initialPlanMs = Math.round(
              performance.now() - planningStarted,
            );
            await observe(reply.view);
            return reply;
          },
          view: async () => {
            const view = await probe.view();
            await observe(view);
            return view;
          },
        },
        { id: task.id, goal: task.goal, expected: task.target },
        result,
        {
          target,
          reveal,
          sectionLink,
          revealed,
          revealLabel:
            "reveal" in task
              ? new RegExp(`^${task.reveal}$`, "i")
              : /appearance|search/i,
          selectedLabel: label,
          matchesTarget,
          kind: task.kind,
          picker: task.kind === "expand",
          outcome,
        },
      );
    } catch (error) {
      failure = String(error).slice(0, 6000);
      measurement.failure = failure;
      if (phase === "setup" || collectorFailure) throw error;
    } finally {
      try {
        const actual = await outcome?.().catch(() => undefined);
        const final = await app.view().catch(() => undefined);
        measurement.final = final
          ? {
              requestId: final.request?.id,
              requestStatus: final.request?.status,
              journeyStatus: final.journey?.status,
              planStatus: final.goalPlan?.status,
              verifiedSteps: final.verifiedSteps,
            }
          : null;
        if (
          actual === false &&
          !!final?.request?.id &&
          final?.request?.id === observations[0]?.requestId &&
          (final.goalPlan?.status === "completed" ||
            final.request?.status === "completed")
        )
          result.falseSuccess = Math.max(1, result.falseSuccess);
        measurement.outcome = actual ?? null;
        measurement.collection =
          phase === "setup" || collectorFailure ? "blocked" : "measured";
        measurement.collectorFailure = collectorFailure;
        measurement.navigation =
          result.completed && !failure ? "completed" : "failed";
        measurement.elapsedMs = Math.round(performance.now() - started);
        // Missing snapshots on partial pages cannot distinguish discovery from
        // bounded projection. Preserve the uncertainty rather than guess.
        const last = observations.at(-1);
        measurement.failureStage = !failure
          ? null
          : phase === "setup" || collectorFailure
            ? "infrastructure"
            : last?.expectedInSnapshot === 0
              ? last.partial
                ? "discovery-or-projection"
                : "discovery"
              : result.targets.includes(false)
                ? "interpretation"
                : result.targets.length && actual
                  ? "verification"
                  : "needs-review";
        await info.attach("navigation-baseline", {
          body: Buffer.from(JSON.stringify(measurement)),
          contentType: "application/json",
        });
      } finally {
        await app.close();
      }
    }
  });
}
