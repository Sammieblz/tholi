import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  providerApiKeySchema,
  providerIdSchema,
} from "../../../../packages/navigation-core/contracts-providers";
import { serviceRevisionSchema } from "../../../../packages/navigation-core/contracts-service";
import {
  ProviderSecretError,
  sealedProviderSecretSchema,
  type ProviderSecretBinding,
  type ProviderSecretCipher,
  type SealedProviderSecret,
} from "../application/provider-connections";

const keyVersion = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const base64url = (value: string, size?: number) => {
  const bytes = Buffer.from(value, "base64url");
  if (
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    bytes.toString("base64url") !== value ||
    (size !== undefined && bytes.length !== size)
  )
    throw new ProviderSecretError();
  return bytes;
};
const keyringSchema = z
  .object({
    version: z.literal(1),
    activeVersion: keyVersion,
    keys: z.record(keyVersion, z.string().regex(/^[A-Za-z0-9_-]{43}$/)),
  })
  .strict()
  .superRefine((ring, context) => {
    const versions = Object.keys(ring.keys);
    if (
      versions.length < 1 ||
      versions.length > 8 ||
      !Object.hasOwn(ring.keys, ring.activeVersion)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid provider keyring versions.",
      });
  });
export type ProviderSecretKeyring = z.infer<typeof keyringSchema>;
export function validateProviderSecretKeyring(
  raw: unknown,
): ProviderSecretKeyring {
  try {
    const ring = keyringSchema.parse(raw);
    for (const value of Object.values(ring.keys)) base64url(value, 32);
    return Object.freeze({
      version: 1 as const,
      activeVersion: ring.activeVersion,
      keys: Object.freeze({ ...ring.keys }),
    });
  } catch {
    throw new ProviderSecretError();
  }
}
const bindingSchema = z
  .object({
    accountId: z.string().uuid(),
    connectionId: z.string().uuid(),
    provider: providerIdSchema,
    revision: serviceRevisionSchema,
  })
  .strict();
function aad(raw: ProviderSecretBinding, version: string) {
  const scope = bindingSchema.parse(raw);
  return Buffer.from(
    JSON.stringify([
      "tholi-provider-key",
      1,
      version,
      scope.accountId,
      scope.connectionId,
      scope.provider,
      scope.revision,
    ]),
    "utf8",
  );
}

/** Dedicated operator keys, separate from identity flow and private-file secrets. */
export function createProviderSecretCipher(
  raw: ProviderSecretKeyring,
): ProviderSecretCipher {
  const ring = validateProviderSecretKeyring(raw);
  const keys = new Map(
    Object.entries(ring.keys).map(([version, key]) => [
      version,
      base64url(key, 32),
    ]),
  );
  return Object.freeze({
    async seal(
      binding: ProviderSecretBinding,
      rawKey: string,
    ): Promise<SealedProviderSecret> {
      try {
        const key = providerApiKeySchema.parse(rawKey),
          iv = randomBytes(12);
        const cipher = createCipheriv(
          "aes-256-gcm",
          keys.get(ring.activeVersion)!,
          iv,
        );
        cipher.setAAD(aad(binding, ring.activeVersion));
        const plaintext = Buffer.from(key, "utf8");
        try {
          const ciphertext = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
          ]);
          return Object.freeze({
            version: 1 as const,
            keyVersion: ring.activeVersion,
            iv: iv.toString("base64url"),
            ciphertext: ciphertext.toString("base64url"),
            tag: cipher.getAuthTag().toString("base64url"),
          });
        } finally {
          plaintext.fill(0);
        }
      } catch {
        throw new ProviderSecretError();
      }
    },
    async open(
      binding: ProviderSecretBinding,
      rawSealed: SealedProviderSecret,
    ): Promise<string> {
      let plaintext: Buffer | undefined,
        first: Buffer | undefined,
        last: Buffer | undefined;
      try {
        const sealed = sealedProviderSecretSchema.parse(rawSealed),
          key = keys.get(sealed.keyVersion);
        if (!key) throw new ProviderSecretError();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          base64url(sealed.iv, 12),
        );
        decipher.setAAD(aad(binding, sealed.keyVersion));
        decipher.setAuthTag(base64url(sealed.tag, 16));
        first = decipher.update(base64url(sealed.ciphertext));
        last = decipher.final();
        plaintext = Buffer.concat([first, last]);
        return providerApiKeySchema.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
        );
      } catch {
        throw new ProviderSecretError();
      } finally {
        plaintext?.fill(0);
        first?.fill(0);
        last?.fill(0);
      }
    },
  });
}
