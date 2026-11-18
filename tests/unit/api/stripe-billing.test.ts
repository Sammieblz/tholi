import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import Stripe from "stripe";
import { expect, test, vi } from "vitest";
import {
  createStripeBilling,
  createStripeWebhookVerifier,
  STRIPE_API_VERSION,
} from "../../../apps/api/src/adapters/stripe-billing";
import { BillingProviderError } from "../../../apps/api/src/application/billing-contracts";
import { BILLING_LIMITS } from "../../../packages/navigation-core/contracts-billing";
import { withoutExternalProviders } from "../../support/provider-network-guard";

const options = {
  mode: "stripe-test" as const,
  secretKey: "sk_test_tholi_synthetic_key_never_sent_to_stripe",
  webhookSecrets: [
    "whsec_tholi_synthetic_current_key_12345678",
    "whsec_tholi_synthetic_previous_key_12345678",
  ],
  serviceOrigin: "http://127.0.0.1:5100",
  portalConfigurationId: "bpc_approved",
  approvedPriceIds: ["price_approved"],
};
const context = (
  signal = new AbortController().signal,
  milliseconds = 2000,
) => ({
  requestId: randomUUID(),
  signal,
  deadlineAt: Date.now() + milliseconds,
});
const now = new Date("2026-11-18T04:00:00Z"),
  start = 1794960000,
  end = start + 86400;
const returnUrl =
  options.serviceOrigin + "/api/v1/billing/return?flow=synthetic";
