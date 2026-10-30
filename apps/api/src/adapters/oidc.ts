import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";
import {
  IdentityError,
  equalIdentityHash,
  identityHash,
} from "../application/identity";
import {
  IDENTITY_CLOCK_TOLERANCE_SECONDS,
  type IdentityOptions,
  type IdentityProvider,
} from "../application/identity-contracts";
import type { ServiceRequestContext } from "../capabilities";

const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const invalid = () =>
  new IdentityError(
    401,
    "UNAUTHENTICATED",
    "The identity provider response could not be verified.",
  );
async function boundedJson(response: Response) {
  if (!response.ok || !response.body) throw invalid();
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } finally {
    reader.releaseLock();
  }
}
function subject(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 255;
}
function sessionId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

/** All network destinations come from validated operator configuration. */
export function createOidcProvider(
  options: IdentityOptions,
  fetcher: typeof fetch = fetch,
): IdentityProvider {
  const keys = createRemoteJWKSet(new URL(options.jwksUri), {
    timeoutDuration: 5000,
    cooldownDuration: 5000,
    cacheMaxAge: 5 * 60_000,
    [customFetch]: async (url, init) => {
      const response = await fetcher(url, { ...init, credentials: "omit" });
      const data = await boundedJson(response);
      return Response.json(data);
    },
  });
  async function verify(
    token: string,
    context: ServiceRequestContext,
    requiredClaims: string[],
  ) {
    context.signal.throwIfAborted();
    if (token.length > 32 * 1024) throw invalid();
    try {
      const result = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.clientId,
        algorithms: ["RS256"],
        requiredClaims,
        maxTokenAge: 300,
        clockTolerance: IDENTITY_CLOCK_TOLERANCE_SECONDS,
      });
      context.signal.throwIfAborted();
      const claims = result.payload;
      if (
        (claims.azp !== undefined && claims.azp !== options.clientId) ||
        (Array.isArray(claims.aud) &&
          (claims.aud.some((audience) => audience !== options.clientId) ||
            (claims.aud.length > 1 && claims.azp !== options.clientId)))
      )
        throw invalid();
      return claims;
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof IdentityError) throw error;
      throw invalid();
    }
  }
  function providerTime(claims: JWTPayload) {
    if (!Number.isSafeInteger(claims.iat) || claims.iat! <= 0) throw invalid();
    return new Date(claims.iat! * 1000);
  }
  return {
    authorize({ state, nonce, codeChallenge, action }) {
      const url = new URL(options.authorizationEndpoint);
      if (action === "recover") {
        if (!url.pathname.endsWith("/protocol/openid-connect/auth"))
          throw new IdentityError(
            400,
            "INVALID_REQUEST",
            "Use password recovery on your identity provider's sign-in page.",
          );
        url.pathname = url.pathname.replace(/\/auth$/, "/forgot-credentials");
      }
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", options.callbackUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      if (action === "signup") url.searchParams.set("prompt", "create");
      if (action === "verify") {
        if (!url.pathname.includes("/protocol/openid-connect/"))
          throw new IdentityError(
            400,
            "INVALID_REQUEST",
            "Manage email verification through your identity provider.",
          );
        url.searchParams.set("kc_action", "VERIFY_EMAIL");
      }
      return url.href;
    },
    async exchange({ code, verifier, nonceHash, context }) {
      context.signal.throwIfAborted();
      const signal = AbortSignal.any([
        context.signal,
        AbortSignal.timeout(
          Math.min(5000, Math.max(1, context.deadlineAt - Date.now())),
        ),
      ]);
      let data: Record<string, unknown>;
      try {
        const response = await fetcher(options.tokenEndpoint, {
          method: "POST",
          redirect: "manual",
          credentials: "omit",
          signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization:
              "Basic " +
              Buffer.from(
                encodeURIComponent(options.clientId) +
                  ":" +
                  encodeURIComponent(options.clientSecret),
              ).toString("base64"),
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: options.callbackUrl,
            code_verifier: verifier,
          }),
        });
        data = await boundedJson(response);
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof IdentityError) throw error;
        throw new IdentityError(
          503,
          "UNAVAILABLE",
          "The identity provider is temporarily unavailable.",
        );
      }
      if (typeof data.id_token !== "string") throw invalid();
      const claims = await verify(data.id_token, context, [
        "sub",
        "exp",
        "iat",
        "nonce",
      ]);
      if (
        !subject(claims.sub) ||
        typeof claims.nonce !== "string" ||
        !equalIdentityHash(identityHash(claims.nonce), nonceHash) ||
        (options.requireVerifiedEmail && claims.email_verified !== true) ||
        (claims.sid !== undefined && !sessionId(claims.sid))
      )
        throw invalid();
      // Access and refresh tokens returned by the provider are deliberately discarded.
      return {
        issuer: options.issuer,
        subject: claims.sub!,
        issuedAt: providerTime(claims),
        ...(typeof claims.sid === "string"
          ? { providerSessionId: claims.sid }
          : {}),
      };
    },
    async verifyLogout(token, context) {
      const claims = await verify(token, context, ["iat", "jti", "events"]);
      const events = claims.events;
      if (
        claims.nonce !== undefined ||
        typeof claims.jti !== "string" ||
        !subject(claims.jti) ||
        !events ||
        typeof events !== "object" ||
        Array.isArray(events) ||
        Object.keys(events).length !== 1 ||
        !(LOGOUT_EVENT in events) ||
        !(events as Record<string, unknown>)[LOGOUT_EVENT] ||
        typeof (events as Record<string, unknown>)[LOGOUT_EVENT] !== "object" ||
        Array.isArray((events as Record<string, unknown>)[LOGOUT_EVENT]) ||
        Object.keys((events as Record<string, object>)[LOGOUT_EVENT]).length !==
          0 ||
        (!subject(claims.sub) && !sessionId(claims.sid)) ||
        (claims.sub !== undefined && !subject(claims.sub)) ||
        (claims.sid !== undefined && !sessionId(claims.sid))
      )
        throw invalid();
      const issuedAt = providerTime(claims);
      return {
        issuer: options.issuer,
        eventId: claims.jti,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 305_000),
        ...(typeof claims.sub === "string" ? { subject: claims.sub } : {}),
        ...(typeof claims.sid === "string"
          ? { providerSessionId: claims.sid }
          : {}),
      };
    },
    logoutUrl() {
      const url = new URL(options.endSessionEndpoint);
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set(
        "post_logout_redirect_uri",
        options.webOrigin + "/download",
      );
      return url.href;
    },
  };
}
