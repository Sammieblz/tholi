import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { identityAccountResponseSchema } from "../../packages/navigation-core/contracts-identity";
import { serviceErrorEnvelopeSchema } from "../../packages/navigation-core/contracts-service";
import type { NativeIdentityEnvironment } from "./webdriver-auth";

const closedContexts = new WeakSet<BrowserContext>();
export class WebsiteIdentityError extends Error {
  constructor(
    readonly reason:
      | "MAIL_CAPTURE_UNAVAILABLE"
      | "MAIL_RESPONSE_INVALID"
      | "ACCOUNT_RESPONSE_INVALID"
      | "ACCOUNT_SESSION_MISSING"
      | "PROVIDER_FORM_REJECTED"
      | "ACTION_LINK_MISSING",
  ) {
    super(reason);
  }
}

/** Capacity schedule for actual rapid UI cohorts, never a retry after rejection. */
export async function waitForIdentityGatewayCapacity() {
  const proxy = readFileSync(
    new URL("../../infra/local/gateway/proxy.conf", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../../infra/local/gateway/api.conf", import.meta.url),
    "utf8",
  );
  const rate =
    /^limit_req_zone\s+\$binary_remote_addr\s+zone=([a-z_][a-z0-9_]*):\S+\s+rate=([1-9][0-9]*)r\/(m|s);$/m.exec(
      proxy,
    );
  const burst =
    /^limit_req\s+zone=([a-z_][a-z0-9_]*)\s+burst=([1-9][0-9]*)\s+nodelay;$/m.exec(
      api,
    );
  if (!rate || !burst || rate[1] !== burst[1])
    throw new Error("IDENTITY_GATEWAY_CAPACITY_POLICY_INVALID");
  const milliseconds = Math.ceil(
    (Number(burst[2]) * (rate[3] === "m" ? 60000 : 1000)) / Number(rate[2]),
  );
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > 30000
  )
    throw new Error("IDENTITY_GATEWAY_CAPACITY_WAIT_EXCEEDS_BUDGET");
  // Each declared phase has fewer requests than the real gateway burst budget.
  // Draining a full burst also isolates consecutive browsers sharing one IP.
  await delay(milliseconds);
  return milliseconds;
}
export async function closeIdentityContext(context: BrowserContext) {
  try {
    await context.close();
  } catch {
    if (!closedContexts.has(context) && context.browser()?.isConnected())
      throw Error("IDENTITY_CONTEXT_CLEANUP_FAILED");
  }
}
export async function providerRegistrationError(page: Page) {
  for (const error of await page
    .locator(
      "#input-error, #input-error-email, #input-error-username, #input-error-password, #input-error-password-confirm, #kc-error-message .instruction, .alert-error .kc-feedback-text",
    )
    .all()) {
    const text = (await error.textContent())?.trim();
    if (!text) continue;
    if (["Username already exists.", "Username already exists"].includes(text))
      return "USERNAME_ALREADY_EXISTS";
    if (["Email already exists.", "Email already exists"].includes(text))
      return "EMAIL_ALREADY_EXISTS";
    if (text.startsWith("Invalid password:")) return "PASSWORD_POLICY_REJECTED";
    if (
      [
        "Please specify username.",
        "Please specify email.",
        "Please specify first name.",
        "Please specify last name.",
      ].includes(text)
    )
      return "REQUIRED_PROFILE_FIELD";
    return "UNRECOGNIZED_PROVIDER_FORM_ERROR";
  }
  return "none";
}

