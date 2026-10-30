import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  IDENTITY_CLOCK_TOLERANCE_SECONDS,
  type IdentityAccount,
  type IdentityBroker,
  type IdentityFlow,
  type IdentitySession,
  type ProviderIdentity,
} from "../../../apps/api/src/application/identity-contracts";
import {
  IdentityStoreError,
  PostgresIdentityRepository,
} from "../../../apps/api/src/database/identity";

/** Shares the existing real runtime/migrator pools and failure reporting owner. */
export async function runIdentityChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const store = new PostgresIdentityRepository(runtime);
  const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
  const provider = (
    overrides: Partial<ProviderIdentity> = {},
  ): ProviderIdentity => ({
    issuer: "https://identity.example.test/realms/tholi",
    subject: randomUUID(),
    providerSessionId: randomUUID(),
    issuedAt: new Date(Date.now() - 1000),
    ...overrides,
  });
  const flow = (): IdentityFlow => ({
    stateHash: digest(),
    browserBindingHash: digest(),
    nonceHash: digest(),
    sealedVerifier: "opaque-authenticated-ciphertext-fixture",
    clientId: "web",
    redirectUri: "https://tholi.example.test/account",
    destination: "account",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const session = (
    account: IdentityAccount,
    identity: ProviderIdentity,
    overrides: Partial<IdentitySession> = {},
  ): IdentitySession => {
    const now = new Date();
    return {
      ...account,
      id: randomUUID(),
      clientId: "extension-chromium",
      clientKind: "extension",
      providerIssuer: identity.issuer,
      providerSubject: identity.subject,
      providerSessionId: identity.providerSessionId,
      providerIssuedAt: identity.issuedAt,
      accessHash: digest(),
      refreshHash: digest(),
      csrfHash: digest(),
      accessExpiresAt: new Date(now.getTime() + 60_000),
      expiresAt: new Date(now.getTime() + 600_000),
      createdAt: now,
      lastUsedAt: now,
      ...overrides,
    };
  };
  const broker = (
    account: IdentityAccount,
    identity: ProviderIdentity,
  ): IdentityBroker => ({
    ...account,
    ...identity,
    codeHash: digest(),
    clientId: "extension-chromium",
    redirectUri: "https://approved.chromiumapp.org/tholi",
    codeChallenge: "a".repeat(43),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const rotate = (
    value: IdentitySession,
    overrides: Partial<Parameters<typeof store.rotateSession>[0]> = {},
  ) =>
    store.rotateSession({
      refreshHash: value.refreshHash,
      clientId: value.clientId,
      accessHash: digest(),
      nextRefreshHash: digest(),
      csrfHash: digest(),
      accessExpiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
      ...overrides,
    });
  const expectRevoked = (work: () => Promise<unknown>) =>
    assert.rejects(
      work,
      (error: unknown) =>
        error instanceof IdentityStoreError &&
        error.code === "IDENTITY_REVOKED",
    );

  await record(
    "identity first login is atomic and provider independent under concurrency",
    async () => {
      const identity = provider();
      const before = Number(
        (await migration.query("SELECT count(*) AS count FROM tholi.accounts"))
          .rows[0].count,
      );
      const accounts = await Promise.all(
        Array.from({ length: 8 }, () => store.resolveIdentity(identity)),
      );
      for (const account of accounts) assert.deepEqual(account, accounts[0]);
      assert.equal(
        Number(
          (
            await migration.query(
              "SELECT count(*) AS count FROM tholi.accounts",
            )
          ).rows[0].count,
        ),
        before + 1,
      );
      const changedSubject = await store.resolveIdentity({
        ...identity,
        subject: randomUUID(),
      });
      const changedIssuer = await store.resolveIdentity({
        ...identity,
        issuer: "https://other-identity.example.test",
      });
      assert.notEqual(changedSubject.accountId, accounts[0].accountId);
      assert.notEqual(changedIssuer.accountId, accounts[0].accountId);
      await migration.query(
        "UPDATE tholi.accounts SET status = 'suspended' WHERE id = $1",
        [accounts[0].accountId],
      );
      await expectRevoked(() => store.resolveIdentity(identity));
      assert.equal(
        Number(
          (
            await runtime.query(
              "SELECT count(*) AS count FROM tholi.identity_links WHERE issuer = $1 AND subject = $2",
              [identity.issuer, identity.subject],
            )
          ).rows[0].count,
        ),
        1,
      );
    },
  );

  await record(
    "OIDC flow browser binding, expiry and concurrent one-use consumption",
    async () => {
      const value = flow();
      await store.createFlow(value);
      assert.equal(
        await store.consumeFlow(value.stateHash, digest(), new Date()),
        null,
      );
      const consumed = await Promise.all(
        [1, 2].map(() =>
          store.consumeFlow(
            value.stateHash,
            value.browserBindingHash,
            new Date(),
          ),
        ),
      );
      assert.equal(consumed.filter(Boolean).length, 1);
      assert.deepEqual(consumed.find(Boolean), {
        ...value,
        clientState: undefined,
        codeChallenge: undefined,
      });
      const expired = flow();
      await store.createFlow(expired);
      assert.equal(
        await store.consumeFlow(
          expired.stateHash,
          expired.browserBindingHash,
          new Date(expired.expiresAt.getTime() + 1),
        ),
        null,
      );
      await assert.rejects(
        () =>
          store.createFlow({
            ...flow(),
            expiresAt: new Date(Date.now() + 11 * 60_000),
          }),
        { code: "23514" },
      );
      await assert.rejects(() =>
        store.createFlow({ ...flow(), stateHash: "raw-token" }),
      );
      assert.equal(
        (
          await runtime.query(
            "SELECT 1 FROM tholi.identity_flows WHERE state_hash = decode($1,'hex')",
            [value.stateHash],
          )
        ).rowCount,
        0,
      );
    },
  );

  await record(
    "native broker binds client, exact redirect, PKCE and one-use expiry",
    async () => {
      const identity = provider(),
        account = await store.resolveIdentity(identity);
      const value = broker(account, identity);
      await store.createBroker(value);
      for (const [clientId, redirect, challenge] of [
        ["extension-firefox", value.redirectUri, value.codeChallenge],
        [value.clientId, "https://attacker.example.test", value.codeChallenge],
        [value.clientId, value.redirectUri, "b".repeat(43)],
      ])
        assert.equal(
          await store.consumeBroker(
            value.codeHash,
            clientId,
            redirect,
            challenge,
            new Date(),
          ),
          null,
        );
      const results = await Promise.all(
        [1, 2].map(() =>
          store.consumeBroker(
            value.codeHash,
            value.clientId,
            value.redirectUri,
            value.codeChallenge,
            new Date(),
          ),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.deepEqual(results.find(Boolean), value);
      const expired = broker(account, identity);
      await store.createBroker(expired);
      assert.equal(
        await store.consumeBroker(
          expired.codeHash,
          expired.clientId,
          expired.redirectUri,
          expired.codeChallenge,
          new Date(expired.expiresAt.getTime() + 1),
        ),
        null,
      );
      const other = await store.resolveIdentity(provider());
      await expectRevoked(() =>
        store.createBroker({
          ...broker(account, identity),
          accountId: other.accountId,
        }),
      );
    },
  );

  await record(
    "opaque sessions enforce ownership, active accounts and independent access expiry",
    async () => {
      const identity = provider(),
        account = await store.resolveIdentity(identity);
      const value = session(account, identity);
      await store.createSession(value);
      const authenticated = await store.authenticateSession(
        value.accessHash,
        new Date(),
      );
      assert.ok(authenticated);
      assert.deepEqual(authenticated, {
        ...value,
        lastUsedAt: authenticated.lastUsedAt,
      });
      assert.equal(await store.authenticateSession(digest(), new Date()), null);
      assert.equal(
        await store.authenticateSession(
          value.accessHash,
          new Date(value.accessExpiresAt.getTime() + 1),
        ),
        null,
      );
      const other = await store.resolveIdentity(provider());
      await expectRevoked(() =>
        store.createSession({
          ...session(account, identity),
          accountId: other.accountId,
        }),
      );
      await migration.query(
        "UPDATE tholi.accounts SET status = 'suspended' WHERE id = $1",
        [account.accountId],
      );
      assert.equal(
        await store.authenticateSession(value.accessHash, new Date()),
        null,
      );
      await migration.query(
        "UPDATE tholi.accounts SET status = 'active' WHERE id = $1",
        [account.accountId],
      );
      assert.equal(
        await store.authenticateSession(value.accessHash, new Date()),
        null,
        "Suspension revocation cannot revive on reactivation.",
      );
    },
  );

  await record(
    "refresh rotation binds client and session, and replay revocation commits",
    async () => {
      const identity = provider(),
        account = await store.resolveIdentity(identity);
      const value = session(account, identity);
      await store.createSession(value);
      assert.deepEqual(await rotate(value, { clientId: "extension-firefox" }), {
        status: "invalid",
      });
      assert.deepEqual(
        await rotate(value, { expectedSessionId: randomUUID() }),
        { status: "invalid" },
      );
      const result = await rotate(value, {
        accessExpiresAt: new Date(value.expiresAt.getTime() + 60_000),
      });
      assert.equal(result.status, "rotated");
      if (result.status !== "rotated") throw new Error("Expected rotation.");
      assert.deepEqual(result.session.accessExpiresAt, value.expiresAt);
      assert.equal(
        await store.authenticateSession(value.accessHash, new Date()),
        null,
      );
      assert.ok(
        await store.authenticateSession(result.session.accessHash, new Date()),
      );
      assert.deepEqual(await rotate(value), { status: "replayed" });
      assert.equal(
        await store.authenticateSession(result.session.accessHash, new Date()),
        null,
      );
      assert.deepEqual(await rotate(result.session), { status: "invalid" });
      const concurrent = session(account, identity);
      await store.createSession(concurrent);
      const results = await Promise.all([
        rotate(concurrent),
        rotate(concurrent),
      ]);
      assert.deepEqual(results.map((x) => x.status).sort(), [
        "replayed",
        "rotated",
      ]);
      const rotated = results.find((x) => x.status === "rotated");
      assert.ok(rotated?.status === "rotated");
      assert.equal(
        await store.authenticateSession(rotated.session.accessHash, new Date()),
        null,
      );
      assert.equal(
        (
          await runtime.query(
            "SELECT count(*)::int AS count FROM tholi.session_refresh_tokens WHERE session_id = $1",
            [concurrent.id],
          )
        ).rows[0].count,
        2,
      );
    },
  );

  await record(
    "session revocation is account scoped and all-client logout fences pending grants",
    async () => {
      const identity = provider(),
        account = await store.resolveIdentity(identity);
      const otherIdentity = provider(),
        other = await store.resolveIdentity(otherIdentity);
      const first = session(account, identity),
        second = session(account, identity, {
          clientId: "web",
          clientKind: "web",
        });
      const foreign = session(other, otherIdentity);
      for (const value of [first, second, foreign])
        await store.createSession(value);
      assert.equal(
        await store.revokeSession(other.accountId, first.id, new Date()),
        false,
      );
      assert.equal(
        await store.revokeSession(account.accountId, first.id, new Date()),
        true,
      );
      assert.equal(
        await store.authenticateSession(first.accessHash, new Date()),
        null,
      );
      assert.ok(await store.authenticateSession(second.accessHash, new Date()));
      const pending = broker(account, identity);
      await store.createBroker(pending);
      const consumed = await store.consumeBroker(
        pending.codeHash,
        pending.clientId,
        pending.redirectUri,
        pending.codeChallenge,
        new Date(),
      );
      assert.ok(consumed);
      const logoutAt = new Date(Date.now() - 10_000);
      await store.revokeAllSessions(account.accountId, logoutAt);
      assert.equal(
        await store.authenticateSession(second.accessHash, new Date()),
        null,
      );
      assert.ok(
        await store.authenticateSession(foreign.accessHash, new Date()),
      );
      assert.deepEqual(
        await store.listSessions(account.accountId, new Date()),
        [],
      );
      await expectRevoked(() =>
        store.createSession(session(consumed, identity)),
      );
      const freshIdentity = {
        ...identity,
        issuedAt: new Date(
          (Math.floor(logoutAt.getTime() / 1000) +
            IDENTITY_CLOCK_TOLERANCE_SECONDS +
            1) *
            1000,
        ),
      };
      const freshAccount = await store.resolveIdentity(freshIdentity);
      assert.notEqual(freshAccount.revision, account.revision);
      const fresh = session(freshAccount, freshIdentity);
      await store.createSession(fresh);
      assert.deepEqual(
        (await store.listSessions(freshAccount.accountId, new Date())).map(
          (x) => x.id,
        ),
        [fresh.id],
      );
    },
  );

  await record(
    "all-client logout fences late identity resolution and concurrent prelogout grants",
    async () => {
      const logoutAt = new Date(Date.now() - 10_000);
      const identity = provider({
        issuedAt: new Date(logoutAt.getTime() - 1000),
      });
      const account = await store.resolveIdentity(identity);
      await store.revokeAllSessions(account.accountId, logoutAt);
      // A provider exchange can finish before logout and resolve its account
      // afterwards. A new account revision must not make that old grant valid.
      const resolvedLate = await store.resolveIdentity(identity);
      assert.notEqual(resolvedLate.revision, account.revision);
      await expectRevoked(() =>
        store.createSession(session(resolvedLate, identity)),
      );
      await expectRevoked(() =>
        store.createBroker(broker(resolvedLate, identity)),
      );
      const sameSecond = {
        ...identity,
        issuedAt: new Date(Math.floor(logoutAt.getTime() / 1000) * 1000),
      };
      await expectRevoked(() =>
        store.createSession(session(resolvedLate, sameSecond)),
      );
      assert.equal(IDENTITY_CLOCK_TOLERANCE_SECONDS, 5);
      const atSkewBoundary = {
        ...identity,
        issuedAt: new Date((Math.floor(logoutAt.getTime() / 1000) + 5) * 1000),
      };
      await expectRevoked(() =>
        store.createSession(session(resolvedLate, atSkewBoundary)),
      );
      const later = {
        ...identity,
        issuedAt: new Date((Math.floor(logoutAt.getTime() / 1000) + 6) * 1000),
      };
      const fresh = session(resolvedLate, later);
      await store.createSession(fresh);
      assert.ok(await store.authenticateSession(fresh.accessHash, new Date()));

      const racingIdentity = provider(),
        racingAccount = await store.resolveIdentity(racingIdentity);
      const racingGrant = session(racingAccount, racingIdentity);
      const results = await Promise.allSettled([
        store.revokeAllSessions(racingAccount.accountId, new Date()),
        store.createSession(racingGrant),
      ]);
      assert.equal(results[0].status, "fulfilled");
      if (results[1].status === "rejected")
        assert.ok(results[1].reason instanceof IdentityStoreError);
      assert.equal(
        await store.authenticateSession(racingGrant.accessHash, new Date()),
        null,
      );
      const afterRace = await store.resolveIdentity(racingIdentity);
      await expectRevoked(() =>
        store.createSession(session(afterRace, racingIdentity)),
      );

      const previous = (
        await migration.query(
          "SELECT auth_grants_revoked_at FROM tholi.accounts WHERE id = $1",
          [account.accountId],
        )
      ).rows[0].auth_grants_revoked_at;
      await store.revokeAllSessions(
        account.accountId,
        new Date(logoutAt.getTime() - 10_000),
      );
      assert.deepEqual(
        (
          await migration.query(
            "SELECT auth_grants_revoked_at FROM tholi.accounts WHERE id = $1",
            [account.accountId],
          )
        ).rows[0].auth_grants_revoked_at,
        previous,
      );
    },
  );

  await record(
    "verified provider logout isolates issuer and sid, deduplicates and blocks late grants",
    async () => {
      const identity = provider(),
        account = await store.resolveIdentity(identity);
      const secondIdentity = { ...identity, providerSessionId: randomUUID() };
      const otherIssuer = {
          ...identity,
          issuer: "https://other-identity.example.test",
        },
        otherAccount = await store.resolveIdentity(otherIssuer);
      const first = session(account, identity),
        second = session(account, secondIdentity),
        foreign = session(otherAccount, otherIssuer);
      for (const value of [first, second, foreign])
        await store.createSession(value);
      const pending = broker(account, identity);
      await store.createBroker(pending);
      const now = new Date();
      const event = {
        issuer: identity.issuer,
        providerSessionId: identity.providerSessionId,
        eventId: randomUUID(),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        now,
      };
      await store.revokeProviderSessions(event);
      assert.equal(
        await store.authenticateSession(first.accessHash, new Date()),
        null,
      );
      assert.ok(await store.authenticateSession(second.accessHash, new Date()));
      assert.ok(
        await store.authenticateSession(foreign.accessHash, new Date()),
      );
      assert.equal(
        await store.consumeBroker(
          pending.codeHash,
          pending.clientId,
          pending.redirectUri,
          pending.codeChallenge,
          new Date(),
        ),
        null,
      );
      await expectRevoked(() =>
        store.createSession(session(account, identity)),
      );
      await expectRevoked(() => store.createBroker(broker(account, identity)));
      const newerIdentity = {
        ...identity,
        issuedAt: new Date(now.getTime() + 1000),
      };
      const newer = session(account, newerIdentity);
      await store.createSession(newer);
      await store.revokeProviderSessions(event);
      assert.ok(
        await store.authenticateSession(newer.accessHash, new Date()),
        "Duplicate event must not revoke a later sign-in.",
      );
      await store.revokeProviderSessions({
        ...event,
        eventId: randomUUID(),
        providerSessionId: undefined,
        subject: identity.subject,
        issuedAt: new Date(now.getTime() + 2000),
      });
      assert.equal(
        await store.authenticateSession(second.accessHash, new Date()),
        null,
      );
      assert.equal(
        await store.authenticateSession(newer.accessHash, new Date()),
        null,
      );
      assert.ok(
        await store.authenticateSession(foreign.accessHash, new Date()),
      );
      const notLinked = provider({ issuedAt: new Date(now.getTime() - 1000) });
      await store.revokeProviderSessions({
        ...event,
        eventId: randomUUID(),
        subject: notLinked.subject,
        providerSessionId: undefined,
      });
      const lateAccount = await store.resolveIdentity(notLinked);
      await expectRevoked(() =>
        store.createSession(session(lateAccount, notLinked)),
      );
    },
  );

  await record(
    "identity grants preserve least-privilege retention and bounded expired-flow cleanup",
    async () => {
      for (const table of [
        "identity_links",
        "sessions",
        "session_refresh_tokens",
      ])
        assert.equal(
          (
            await runtime.query(
              "SELECT has_table_privilege(current_user,$1,'DELETE') AS allowed",
              [`tholi.${table}`],
            )
          ).rows[0].allowed,
          false,
        );
      for (const table of [
        "identity_flows",
        "identity_brokers",
        "identity_logout_events",
      ])
        assert.equal(
          (
            await runtime.query(
              "SELECT has_table_privilege(current_user,$1,'DELETE') AS allowed",
              [`tholi.${table}`],
            )
          ).rows[0].allowed,
          true,
        );
      const values = await Promise.all(
        Array.from({ length: 105 }, async () => {
          const value = flow();
          await store.createFlow(value);
          return value;
        }),
      );
      await migration.query(
        "UPDATE tholi.identity_flows SET created_at = now() - interval '2 minutes',expires_at = now() - interval '1 minute' WHERE state_hash = ANY($1::bytea[])",
        [values.map((x) => Buffer.from(x.stateHash, "hex"))],
      );
      await store.createFlow(flow());
      assert.equal(
        (
          await runtime.query(
            "SELECT count(*)::int AS count FROM tholi.identity_flows WHERE state_hash = ANY($1::bytea[])",
            [values.map((x) => Buffer.from(x.stateHash, "hex"))],
          )
        ).rows[0].count,
        5,
      );
    },
  );
}
