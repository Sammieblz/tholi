import { test, expect } from "../../support/browser-test";
import matrix from "./matrix.json" with { type: "json" };
import { openNavigatorExtension } from "../../support/navigator-extension";
import {
  sample,
  attachCase,
  runGoal,
  chromiumProbe,
  runNegativeContract,
} from "../../support/acceptance-runner";
import { acceptanceHtml as html } from "../../fixtures/acceptance/page";

test("declared generic positive and negative cases", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
    [],
  );
  const errors: string[] = [];
  const load = async () => {
    await app.stop();
    await app.page.goto("http://localhost:5173/acceptance/fixture");
    await app.start();
  };
  try {
    await info.attach("navigator-browser-version", {
      body: Buffer.from(app.context.browser()!.version()),
      contentType: "text/plain",
    });
    await app.context.route("http://localhost:5173/acceptance/**", (r) =>
      r.fulfill({ contentType: "text/html", body: html }),
    );
    for (const contract of matrix.goals) {
      const result = sample(
        `${info.project.name.replace("acceptance-", "")}/fixture/${contract.id}`,
        "fixture",
      );
      try {
        await load();
        const appearance = app.page.getByText("Appearance", { exact: true });
        const label =
          contract.id === "text-size"
            ? "Large"
            : contract.id === "theme"
              ? "Dark"
              : "Wide";
        if (["text-size", "theme", "width"].includes(contract.id)) {
          const target = app.page.getByLabel(label, { exact: true });
          await runGoal(app, contract, result, {
            target,
            reveal: appearance,
            selectedLabel: new RegExp(label + "$", "i"),
            kind: "choice",
            outcome: () => target.isChecked(),
          });
        } else if (contract.id === "section") {
          const target = app.page.getByRole("heading", {
            name: "References",
            exact: true,
          });
          await runGoal(app, contract, result, {
            target,
            selectedLabel: /^References$/,
            kind: "section",
            outcome: async () => {
              const r = await target.boundingBox();
              return (
                !!r &&
                r.y >= 0 &&
                r.y + r.height <= (info.project.use.viewport?.height || 900)
              );
            },
          });
        } else if (contract.id === "search") {
          const target = app.page.getByPlaceholder("Search catalogue");
          await runGoal(app, contract, result, {
            target,
            selectedLabel: /^Search catalogue$/,
            kind: "focus",
            outcome: () => target.evaluate((e) => e === document.activeElement),
          });
        } else {
          const target = app.page.getByRole("button", {
            name: "7 languages",
            exact: true,
          });
          await runGoal(app, contract, result, {
            target,
            selectedLabel: /^7 languages$/,
            kind: "expand",
            picker: true,
            outcome: () =>
              app.page
                .getByRole("link", { name: "French", exact: true })
                .isVisible(),
          });
        }
        const state = await app.panel.evaluate(async () => ({
          session: await chrome.storage.session.get(null),
          memory: await chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
        }));
        result.secretLeaks += Number(
          JSON.stringify(state).includes("SENTINEL"),
        );
        expect(result.secretLeaks).toBe(0);
      } catch (error) {
        errors.push(contract.id + ": " + String(error).slice(0, 4000));
      } finally {
        await attachCase(info, result);
      }
    }
    for (const id of matrix.negativeCases) {
      const result = sample(
        `${info.project.name.replace("acceptance-", "")}/fixture/${id}`,
        "fixture",
        false,
      );
      try {
        await load();
        await runNegativeContract(chromiumProbe(app), id, result, {
          act: async () => {
            if (id === "unrelated-popup" || id === "unrelated-action")
              await app.page.locator("#" + id).click();
            else
              await app.page
                .locator("input[type=search]")
                .evaluate((node) => node.remove());
          },
          refresh: () =>
            app.panel.evaluate(() =>
              chrome.runtime.sendMessage({ type: "GET_PAGE" }),
            ),
        });
      } catch (error) {
        errors.push(id + ": " + String(error).slice(0, 200));
      } finally {
        await attachCase(info, result);
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
