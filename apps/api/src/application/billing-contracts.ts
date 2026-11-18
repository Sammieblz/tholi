import type { ServiceRequestContext } from "../capabilities";
import type { BillingMode } from "../../../../packages/navigation-core/contracts-billing";

export type BillingProviderErrorCode =
  | "CONFIGURATION"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "THROTTLED"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE"
  | "INVALID_SIGNATURE";

/** Closed classifications only. Raw provider messages, bodies and headers stay private. */
export class BillingProviderError extends Error {
  constructor(
    readonly code: BillingProviderErrorCode,
    readonly outcome: "not-sent" | "rejected" | "unknown" = "not-sent",
  ) {
    super("The billing provider operation could not be verified.");
    this.name = "BillingProviderError";
  }
}

export interface BillingEvent {
  id: string;
  type: string;
  objectId: string;
  live: boolean;
  /** A lookup hint only; current provider records must establish every relation. */
  operationReference?: string;
}
export interface BillingCheckout {
  id: string;
  operationReference: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: "open" | "complete" | "expired";
  url: string | null;
  expiresAt: Date;
}
export interface BillingProviderSubscription {
  id: string;
  customerId: string;
  priceId: string;
  status:
    | "active"
    | "trialing"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused";
  startsAt: Date;
  endsAt: Date;
  cancelAtPeriodEnd: boolean;
  invoiceId: string | null;
}
export interface BillingProviderInvoice {
  id: string;
  customerId: string;
  subscriptionId: string;
  priceId: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  amountPaidMinor: bigint;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  issuedAt: Date;
  // Non-prorated, one-item periods only. Ineligible invoices never mint credits.
  eligible: boolean;
}
export interface BillingPortal {
  id: string;
  /** Short-lived bearer capability; never export or retain it in plaintext. */
  url: string;
}

/** Only this adapter knows Stripe serialization. Application services own durable effects. */
export interface BillingProvider {
  readonly mode: BillingMode;
  verifyEvent(raw: Buffer, signature: string, now: Date): BillingEvent;
  createCheckout(
    input: {
      key: string;
      operationReference: string;
      customerId?: string;
      priceId: string;
      returnUrl: string;
    },
    context: ServiceRequestContext,
  ): Promise<BillingCheckout>;
  readCheckout(
    id: string,
    context: ServiceRequestContext,
  ): Promise<BillingCheckout>;
  readSubscription(
    id: string,
    context: ServiceRequestContext,
  ): Promise<BillingProviderSubscription>;
  readInvoice(
    id: string,
    context: ServiceRequestContext,
  ): Promise<BillingProviderInvoice>;
  createPortal(
    input: {
      key: string;
      customerId: string;
      returnUrl: string;
    },
    context: ServiceRequestContext,
  ): Promise<BillingPortal>;
}
