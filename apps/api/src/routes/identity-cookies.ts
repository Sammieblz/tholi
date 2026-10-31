/** Production host prefixes prevent a sibling domain from shadowing credentials. */
export function identityCookieNames(secure: boolean) {
  const prefix = secure ? "__Host-" : "";
  return {
    access: prefix + "tholi_session",
    refresh: prefix + "tholi_refresh",
    flow: prefix + "tholi_flow",
  };
}
import type { FastifyReply } from "fastify";

export function identityCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: secure ? "/" : "/api/v1",
  };
}

export function clearIdentityCookies(reply: FastifyReply, secure: boolean) {
  const names = identityCookieNames(secure),
    options = identityCookieOptions(secure);
  reply.clearCookie(names.access, options).clearCookie(names.refresh, options);
}
