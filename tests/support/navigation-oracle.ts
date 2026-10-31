import { expect, type Locator } from "@playwright/test";
import type { NavigatorApp } from "./acceptance-runner";
import type { PageControl } from "../../packages/page-model";

/** The frozen declaration owns these outcomes; no oracle enters model input. */
export async function prepareNavigationOracle(
  app: NavigatorApp,
  task: any,
  url: string,
  viewport: { width: number; height: number },
  timeoutMs: number,
) {
  let target: Locator;
  let outcome!: () => Promise<boolean>;
  let targetHref: string | undefined;
  let reveal: Locator | undefined;
  let sectionLink: Locator | undefined;
  let revealed: Locator | undefined;
  let label = new RegExp(`^${task.target}(?:\\s|$)`, "i");
  let matchesTarget: ((control: PageControl) => boolean) | undefined;
  if (task.proof && task.kind === "navigation") {
    label = /\S/;
    target = app.page
      .locator(`a[href="${task.path}"]`)
      .filter({ visible: true })
      .first();
    matchesTarget = (control) =>
      control.destination?.origin === new URL(url).origin &&
      control.destination.path === task.path;
    outcome = async () => {
      const actual = new URL(app.page.url());
      const main = app.page.locator("main");
      if (
        actual.origin !== new URL(url).origin ||
        actual.pathname !== task.path ||
        !(await main.isVisible())
      )
        return false;
      const proof = task.proof;
      const headings = main.getByRole("heading", {
        name: proof.heading,
        exact: true,
      });
      const breadcrumb = main
        .locator('[aria-label="Breadcrumbs"]')
        .filter({ hasText: proof.heading });
      if (
        !(await headings.filter({ visible: true }).count()) &&
        !(await breadcrumb.filter({ visible: true }).count())
      )
        return false;
      if (
        proof.bodyText &&
        !(await main.textContent())?.includes(proof.bodyText)
      )
        return false;
      if (
        proof.entryHref &&
        !(await main
          .locator(`a[href="${proof.entryHref}"]`)
          .filter({ visible: true })
          .count())
      )
        return false;
      if (
        proof.entryHrefPrefix &&
        !(await main
          .locator(`a[href^="${proof.entryHrefPrefix}"]`)
          .filter({ visible: true })
          .count())
      )
        return false;
      if (
        proof.versionHistory &&
        (!(await main
          .getByRole("heading", { name: /^Version \d/ })
          .filter({ visible: true })
          .count()) ||
          !/Unreleased|Released/.test((await main.textContent()) || ""))
      )
        return false;
      return true;
    };
  } else if (task.app === "github") {
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
      if ((await choice.getAttribute("name")) === name) sameGroup.push(choice);
    expect(sameGroup).toHaveLength(1);
    await sameGroup[0].check();
    if (hidden) await reveal.click();
    outcome = () => target.isChecked();
  } else if (task.kind === "section") {
    target = task.proof
      ? app.page.getByRole("heading", {
          name: task.proof.heading,
          exact: true,
          level: task.proof.headingLevel,
        })
      : app.page.locator(`#${task.target}`);
    const fragment = task.proof ? await target.getAttribute("id") : task.target;
    if (!fragment)
      throw Error("The declared independent heading lacks a section anchor.");
    sectionLink = app.page
      .locator(`a[href="#${fragment}"]`)
      .filter({ visible: true })
      .first();
    label = new RegExp(`^(?:\\d+(?:\\.\\d+)*[. ]*)?${task.target}$`, "i");
    outcome = async () => {
      const box = await target.boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= viewport.height;
    };
  } else if (task.kind === "focus") {
    target = app.page
      .getByPlaceholder("Search Wikipedia", { exact: true })
      .filter({ visible: true });
    reveal = app.page.locator('[role="search"] > a').filter({ visible: true });
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
  ).toHaveCount(1, { timeout: timeoutMs });
  if (task.kind === "navigation") {
    const href = new URL((await target.getAttribute("href"))!, url);
    targetHref = href.href;
    if ("query" in task)
      for (const [key, value] of new URLSearchParams(task.query))
        expect(href.searchParams.get(key)).toBe(value);
  }

  return {
    target,
    reveal,
    sectionLink,
    revealed,
    label,
    matchesTarget,
    outcome,
    targetHref,
  };
}
