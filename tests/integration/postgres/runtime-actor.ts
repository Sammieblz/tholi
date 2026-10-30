import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";

/** Synthetic native actor for independently running local HTTP/worker probes. */
export async function createRuntimeActor(pool: Pool, accessToken?: string) {
  const identities = new PostgresIdentityRepository(pool);
  const issuedAt = new Date(Date.now() - 1000);
  const identity = {
    issuer: "https://identity.example.test/realms/local-runtime-probe",
    subject: randomUUID(),
    providerSessionId: randomUUID(),
    issuedAt,
    verifiedEmail: `tholi-capture-${randomUUID()}@example.invalid`,
  };
  const account = await identities.resolveIdentity(identity),
    token = accessToken ?? randomBytes(32).toString("base64url"),
    now = new Date();
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  await identities.createSession({
    ...account,
    id: randomUUID(),
    clientId: "extension-chromium",
    clientKind: "extension",
    providerIssuer: identity.issuer,
    providerSubject: identity.subject,
    providerSessionId: identity.providerSessionId,
    providerIssuedAt: issuedAt,
    accessHash: digest(token),
    refreshHash: digest(randomBytes(32).toString("base64url")),
    csrfHash: digest(randomUUID()),
    accessExpiresAt: new Date(now.getTime() + 180000),
    expiresAt: new Date(now.getTime() + 600000),
    createdAt: now,
    lastUsedAt: now,
  });
  return { account, token };
}
