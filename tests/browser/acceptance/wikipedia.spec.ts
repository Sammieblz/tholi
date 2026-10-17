import { test, expect, type Locator } from "../../support/browser-test";
import matrix from "./matrix.json" with { type: "json" };
import { openNavigatorExtension } from "../../support/navigator-extension";
import { sample, attachCase, runGoal } from "../../support/acceptance-runner";
for (const article of matrix.articles)
  test("declared Wikipedia goals: " + article, async ({}, info) => {
    const app = await openNavigatorExtension(
      info.project.use.viewport || undefined,
      [],
    );
    const errors: string[] = [];
    const attached = new Set<string>();
    try {
      await info.attach("navigator-browser-version", {
        body: Buffer.from(app.context.browser()!.version()),
        contentType: "text/plain",
      });
      await app.page.goto("https://en.wikipedia.org/wiki/" + article, {
        waitUntil: "networkidle",
      });
      await app.start();
      for (const contract of matrix.goals) {
        const result = sample(
          `${info.project.name.replace("acceptance-", "")}/${article}/${contract.id}`,
          "live",
        );
        try {
          await app.page.evaluate(() => window.scrollTo(0, 0));
          const appearance = app.page
            .getByRole("button", { name: /Appearance/ })
            .filter({ visible: true })
            .first();
          let target: Locator;
          if (["text-size", "theme", "width"].includes(contract.id)) {
            const label =
              contract.id === "text-size"
                ? "Large"
                : contract.id === "theme"
                  ? "Dark"
                  : "Wide";
            target = app.page.getByLabel(label, { exact: true });
            let opened = false;
            if (!(await target.isVisible())) {
              await appearance.click();
              opened = true;
            }
            if (contract.id === "text-size")
              await app.page.getByLabel("Small", { exact: true }).check();
            else if (contract.id === "theme")
              await app.page.getByLabel("Light", { exact: true }).check();
            else {
              const name = await target.getAttribute("name");
              const defaults = await app.page
                .getByLabel("Standard", { exact: true })
                .all();
              const standard = [];
              for (const field of defaults)
                if ((await field.getAttribute("name")) === name)
                  standard.push(field);
              expect(standard).toHaveLength(1);
              await standard[0].check();
            }
            if (opened && info.project.name.endsWith("narrow"))
              await appearance.click();
            await runGoal(app, contract, result, {
              target,
              reveal: appearance,
              selectedLabel: new RegExp("(?:^|: )" + label + "$", "i"),
              kind: "choice",
              outcome: () => target!.isChecked(),
            });
          } else if (contract.id === "section") {
            const heading = app.page.locator("#References");
            const link = app.page
              .locator('a[href="#References"]')
              .filter({ visible: true })
              .first();
            // The independent oracle accepts either the heading or its Contents link.
            const reply = await app.panel.evaluate(async () =>
              chrome.runtime.sendMessage({ type: "GET_PAGE" }),
            );
            expect(reply.page).toBeDefined();
            await runGoal(app, contract, result, {
              target: heading,
              sectionLink: link,
              reveal: app.page
                .getByRole("button", { name: /table of contents/i })
                .filter({ visible: true }),
              revealLabel: /table of contents/i,
              revealed: link,
              selectedLabel: /^(?:\d+(?:\.\d+)*[. ]*)?References$/i,
              kind: "section",
              outcome: async () => {
                const r = await heading.boundingBox();
                return (
                  !!r &&
                  r.y >= 0 &&
                  r.y + r.height <= (info.project.use.viewport?.height || 900)
                );
              },
            });
            if (
              [
                "Ada_Lovelace",
                "List_of_James_Bond_novels_and_short_stories",
              ].includes(article)
            ) {
              // The former generic live owner checked persistence immediately
              // after References, before any language-picker transition.
              await app.page.bringToFront();
              const stored = await app.panel.evaluate(() =>
                chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
              );
              expect(stored.error).toBeUndefined();
              expect(stored.memory.pages).toHaveLength(1);
            }
          } else if (contract.id === "search") {
            target = app.page
              .getByPlaceholder("Search Wikipedia", {
                exact: true,
              })
              .filter({ visible: true });
            await runGoal(app, contract, result, {
              target,
              reveal: app.page
                .locator('[role="search"] > a')
                .filter({ visible: true }),
              revealLabel: /^Search$/,
              selectedLabel: /search wikipedia/i,
              kind: "focus",
              outcome: () =>
                target!.evaluate((e) => e === document.activeElement),
            });
          } else {
            target = app.page
              .getByRole("button", { name: /\blanguages\b/i })
              .filter({ visible: true });
            await runGoal(app, contract, result, {
              target,
              selectedLabel: /\blanguages\b/i,
              kind: "expand",
              picker: true,
              outcome: async () => {
                const choices = app.page
                  .getByRole("link", { name: "Français", exact: true })
                  .filter({ visible: true });
                return (
                  (await choices.count()) > 0 &&
                  (await app.view()).goalPlan.status === "awaiting-choice"
                );
              },
            });
          }
        } catch (error) {
          errors.push(contract.id + ": " + String(error).slice(0, 240));
        } finally {
          await attachCase(info, result);
          attached.add(contract.id);
        }
      }
      expect(errors).toEqual([]);
    } catch (error) {
      // Initialization failures retain missing samples; already recorded IDs
      // must not be duplicated by a later persistence or aggregate failure.
      for (const contract of matrix.goals)
        if (!attached.has(contract.id))
          await attachCase(
            info,
            sample(
              `${info.project.name.replace("acceptance-", "")}/${article}/${contract.id}`,
              "live",
            ),
          );
      throw error;
    } finally {
      await app.close();
    }
  });
