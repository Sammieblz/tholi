import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseEnv } from "node:util";
import {
  By,
  Key,
  until,
  error as webdriverError,
  type WebElement,
} from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import type chrome from "selenium-webdriver/chrome.js";
import { localStackArguments } from "../../scripts/local-stack.mjs";
import {
  assertOwnedSmokeProject,
  inspectLocalStack,
} from "../../scripts/lib/local-stack-policy.mjs";
import { serviceAuthStatusSchema } from "../../apps/extension/src/platform/service-auth-contract";
import {
  seleniumBidi,
  type attachWebDriverExtension,
} from "./webdriver-extension";

type App = Awaited<ReturnType<typeof attachWebDriverExtension>>;
async function nativeCdp(
  app: App,
  method: string,
  params: Record<string, unknown>,
  session?: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      (await seleniumBidi(app.driver)).send({
        method: "goog:cdp.sendCommand",
        params: { method, params, ...(session ? { session } : {}) },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error("The native debugger command timed out.")),
          3_000,
        );
      }),
    ]);
    if (reply.error) throw Error("The native debugger command failed.");
    return reply.result?.result;
  } finally {
    clearTimeout(timer);
  }
}
export type NativeIdentityEnvironment = {
  envFile: string;
  project: string;
  serviceOrigin: string;
  providerOrigin: string;
  webOrigin: string;
  mailOrigin: string;
  username: string;
  password: string;
  registerCallbacks: boolean;
};
function localOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw Error(
      "Native identity evidence requires explicit loopback HTTP origins.",
    );
  return value;
}
function compose(environment: NativeIdentityEnvironment, args: string[]) {
  const base = localStackArguments({
    action: "status",
    envFile: environment.envFile,
    project: environment.project,
  }).slice(0, -1);
  try {
    return execFileSync("docker", [...base, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw Error(
      "The explicitly owned native identity stack operation failed. Inspect that project's local service state.",
    );
  }
}
function verifyOwnedStack(environment: NativeIdentityEnvironment) {
  assertOwnedSmokeProject(environment.project, environment.project);
  const configuration = JSON.parse(
    compose(environment, ["config", "--format", "json"]),
  );
  assertOwnedSmokeProject(configuration.name, environment.project);
  const inspection = inspectLocalStack(configuration);
  const endpoint = new URL(environment.serviceOrigin);
  if (
    !inspection.ports.some(
      (port) =>
        port.target === 8788 && port.published === Number(endpoint.port || 80),
    )
  )
    throw Error(
      "The identity service origin must belong to the allocated disposable project.",
    );
  const provider =
    configuration.services.api.environment
      .THOLI_IDENTITY_AUTHORIZATION_ENDPOINT;
  if (
    typeof provider !== "string" ||
    new URL(provider).origin !== environment.providerOrigin
  )
    throw Error(
      "The identity provider must match the allocated disposable project's configured provider.",
    );
  if (
    configuration.services.api.environment.THOLI_IDENTITY_WEB_ORIGIN !==
      environment.webOrigin ||
    !inspection.ports.some(
      (port) =>
        port.target === 18025 &&
        port.published === Number(new URL(environment.mailOrigin).port),
    )
  )
    throw Error(
      "Website and mail verification must use the allocated stack's exact local endpoints.",
    );
}
/** Opt-in real identity evidence never borrows a developer's ordinary stack or credentials. */
export function nativeIdentityEnvironment(): NativeIdentityEnvironment {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value)
      throw Error(
        `Native identity verification requires ${name}. It is never silently skipped.`,
      );
    return value;
  };
  const candidate = required("THOLI_IDENTITY_ENV_FILE");
  if (!isAbsolute(candidate))
    throw Error(
      "THOLI_IDENTITY_ENV_FILE must be an absolute path inside output/qa.",
    );
  const envFile = realpathSync(candidate),
    root = realpathSync(resolve("output/qa"));
  if (
    !envFile.startsWith(root + sep) ||
    relative(root, envFile).startsWith("..")
  )
    throw Error(
      "The identity environment must remain inside the repository's ignored output/qa directory.",
    );
  const project = required("THOLI_IDENTITY_PROJECT");
  const settings = parseEnv(readFileSync(envFile, "utf8"));
  const allocatedProject = settings.COMPOSE_PROJECT_NAME;
  if (!allocatedProject)
    throw Error(
      "The identity environment must name its allocated disposable project.",
    );
  assertOwnedSmokeProject(project, allocatedProject);
  const environment = {
    envFile,
    project,
    serviceOrigin: localOrigin(required("THOLI_IDENTITY_SERVICE_ORIGIN")),
    providerOrigin: localOrigin(required("THOLI_IDENTITY_PROVIDER_ORIGIN")),
    webOrigin: localOrigin(
      settings.THOLI_WEB_ORIGIN || "http://127.0.0.1:5174",
    ),
    mailOrigin: localOrigin(
      `http://127.0.0.1:${settings.MAIL_HOST_PORT || "18025"}`,
    ),
    username: required("THOLI_IDENTITY_USERNAME"),
    password: required("THOLI_IDENTITY_PASSWORD"),
    registerCallbacks: process.env.THOLI_IDENTITY_REGISTER_CALLBACKS === "1",
  };
  if (environment.username.length > 256 || environment.password.length > 1024)
    throw Error(
      "Use a synthetic local identity fixture for native verification.",
    );
  if (
    process.env.THOLI_TEST_TIER === "pr" ||
    process.env.THOLI_BROWSER_NETWORK === "fixtures"
  )
    throw Error(
      "Invoke test:identity so native identity verification uses no privileged network interception.",
    );
  verifyOwnedStack(environment);
  return environment;
}
/** Reapply the real local identity owner to retained volumes, preserving the test's registered user. */
export function reconcileIdentityConfiguration(
  environment: NativeIdentityEnvironment,
) {
  verifyOwnedStack(environment);
  compose(environment, [
    "exec",
    "-T",
    "oidc",
    "bash",
    "/opt/keycloak/data/seed.sh",
  ]);
}
/** Only the callback line in an allocated smoke environment may change; secrets remain untouched. */
export async function registerNativeCallback(
  app: App,
  target: "chromium" | "firefox",
  environment: NativeIdentityEnvironment,
) {
  const callback = await app.extension(() => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    return api.identity.getRedirectURL() as string;
  });
  const url = new URL(callback);
  const suffix =
    target === "firefox" ? ".extensions.allizom.org" : ".chromiumapp.org";
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(suffix) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error(
      "The installed browser returned an unsupported native callback.",
    );
  verifyOwnedStack(environment);
  const source = readFileSync(environment.envFile, "utf8"),
    values = parseEnv(source);
  const key =
    target === "firefox"
      ? "THOLI_IDENTITY_FIREFOX_CALLBACKS"
      : "THOLI_IDENTITY_CHROMIUM_CALLBACKS";
  const registered = (values[key] || "").split(",").filter(Boolean);
  mkdirSync("output/qa/native-identity", { recursive: true });
  writeFileSync(
    resolve("output/qa/native-identity", `${target}-callback.json`),
    JSON.stringify({ target, callback, project: environment.project }) + "\n",
  );
  if (registered.includes(callback)) return;
  if (!environment.registerCallbacks)
    throw Error(
      "The observed native callback is recorded in output/qa/native-identity. Register it on the allocated stack or explicitly enable THOLI_IDENTITY_REGISTER_CALLBACKS=1.",
    );
  const expression = new RegExp(`^${key}=.*$`, "m");
  if (!expression.test(source))
    throw Error(
      "The allocated environment must contain its native callback setting before registration.",
    );
  writeFileSync(
    environment.envFile,
    source.replace(expression, `${key}=${[...registered, callback].join(",")}`),
    { mode: 0o600 },
  );
  verifyOwnedStack(environment);
  compose(environment, [
    "up",
    "--detach",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "90",
    "api",
  ]);
  await app.waitFor(
    async () => {
      try {
        return (
          await fetch(new URL("/health/ready", environment.serviceOrigin), {
            signal: AbortSignal.timeout(2_000),
            redirect: "error",
          })
        ).ok;
      } catch {
        return false;
      }
    },
    Boolean,
    "The owned identity API becomes ready after exact callback registration",
    30_000,
  );
}
export async function accountControl(
  app: App,
  label: string,
): Promise<WebElement> {
  const control = await app.driver.wait(
    async () => {
      for (const button of await app.driver.findElements(
        By.xpath(`//button[normalize-space(.)=${JSON.stringify(label)}]`),
      )) {
        try {
          if ((await button.isDisplayed()) && (await button.isEnabled()))
            return button;
        } catch (error) {
          if (!(error instanceof webdriverError.StaleElementReferenceError))
            throw error;
        }
      }
      return false;
    },
    10_000,
    `The native account control ${label} is visible and enabled`,
  );
  if (!control) throw Error("The native account control is unavailable.");
  return control;
}
export async function openAccountSettings(app: App) {
  await app.driver.switchTo().window(app.panel);
  if (!(await app.driver.findElements(By.id("tholi-service-origin"))).length)
    await app.driver
      .findElement(By.css('button[aria-label="Tholi settings"]'))
      .click();
  await app.driver.wait(
    until.elementLocated(By.id("tholi-service-origin")),
    10_000,
  );
}
export async function configureNativeAccount(
  app: App,
  target: "chromium" | "firefox",
  environment: NativeIdentityEnvironment,
) {
  await openAccountSettings(app);
  const input = await app.driver.findElement(By.id("tholi-service-origin"));
  await input.clear();
  await input.sendKeys(environment.serviceOrigin);
  const needsConsent =
    target === "firefox" &&
    !(await app.extension(() =>
      (globalThis as any).browser.permissions.contains({
        data_collection: ["authenticationInfo"],
      }),
    ));
  if (target === "firefox" && !needsConsent)
    throw Error(
      "Native Firefox account consent evidence requires a fresh profile with authentication permission still ungranted.",
    );
  await (await accountControl(app, "Save service origin")).click();
  if (needsConsent) {
    const driver = app.driver as firefox.Driver;
    let stage = "enter-chrome-context";
    try {
      await driver.setContext(firefox.Context.CHROME);
      stage = "locate-permission-button";
      const located = await driver.wait(async () => {
        for (const button of await driver.findElements(
          By.css(
            "#addon-webext-permissions-notification .popup-notification-primary-button",
          ),
        ))
          if (await button.isDisplayed()) return button;
        return false;
      }, 15_000);
      if (!located) throw Error();
      let confirmation: WebElement = located;
      if ((await confirmation.getTagName()) === "moz-button") {
        stage = "locate-inner-permission-button";
        confirmation = await (
          await confirmation.getShadowRoot()
        ).findElement(By.css("button#main-button"));
      }
      stage = "wait-for-permission-button-readiness";
      await driver.wait(async () => {
        if (
          !(await confirmation.isDisplayed()) ||
          !(await confirmation.isEnabled())
        )
          return false;
        return driver.executeScript(() => {
          const notification = document.getElementById(
            "addon-webext-permissions-notification",
          ) as any;
          const scope = globalThis as any;
          const shown = notification?.notification?.timeShown;
          const delay = scope.Services.prefs.getIntPref(
            "security.notification_enable_delay",
          );
          return (
            !!scope.PopupNotifications?.isPanelOpen &&
            scope.Services.focus.activeWindow === document.defaultView &&
            !notification.matches(":-moz-window-inactive") &&
            typeof shown === "number" &&
            scope.ChromeUtils.now() - shown >= delay
          );
        });
      }, 15_000);
      stage = "click-permission-button";
      await driver.actions().move({ origin: confirmation }).click().perform();
    } catch (error) {
      const knownErrors = new Set([
        "TimeoutError",
        "UnsupportedOperationError",
        "JavascriptError",
        "StaleElementReferenceError",
        "ElementNotInteractableError",
        "ElementClickInterceptedError",
        "NoSuchWindowError",
        "InvalidSelectorError",
        "WebDriverError",
        "UnknownError",
      ]);
      const errorName =
        error instanceof Error && knownErrors.has(error.name)
          ? error.name
          : "OtherError";
      throw Error(
        "The real Firefox account permission notification could not be accepted. Native permission verification remains blocked; no pre-grant was substituted. Sanitized progress: " +
          JSON.stringify({ stage, errorName }),
      );
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
      await driver.switchTo().window(app.panel);
    }
  }
  await app.waitFor(
    () => app.message({ type: "AUTH_STATUS" }),
    (raw) =>
      serviceAuthStatusSchema.safeParse(raw).success &&
      raw.configured &&
      raw.origin === environment.serviceOrigin,
    "The real panel saves the explicitly granted account origin",
    15_000,
  );
}
async function newAuthWindow(
  app: App,
  previous: string[],
  environment: NativeIdentityEnvironment,
) {
  return app.driver.wait(
    async () => {
      for (const handle of await app.driver.getAllWindowHandles()) {
        if (previous.includes(handle)) continue;
        try {
          await app.driver.switchTo().window(handle);
          const value = await app.driver.getCurrentUrl();
          if (value === "about:blank") continue;
          const origin = new URL(value).origin;
          if (origin === environment.providerOrigin) return handle;
          if (origin !== environment.serviceOrigin)
            throw Error("Unexpected native identity navigation.");
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Unexpected native identity navigation."
          )
            throw error;
        }
      }
      return false;
    },
    20_000,
    "The native identity flow opens the configured local provider",
  );
}
export async function cancelNativeSignIn(
  app: App,
  environment: NativeIdentityEnvironment,
) {
  const previous = await app.driver.getAllWindowHandles();
  let stage = "open-sign-in";
  try {
    await (await accountControl(app, "Sign in")).click();
    stage = "cancel-provider-window";
    await newAuthWindow(app, previous, environment);
    await app.driver.close();
    await app.driver.switchTo().window(app.panel);
    stage = "verify-cancellation";
    await app.waitFor(
      () =>
        app.driver.findElements(
          By.css('.tholi-account-settings [role="alert"]'),
        ),
      (items) => items.length > 0,
      "Cancellation is reported in the account panel",
      15_000,
    );
    const status = serviceAuthStatusSchema.parse(
      await app.message({ type: "AUTH_STATUS" }),
    );
    if (status.account || status.session)
      throw Error("Cancellation created an unexpected session.");
  } catch {
    throw Error(`Native sign-in cancellation failed during ${stage}.`);
  } finally {
    await app.driver.switchTo().window(app.panel);
  }
}
export async function completeNativeSignIn(
  app: App,
  environment: NativeIdentityEnvironment,
) {
  const previous = await app.driver.getAllWindowHandles();
  const attempted = new Set<string>();
  const registered = new URL(
    await app.extension(() => {
      const api = (globalThis as any).browser || (globalThis as any).chrome;
      return api.identity.getRedirectURL() as string;
    }),
  );
  const chromium = registered.hostname.endsWith(".chromiumapp.org");
  let stage = "open-sign-in";
  let signedIn: ReturnType<typeof serviceAuthStatusSchema.parse> | undefined;
  async function accountReady() {
    stage = "verify-account";
    const parsed = serviceAuthStatusSchema.safeParse(
      await app.message({ type: "AUTH_STATUS" }),
    );
    if (!parsed.success) throw Error("The native account response is invalid.");
    if (!parsed.data.account) return false;
    signedIn = parsed.data;
    return true;
  }
  try {
    await (await accountControl(app, "Sign in")).click();
    await app.driver.wait(
      async () => {
        if (chromium && attempted.size) return accountReady();
        stage = "observe-provider-window";
        for (const handle of (await app.driver.getAllWindowHandles()).filter(
          (item) => !previous.includes(item),
        )) {
          try {
            await app.driver.switchTo().window(handle);
            const location = await app.driver.getCurrentUrl();
            if (
              typeof location !== "string" ||
              !location ||
              location === "about:blank"
            )
              continue;
            const url = new URL(location);
            const callback =
              url.origin === registered.origin &&
              url.pathname === registered.pathname;
            if (
              url.origin !== environment.providerOrigin &&
              url.origin !== environment.serviceOrigin &&
              !callback
            )
              throw Error("Unexpected native identity navigation.");
            stage = "check-provider-form";
            for (const feedback of await app.driver.findElements(
              By.css(
                "#input-error, #input-error-username, #input-error-password, #kc-error-message .instruction, .alert-error .kc-feedback-text",
              ),
            )) {
              if ((await feedback.getText()).trim())
                throw Error("The provider reported a sign-in error.");
            }
            const fields = await app.driver.findElements(By.id("username"));
            if (
              attempted.has(handle) ||
              !fields.length ||
              !(await fields[0].isDisplayed())
            )
              continue;
            const passwords = await app.driver.findElements(By.id("password"));
            const buttons = await app.driver.findElements(By.id("kc-login"));
            if (
              !passwords.length ||
              !buttons.length ||
              !(await passwords[0].isDisplayed())
            )
              continue;
            stage = "fill-provider-form";
            await fields[0].clear();
            await fields[0].sendKeys(environment.username);
            await passwords[0].clear();
            await passwords[0].sendKeys(environment.password);
            const matches = await app.driver.executeScript<boolean>(
              (
                username: WebElement,
                password: WebElement,
                submit: WebElement,
                origin: string,
                expectedUsername: string,
                expectedPassword: string,
              ) => {
                const user = username as unknown as HTMLInputElement;
                const secret = password as unknown as HTMLInputElement;
                const button = submit as unknown as HTMLButtonElement;
                const form = user.form;
                const action = form ? new URL(form.action) : undefined;
                return (
                  !!form &&
                  secret.form === form &&
                  button.form === form &&
                  form.method.toLowerCase() === "post" &&
                  action?.origin === origin &&
                  action.pathname ===
                    "/realms/tholi-local/login-actions/authenticate" &&
                  user.type === "text" &&
                  secret.type === "password" &&
                  button.type === "submit" &&
                  !button.disabled &&
                  user.value === expectedUsername &&
                  secret.value === expectedPassword
                );
              },
              fields[0],
              passwords[0],
              buttons[0],
              environment.providerOrigin,
              environment.username,
              environment.password,
            );
            if (!matches)
              throw Error(
                "The provider form does not match the synthetic fixture.",
              );
            attempted.add(handle);
            stage = "submit-provider-form";
            if (chromium)
              await app.driver
                .actions({ async: true })
                .click(buttons[0])
                .perform();
            else await passwords[0].sendKeys(Key.ENTER);
          } catch (error) {
            if (
              (error instanceof webdriverError.TimeoutError &&
                attempted.has(handle)) ||
              error instanceof webdriverError.NoSuchWindowError ||
              error instanceof webdriverError.StaleElementReferenceError
            )
              continue;
            throw error;
          }
        }
        if (!chromium) await app.driver.switchTo().window(app.panel);
        return accountReady();
      },
      40_000,
      "The native broker completes configured local identity sign-in",
    );
    if (!signedIn) throw Error("The native account was not verified.");
    return signedIn;
  } catch {
    throw Error(`Native sign-in failed during ${stage}.`);
  } finally {
    await app.driver.switchTo().window(app.panel);
  }
}
export async function restartNativeBackground(
  app: App,
  target: "chromium" | "firefox",
) {
  if (target === "chromium") {
    const workerUrl = await app.extension(() =>
      (globalThis as any).chrome.runtime.getURL("worker.js"),
    );
    async function exactWorkers(): Promise<string[]> {
      const targets = (await nativeCdp(app, "Target.getTargets", {}))
        ?.targetInfos;
      if (!Array.isArray(targets))
        throw Error("The native worker targets could not be inspected.");
      return targets
        .filter(
          (item) =>
            item.type === "service_worker" &&
            item.url === workerUrl &&
            typeof item.targetId === "string",
        )
        .map((item) => item.targetId);
    }
    const previous = await exactWorkers();
    if (previous.length !== 1)
      throw Error(
        "Native restart requires one exact running extension worker.",
      );
    await (app.driver as chrome.Driver).sendDevToolsCommand(
      "ServiceWorker.enable",
      {},
    );
    await (app.driver as chrome.Driver).sendDevToolsCommand(
      "ServiceWorker.stopAllWorkers",
      {},
    );
    // The stop command may acknowledge before termination. Never deliver the
    // recovery request to the old instance while it is still draining.
    await app.driver.wait(
      async () => !(await exactWorkers()).includes(previous[0]),
      10_000,
      "The exact old extension worker terminates before account recovery",
    );
    // Wake the real worker without waiting on a message to a debugger-paused
    // target. The test independently parses AUTH_STATUS after this helper.
    await app.driver.executeScript(() => {
      void (globalThis as any).chrome.runtime
        .sendMessage({ type: "AUTH_STATUS" })
        .catch(() => {});
    });
    // Chrome can reuse the DevTools host ID for the same worker version.
    // Observed absence and reappearance prove restart; a new ID is not required.
    const worker = await app.driver.wait(
      async () => {
        const current = await exactWorkers();
        if (current.length > 1)
          throw Error("The native worker identity is ambiguous.");
        return current.length === 1 ? current[0] : false;
      },
      10_000,
      "The exact new extension worker starts",
    );
    if (!worker) throw Error("The exact new extension worker is missing.");
    let session: string | undefined;
    try {
      session = (
        await nativeCdp(app, "Target.attachToTarget", {
          targetId: worker,
          flatten: true,
        })
      )?.sessionId;
      if (typeof session !== "string")
        throw Error("The exact native worker could not be attached.");
      // Test-only debugger recovery, proven by the native restart diagnostic:
      // resume solely this bundle's worker, preserving authentication data.
      await nativeCdp(app, "Runtime.runIfWaitingForDebugger", {}, session);
    } finally {
      if (session)
        await nativeCdp(app, "Target.detachFromTarget", { sessionId: session });
    }
  } else {
    const panelUrl = await app.driver.getCurrentUrl();
    await app.driver.get("about:blank");
    const driver = app.driver as firefox.Driver;
    try {
      await driver.setContext(firefox.Context.CHROME);
      await driver.executeScript(async () => {
        const extension = (globalThis as any).WebExtensionPolicy.getByID(
          "tholi@ilunonsen.com",
        ).extension;
        await extension.terminateBackground({ disableResetIdleForTest: true });
        if (extension.backgroundState !== "stopped")
          throw Error("Background did not stop");
      });
      await driver.executeScript((url: string) => {
        const scope = globalThis as any;
        scope.gBrowser.selectedBrowser.loadURI(scope.Services.io.newURI(url), {
          triggeringPrincipal:
            scope.Services.scriptSecurityManager.getSystemPrincipal(),
        });
      }, panelUrl);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
  }
  await app.driver.wait(until.elementLocated(By.css(".tholi-app")), 15_000);
  await openAccountSettings(app);
}
/** No credentials are returned from content or included in verification artifacts. */
export async function nativeTokenIsolation(app: App) {
  return app.extension(async (tabId: number) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    const [content] = await api.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const api = (globalThis as any).browser || (globalThis as any).chrome;
        let keys: string[] = [];
        try {
          keys = Object.keys(await api.storage.local.get(null));
        } catch {
          /* Protected Chromium storage is unavailable to content. */
        }
        const denied = await api.runtime.sendMessage({ type: "AUTH_STATUS" });
        return {
          privateAuthExposed: keys.includes("service-auth"),
          accountRpcDenied: !!denied?.error,
          privateDatabaseExposed: (await indexedDB.databases()).some(
            (database) => database.name === "tholi-private-settings",
          ),
        };
      },
    });
    return content.result as {
      privateAuthExposed: boolean;
      accountRpcDenied: boolean;
      privateDatabaseExposed: boolean;
    };
  }, app.tabId);
}
