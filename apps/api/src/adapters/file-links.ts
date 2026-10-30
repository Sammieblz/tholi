import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { serviceRevisionSchema } from "../../../../packages/navigation-core/contracts-service";
import { SUPPORT_LIMITS } from "../../../../packages/navigation-core/contracts-support";
import type { FileLinks } from "../application/support-contracts";

const scopeSchema = z
  .object({
    accountId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    fileId: z.string().uuid(),
    revision: serviceRevisionSchema,
  })
  .strict();
const issuer = "tholi-private-files";
const audience = "tholi-authenticated-download";

/** Proof only: possession never replaces a current authenticated account and file lookup. */
export function createFileLinks(secret: string): FileLinks {
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== secret)
    throw new Error("Use a separate generated private-file signing key.");
  return {
    async issue({ expiresAt, ...input }) {
      const scope = scopeSchema.parse(input);
      const now = Math.floor(Date.now() / 1000);
      const expiry = Math.floor(expiresAt.getTime() / 1000);
      if (
        expiry <= now ||
        expiry > now + SUPPORT_LIMITS.maxLinkLifetimeMs / 1000
      )
        throw new Error("The download expiry is invalid.");
      return new SignJWT(scope)
        .setProtectedHeader({ alg: "HS256", typ: "tholi-file+jwt" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(now)
        .setExpirationTime(expiry)
        .sign(key);
    },
    async verify(token) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          issuer,
          audience,
          requiredClaims: ["iat", "exp"],
        });
        if (
          protectedHeader.typ !== "tholi-file+jwt" ||
          !Number.isInteger(payload.iat) ||
          !Number.isInteger(payload.exp) ||
          payload.exp! <= payload.iat! ||
          payload.exp! - payload.iat! >
            SUPPORT_LIMITS.maxLinkLifetimeMs / 1000 ||
          payload.iat! > Math.floor(Date.now() / 1000)
        )
          throw new Error();
        const {
          iss: _issuer,
          aud: _audience,
          iat: _issued,
          exp: _expiry,
          ...scope
        } = payload;
        return scopeSchema.parse(scope);
      } catch {
        throw new Error("The download proof is invalid.");
      }
    },
  };
}
