import Stripe from "stripe";
import { z } from "zod";
import { BILLING_LIMITS } from "../../../../packages/navigation-core/contracts-billing";
import { serviceOrigin } from "../../../../packages/navigation-core/service-client";
import type { ServiceRequestContext } from "../capabilities";
import {
  BillingProviderError,
  type BillingProvider,
  type BillingEventVerifier,
  type BillingCheckout,
  type BillingEvent,
} from "../application/billing-contracts";
import { createAdapterHttp, type AdapterHttpErrorCode } from "./adapter-http";

export const STRIPE_API_VERSION = "2026-10-28.endive";
const reference = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,120}$`));
const seconds = z.number().int().min(0).max(253402300799);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[a-z]{3}$/);
const customerId = reference("cus"),
  subscriptionId = reference("sub"),
  invoiceId = reference("in");
const price = z.object({ id: reference("price") });
function inputValue<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BillingProviderError("CONFIGURATION");
  return parsed.data;
}
function bindReference<T extends { id: string }>(
  value: T,
  expected: string,
): T {
  if (value.id !== expected)
    throw new BillingProviderError("INVALID_RESPONSE", "unknown");
  return value;
}
const checkout = z.object({
  id: reference("cs"),
  livemode: z.boolean(),
  client_reference_id: z.string().uuid(),
  customer: customerId.nullable(),
  subscription: subscriptionId.nullable(),
  status: z.enum(["open", "complete", "expired"]),
  url: z.string().nullable(),
  expires_at: seconds,
});
const operationMetadata = z.object({ tholi_operation: z.unknown().optional() });
const event = z.object({
  id: reference("evt"),
  type: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z_]+(?:\.[a-z_]+)+$/),
  livemode: z.boolean(),
  data: z.object({
    object: z.object({
      id: z.string().regex(/^[a-z]+_[A-Za-z0-9_]{1,120}$/),
      client_reference_id: z.unknown().optional(),
      metadata: operationMetadata.optional(),
      parent: z
        .object({
          subscription_details: z
            .object({ metadata: operationMetadata.optional() })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    }),
  }),
});
const subscription = z.object({
  id: subscriptionId,
  livemode: z.boolean(),
  customer: customerId,
  status: z.enum([
    "active",
    "trialing",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
  ]),
  cancel_at_period_end: z.boolean(),
  latest_invoice: invoiceId.nullable(),
  items: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z.object({
          price,
          quantity: z.literal(1),
          current_period_start: seconds,
          current_period_end: seconds,
        }),
      )
      .length(1),
  }),
});
const invoice = z.object({
  id: invoiceId,
  livemode: z.boolean(),
  customer: customerId,
  created: seconds,
  status: z.enum(["draft", "open", "paid", "void", "uncollectible"]),
  currency,
  amount_paid: minor,
  amount_due: minor,
  amount_remaining: minor,
  collection_method: z.string(),
  billing_reason: z.string(),
  parent: z.object({
    type: z.literal("subscription_details"),
    subscription_details: z.object({ subscription: subscriptionId }),
  }),
  lines: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z.object({
          quantity: z.literal(1),
          currency,
          period: z.object({ start: seconds, end: seconds }),
          pricing: z.object({
            type: z.literal("price_details"),
            price_details: z.object({ price: reference("price") }),
          }),
          parent: z.object({
            type: z.literal("subscription_item_details"),
            subscription_item_details: z.object({
              proration: z.boolean(),
              subscription: subscriptionId,
            }),
          }),
        }),
      )
      .length(1),
  }),
});
const portalConfiguration = z.object({
  id: reference("bpc"),
  active: z.literal(true),
  livemode: z.boolean(),
  features: z.object({
    subscription_cancel: z.object({
      enabled: z.literal(true),
      mode: z.literal("at_period_end"),
      proration_behavior: z.literal("none"),
    }),
    subscription_update: z.object({
      enabled: z.literal(true),
      billing_cycle_anchor: z.literal("unchanged").nullable(),
      proration_behavior: z.literal("none"),
      default_allowed_updates: z.array(z.literal("price")).length(1),
      products: z
        .array(
          z.object({
            prices: z.array(reference("price")).min(1).max(8),
            adjustable_quantity: z.object({ enabled: z.literal(false) }),
          }),
        )
        .min(1)
        .max(8),
    }),
    subscription_pause: z.object({ enabled: z.literal(false) }),
  }),
});

export interface StripeWebhookOptions {
  mode: "stripe-test" | "stripe-live";
  webhookSecrets: readonly string[];
}
export interface StripeBillingOptions extends StripeWebhookOptions {
  secretKey: string;
  serviceOrigin: string;
  portalConfigurationId: string;
  approvedPriceIds: readonly string[];
}
function providerUrl(raw: string, kind: "checkout" | "portal") {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BillingProviderError("INVALID_RESPONSE", "unknown");
  }
  const approved =
    kind === "checkout"
      ? url.origin === "https://checkout.stripe.com" &&
        /^\/(?:c\/pay|pay)\/cs_[A-Za-z0-9_]+$/.test(url.pathname)
      : url.origin === "https://billing.stripe.com" &&
        /^\/p\/session(?:\/|$)/.test(url.pathname);
  if (
    !approved ||
    url.username ||
    url.password ||
    (kind === "portal" && url.hash) ||
    raw.length > 4096
  )
    throw new BillingProviderError("INVALID_RESPONSE", "unknown");
  return url.href;
}

/** Ingress verifies signed bytes without holding a payment API credential. */
export function createStripeWebhookVerifier(
  raw: StripeWebhookOptions,
): BillingEventVerifier {
  const parsed = z
    .object({
      mode: z.enum(["stripe-test", "stripe-live"]),
      webhookSecrets: z
        .array(z.string().regex(/^whsec_[A-Za-z0-9_]{24,240}$/))
        .min(1)
        .max(2),
    })
    .safeParse(raw);
  if (!parsed.success) throw new BillingProviderError("CONFIGURATION");
  const options = parsed.data;
  return Object.freeze({
    mode: options.mode,
    verifyEvent(raw: Buffer, signature: string, now: Date): BillingEvent {
      if (
        !Buffer.isBuffer(raw) ||
        raw.length > BILLING_LIMITS.maxWebhookBytes ||
        typeof signature !== "string" ||
        Buffer.byteLength(signature) > BILLING_LIMITS.maxSignatureBytes ||
        !Number.isFinite(now.getTime())
      )
        throw new BillingProviderError("INVALID_SIGNATURE");
      const timestamps = signature
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.startsWith("t="));
      if (
        timestamps.length !== 1 ||
        !/^t=\d{1,12}$/.test(timestamps[0]) ||
        Math.abs(now.getTime() / 1000 - Number(timestamps[0].slice(2))) >
          BILLING_LIMITS.signatureToleranceSeconds
      )
        throw new BillingProviderError("INVALID_SIGNATURE");
      for (const secret of options.webhookSecrets) {
        try {
          const verified = event.parse(
            Stripe.webhooks.constructEvent(
              raw,
              signature,
              secret,
              BILLING_LIMITS.signatureToleranceSeconds,
              undefined,
              now.getTime(),
            ),
          );
          if (verified.livemode !== (options.mode === "stripe-live"))
            throw new Error();
          const object = verified.data.object;
          const hints = [
            object.client_reference_id,
            object.metadata?.tholi_operation,
            object.parent?.subscription_details?.metadata?.tholi_operation,
          ].flatMap((value) => {
            const id = z.string().uuid().safeParse(value);
            return id.success ? [id.data] : [];
          });
          const references = [...new Set(hints)];
          return {
            id: verified.id,
            type: verified.type,
            objectId: verified.data.object.id,
            live: verified.livemode,
            ...(references.length === 1
              ? { operationReference: references[0] }
              : {}),
          };
        } catch {
          /* Try the other explicitly configured rotation key, never another provider. */
        }
      }
      throw new BillingProviderError("INVALID_SIGNATURE");
    },
  });
}

/** SDK verification stays here. HTTP uses the existing bounded, single-send transport. */
export function createStripeBilling(
  raw: StripeBillingOptions,
  transport: typeof fetch = fetch,
): BillingProvider {
  const verifier = createStripeWebhookVerifier(raw);
  const options = {
    ...raw,
    approvedPriceIds: [...raw.approvedPriceIds],
  };
  const expectedPrefix =
    options.mode === "stripe-live" ? "sk_live_" : "sk_test_";
  if (
    !["stripe-test", "stripe-live"].includes(options.mode) ||
    !options.secretKey.startsWith(expectedPrefix) ||
    !/^sk_(test|live)_[A-Za-z0-9_]{16,240}$/.test(options.secretKey) ||
    !reference("bpc").safeParse(options.portalConfigurationId).success ||
    !options.approvedPriceIds.length ||
    options.approvedPriceIds.length > 8 ||
    new Set(options.approvedPriceIds).size !==
      options.approvedPriceIds.length ||
    options.approvedPriceIds.some(
      (id) => !reference("price").safeParse(id).success,
    )
  )
    throw new BillingProviderError("CONFIGURATION");
  let origin: string;
  try {
    origin = serviceOrigin(options.serviceOrigin);
  } catch {
    throw new BillingProviderError("CONFIGURATION");
  }
  const returnUrl = (raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BillingProviderError("CONFIGURATION");
    }
    if (
      url.origin !== origin ||
      url.pathname !== "/api/v1/billing/return" ||
      url.hash ||
      url.username ||
      url.password ||
      raw.length > 4096
    )
      throw new BillingProviderError("CONFIGURATION");
    return url.href;
  };
  const key = z
    .string()
    .min(16)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/);
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    context: ServiceRequestContext,
    body?: URLSearchParams,
    operationKey?: string,
  ): Promise<T> {
    let dispatched = false,
      rejected = false;
    const fail = (code: AdapterHttpErrorCode) =>
      new BillingProviderError(
        code === "INVALID_INPUT"
          ? "CONFIGURATION"
          : code === "INVALID_OUTPUT" || code === "BUDGET_EXCEEDED"
            ? "INVALID_RESPONSE"
            : code,
        rejected ? "rejected" : dispatched ? "unknown" : "not-sent",
      );
    const http = createAdapterHttp(context, BILLING_LIMITS.maxDeadlineMs, fail);
    try {
      if (operationKey !== undefined) inputValue(key, operationKey);
      const response = await http.within(() => {
        // No automatic retry, including connection-reset retries in SDK request senders.
        if (dispatched) throw fail("UNAVAILABLE");
        dispatched = true;
        return transport("https://api.stripe.com/v1/" + path, {
          method: body ? "POST" : "GET",
          redirect: "error",
          cache: "no-store",
          signal: http.signal,
          headers: {
            Authorization: "Bearer " + options.secretKey,
            "Stripe-Version": STRIPE_API_VERSION,
            Accept: "application/json",
            ...(body
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
            ...(operationKey ? { "Idempotency-Key": operationKey } : {}),
          },
          ...(body ? { body: body.toString() } : {}),
        });
      });
      if (!response.ok) {
        rejected = [400, 401, 403, 404, 422, 429].includes(response.status);
        void response.body?.cancel().catch(() => {});
        throw fail(
          response.status === 429
            ? "THROTTLED"
            : [401, 403].includes(response.status)
              ? "CONFIGURATION"
              : "UNAVAILABLE",
        );
      }
      const value = schema.safeParse(
        await http.json(response, BILLING_LIMITS.maxResponseBytes),
      );
      if (!value.success) throw fail("INVALID_OUTPUT");
      return value.data;
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      throw fail("UNAVAILABLE");
    } finally {
      http.close();
    }
  }
  function projectCheckout(value: z.infer<typeof checkout>): BillingCheckout {
    if (value.livemode !== (options.mode === "stripe-live"))
      throw new BillingProviderError("INVALID_RESPONSE", "unknown");
    const url = value.url === null ? null : providerUrl(value.url, "checkout");
    if (url && !new URL(url).pathname.endsWith("/" + value.id))
      throw new BillingProviderError("INVALID_RESPONSE", "unknown");
    return {
      id: value.id,
      operationReference: value.client_reference_id,
      customerId: value.customer,
      subscriptionId: value.subscription,
      status: value.status,
      url,
      expiresAt: new Date(value.expires_at * 1000),
    };
  }
  return {
    ...verifier,
    async createCheckout(input, context) {
      if (input.customerId !== undefined)
        inputValue(customerId, input.customerId);
      inputValue(z.string().uuid(), input.operationReference);
      inputValue(reference("price"), input.priceId);
      if (!options.approvedPriceIds.includes(input.priceId))
        throw new BillingProviderError("CONFIGURATION");
      const complete = new URL(returnUrl(input.returnUrl)),
        cancel = new URL(complete);
      complete.searchParams.set("outcome", "complete");
      cancel.searchParams.set("outcome", "cancelled");
      const value = await request(
        "checkout/sessions",
        checkout,
        context,
        new URLSearchParams({
          ...(input.customerId ? { customer: input.customerId } : {}),
          client_reference_id: input.operationReference,
          "subscription_data[metadata][tholi_operation]":
            input.operationReference,
          "payment_method_types[0]": "card",
          mode: "subscription",
          "line_items[0][price]": input.priceId,
          "line_items[0][quantity]": "1",
          success_url: complete.href,
          cancel_url: cancel.href,
          allow_promotion_codes: "false",
        }),
        input.key,
      );
      if (
        value.client_reference_id !== input.operationReference ||
        (input.customerId !== undefined && value.customer !== input.customerId)
      )
        throw new BillingProviderError("INVALID_RESPONSE", "unknown");
      return projectCheckout(value);
    },
    async readCheckout(id, context) {
      const expected = inputValue(reference("cs"), id);
      return projectCheckout(
        bindReference(
          await request("checkout/sessions/" + expected, checkout, context),
          expected,
        ),
      );
    },
    async readSubscription(id, context) {
      const expected = inputValue(subscriptionId, id);
      const value = bindReference(
          await request("subscriptions/" + expected, subscription, context),
          expected,
        ),
        item = value.items.data[0];
      if (
        value.livemode !== (options.mode === "stripe-live") ||
        item.current_period_end <= item.current_period_start
      )
        throw new BillingProviderError("INVALID_RESPONSE", "unknown");
      return {
        id: value.id,
        customerId: value.customer,
        priceId: item.price.id,
        status: value.status,
        startsAt: new Date(item.current_period_start * 1000),
        endsAt: new Date(item.current_period_end * 1000),
        cancelAtPeriodEnd: value.cancel_at_period_end,
        invoiceId: value.latest_invoice,
      };
    },
    async readInvoice(id, context) {
      const expected = inputValue(invoiceId, id);
      const value = bindReference(
          await request("invoices/" + expected, invoice, context),
          expected,
        ),
        line = value.lines.data[0];
      if (
        value.livemode !== (options.mode === "stripe-live") ||
        line.period.end <= line.period.start ||
        line.parent.subscription_item_details.subscription !==
          value.parent.subscription_details.subscription ||
        line.currency !== value.currency
      )
        throw new BillingProviderError("INVALID_RESPONSE", "unknown");
      return {
        id: value.id,
        customerId: value.customer,
        subscriptionId: value.parent.subscription_details.subscription,
        priceId: line.pricing.price_details.price,
        status: value.status,
        amountPaidMinor: BigInt(value.amount_paid),
        currency: value.currency,
        startsAt: new Date(line.period.start * 1000),
        endsAt: new Date(line.period.end * 1000),
        issuedAt: new Date(value.created * 1000),
        eligible:
          value.status === "paid" &&
          value.amount_remaining === 0 &&
          value.amount_paid > 0 &&
          value.amount_paid >= value.amount_due &&
          value.collection_method === "charge_automatically" &&
          ["subscription_create", "subscription_cycle"].includes(
            value.billing_reason,
          ) &&
          !line.parent.subscription_item_details.proration,
      };
    },
    async createPortal(input, context) {
      inputValue(customerId, input.customerId);
      inputValue(key, input.key);
      const destination = returnUrl(input.returnUrl);
      const configuration = await request(
        "billing_portal/configurations/" + options.portalConfigurationId,
        portalConfiguration,
        context,
      );
      if (
        configuration.id !== options.portalConfigurationId ||
        configuration.livemode !== (options.mode === "stripe-live") ||
        configuration.features.subscription_update.products.some((product) =>
          product.prices.some((id) => !options.approvedPriceIds.includes(id)),
        )
      )
        throw new BillingProviderError("CONFIGURATION");
      const result = await request(
        "billing_portal/sessions",
        z.object({
          id: reference("bps"),
          customer: customerId,
          configuration: reference("bpc"),
          livemode: z.boolean(),
          url: z.string(),
        }),
        context,
        new URLSearchParams({
          customer: input.customerId,
          configuration: options.portalConfigurationId,
          return_url: destination,
        }),
        input.key,
      );
      if (
        result.customer !== input.customerId ||
        result.configuration !== options.portalConfigurationId ||
        result.livemode !== (options.mode === "stripe-live")
      )
        throw new BillingProviderError("INVALID_RESPONSE", "unknown");
      return { id: result.id, url: providerUrl(result.url, "portal") };
    },
  };
}
