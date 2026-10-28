import { test, expect, type Locator } from "../../support/browser-test";
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
import { modelContext } from "../../../packages/goal-planner/model-context";
import type { PageControl } from "../../../packages/page-model";

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

for (const task of corpus.cases) {
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
    let failure: string | undefined;
    let outcome: (() => Promise<boolean>) | undefined;
    const started = performance.now();
    const measurement: Record<string, unknown> = {
      caseId: task.id,
      split: task.split,
      goal: task.goal,
      mode: "local",
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
      let target: Locator;
      let reveal: Locator | undefined;
      let sectionLink: Locator | undefined;
      let revealed: Locator | undefined;
      let label = new RegExp(`^${task.target}(?:\\s|$)`, "i");
      let matchesTarget: ((control: PageControl) => boolean) | undefined;
      if (task.app === "github") {
        // GitHub repeats destinations with different labels (for example a
        // LICENSE.txt file link and a license tab). Either is a valid route.
        label = /\S/;
        const path = "path" in task ? task.path : "";
        target = app.page
          .locator(`a[href="${path}"]`)
          .filter({ visible: true })
          .first();
        outcome = async () =>
          new URL(app.page.url()).origin === "https://github.com" &&
          new URL(app.page.url()).pathname === path &&
          (await app.page.locator("main").isVisible());
        matchesTarget = (control) =>
          control.destination?.origin === "https://github.com" &&
          control.destination.path === path;
      } else if (task.kind === "choice") {
        label = new RegExp(`(?:^|: )${task.target}$`, "i");
        target = app.page.getByLabel(task.target, { exact: true });
        reveal = app.page
          .getByRole("button", { name: /Appearance/ })
          .filter({ visible: true })
          .first();
        const hidden = !(await target.isVisible());
        if (hidden) await reveal.click();
        const initial = app.page.getByLabel(task.initialChoice ?? "", {
          exact: true,
        });
        // Wikipedia uses "Standard" for both width and font size.
        const name = await target.getAttribute("name");
        const choices = await initial.all();
        const sameGroup = [];
        for (const choice of choices)
          if ((await choice.getAttribute("name")) === name)
            sameGroup.push(choice);
        expect(sameGroup).toHaveLength(1);
        await sameGroup[0].check();
        if (hidden) await reveal.click();
        outcome = () => target.isChecked();
      } else if (task.kind === "section") {
        target = app.page.locator(`#${task.target}`);
        sectionLink = app.page
          .locator(`a[href="#${task.target}"]`)
          .filter({ visible: true })
          .first();
        label = new RegExp(`^(?:\\d+(?:\\.\\d+)*[. ]*)?${task.target}$`, "i");
        outcome = async () => {
          const box = await target.boundingBox();
          return (
            !!box && box.y >= 0 && box.y + box.height <= corpus.viewport.height
          );
        };
      } else if (task.kind === "focus") {
        target = app.page
          .getByPlaceholder("Search Wikipedia", { exact: true })
          .filter({ visible: true });
        reveal = app.page
          .locator('[role="search"] > a')
          .filter({ visible: true });
        outcome = () =>
          target.evaluate((element) => element === document.activeElement);
      } else if (task.kind === "expand") {
        target = app.page
          .getByRole("button", { name: /languages/i })
          .filter({ visible: true })
          .first();
        label = /languages/i;
        outcome = async () =>
          (await app.page
            .getByRole("link", { name: "Français", exact: true })
            .filter({ visible: true })
            .count()) > 0;
      } else {
        target = app.page
          .getByRole("link", {
            name: task.target,
            exact: true,
            includeHidden: true,
          })
          .first();
        const query = new URLSearchParams("query" in task ? task.query : "");
        outcome = async () => {
          const actual = new URL(app.page.url());
          return (
            actual.origin === new URL(url).origin &&
            [...query].every(([k, v]) => actual.searchParams.get(k) === v) &&
            (await app.page.locator("main").isVisible())
          );
        };
        matchesTarget = (control) =>
          control.destination?.origin === new URL(url).origin &&
          control.destination.path === "/w/index.php";
        if ("reveal" in task) {
          reveal = app.page
            .getByRole("button", { name: task.reveal, exact: true })
            .filter({ visible: true });
          revealed = target;
        }
      }
      await expect(
        target,
        "The declared independent target must exist",
      ).toHaveCount(1, { timeout: corpus.timeoutMs });
      if (task.kind === "navigation") {
        const href = new URL((await target.getAttribute("href"))!, url);
        measurement.targetHref = href.href;
        if ("query" in task)
          for (const [key, value] of new URLSearchParams(task.query))
            expect(href.searchParams.get(key)).toBe(value);
      }
      await app.page.evaluate(settlePageTop);
      await app.start();
      const probe = chromiumProbe(app);
      const observe = (view: any) => {
        if (!view?.page) return;
        const matching = view.page.controls.filter(
          (c: PageControl) =>
            label.test(c.label) && (!matchesTarget || matchesTarget(c)),
        );
        const projection = modelContext(view.page, task.goal, view.journey);
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
            matching.some((m: PageControl) => m.id === c.id),
          ).length,
          modelContextControls: projection.controls.length,
          modelContextCharacters: JSON.stringify(projection).length,
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
            observe(reply.view);
            return reply;
          },
          view: async () => {
            const view = await probe.view();
            observe(view);
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
      if (phase === "setup") throw error;
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
        measurement.collection = phase === "setup" ? "blocked" : "measured";
        measurement.navigation =
          result.completed && !failure ? "completed" : "failed";
        measurement.elapsedMs = Math.round(performance.now() - started);
        // Missing snapshots on partial pages cannot distinguish discovery from
        // bounded projection. Preserve the uncertainty rather than guess.
        const last = observations.at(-1);
        measurement.failureStage = !failure
          ? null
          : phase === "setup"
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
