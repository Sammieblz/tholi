import { z } from "zod";

export const secretKeyVersionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

/** Internal authenticated envelope. Domain owners supply and validate their AAD. */
export const sealedSecretSchema = z
  .object({
    version: z.literal(1),
    keyVersion: secretKeyVersionSchema,
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    ciphertext: z
      .string()
      .min(2)
      .max(10923)
      .regex(/^[A-Za-z0-9_-]+$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();

export interface SealedSecret {
  readonly version: 1;
  readonly keyVersion: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}
