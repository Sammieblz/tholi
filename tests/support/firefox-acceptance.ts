import { By, error, type WebElement } from "selenium-webdriver";
import type { FirefoxApp } from "./firefox-extension";
import type {
  AcceptanceElement,
  AcceptanceProbe,
  GoalContract,
} from "./acceptance-runner";
class FirefoxElement implements AcceptanceElement {
  constructor(
    private app: FirefoxApp,
    private selector: By,
  ) {}
  private async element(wait = true) {
    await this.app.driver.switchTo().window(this.app.website);
    const read = async () => {
      const elements = await this.app.driver.findElements(this.selector);
      for (const element of elements)
        if (
          await this.app.driver.executeScript<boolean>(
            (node: HTMLElement) =>
              node.getClientRects().length > 0 &&
              !["hidden", "collapse"].includes(
                getComputedStyle(node).visibility,
              ),
            element,
          )
        )
          return element;
      return undefined;
    };
    const found = wait
      ? await this.app.driver.wait(
          read,
          5000,
          "Website control did not become visible: " + this.selector,
          100,
        )
      : await read();
    if (found) return found;
    throw Error("Expected visible website control: " + this.selector);
  }
  private async use<T>(
    operation: (element: WebElement) => Promise<T>,
    wait = true,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation(await this.element(wait));
      } catch (failure) {
        if (
          !(failure instanceof error.StaleElementReferenceError) ||
          attempt === 2
        )
          throw failure;
      }
    }
  }
  async click() {
    await this.use((element) => element.click());
  }
  async check() {
    await this.use(async (element) => {
      if (await element.isSelected()) return;
      // Wikipedia styles native inputs transparently. Click their real label,
      // retaining the native checked-state oracle and actual pointer action.
      const label = await this.app.driver.executeScript<WebElement | null>(
        (node: HTMLInputElement) => node.labels?.[0] || null,
        element,
      );
      await (label && (await label.isDisplayed()) ? label : element).click();
    });
  }
  async isVisible() {
    try {
      await this.use(async () => true, false);
      return true;
    } catch {
      return false;
    }
  }
  async scrollIntoViewIfNeeded() {
    await this.use((element) =>
      this.app.driver.executeScript(
        (element: HTMLElement) => element.scrollIntoView({ block: "center" }),
        element,
      ),
    );
  }
  async boundingBox() {
    try {
      return await this.use((element) =>
        this.app.driver.executeScript<{
          x: number;
          y: number;
          width: number;
          height: number;
        }>((element: HTMLElement) => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, element),
      );
    } catch {
      return null;
    }
  }
  async checked() {
    return this.use((element) => element.isSelected());
  }
  async focused() {
    return this.use((element) =>
      this.app.driver.executeScript<boolean>(
        (element: HTMLElement) => element === document.activeElement,
        element,
      ),
    );
  }
}
export function firefoxProbe(app: FirefoxApp): AcceptanceProbe {
  return {
    setGoal: app.goal,
    view: app.view,
    progress: app.progress,
    selected: app.selected,
    resetClicks: () =>
      app
        .site(() => {
          const win = window as any;
          if (!win.__navigatorBenchmark) {
            win.__navigatorBenchmark = { clicks: 0 };
            document.addEventListener(
              "click",
              () => win.__navigatorBenchmark.clicks++,
              true,
            );
          }
          win.__navigatorBenchmark.clicks = 0;
        })
        .then(() => {}),
    clicks: () =>
      app.site(() => (window as any).__navigatorBenchmark?.clicks || 0),
  };
}
export function firefoxOracle(
  app: FirefoxApp,
  contract: GoalContract,
  live: boolean,
  height: number,
) {
  const element = (selector: By) => new FirefoxElement(app, selector);
  const appearance = element(
    By.xpath(
      '//summary[normalize-space(.)="Appearance"] | //*[self::button or @role="button"][contains(@aria-label,"Appearance") or contains(normalize-space(.),"Appearance")]',
    ),
  );
  if (["text-size", "theme", "width"].includes(contract.id)) {
    const label =
      contract.id === "text-size"
        ? "Large"
        : contract.id === "theme"
          ? "Dark"
          : "Wide";
    const target = element(
      By.xpath(
        '//input[@id = //label[normalize-space(.)="' + label + '"]/@for]',
      ),
    );
    return {
      target,
      reveal: appearance,
      selectedLabel: new RegExp("(?:^|: )" + label + "$", "i"),
      kind: "choice",
      outcome: () => target.checked(),
    };
  }
  if (contract.id === "section") {
    const target = element(By.css(live ? "#References" : "#references"));
    const sectionLink = element(By.css('a[href="#References"]'));
    return {
      target,
      sectionLink,
      ...(live ? { revealed: sectionLink } : {}),
      reveal: element(
        By.xpath(
          '//*[self::button or @role="button"][contains(translate(@aria-label,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"table of contents") or contains(translate(normalize-space(.),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"table of contents")]',
        ),
      ),
      revealLabel: /table of contents/i,
      selectedLabel: /^(?:\d+(?:\.\d+)*[. ]*)?References$/i,
      kind: "section",
      outcome: async () => {
        const r = await target.boundingBox();
        return !!r && r.y >= 0 && r.y + r.height <= height;
      },
    };
  }
  if (contract.id === "search") {
    const target = element(
      By.css(
        live
          ? 'input[placeholder="Search Wikipedia"]'
          : 'input[placeholder="Search catalogue"]',
      ),
    );
    return {
      target,
      reveal: element(By.css('[role="search"] > a')),
      revealLabel: /^Search$/,
      selectedLabel: live ? /search wikipedia/i : /^Search catalogue$/,
      kind: "focus",
      outcome: () => target.focused(),
    };
  }
  const target = element(
    By.css(
      live
        ? '#p-lang-btn [role="button"], #p-lang-btn[role="button"]'
        : "#languages",
    ),
  );
  return {
    target,
    selectedLabel: /\blanguages\b/i,
    kind: "expand",
    picker: true,
    outcome: () =>
      element(
        By.xpath(
          live
            ? '//a[normalize-space(.)="Français"]'
            : '//a[normalize-space(.)="French"]',
        ),
      ).isVisible(),
  };
}

