import { z } from "zod";
import { BILLING_LIMITS } from "../../../../packages/navigation-core/contracts-billing";
import { serviceRevisionSchema } from "../../../../packages/navigation-core/contracts-service";
import {
  BillingSecretError,
  type BillingLinkBinding,
  type BillingLinkCipher,
} from "../application/billing-contracts";
import {
  createSecretCipher,
  validateSecretKeyring,
  type SecretKeyring,
} from "./secret-cipher";

export type BillingLinkKeyring = SecretKeyring;
export function validateBillingLinkKeyring(raw: unknown): BillingLinkKeyring {
  try {
    return validateSecretKeyring(raw);
  } catch {
    throw new BillingSecretError();
  }
}
const bindingSchema = z
  .object({
    accountId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    operationId: z.string().uuid(),
    profileRevision: serviceRevisionSchema,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
function aad(raw: BillingLinkBinding, version: string, now: Date) {
  const binding = bindingSchema.parse(raw),
    remaining = Date.parse(binding.expiresAt) - now.getTime();
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > BILLING_LIMITS.returnSeconds * 1000
  )
    throw new BillingSecretError();
  return Buffer.from(
    JSON.stringify([
      "tholi-billing-link",
      1,
      version,
      binding.accountId,
      binding.workspaceId,
      binding.operationId,
      binding.profileRevision,
      binding.expiresAt,
    ]),
    "utf8",
  );
}
const linkSchema = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  });

/** Short-lived handoffs use their own operator keyring, never a provider/identity key. */
export function createBillingLinkCipher(
  raw: BillingLinkKeyring,
  now: () => Date = () => new Date(),
): BillingLinkCipher {
  const cipher = createSecretCipher(validateBillingLinkKeyring(raw));
  return Object.freeze({
    async seal(binding, url) {
      try {
        return await cipher.seal(linkSchema.parse(url), (version) =>
          aad(binding, version, now()),
        );
      } catch {
        throw new BillingSecretError();
      }
    },
    async open(binding, sealed) {
      try {
        return linkSchema.parse(
          await cipher.open(sealed, (version) => aad(binding, version, now())),
        );
      } catch {
        throw new BillingSecretError();
      }
    },
  } satisfies BillingLinkCipher);
}
