import { z } from "zod";
import { serviceRevisionSchema } from "./contracts-service";

const opaque = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const clientId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const instant = z.string().datetime({ offset: true });
export const identityActionSchema = z.enum([
  "signin",
  "signup",
  "recover",
  "verify",
]);
export const identityAuthorizeSchema = z
  .object({
    clientId,
    action: identityActionSchema.default("signin"),
    destination: z.enum(["account", "download", "client"]).default("account"),
    redirectUri: z.string().url().max(2048).optional(),
    state: opaque.optional(),
    codeChallenge: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
export const identityExchangeSchema = z
  .object({
    code: opaque,
    clientId,
    redirectUri: z.string().url().max(2048),
    codeVerifier: opaque,
  })
  .strict();
export const identityRefreshSchema = z
  .object({
    clientId,
    refreshToken: opaque.optional(),
  })
  .strict();
export const identityLogoutSchema = z
  .object({ all: z.boolean().optional() })
  .strict();
export const identityAccountSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    revision: serviceRevisionSchema,
  })
  .strict();
export const identitySessionSchema = z
  .object({
    id: z.string().uuid(),
    clientId,
    clientKind: z.enum(["web", "extension", "desktop"]),
    expiresAt: instant,
  })
  .strict();
export const identityAccountResponseSchema = z
  .object({
    account: identityAccountSchema,
    session: identitySessionSchema,
    csrfToken: opaque.optional(),
  })
  .strict();
export const identityTokensSchema = z
  .object({
    accessToken: opaque,
    refreshToken: opaque,
    expiresAt: instant,
    sessionExpiresAt: instant,
    sessionId: z.string().uuid(),
    account: identityAccountSchema,
  })
  .strict();
export const identitySessionsSchema = z
  .object({
    items: z
      .array(
        identitySessionSchema
          .extend({
            createdAt: instant,
            lastUsedAt: instant,
            current: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const identityLogoutResponseSchema = z
  .object({
    signedOut: z.literal(true),
    providerLogoutUrl: z.string().url().max(4096),
  })
  .strict();
export const identityRevokedSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export type IdentityAccountResponse = z.infer<
  typeof identityAccountResponseSchema
>;
export type IdentityTokens = z.infer<typeof identityTokensSchema>;
export type IdentityAuthorizeInput = z.infer<typeof identityAuthorizeSchema>;