const operationReference = randomUUID();
const checkoutInput = (key = randomUUID()) => ({
  key,
  operationReference,
  customerId: "cus_owner",
  priceId: "price_approved",
  returnUrl,
});
const session = () => ({
  id: "cs_test_checkout",
  livemode: false,
  client_reference_id: operationReference,
  customer: "cus_owner",
  subscription: "sub_owner",
  status: "complete",
  url: "https://checkout.stripe.com/c/pay/cs_test_checkout#opaqueSyntheticFragment",
  expires_at: end,
});
const subscription = () => ({
  id: "sub_owner",
  livemode: false,
  customer: "cus_owner",
  status: "active",
  cancel_at_period_end: false,
  latest_invoice: "in_paid",
  items: {
    has_more: false,
    data: [
      {
        price: { id: "price_approved" },
        quantity: 1,
        current_period_start: start,
        current_period_end: end,
      },
    ],
  },
});
const invoice = () => ({
  id: "in_paid",
  livemode: false,
  customer: "cus_owner",
  created: start,
  status: "paid",
  currency: "usd",
  amount_paid: 100,
  amount_due: 100,
  amount_remaining: 0,
  collection_method: "charge_automatically",
  billing_reason: "subscription_cycle",
  parent: {
    type: "subscription_details",
    subscription_details: { subscription: "sub_owner" },
  },
  lines: {
    has_more: false,
    data: [
      {
        quantity: 1,
        currency: "usd",
        period: { start, end },
        pricing: {
          type: "price_details",
          price_details: { price: "price_approved" },
        },
        parent: {
          type: "subscription_item_details",
          subscription_item_details: {
            proration: false,
            subscription: "sub_owner",
          },
        },
      },
    ],
  },
});
const portal = () => ({
  id: "bpc_approved",
  active: true,
  livemode: false,
  features: {
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      proration_behavior: "none",
    },
    subscription_update: {
      enabled: true,
      billing_cycle_anchor: "unchanged",
      proration_behavior: "none",
      default_allowed_updates: ["price"],
      products: [
        { prices: ["price_approved"], adjustable_quantity: { enabled: false } },
      ],
    },
    subscription_pause: { enabled: false },
  },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("automated provider guard blocks all payment destinations before dispatch", async () => {
  const dispatch = vi.fn<typeof fetch>();
  const guarded = withoutExternalProviders(dispatch);
  for (const host of [
    "api.stripe.com",
    "checkout.stripe.com",
    "billing.stripe.com",
  ])
    await expect(guarded(`https://${host}/synthetic`)).rejects.toThrow(
      "External payment requests are disabled",
    );
  expect(dispatch).not.toHaveBeenCalled();
});

test("ingress-only signatures need no payment API credential and reject stale, future, altered and wrong-mode events without requests", () => {
  const dispatch = vi.spyOn(globalThis, "fetch"),
    adapter = createStripeWebhookVerifier({
      mode: options.mode,
      webhookSecrets: options.webhookSecrets,
    });
  try {
    const payload = JSON.stringify({
      id: "evt_paid",
      object: "event",
      type: "invoice.paid",
      livemode: false,
      data: {
        object: {
          id: "in_paid",
          customer_email: "synthetic-private@example.invalid",
        },
      },
    });
    const sign = (
      timestamp = now.getTime() / 1000,
      secret = options.webhookSecrets[1],
      body = payload,
    ) =>
      Stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret,
        timestamp,
      });
    expect(
      adapter.verifyEvent(
        Buffer.from(payload),
        sign() + ",v1=" + "0".repeat(64),
        now,
      ),
    ).toEqual({
      id: "evt_paid",
      type: "invoice.paid",
      objectId: "in_paid",
      live: false,
    });
    expect(
      adapter.verifyEvent(
        Buffer.from(payload),
        sign(undefined, options.webhookSecrets[0]),
        now,
      ).id,
    ).toBe("evt_paid");
    const referenced = JSON.stringify({
      ...JSON.parse(payload),
      data: {
        object: {
          id: "in_paid",
          customer_email: "synthetic-private@example.invalid",
          parent: {
            subscription_details: {
              metadata: { tholi_operation: operationReference },
            },
          },
        },
      },
    });
    expect(
      adapter.verifyEvent(
        Buffer.from(referenced),
        sign(undefined, undefined, referenced),
        now,
      ),
    ).toEqual({
      id: "evt_paid",
      type: "invoice.paid",
      objectId: "in_paid",
      live: false,
      operationReference,
    });
    const ambiguous = JSON.stringify({
      ...JSON.parse(payload),
      data: {
        object: {
          id: "in_paid",
          client_reference_id: operationReference,
          metadata: { tholi_operation: randomUUID() },
        },
      },
    });
    expect(
      adapter.verifyEvent(
        Buffer.from(ambiguous),
        sign(undefined, undefined, ambiguous),
        now,
      ).operationReference,
    ).toBeUndefined();
    for (const [body, header] of [
      [payload + " ", sign()],
      [payload, sign(now.getTime() / 1000 - 301)],
      [payload, sign(now.getTime() / 1000 + 301)],
      [payload, sign() + ",t=1"],
      [
        payload.replace('"livemode":false', '"livemode":true'),
        sign(
          undefined,
          undefined,
          payload.replace('"livemode":false', '"livemode":true'),
        ),
      ],
    ])
      expect(() => adapter.verifyEvent(Buffer.from(body), header, now)).toThrow(
        BillingProviderError,
      );
    expect(() =>
      adapter.verifyEvent(
        Buffer.alloc(BILLING_LIMITS.maxWebhookBytes + 1),
        sign(),
        now,
      ),
    ).toThrow(BillingProviderError);
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    dispatch.mockRestore();
  }
});

