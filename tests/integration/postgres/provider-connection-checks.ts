import assert from "node:assert/strict";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import { providerConnectionSelection } from "../../../packages/navigation-core/contracts-providers";
import { providerConnectionFixture } from "./provider-fixture";

/** Real runtime/worker SQL privileges and crypto; no external provider is contacted. */
export async function runProviderConnectionChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
  worker?: Pool,
) {
  const repositories = new PostgresRepositories(runtime);
  await record(
    "provider credentials are encrypted, account-isolated, metadata-only and denied to the worker role",
    async () => {
      const first = await repositories.provisionAccount(),
        second = await repositories.provisionAccount();
      const fixture = await providerConnectionFixture(runtime, first.accountId);
      const stored = (
        await migration.query(
          "SELECT sealed_key FROM tholi.provider_connections WHERE id=$1",
          [fixture.connection.id],
        )
      ).rows[0].sealed_key;
      assert.equal(stored.version, 1);
      assert.equal(stored.keyVersion, "synthetic-v1");
      assert.ok(stored.ciphertext);
      assert.ok(
        !JSON.stringify(stored).includes("synthetic-provider-fixture-key"),
      );
      assert.equal(
        (
          await fixture.service.list(
            { accountId: second.accountId },
            fixture.context,
          )
        ).items.length,
        0,
      );
      await assert.rejects(
        () =>
          fixture.service.assertCurrent(
            { accountId: second.accountId },
            fixture.selection,
            fixture.context,
          ),
        { code: "CONFLICT" },
      );
      assert.equal(
        (
          await withTransaction(
            runtime,
            (client) =>
              client.query(
                "SELECT id FROM tholi.provider_connections WHERE id=$1",
                [fixture.connection.id],
              ),
            { accountId: second.accountId },
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        () => providerConnectionFixture(runtime, first.accountId),
        { code: "CONFLICT" },
      );
      const safe = JSON.stringify(
        await fixture.service.list(
          { accountId: first.accountId },
          fixture.context,
        ),
      );
      for (const secret of [
        "synthetic-provider-fixture-key",
        "sealed_key",
        "sealedKey",
        "ciphertext",
        "accountId",
      ])
        assert.ok(!safe.includes(secret));
      if (worker)
        await assert.rejects(
          () =>
            withTransaction(
              worker,
              (client) =>
                client.query(
                  "SELECT sealed_key FROM tholi.provider_connections WHERE id=$1",
                  [fixture.connection.id],
                ),
              { accountId: first.accountId },
            ),
          { code: "42501" },
        );
    },
  );
  await record(
    "provider rotation and removal use current revisions, clear verification, keep minimal audit and invalidate all old selectors",
    async () => {
      const owner = await repositories.provisionAccount(),
        fixture = await providerConnectionFixture(runtime, owner.accountId),
        principal = { accountId: owner.accountId };
      assert.equal(
        await fixture.service.markVerified(
          principal,
          fixture.selection,
          fixture.context,
        ),
        true,
      );
      const verified = (await fixture.service.list(principal, fixture.context))
        .items[0];
      assert.ok(verified.verifiedAt);
      const replacement = {
        expectedRevision: "1",
        model: verified.model,
        catalogRevision: verified.catalogRevision,
        apiKey: "rotated-synthetic-provider-key",
      };
      const outcomes = await Promise.allSettled([
        fixture.service.replace(
          principal,
          verified.id,
          replacement,
          fixture.context,
        ),
        fixture.service.replace(
          principal,
          verified.id,
          replacement,
          fixture.context,
        ),
      ]);
      assert.equal(
        outcomes.filter((item) => item.status === "fulfilled").length,
        1,
      );
      assert.equal(
        outcomes.filter((item) => item.status === "rejected").length,
        1,
      );
      const current = (await fixture.service.list(principal, fixture.context))
        .items[0];
      assert.equal(current.revision, "2");
      assert.equal(current.verifiedAt, null);
      await assert.rejects(
        () =>
          fixture.service.assertCurrent(
            principal,
            fixture.selection,
            fixture.context,
          ),
        { code: "CONFLICT" },
      );
      assert.equal(
        await fixture.service.withCredential(
          principal,
          providerConnectionSelection(current),
          fixture.context,
          async (key) => key,
        ),
        replacement.apiKey,
      );
      const removed = await fixture.service.remove(
        principal,
        current.id,
        { expectedRevision: current.revision },
        fixture.context,
      );
      assert.equal(removed.revision, "3");
      assert.equal(removed.status, "removed");
      assert.equal(
        (
          await migration.query(
            "SELECT sealed_key FROM tholi.provider_connections WHERE id=$1",
            [current.id],
          )
        ).rows[0].sealed_key,
        null,
      );
      assert.equal(
        await fixture.service.markVerified(
          principal,
          providerConnectionSelection(current),
          fixture.context,
        ),
        false,
      );
      const audit = (
        await migration.query(
          "SELECT kind,subject_id,details FROM tholi.security_audit WHERE account_id=$1 AND kind='provider.connection.changed' ORDER BY occurred_at,id",
          [owner.accountId],
        )
      ).rows;
      assert.equal(audit.length, 3);
      for (const event of audit) {
        assert.equal(event.subject_id, current.id);
        assert.deepEqual(Object.keys(event.details).sort(), [
          "provider",
          "revision",
          "status",
        ]);
        assert.ok(!JSON.stringify(event).includes("synthetic-provider"));
      }
      await assert.rejects(
        () =>
          migration.query(
            "INSERT INTO tholi.security_audit(account_id,subject_id,kind,details) VALUES($1,$2,'provider.connection.changed','{}'::jsonb)",
            [owner.accountId, current.id],
          ),
        { code: "23514" },
      );
      const reconnect = await fixture.service.replace(
        principal,
        current.id,
        { ...replacement, expectedRevision: "3" },
        fixture.context,
      );
      assert.equal(reconnect.id, current.id);
      assert.equal(reconnect.revision, "4");
      assert.equal(reconnect.verifiedAt, null);
    },
  );
  await record(
    "provider ciphertext moved across accounts fails closed even if a database administrator copies the envelope",
    async () => {
      const first = await repositories.provisionAccount(),
        second = await repositories.provisionAccount(),
        left = await providerConnectionFixture(runtime, first.accountId),
        right = await providerConnectionFixture(runtime, second.accountId);
      const envelope = (
        await migration.query(
          "SELECT sealed_key FROM tholi.provider_connections WHERE id=$1",
          [left.connection.id],
        )
      ).rows[0].sealed_key;
      await migration.query(
        "UPDATE tholi.provider_connections SET sealed_key=$2::jsonb,revision=revision+1,verified_at=NULL WHERE id=$1",
        [right.connection.id, JSON.stringify(envelope)],
      );
      const current = (
        await right.service.list({ accountId: second.accountId }, right.context)
      ).items[0];
      let called = false;
      await assert.rejects(
        () =>
          right.service.withCredential(
            { accountId: second.accountId },
            providerConnectionSelection(current),
            right.context,
            async () => {
              called = true;
            },
          ),
        { code: "UNAVAILABLE" },
      );
      assert.equal(called, false);
    },
  );
  await record(
    "account suspension immediately fences a key and account deletion destroys it before background cleanup",
    async () => {
      const owner = await repositories.provisionAccount(),
        fixture = await providerConnectionFixture(runtime, owner.accountId),
        principal = { accountId: owner.accountId };
      await migration.query(
        "UPDATE tholi.accounts SET status='suspended',revision=revision+1 WHERE id=$1",
        [owner.accountId],
      );
      let row = (
        await migration.query(
          "SELECT status,revision::text,sealed_key,verified_at FROM tholi.provider_connections WHERE id=$1",
          [fixture.connection.id],
        )
      ).rows[0];
      assert.equal(row.status, "disabled");
      assert.equal(row.revision, "2");
      assert.ok(row.sealed_key);
      assert.equal(row.verified_at, null);
      await assert.rejects(
        () =>
          fixture.service.withCredential(
            principal,
            fixture.selection,
            fixture.context,
            async () => "unreachable",
          ),
        { code: "FORBIDDEN" },
      );
      await migration.query(
        "UPDATE tholi.accounts SET status='active',revision=revision+1 WHERE id=$1",
        [owner.accountId],
      );
      const disabled = (await fixture.service.list(principal, fixture.context))
        .items[0];
      assert.equal(disabled.status, "disabled");
      await assert.rejects(
        () =>
          fixture.service.assertCurrent(
            principal,
            providerConnectionSelection(disabled),
            fixture.context,
          ),
        { code: "CONFLICT" },
      );
      await migration.query(
        "UPDATE tholi.accounts SET status='deletion_pending',revision=revision+1 WHERE id=$1",
        [owner.accountId],
      );
      row = (
        await migration.query(
          "SELECT status,revision::text,sealed_key,verified_at FROM tholi.provider_connections WHERE id=$1",
          [fixture.connection.id],
        )
      ).rows[0];
      assert.equal(row.status, "removed");
      assert.equal(row.revision, "3");
      assert.equal(row.sealed_key, null);
      await assert.rejects(
        () => fixture.service.list(principal, fixture.context),
        { code: "FORBIDDEN" },
      );
      const denied = (
        await withTransaction(
          runtime,
          (client) =>
            client.query(
              "SELECT tholi.provider_connection_current($1,$2,decode($3,'hex')) AS current",
              [fixture.connection.id, "3", fixture.selection.policyDigest],
            ),
          { accountId: owner.accountId },
        )
      ).rows[0];
      assert.equal(denied.current, false);
    },
  );
}
