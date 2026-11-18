import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  secretKeyVersionSchema,
  sealedSecretSchema,
  type SealedSecret,
} from "../application/sealed-secret";

export class SecretCipherError extends Error {
  constructor() {
    super("The protected value is unavailable.");
    this.name = "SecretCipherError";
  }
}
const base64url = (value: string, size?: number) => {
  const bytes = Buffer.from(value, "base64url");
  if (
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    bytes.toString("base64url") !== value ||
    (size !== undefined && bytes.length !== size)
  )
    throw new SecretCipherError();
  return bytes;
};
const keyringSchema = z
  .object({
    version: z.literal(1),
    activeVersion: secretKeyVersionSchema,
    keys: z.record(
      secretKeyVersionSchema,
      z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    ),
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
        message: "Invalid keyring versions.",
      });
  });
export type SecretKeyring = z.infer<typeof keyringSchema>;
export function validateSecretKeyring(raw: unknown): SecretKeyring {
  try {
    const ring = keyringSchema.parse(raw);
    for (const value of Object.values(ring.keys)) base64url(value, 32);
    return Object.freeze({
      version: 1 as const,
      activeVersion: ring.activeVersion,
      keys: Object.freeze({ ...ring.keys }),
    });
  } catch {
    throw new SecretCipherError();
  }
}
type AdditionalData = (keyVersion: string) => Uint8Array;

/** Shared primitive; callers retain distinct keyrings, namespaces and value rules. */
export function createSecretCipher(raw: SecretKeyring) {
  const ring = validateSecretKeyring(raw);
  const keys = new Map(
    Object.entries(ring.keys).map(([version, key]) => [
      version,
      base64url(key, 32),
    ]),
  );
  return Object.freeze({
    async seal(value: string, aad: AdditionalData): Promise<SealedSecret> {
      let plaintext: Buffer | undefined;
      try {
        if (typeof value !== "string") throw new SecretCipherError();
        plaintext = Buffer.from(value, "utf8");
        if (plaintext.length < 1 || plaintext.length > 8192)
          throw new SecretCipherError();
        const iv = randomBytes(12),
          cipher = createCipheriv(
            "aes-256-gcm",
            keys.get(ring.activeVersion)!,
            iv,
          );
        cipher.setAAD(aad(ring.activeVersion));
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
      } catch {
        throw new SecretCipherError();
      } finally {
        plaintext?.fill(0);
      }
    },
    async open(rawSealed: SealedSecret, aad: AdditionalData): Promise<string> {
      let plaintext: Buffer | undefined,
        first: Buffer | undefined,
        last: Buffer | undefined;
      try {
        const sealed = sealedSecretSchema.parse(rawSealed),
          key = keys.get(sealed.keyVersion);
        if (!key) throw new SecretCipherError();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          base64url(sealed.iv, 12),
        );
        decipher.setAAD(aad(sealed.keyVersion));
        decipher.setAuthTag(base64url(sealed.tag, 16));
        first = decipher.update(base64url(sealed.ciphertext));
        last = decipher.final();
        plaintext = Buffer.concat([first, last]);
        return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
      } catch {
        throw new SecretCipherError();
      } finally {
        plaintext?.fill(0);
        first?.fill(0);
        last?.fill(0);
      }
    },
  });
}
