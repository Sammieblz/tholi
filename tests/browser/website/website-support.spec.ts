import { test, expect } from "../../support/browser-test";

test("support links lead to a contact form that prepares email without claiming delivery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 850 });
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") submissions.push(request.url());
  });
  await page.goto("/support");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  await expect(page.locator("main h1")).toHaveText(
    "A little help, when you need it.",
  );
  await page
    .getByText("How do I install Tholi on Firefox?", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Firefox setup", exact: true }),
  ).toHaveAttribute("href", "/download");
  await page
    .getByRole("link", { name: "Contact support", exact: true })
    .click();
  await expect(page).toHaveURL(/\/contact\?topic=support$/);
  await expect(page.locator("main h1")).toBeFocused();
  await expect(page.getByLabel("What’s it about?")).toHaveValue("Support");
  await expect(page.locator("#contact-delivery-note")).toContainText(
    "Nothing is sent by this form",
  );
  await page
    .getByRole("button", { name: "Prepare message", exact: true })
    .click();
  const email = page.getByLabel("Email (required)", { exact: true });
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#contact-email-error")).toBeVisible();
  await page
    .getByLabel("Name (optional)", { exact: true })
    .fill("Example Reader");
  await email.fill("reader@example.com");
  const subject = page.getByLabel("Subject (required)", { exact: true });
  await subject.fill("Help & setup? #one");
  const message = page.getByLabel("Message (required)", { exact: true });
  await message.fill(
    "Firefox 153, Tholi 0.11.0. I need help after restarting.\nWhat should I do next?",
  );
  await page
    .getByRole("button", { name: "Prepare message", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Your message is ready to email.",
      exact: true,
    }),
  ).toBeFocused();
  const href = await page
    .getByRole("link", { name: "Open email draft", exact: true })
    .getAttribute("href");
  const draft = new URL(href!);
  expect(draft.protocol).toBe("mailto:");
  expect(draft.pathname).toBe("info@ilunonsen.com");
  expect(draft.searchParams.get("subject")).toBe(
    "[Tholi Support] Help & setup? #one",
  );
  expect(draft.searchParams.get("body")).toContain(
    "Reply to: reader@example.com",
  );
  expect(draft.searchParams.get("body")).toContain("\nWhat should I do next?");
  const prepared = page.getByLabel("Prepared message", { exact: true });
  await expect(prepared).toHaveAttribute("readonly", "");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Unavailable in fixture")),
      },
    });
  });
  await page.getByRole("button", { name: "Copy message", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Select and copy the prepared message below",
  );
  await expect(prepared).toHaveValue(/Help & setup\? #one/);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as Window & { copiedContact?: string }).copiedContact = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy message", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Message copied");
  expect(
    await page.evaluate(
      () => (window as Window & { copiedContact?: string }).copiedContact,
    ),
  ).toBe(await prepared.inputValue());
  await subject.fill("A revised subject");
  await expect(
    page.getByRole("link", { name: "Open email draft", exact: true }),
  ).toHaveCount(0);
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain("reader@example.com");
  expect(storage).not.toContain("Example Reader");
  expect(submissions).toEqual([]);
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Support", exact: true })
    .click();
  await expect(page).toHaveURL(/\/support$/);
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Contact", exact: true })
    .click();
  await expect(page).toHaveURL(/\/contact$/);
});