/** Start each public preference case from the same independent baseline as Chromium. */
export async function resetFirefoxPreference(
  app: FirefoxApp,
  id: string,
  narrow: boolean,
) {
  if (!["text-size", "theme", "width"].includes(id)) return;
  const appearance = new FirefoxElement(
    app,
    By.xpath(
      '//*[self::button or @role="button"][contains(@aria-label,"Appearance") or contains(normalize-space(.),"Appearance")]',
    ),
  );
  const label = id === "text-size" ? "Large" : id === "theme" ? "Dark" : "Wide";
  const target = new FirefoxElement(
    app,
    By.xpath('//input[@id = //label[normalize-space(.)="' + label + '"]/@for]'),
  );
  // MediaWiki builds these controls after load. Match Chromium's explicit
  // ready-page setup before deciding whether the Appearance menu is collapsed.
  await app.driver.switchTo().window(app.website);
  await app.driver.wait(
    async () =>
      (
        await app.driver.findElements(
          By.xpath(
            '//input[@id=//label[normalize-space(.)="' + label + '"]/@for]',
          ),
        )
      ).length > 0,
    10000,
    "MediaWiki appearance controls are initialized",
  );
  const opened = !(await target.isVisible());
  if (opened) await appearance.click();
  const baseline =
    id === "text-size" ? "Small" : id === "theme" ? "Light" : "Standard";
  const field =
    id === "width"
      ? By.xpath(
          '//input[@name = //input[@id=//label[normalize-space(.)="Wide"]/@for]/@name and @id=//label[normalize-space(.)="Standard"]/@for]',
        )
      : By.xpath(
          '//input[@id=//label[normalize-space(.)="' + baseline + '"]/@for]',
        );
  await new FirefoxElement(app, field).check();
  if (opened && narrow) await appearance.click();
}
