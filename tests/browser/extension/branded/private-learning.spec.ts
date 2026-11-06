import { test } from "../../../support/browser-test";
import { verifyWebDriverPrivateLearning } from "../../../support/webdriver-private-learning";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("chrome customer-funded guidance and private learning keep native authority", async ({}, info) => {
  await verifyWebDriverPrivateLearning("chromium", info);
});
