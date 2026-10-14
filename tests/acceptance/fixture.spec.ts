import { test, expect } from "@playwright/test";
import matrix from "./matrix.json" with { type: "json" };
import { openNavigatorExtension } from "../support/navigator-extension";
import {
  sample,
  attachCase,
  runGoal,
  setGoal,
  resetClicks,
} from "../support/acceptance-runner";
const html = `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:24px">
<h1>Independent catalogue fixture</h1><input type="search" aria-label="Search catalogue" placeholder="Search catalogue">
<details><summary>Appearance</summary><fieldset><legend>Text size</legend><input type="radio" name="size" id="small" checked><label for="small">Small</label><input type="radio" name="size" id="large"><label for="large">Large</label></fieldset><fieldset><legend>Color</legend><input type="radio" name="color" id="light" checked><label for="light">Light</label><input type="radio" name="color" id="dark"><label for="dark">Dark</label></fieldset><fieldset><legend>Width</legend><input type="radio" name="width" id="standard" checked><label for="standard">Standard</label><input type="radio" name="width" id="wide"><label for="wide">Wide</label></fieldset></details>
<button id="languages" aria-controls="picker" aria-haspopup="menu" aria-expanded="false">7 languages</button><div id="picker" role="menu" hidden><a href="/acceptance/french">French</a></div>
<button>Delete account</button><nav aria-label="Account"><button>Settings</button></nav><nav aria-label="Display"><button>Settings</button></nav>
<button type="button">Edit draft</button><form method="post" action="/edit"><input aria-label="Draft title"><button>Continue publication</button></form>
<section id="twins"><button>Help</button><button>Help</button></section>
<nav><button id="unrelated-popup" aria-haspopup="dialog" aria-expanded="false">Categories</button><button id="unrelated-action">Feedback</button><span id="change-here"></span></nav>
<input type="password" value="SENTINEL_PASSWORD"><input autocomplete="one-time-code" value="SENTINEL_OTP"><input name="credit-card" value="SENTINEL_CARD"><div contenteditable>SENTINEL_EDITABLE</div>
<div style="height:1500px"></div><h2 id="references">References</h2><div style="height:1000px"></div>
<script>document.querySelector('#languages').onclick=()=>{document.querySelector('#picker').hidden=false;document.querySelector('#languages').setAttribute('aria-expanded','true')};document.querySelector('#unrelated-popup').onclick=()=>{const h=document.createElement('h1');h.textContent='Notifications';document.body.append(h)};document.querySelector('#unrelated-action').onclick=()=>{document.querySelector('#change-here').innerHTML='<button>Notifications</button>'};</script>
</body></html>`;
test("declared generic positive and negative cases", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
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
        `${info.project.name}/fixture/${contract.id}`,
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
        `${info.project.name}/fixture/${id}`,
        "fixture",
        false,
      );
      try {
        await load();
        await resetClicks(app);
        const goals: Record<string, string> = {
          missing: "Unknown feature",
          "ambiguous-context": "Settings",
          "duplicate-controls": "Help",
          consequential: "Delete account",
          "unknown-edit-effect": "Edit draft",
          "implicit-submit": "Continue publication",
          "unrelated-popup": "Categories",
          "unrelated-action": "Feedback",
          "stale-target": "Show search",
        };
        const reply = await setGoal(app, goals[id]);
        expect(reply.error).toBeUndefined();
        let view = reply.view;
        result.automation += await app.page.evaluate(
          () => (window as any).__navigatorBenchmark.clicks,
        );
        expect(result.automation).toBe(0);
        const refuse = [
          "missing",
          "ambiguous-context",
          "duplicate-controls",
          "consequential",
          "unknown-edit-effect",
          "implicit-submit",
        ].includes(id);
        result.unresolved = view.goalPlan.status === "unresolved";
        if (view.selectedControlId) result.targets.push(!refuse);
        if (refuse) {
          expect(view.selectedControlId).toBeUndefined();
          expect(result.unresolved).toBe(true);
          if (id === "unknown-edit-effect")
            expect(view.goalPlan.issue).toBe("unknown-effect");
          if (id === "implicit-submit")
            expect(view.goalPlan.issue).toBe("consequential");
        } else {
          const before = view.verifiedSteps;
          if (id === "unrelated-popup")
            await app.page.locator("#unrelated-popup").click();
          else if (id === "unrelated-action")
            await app.page.locator("#unrelated-action").click();
          else
            await app.page
              .locator("input[type=search]")
              .evaluate((e) => e.remove());
          await app.panel.evaluate(async () =>
            chrome.runtime.sendMessage({ type: "GET_PAGE" }),
          );
          view = await app.view();
          for (let n = before; n < view.verifiedSteps; n++) {
            result.verifications.push(false);
            result.falseSuccess++;
          }
          if (view.goalPlan?.status === "completed") result.falseSuccess++;
          expect(view.verifiedSteps).toBe(before);
          expect(view.goalPlan?.status).not.toBe("completed");
          if (id === "stale-target")
            expect(view.selectedControlId).toBeUndefined();
        }
        result.completed = true;
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