/** Account-specific geometry and keyboard checks use the real signed-in session, without visual captures. */
export async function checkAccountLayout(page: Page) {
  const initialTheme = await page
    .locator("html")
    .getAttribute("data-tholi-theme");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const focusVisible = async (control: Locator) => {
    await expect(control).toBeFocused();
    expect(
      await control.evaluate((element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return (
          element.matches(":focus-visible") &&
          style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth) >= 2 &&
          style.outlineColor !== "rgba(0, 0, 0, 0)" &&
          rect.left >= 7 &&
          rect.right <= innerWidth - 7
        );
      }),
    ).toBe(true);
  };
  for (const width of [320, 768, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(() => window.scrollTo(0, 0));
      if (
        (await page.locator("html").getAttribute("data-tholi-theme")) !== theme
      )
        await page
          .getByRole("button", { name: `Switch to ${theme} mode`, exact: true })
          .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-tholi-theme",
        theme,
      );
      const account = page.locator(".account-security");
      expect(
        await account
          .locator(".account-details dd")
          .evaluateAll((elements) =>
            elements.every(
              (element) => element.scrollWidth <= element.clientWidth + 1,
            ),
          ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const revoke = account.getByRole("button", {
        name: "Revoke this session",
        exact: true,
      });
      await revoke.scrollIntoViewIfNeeded();
      const target = await revoke.boundingBox();
      expect(!!target && target.width >= 44 && target.height >= 44).toBe(true);
      await revoke.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await focusVisible(revoke);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("alertdialog");
      await expect(
        dialog.getByRole("heading", {
          name: "Revoke this session?",
          exact: true,
        }),
      ).toBeVisible();
      const cancel = dialog.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      await cancel.focus();
      await focusVisible(cancel);
      await page.keyboard.press("Tab");
      await focusVisible(
        dialog.getByRole("button", { name: "Confirm", exact: true }),
      );
      expect(
        await dialog.evaluate((element) => {
          const style = getComputedStyle(element),
            rect = element.getBoundingClientRect();
          return (
            matchMedia("(prefers-reduced-motion: reduce)").matches &&
            style.animationName === "none" &&
            style.transitionDuration
              .split(",")
              .every(
                (duration) =>
                  parseFloat(duration) *
                    (duration.trim().endsWith("ms") ? 1 : 1000) <=
                  80,
              ) &&
            rect.left >= 0 &&
            rect.right <= innerWidth
          );
        }),
      ).toBe(true);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(0);
      await focusVisible(revoke);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (
    initialTheme &&
    (await page.locator("html").getAttribute("data-tholi-theme")) !==
      initialTheme
  )
    await page
      .getByRole("button", {
        name: `Switch to ${initialTheme} mode`,
        exact: true,
      })
      .click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

export function syntheticWebsiteIdentity(
  environment: NativeIdentityEnvironment,
) {
  const username = `tholi-e2e-${randomUUID()}`;
  return {
    username,
    email: `${username}@example.test`,
    password: environment.password,
    newPassword: `Local-${randomBytes(24).toString("base64url")}-9a`,
  };
}
export async function accountResponse(
  page: Page,
  environment: NativeIdentityEnvironment,
) {
  const response = await page.request.get(
    new URL("/api/v1/account", environment.serviceOrigin).href,
    { maxRedirects: 0, failOnStatusCode: false, timeout: 5_000 },
  );
  const raw: unknown = await response.json().catch(() => undefined);
  const account = identityAccountResponseSchema.safeParse(raw);
  const failure = serviceErrorEnvelopeSchema.safeParse(raw);
  if (response.ok() && !account.success)
    throw new WebsiteIdentityError("ACCOUNT_RESPONSE_INVALID");
  return {
    status: response.status(),
    value: response.ok() && account.success ? account.data : undefined,
    errorCode: response.ok()
      ? "none"
      : failure.success
        ? failure.data.error.code
        : "UNRECOGNIZED_ACCOUNT_ERROR",
  };
}
export async function waitForWebsiteAccount(
  page: Page,
  environment: NativeIdentityEnvironment,
) {
  await page.waitForURL(
    (url) =>
      url.origin === environment.webOrigin && url.pathname === "/account",
  );
  await expect(
    page.getByRole("heading", { name: "Account and security", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Renew session", exact: true }),
  ).toBeVisible();
  const result = await accountResponse(page, environment);
  if (result.status !== 200 || !result.value)
    throw new WebsiteIdentityError("ACCOUNT_SESSION_MISSING");
  return result.value;
}
export async function signInWebsite(
  page: Page,
  environment: NativeIdentityEnvironment,
  username: string,
  password: string,
) {
  await page.goto(environment.webOrigin + "/signin");
  await page
    .getByRole("link", { name: "Continue to sign in", exact: true })
    .click();
  await completeLocalProviderSignIn(page, environment, username, password);
  return waitForWebsiteAccount(page, environment);
}
/** Shared local provider form for website sign-in and ordinary operator PKCE. */
export async function completeLocalProviderSignIn(
  page: Page,
  environment: NativeIdentityEnvironment,
  username: string,
  password: string,
) {
  await page.waitForURL((url) => url.origin === environment.providerOrigin);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
}
/** Keycloak defers initial password setup until verified email; recovery uses the same real form. */
export async function setWebsitePassword(page: Page, password: string) {
  const form = page.locator("#kc-passwd-update-form");
  await expect(form).toBeVisible();
  await form.locator("#password-new").fill(password);
  await form.locator("#password-confirm").fill(password);
  await form.locator("#kc-submit").click();
  await expect(form).not.toBeVisible();
}
export async function identityContext(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  context.on("close", () => closedContexts.add(context));
  return context;
}
type MailMessage = { ID: string; To: { Address: string }[] };
async function mailJson(
  environment: NativeIdentityEnvironment,
  path: string,
): Promise<unknown> {
  const response = await fetch(new URL(path, environment.mailOrigin), {
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  });
  if (!response.ok) throw new WebsiteIdentityError("MAIL_CAPTURE_UNAVAILABLE");
  return response.json();
}
export async function capturedMessageIds(
  environment: NativeIdentityEnvironment,
  email: string,
) {
  const response = (await mailJson(
    environment,
    "/api/v1/messages?limit=100",
  )) as { messages?: MailMessage[] };
  if (!Array.isArray(response.messages))
    throw new WebsiteIdentityError("MAIL_RESPONSE_INVALID");
  return response.messages
    .filter(
      (message) =>
        Array.isArray(message.To) &&
        message.To.some((recipient) => recipient.Address === email),
    )
    .map((message) => message.ID);
}
/** Email bodies and one-use links stay in process memory; no screenshot, snapshot or artifact receives them. */
export async function localEmailAction(
  environment: NativeIdentityEnvironment,
  email: string,
  previous: string[],
) {
  let action: string | undefined;
  await expect
    .poll(
      async () => {
        const ids = (await capturedMessageIds(environment, email)).filter(
          (id) => !previous.includes(id),
        );
        for (const id of ids) {
          if (!/^[A-Za-z0-9_-]+$/.test(id))
            throw Error(
              "Local mail capture returned an invalid message identifier.",
            );
          const message = (await mailJson(
            environment,
            `/api/v1/message/${id}`,
          )) as { HTML?: string; Text?: string };
          const markup = [message.HTML, message.Text]
            .filter((value): value is string => typeof value === "string")
            .join("\n");
          for (const candidate of markup.matchAll(/https?:\/\/[^\s<>"']+/g)) {
            try {
              const url = new URL(
                candidate[0].replaceAll("&amp;", "&").replace(/[).,]+$/, ""),
              );
              if (
                url.origin === environment.providerOrigin &&
                url.pathname ===
                  "/realms/tholi-local/login-actions/action-token" &&
                url.searchParams.has("key") &&
                !url.username &&
                !url.password
              ) {
                action = url.href;
                return true;
              }
            } catch {
              /* Ignore non-action links without disclosing their contents. */
            }
          }
        }
        return false;
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
        message:
          "The configured provider delivers the synthetic identity action to local mail capture",
      },
    )
    .toBe(true);
  if (!action) throw new WebsiteIdentityError("ACTION_LINK_MISSING");
  return action;
}
export async function signOutWebsite(
  page: Page,
  environment: NativeIdentityEnvironment,
  provider = false,
) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Signed out of this Tholi session." }),
  ).toBeVisible();
  if ((await accountResponse(page, environment)).status !== 401)
    throw Error("The website logout did not revoke its account session.");
  if (provider) {
    const popupPromise = page.waitForEvent("popup");
    await page
      .getByRole("link", {
        name: "Also review sign-out with your identity provider",
        exact: true,
      })
      .click();
    const popup = await popupPromise;
    try {
      await popup.waitForURL(
        (url) => url.origin === environment.providerOrigin,
      );
      await popup.locator("#kc-logout").click();
      await popup.waitForURL(
        (url) =>
          url.origin === environment.webOrigin && url.pathname === "/download",
      );
    } finally {
      await popup.close();
    }
  }
}
export async function checkCookieBinding(
  browser: Browser,
  context: BrowserContext,
  callback: string,
  environment: NativeIdentityEnvironment,
) {
  const url = new URL(callback);
  if (
    url.origin !== environment.serviceOrigin ||
    url.pathname !== "/api/v1/auth/callback" ||
    !url.searchParams.has("code") ||
    !url.searchParams.has("state")
  )
    throw Error("The observed real provider callback was missing.");
  const foreign = await identityContext(browser);
  try {
    const unbound = await foreign.request.get(callback, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    const replay = await context.request.get(callback, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    if (unbound.status() !== 401 || replay.status() !== 401)
      throw Error(
        "A provider callback must reject missing cookie binding and completed-flow replay.",
      );
  } finally {
    await foreign.close();
  }
}
