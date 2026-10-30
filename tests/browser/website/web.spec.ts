import { test, expect } from "../../support/browser-test";
import { createHash } from "node:crypto";
const storeUrls = {
  Chrome:
    "https://chromewebstore.google.com/detail/tholi/pliafmeneaalhbecphnodbifdfcajngk",
  Firefox: "https://addons.mozilla.org/en-US/firefox/addon/tholi/",
};

test("mobile account-free navigation offers browser selection and both stores", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Linux; Android 16) Chrome/140.0.0.0 Mobile Safari/537.36",
    }),
  );
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto("/");
  await expect(page.locator(".header-install")).toHaveText("Get Tholi");
  await expect(page.locator(".header-install")).toHaveAttribute(
    "href",
    "/download",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("link", { name: /Sign in|Sign up|Get started/ }),
  ).toHaveCount(0);
  await dialog.locator(".web-primary").click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(dialog).toHaveCount(0);
  for (const browser of ["Chrome", "Firefox"]) {
    const link = page
      .locator(".browser-install-options")
      .getByRole("link", { name: `Add to ${browser}`, exact: true });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("published store download links navigate independently of cookies and developer metadata", async ({
  page,
  browserName,
}) => {
  let metadataRequests = 0;
  await page.route("**/downloads/manifest.json", (route) => {
    metadataRequests++;
    return route.fulfill({ status: 503, body: "Unavailable" });
  });
  for (const url of Object.values(storeUrls))
    await page.route(url, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Intercepted store listing</h1>",
      }),
    );
  await page.goto("/");
  await expect(page.locator(".web-header nav a")).toHaveText([
    "About",
    "Get Tholi",
    "Docs",
  ]);
  await expect(
    page.getByRole("link", { name: /Get started|Sign in|Sign up/ }),
  ).toHaveCount(0);
  const headerStore = browserName === "firefox" ? "Firefox" : "Chrome";
  await page
    .locator(".header-actions")
    .getByRole("link", { name: `Add to ${headerStore}`, exact: true })
    .click();
  await expect(page).toHaveURL(storeUrls[headerStore]);
  await page.goBack();
  await page
    .locator(".hero")
    .getByRole("link", { name: "Try it here", exact: true })
    .click();
  await expect(page.locator("#practice")).toBeFocused();
  await page.goto("/about");
  await expect(page.locator("em[lang=zu]")).toHaveText("umtholi");
  await expect(page.locator(".about-story").first()).toContainText(
    "the Zulu word for “finder.”",
  );
  await page.goto("/download");
  await expect(page.locator(".developer-installation")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.getByLabel("Your browser", { exact: true })).toHaveCount(0);
  for (const [browser, url] of Object.entries(storeUrls)) {
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: `Tholi for ${browser}`,
        exact: true,
      }),
    });
    await expect(card).toContainText("Available now");
    await expect(card.locator("img")).toHaveAttribute("alt", "");
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const link = card.getByRole("link", {
      name: `Add to ${browser}`,
      exact: true,
    });
    await expect(link).toHaveAttribute("href", url);
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading")).toHaveText(
      "Intercepted store listing",
    );
    await page.goBack();
  }
  expect(metadataRequests).toBe(0);
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  const summary = page.getByText("Developer installation", { exact: true });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("could not be loaded");
  expect(metadataRequests).toBe(1);
});

