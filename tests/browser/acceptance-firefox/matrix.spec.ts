import { test, expect } from "../../support/browser-test";
import matrix from "../acceptance/matrix.json" with { type: "json" };
import { openFirefoxExtension } from "../../support/firefox-extension";
import { acceptanceServer } from "../../support/fixture-server";
import {
  firefoxOracle,
  firefoxProbe,
  resetFirefoxPreference,
} from "../../support/firefox-acceptance";
import {
  sample,
  attachCase,
  runGoalContract,
  runNegativeContract,
  settlePageTop,
} from "../../support/acceptance-runner";
for (const article of ["fixture", ...matrix.articles])
  test("declared Firefox goals: " + article, async ({}, info) => {
    const fixture =
      article === "fixture" ? await acceptanceServer() : undefined;
    const url = fixture?.url || "https://en.wikipedia.org/wiki/" + article;
    let app: Awaited<ReturnType<typeof openFirefoxExtension>> | undefined;
    const errors: string[] = [],
      attached = new Set<string>();
    const name = info.project.name.replace("acceptance-firefox-", "");
    try {
      app = await openFirefoxExtension(
        url,
        info.project.use.viewport || undefined,
      );
      const current = app,
        probe = firefoxProbe(app);
      await info.attach("navigator-browser-version", {
        body: Buffer.from("Firefox " + app.version),
        contentType: "text/plain",
      });
      await app.start();
      for (const contract of matrix.goals) {
        const result = sample(
          `${name}/${article}/${contract.id}`,
          article === "fixture" ? "fixture" : "live",
        );
        try {
          if (article === "fixture") {
            await app.message({ type: "STOP" });
            await app.visit(url);
            await app.start();
          }
          await app.site(settlePageTop);
          if (article !== "fixture")
            await resetFirefoxPreference(app, contract.id, name === "narrow");
          await runGoalContract(
            probe,
            contract,
            result,
            firefoxOracle(
              app,
              contract,
              article !== "fixture",
              info.project.use.viewport?.height || 900,
            ),
          );
          if (article === "fixture") {
            const stored = await app.message({ type: "GET_MEMORY" });
            result.secretLeaks += Number(
              JSON.stringify([
                stored,
                await app.extension(() =>
                  (globalThis as any).browser.storage.session.get(null),
                ),
              ]).includes("SENTINEL"),
            );
            expect(result.secretLeaks).toBe(0);
          } else if (
            contract.id === "section" &&
            [
              "Ada_Lovelace",
              "List_of_James_Bond_novels_and_short_stories",
            ].includes(article)
          ) {
            await expect
              .poll(
                async () => {
                  const stored = await current.message(
                    { type: "GET_MEMORY" },
                    "memory-summary",
                  );
                  expect(stored.error).toBeUndefined();
                  return stored.pages;
                },
                { timeout: 10000 },
              )
              .toBe(1);
          }
        } catch (error) {
          errors.push(contract.id + ": " + String(error));
        } finally {
          await attachCase(info, result);
          attached.add(contract.id);
        }
      }
      if (article === "fixture")
        for (const id of matrix.negativeCases) {
          const result = sample(`${name}/fixture/${id}`, "fixture", false);
          try {
            await app.message({ type: "STOP" });
            await app.visit(url);
            await app.start();
            await runNegativeContract(probe, id, result, {
              act: async () => {
                await current.site(() => document.title);
                if (id === "unrelated-popup" || id === "unrelated-action")
                  await current.driver.findElement({ css: "#" + id }).click();
                else
                  await current.site(() =>
                    document.querySelector('input[type="search"]')!.remove(),
                  );
              },
              refresh: () => current.message({ type: "GET_PAGE" }),
            });
          } catch (error) {
            errors.push(id + ": " + String(error));
          } finally {
            await attachCase(info, result);
            attached.add(id);
          }
        }
      expect(errors).toEqual([]);
    } catch (error) {
      const ids =
        article === "fixture"
          ? [...matrix.goals.map((goal) => goal.id), ...matrix.negativeCases]
          : matrix.goals.map((goal) => goal.id);
      for (const id of ids)
        if (!attached.has(id))
          await attachCase(
            info,
            sample(
              `${name}/${article}/${id}`,
              article === "fixture" ? "fixture" : "live",
              article !== "fixture" || !matrix.negativeCases.includes(id),
            ),
          );
      throw error;
    } finally {
      await app?.close();
      await fixture?.close();
    }
  });
