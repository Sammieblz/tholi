import { z } from "zod";
import {
  providerApiKeySchema,
  providerIdSchema,
} from "../../../../packages/navigation-core/contracts-providers";
import { serviceRevisionSchema } from "../../../../packages/navigation-core/contracts-service";
import {
  ProviderSecretError,
  type ProviderSecretBinding,
  type ProviderSecretCipher,
} from "../application/provider-connections";
import {
  createSecretCipher,
  validateSecretKeyring,
  type SecretKeyring,
} from "./secret-cipher";

export type ProviderSecretKeyring = SecretKeyring;
export function validateProviderSecretKeyring(
  raw: unknown,
): ProviderSecretKeyring {
  try {
    return validateSecretKeyring(raw);
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
  // Preserve the exact version-1 AAD for already stored credentials.
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

/** Provider keys keep their dedicated operator keyring and stored format. */
export function createProviderSecretCipher(
  raw: ProviderSecretKeyring,
): ProviderSecretCipher {
  const cipher = createSecretCipher(validateProviderSecretKeyring(raw));
  return Object.freeze({
    async seal(binding, rawKey) {
      try {
        return await cipher.seal(
          providerApiKeySchema.parse(rawKey),
          (version) => aad(binding, version),
        );
      } catch {
        throw new ProviderSecretError();
      }
    },
    async open(binding, sealed) {
      try {
        return providerApiKeySchema.parse(
          await cipher.open(sealed, (version) => aad(binding, version)),
        );
      } catch {
        throw new ProviderSecretError();
      }
    },
  } satisfies ProviderSecretCipher);
}