for (const route of ["signin", "signup", "welcome"])
  test(`account route /${route} ignores mock identity and preserves Back behavior`, async ({
    page,
  }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem(
        "tholi-demo-account",
        JSON.stringify({
          name: "Legacy account reader",
          email: "legacy@example.com",
          onboarded: true,
        }),
      ),
    );
    await page.goto("/about");
    // Let the lazy route and its initial focus settle before adding a bookmark.
    await expect(page.locator("main h1")).toBeFocused();
    await page.evaluate((route) => {
      const link = document.createElement("a");
      link.href = route;
      link.textContent = "Legacy account bookmark";
      document.querySelector("main")!.append(link);
    }, "/" + route);
    await page.getByRole("link", { name: "Legacy account bookmark" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${route === "welcome" ? "account" : route}$`),
    );
    await expect(page.locator("main h1")).toBeFocused();
    await expect(
      page.locator('input[type="password"], .auth-page'),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "Legacy account reader",
    );
    await expect(
      page
        .locator("nav")
        .getByRole("link", { name: /Welcome|Sign in|Sign up/ }),
    ).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/about$/);
    await page.goForward();
    await expect(page).toHaveURL(
      new RegExp(`/${route === "welcome" ? "account" : route}$`),
    );
  });

test("account-free onboarding, dark theme and reduced motion retain local practice", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/onboarding");
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "dark",
  );
  await expect(page.locator("main")).toContainText(
    "cannot check whether Tholi is installed",
  );
  await expect(
    page.locator('input[type="email"], input[type="password"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Skip onboarding" }).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.locator("main h1")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("dark-download.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(() => sessionStorage.getItem("tholi-demo-account")),
  ).toBeNull();
});

for (const failure of ["missing", "invalid", "unavailable"])
  test(`store download actions remain available with ${failure} developer metadata`, async ({
    page,
  }) => {
    await page.route("**/downloads/manifest.json", (route) =>
      failure === "invalid"
        ? route.fulfill({
            json: {
              schemaVersion: 2,
              targets: {
                chromium: {
                  target: "chromium",
                  url: "https://untrusted.example/archive.zip",
                },
                firefox: {
                  target: "firefox",
                  url: "https://untrusted.example/archive.zip",
                },
              },
            },
          })
        : route.fulfill({
            status: failure === "missing" ? 404 : 503,
            body: "Unavailable",
          }),
    );
    await page.goto("/download");
    await page.getByText("Developer installation", { exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      failure === "missing" ? "No packaged download" : "could not be loaded",
    );
    for (const [browser, url] of Object.entries(storeUrls)) {
      await page.route(url, (route) =>
        route.fulfill({ contentType: "text/html", body: "Store fixture" }),
      );
      await page
        .locator(".browser-install-options")
        .getByRole("link", { name: `Add to ${browser}`, exact: true })
        .click();
      await expect(page).toHaveURL(url);
      await page.goBack();
    }
    await expect(
      page.getByRole("link", { name: /Download .* developer ZIP/ }),
    ).toHaveCount(0);
  });

for (const width of [375])
  test(`Tholi website ${width}px onboarding and download integrity`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Find your way forward." }),
    ).toBeVisible();
    const captures = page.locator(".product-capture .capture-open img");
    await expect(captures).toHaveCount(4);
    for (const capture of await captures.all()) {
      await capture.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          capture.evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    const enlarge = page.getByRole("button", {
      name: "Enlarge screenshot: The next step, right where you need it.",
    });
    await enlarge.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator("img")).toHaveJSProperty(
      "naturalWidth",
      1440,
    );
    await page.keyboard.press("Escape");
    await expect(enlarge).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 375) {
      const navigation = page.getByRole("button", { name: "Open navigation" });
      await navigation.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(navigation).toBeFocused();
    }
    await page
      .getByRole("button", { name: "Find account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account settings", exact: true }),
    ).toBeVisible();
    const demo = page.locator(".demo");
    await expect(demo.locator(".tholi-app[data-phase=arrived]")).toBeVisible();
    await demo
      .getByRole("button", { name: "Switch to Spanish", exact: true })
      .click();
    await demo
      .getByRole("button", { name: "Language: English", exact: true })
      .click();
    await demo.getByRole("button", { name: "Español", exact: true }).click();
    await expect(demo.locator(".tholi-app[data-phase=arrived]")).toHaveCount(0);
    await demo
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(demo.getByTestId("saved-language")).toHaveText("Español");
    await expect(demo.locator(".tholi-app[data-phase=arrived]")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`home-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/onboarding");
    await expect(
      page.getByText("No Tholi account required.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Try the demonstration" }).click();
    await page
      .getByRole("radio", { name: "Conversation", exact: true })
      .check();
    await expect(
      page
        .locator(".demo")
        .getByRole("button", { name: "Conversation", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Finish onboarding" }).click();
    await expect(page).toHaveURL(/\/download$/);
    expect(
      await page.evaluate(() => sessionStorage.getItem("tholi-demo-account")),
    ).toBeNull();
    await page.getByText("Developer installation", { exact: true }).click();
    await page
      .getByLabel("Your browser", { exact: true })
      .selectOption("chrome");
    if (width === 375)
      expect(
        await page
          .locator(".manual-installation .install-grid")
          .evaluate(
            (grid) =>
              getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          ),
      ).toBe(1);
    const metadata = await page.request.get("/downloads/manifest.json");
    const manifest =
      metadata.ok() &&
      metadata.headers()["content-type"]?.includes("application/json")
        ? await metadata.json()
        : undefined;
    if (manifest) {
      await expect(
        page.getByRole("link", {
          name: "Download Chromium developer ZIP",
          exact: true,
        }),
      ).toHaveAttribute("href", manifest.url);
      if (width === 375) {
        const archive = await page.request.get(manifest.url);
        expect(
          createHash("sha256")
            .update(await archive.body())
            .digest("hex"),
        ).toBe(manifest.sha256);
      }
    } else {
      // A fresh checkout has no eligible release yet. Never fabricate one for CI.
      await expect(page.getByRole("status")).toContainText(
        "No packaged download is available",
      );
      await expect(
        page.getByRole("link", {
          name: "Download Chromium developer ZIP",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await page
      .getByLabel("Your browser", { exact: true })
      .selectOption("firefox");
    await expect(page).toHaveURL(/browser=firefox/);
    await expect(
      page.getByText("Firefox developer build", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Temporary installation is removed when Firefox restarts/),
    ).toBeVisible();
    if (manifest?.targets?.firefox) {
      const release = manifest.targets.firefox;
      const zip = page.getByRole("link", {
        name: "Download Firefox developer ZIP",
        exact: true,
      });
      await expect(zip).toHaveAttribute("href", release.url);
      const archive = await page.request.get(release.url);
      expect(archive.ok()).toBe(true);
      expect(
        createHash("sha256")
          .update(await archive.body())
          .digest("hex"),
      ).toBe(release.sha256);
      await page.getByText("Version and checksum", { exact: true }).click();
      await expect(page.locator(".download-evidence code")).toHaveText(
        release.sha256,
      );
    }
    await page.goBack();
    await expect(page.getByLabel("Your browser", { exact: true })).toHaveValue(
      "chrome",
    );
    await page.screenshot({
      path: info.outputPath(`download-${width}.png`),
      fullPage: true,
    });
  });

test("practice conversation retains context and verifies manual outcomes", async ({
  page,
}) => {
  await page.goto("/");
  const demo = page.locator(".demo");
  await demo
    .getByRole("button", { name: "Find account settings", exact: true })
    .click();
  await demo.getByRole("button", { name: "Conversation", exact: true }).click();
  const composer = demo.getByRole("textbox", { name: "Navigation goal" });
  await composer.fill("Why this step?");
  await demo.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    demo.getByRole("region", { name: "Conversation" }),
  ).toContainText("visible control in the sample website");
  await demo.getByRole("button", { name: "Guide", exact: true }).click();
  await demo
    .getByRole("button", { name: "Pause navigation", exact: true })
    .click();
  await demo.getByRole("button", { name: "Account menu", exact: true }).click();
  await demo
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await expect(demo.locator(".tholi-app[data-phase=arrived]")).toHaveCount(0);
  await demo
    .getByRole("button", { name: "Resume navigation", exact: true })
    .click();
  await expect(demo.locator(".tholi-app[data-phase=arrived]")).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await demo
    .getByRole("textbox", { name: "Navigation goal" })
    .fill("Do not change the language to Spanish");
  await demo.getByRole("button", { name: "Guide me", exact: true }).click();
  await expect(
    demo.locator(".tholi-app[data-phase=clarification]"),
  ).toBeVisible();
  await expect(demo.getByTestId("saved-language")).toHaveText("English");
  await expect(demo.locator(".demo-target")).toHaveCount(0);
});

test("developer download deep links retain browser query and fragment targets", async ({
  page,
}) => {
  await page.route("**/downloads/manifest.json", (route) =>
    route.fulfill({ status: 404, body: "Not found" }),
  );
  for (const destination of [
    "/download?browser=firefox",
    "/download?browser=firefox#installation-firefox",
    "/download#installation-firefox",
  ]) {
    await page.goto(destination);
    await expect(page.locator(".developer-installation")).toHaveAttribute(
      "open",
      "",
    );
    await expect(page.getByLabel("Your browser", { exact: true })).toHaveValue(
      "firefox",
    );
    if (destination.includes("#"))
      await expect(page.locator("#installation-firefox")).toBeFocused();
  }
  await page.goto("/download#developer-installation");
  await expect(page.locator("#developer-installation")).toBeFocused();
  await expect(page.getByRole("status")).toContainText("No packaged download");
});

test("developer download rejects a package for the wrong browser target", async ({
  page,
}) => {
  await page.route("**/downloads/manifest.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        targets: {
          firefox: {
            target: "chromium",
            version: "0.11.0",
            url: "/downloads/tholi-0.11.0.zip",
            sha256: "a".repeat(64),
            bytes: 1024,
            status: "fixture",
            minimumBrowserVersion: "140",
            installationKind: "unpacked",
          },
        },
      },
    }),
  );
  await page.goto("/download?browser=firefox#installation-firefox");
  await expect(page.getByRole("status")).toContainText("could not be loaded");
  await expect(
    page.getByRole("link", { name: /Download .* developer ZIP/ }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".browser-install-options")
      .getByRole("link", { name: "Add to Firefox", exact: true }),
  ).toHaveAttribute("href", storeUrls.Firefox);
});

test("download loading and failed requests remain distinct from unavailable releases", async ({
  page,
}) => {
  let resolveRequest: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  let requests = 0;
  await page.route("**/downloads/manifest.json", async (route) => {
    requests++;
    if (requests === 1) {
      await ready;
      await route.fulfill({ status: 503, body: "Unavailable" });
    } else await route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("/download?browser=chromium");
  await expect(page.getByRole("status")).toContainText(
    "Finding the developer package",
  );
  await expect(
    page.getByText("No packaged download is available", { exact: false }),
  ).toHaveCount(0);
  resolveRequest?.();
  await expect(page.getByRole("status")).toContainText("could not be loaded");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "No packaged download is available",
  );
  const release = (target: "chromium" | "firefox") => ({
    target,
    version: "0.10.1",
    url:
      "/downloads/tholi" +
      (target === "firefox" ? "-firefox" : "") +
      "-0.10.1.zip",
    sha256: "a".repeat(64),
    bytes: 1024,
    status: "fixture",
    minimumBrowserVersion: target === "firefox" ? "153" : "140",
    installationKind: target === "firefox" ? "temporary" : "unpacked",
  });
  await page.unroute("**/downloads/manifest.json");
  await page.route("**/downloads/manifest.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 2,
        targets: { chromium: release("chromium"), firefox: release("firefox") },
      },
    }),
  );
  const selector = page.getByLabel("Your browser", { exact: true });
  await selector.focus();
  await page.keyboard.press("Home");
  await expect(selector).toHaveValue("chrome");
  await page.keyboard.press("End");
  await expect(selector).toHaveValue("firefox");
  await expect(selector).toBeFocused();
  await expect(
    page.getByRole("link", {
      name: "Download Firefox developer ZIP",
      exact: true,
    }),
  ).toHaveAttribute("href", "/downloads/tholi-firefox-0.10.1.zip");
  await page.getByLabel("Your browser", { exact: true }).selectOption("edge");
  await expect(
    page.getByRole("link", {
      name: "Download Chromium developer ZIP",
      exact: true,
    }),
  ).toHaveAttribute("href", "/downloads/tholi-0.10.1.zip");
  await page.goBack();
  await expect(page.getByLabel("Your browser", { exact: true })).toHaveValue(
    "firefox",
  );
  await expect(
    page.getByRole("link", {
      name: "Download Firefox developer ZIP",
      exact: true,
    }),
  ).toBeVisible();
});