test("actual loopback HTTP preserves pinned API and idempotency headers, strips private fields and verifies a paid original invoice period", async () => {
  const observed: {
    path: string;
    method: string;
    version: string | string[] | undefined;
    key: string | string[] | undefined;
    body: string;
  }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    observed.push({
      path: req.url!,
      method: req.method!,
      version: req.headers["stripe-version"],
      key: req.headers["idempotency-key"],
      body: Buffer.concat(chunks).toString(),
    });
    const data =
      req.url === "/v1/account"
        ? { id: "acct_tholi", email: "synthetic-private@example.invalid" }
        : req.url === "/v1/checkout/sessions/cs_test_checkout/expire"
          ? { ...session(), status: "expired", url: null }
          : req.url === "/v1/checkout/sessions"
            ? session()
            : req.url?.startsWith("/v1/subscriptions/")
              ? {
                  ...subscription(),
                  ...(req.method === "DELETE"
                    ? { status: "canceled" }
                    : req.method === "POST"
                      ? { cancel_at_period_end: true }
                      : {}),
                }
              : req.url?.startsWith("/v1/invoices/")
                ? invoice()
                : req.url?.startsWith("/v1/billing_portal/configurations/")
                  ? portal()
                  : {
                      id: "bps_synthetic",
                      customer: "cus_owner",
                      configuration: "bpc_approved",
                      livemode: false,
                      url: "https://billing.stripe.com/p/session?secret=synthetic",
                    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture port missing");
  const dispatch: typeof fetch = (input, init) => {
    const target = new URL(String(input));
    expect(target.origin).toBe("https://api.stripe.com");
    return fetch(
      `http://127.0.0.1:${address.port}${target.pathname}${target.search}`,
      init,
    );
  };
  try {
    const adapter = createStripeBilling(options, dispatch),
      checkoutKey = randomUUID(),
      portalKey = randomUUID();
    expect(observed).toHaveLength(0);
    expect(await adapter.readMerchant(context())).toBe("acct_tholi");
    expect(
      await adapter.createCheckout(checkoutInput(checkoutKey), context()),
    ).toMatchObject({ id: "cs_test_checkout", customerId: "cus_owner" });
    expect(
      await adapter.readSubscription("sub_owner", context()),
    ).toMatchObject({
      priceId: "price_approved",
      startsAt: new Date(start * 1000),
      endsAt: new Date(end * 1000),
    });
    expect(await adapter.readInvoice("in_paid", context())).toMatchObject({
      eligible: true,
      amountPaidMinor: 100n,
      startsAt: new Date(start * 1000),
      endsAt: new Date(end * 1000),
    });
    expect(
      await adapter.createPortal(
        { key: portalKey, customerId: "cus_owner", returnUrl },
        context(),
      ),
    ).toEqual({
      id: "bps_synthetic",
      url: "https://billing.stripe.com/p/session?secret=synthetic",
    });
    const cleanupKeys = [randomUUID(), randomUUID(), randomUUID()];
    expect(
      await adapter.expireCheckout(
        {
          id: "cs_test_checkout",
          key: cleanupKeys[0],
          operationReference,
          customerId: "cus_owner",
        },
        context(),
      ),
    ).toMatchObject({ status: "expired", url: null });
    for (const [index, timing] of (
      ["period-end", "immediate"] as const
    ).entries())
      expect(
        await adapter.cancelSubscription(
          {
            id: "sub_owner",
            key: cleanupKeys[index + 1],
            customerId: "cus_owner",
            timing,
          },
          context(),
        ),
      ).toMatchObject(
        timing === "immediate"
          ? { status: "canceled" }
          : { cancelAtPeriodEnd: true },
      );
    expect(
      observed.every((request) => request.version === STRIPE_API_VERSION),
    ).toBe(true);
    for (const key of [checkoutKey, portalKey, ...cleanupKeys])
      expect(observed.filter((request) => request.key === key)).toHaveLength(1);
    expect(
      new URLSearchParams(
        observed.find((entry) => entry.path === "/v1/checkout/sessions")!.body,
      ).get("client_reference_id"),
    ).toBe(operationReference);
    expect(
      new URLSearchParams(
        observed.find((entry) => entry.path === "/v1/checkout/sessions")!.body,
      ).get("line_items[0][quantity]"),
    ).toBe("1");
    expect(
      observed.some((request) => request.body.includes("example.invalid")),
    ).toBe(false);
    expect(
      observed.filter((entry) => entry.path === "/v1/account"),
    ).toHaveLength(1);
    const cleanup = observed.filter(
      (entry) => entry.key && cleanupKeys.includes(entry.key as string),
    );
    expect(cleanup.map((entry) => [entry.method, entry.path])).toEqual([
      ["POST", "/v1/checkout/sessions/cs_test_checkout/expire"],
      ["POST", "/v1/subscriptions/sub_owner"],
      ["DELETE", "/v1/subscriptions/sub_owner"],
    ]);
    expect(
      new URLSearchParams(cleanup[1].body).get("cancel_at_period_end"),
    ).toBe("true");
    expect(Object.fromEntries(new URLSearchParams(cleanup[2].body))).toEqual({
      invoice_now: "false",
      prorate: "false",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test.each(["checkout", "subscription", "invoice"] as const)(
  "%s replies cannot substitute another provider reference",
  async (kind) => {
    const payload =
      kind === "checkout"
        ? { ...session(), id: "cs_test_foreign" }
        : kind === "subscription"
          ? { ...subscription(), id: "sub_foreign" }
          : { ...invoice(), id: "in_foreign" };
    const adapter = createStripeBilling(
      options,
      vi.fn<typeof fetch>().mockResolvedValue(json(payload)),
    );
    const result =
      kind === "checkout"
        ? adapter.readCheckout("cs_test_checkout", context())
        : kind === "subscription"
          ? adapter.readSubscription("sub_owner", context())
          : adapter.readInvoice("in_paid", context());
    await expect(result).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  },
);

test.each(["expiry", "period-end", "immediate"] as const)(
  "%s cleanup rejects another customer, object, mode or unconfirmed outcome",
  async (kind) => {
    const expired = { ...session(), status: "expired", url: null },
      cancelled = {
        ...subscription(),
        status: kind === "immediate" ? "canceled" : "active",
        cancel_at_period_end: kind === "period-end",
      };
    for (const change of kind === "expiry"
      ? [
          { id: "cs_test_foreign" },
          { customer: "cus_foreign" },
          { livemode: true },
          { client_reference_id: randomUUID() },
          { status: "open" },
        ]
      : [
          { id: "sub_foreign" },
          { customer: "cus_foreign" },
          { livemode: true },
          kind === "immediate"
            ? { status: "active" }
            : { cancel_at_period_end: false },
        ]) {
      const dispatch = vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            json({ ...(kind === "expiry" ? expired : cancelled), ...change }),
          ),
        adapter = createStripeBilling(options, dispatch);
      await expect(
        kind === "expiry"
          ? adapter.expireCheckout(
              {
                id: "cs_test_checkout",
                key: randomUUID(),
                operationReference,
                customerId: "cus_owner",
              },
              context(),
            )
          : adapter.cancelSubscription(
              {
                id: "sub_owner",
                key: randomUUID(),
                customerId: "cus_owner",
                timing: kind,
              },
              context(),
            ),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE", outcome: "unknown" });
      expect(dispatch).toHaveBeenCalledTimes(1);
    }
  },
);

test("checkout cannot substitute another customer or return a non-Stripe launch URL", async () => {
  for (const payload of [
    { ...session(), customer: "cus_foreign" },
    { ...session(), client_reference_id: randomUUID() },
    { ...session(), url: "https://attacker.invalid/checkout" },
  ]) {
    const adapter = createStripeBilling(
      options,
      vi.fn<typeof fetch>().mockResolvedValue(json(payload)),
    );
    await expect(
      adapter.createCheckout(
        {
          key: randomUUID(),
          operationReference,
          customerId: "cus_owner",
          priceId: "price_approved",
          returnUrl,
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  }
});

test("portal configuration changes cannot introduce unapproved prices or immediate cancellation", async () => {
  const unsafePrice = portal();
  unsafePrice.features.subscription_update.products[0].prices = [
    "price_foreign",
  ];
  const immediate = portal();
  immediate.features.subscription_cancel.mode = "immediately";
  for (const configuration of [unsafePrice, immediate]) {
    const dispatch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(json(configuration)),
      adapter = createStripeBilling(options, dispatch);
    await expect(
      adapter.createPortal(
        { key: randomUUID(), customerId: "cus_owner", returnUrl },
        context(),
      ),
    ).rejects.toBeInstanceOf(BillingProviderError);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1]?.method).toBe("GET");
  }
});

test("first checkout can create its customer inside Stripe without another external mutation", async () => {
  const dispatch = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      ...session(),
      customer: null,
      subscription: null,
      status: "open",
    }),
  );
  const adapter = createStripeBilling(options, dispatch);
  const { customerId: _customer, ...input } = checkoutInput();
  expect(await adapter.createCheckout(input, context())).toMatchObject({
    customerId: null,
    operationReference,
    status: "open",
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
  const body = new URLSearchParams(dispatch.mock.calls[0][1]?.body as string);
  expect(body.has("customer")).toBe(false);
  expect(body.get("subscription_data[metadata][tholi_operation]")).toBe(
    operationReference,
  );
});

test("invalid return targets and portal operation keys cannot dispatch even a configuration read", async () => {
  const dispatch = vi.fn<typeof fetch>(),
    adapter = createStripeBilling(options, dispatch);
  for (const destination of [
    "not a URL",
    "https://attacker.invalid/api/v1/billing/return",
    options.serviceOrigin + "/api/v1/auth/callback",
  ])
    await expect(
      adapter.createPortal(
        { key: randomUUID(), customerId: "cus_owner", returnUrl: destination },
        context(),
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION", outcome: "not-sent" });
  await expect(
    adapter.createPortal(
      { key: "short", customerId: "cus_owner", returnUrl },
      context(),
    ),
  ).rejects.toMatchObject({ code: "CONFIGURATION" });
  expect(dispatch).not.toHaveBeenCalled();
});

test("portal replies cannot substitute another customer's session or mode", async () => {
  for (const changed of [
    { customer: "cus_foreign" },
    { livemode: true },
    { configuration: "bpc_foreign" },
  ]) {
    const dispatch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(portal()))
      .mockResolvedValueOnce(
        json({
          id: "bps_synthetic",
          customer: "cus_owner",
          configuration: "bpc_approved",
          livemode: false,
          url: "https://billing.stripe.com/p/session?secret=synthetic",
          ...changed,
        }),
      );
    const adapter = createStripeBilling(options, dispatch);
    await expect(
      adapter.createPortal(
        { key: randomUUID(), customerId: "cus_owner", returnUrl },
        context(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  }
});

test.each([400, 429, 500])(
  "HTTP %s remains a closed classified single dispatch without leaking the provider body",
  async (status) => {
    const dispatch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json(
          { error: { message: "SYNTHETIC_PRIVATE_PROVIDER_ERROR" } },
          status,
        ),
      );
    const adapter = createStripeBilling(options, dispatch);
    await expect(
      adapter.createCheckout(checkoutInput(), context()),
    ).rejects.toMatchObject({
      outcome: status === 500 ? "unknown" : "rejected",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  },
);

test("a connection reset after dispatch remains uncertain and is never retried", async () => {
  const dispatch = vi.fn<typeof fetch>().mockRejectedValue(
    Object.assign(new Error("synthetic private error"), {
      code: "ECONNRESET",
    }),
  );
  const adapter = createStripeBilling(options, dispatch);
  await expect(
    adapter.createCheckout(checkoutInput(), context()),
  ).rejects.toMatchObject({
    code: "UNAVAILABLE",
    outcome: "unknown",
    message: "The billing provider operation could not be verified.",
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test("deadlines fence a transport that ignores cancellation and an already aborted request sends nothing", async () => {
  const dispatch = vi
    .fn<typeof fetch>()
    .mockImplementation(() => new Promise(() => {}));
  const adapter = createStripeBilling(options, dispatch);
  await expect(
    adapter.createCheckout(checkoutInput(), context(undefined, 15)),
  ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED", outcome: "unknown" });
  expect(dispatch).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  dispatch.mockClear();
  await expect(
    adapter.createCheckout(checkoutInput(), context(controller.signal)),
  ).rejects.toMatchObject({ code: "CANCELLED", outcome: "not-sent" });
  expect(dispatch).not.toHaveBeenCalled();
});

test.each(["oversized", "html", "invalid-json"])(
  "%s responses stop at the bounded decoder",
  async (kind) => {
    const response =
      kind === "oversized"
        ? new Response(" ".repeat(BILLING_LIMITS.maxResponseBytes + 1), {
            headers: { "Content-Type": "application/json" },
          })
        : kind === "html"
          ? new Response("synthetic private response", {
              headers: { "Content-Type": "text/html" },
            })
          : new Response("{", {
              headers: { "Content-Type": "application/json" },
            });
    const dispatch = vi.fn<typeof fetch>().mockResolvedValue(response),
      adapter = createStripeBilling(options, dispatch);
    await expect(
      adapter.createCheckout(checkoutInput(), context()),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", outcome: "unknown" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  },
);

test("prorated, unpaid and off-cycle invoices cannot mint period credits", async () => {
  const prorated = invoice();
  prorated.lines.data[0].parent.subscription_item_details.proration = true;
  const unpaid = invoice();
  unpaid.status = "open";
  unpaid.amount_remaining = 100;
  const changed = invoice();
  changed.billing_reason = "subscription_update";
  for (const payload of [prorated, unpaid, changed]) {
    const adapter = createStripeBilling(
      options,
      vi.fn<typeof fetch>().mockResolvedValue(json(payload)),
    );
    expect((await adapter.readInvoice("in_paid", context())).eligible).toBe(
      false,
    );
  }
});
