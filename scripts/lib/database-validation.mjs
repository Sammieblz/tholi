import assert from "node:assert/strict";
import { assertOwnedSmokeProject } from "./local-stack-policy.mjs";

/** Shared synthetic local/VM restore drill. Never accepts a production project. */
export async function verifyDatabaseRestore({ compose, project, scope }) {
  assertOwnedSmokeProject(project, project);
  for (const value of [scope.accountId, scope.workspaceId])
    assert.match(
      value,
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    );
  const backup = await compose(
    [
      "exec",
      "-T",
      "postgres",
      "sh",
      "-ec",
      'PGPASSWORD="$THOLI_MIGRATION_PASSWORD" pg_dump --host=127.0.0.1 --username=tholi_migrator --dbname=tholi --format=custom --file=/tmp/tholi-smoke.dump; psql --username=postgres --dbname=postgres --set=ON_ERROR_STOP=1 --command="CREATE DATABASE tholi_restore OWNER tholi_migrator TEMPLATE template0"; PGPASSWORD="$THOLI_MIGRATION_PASSWORD" pg_restore --host=127.0.0.1 --username=tholi_migrator --dbname=tholi_restore --single-transaction --exit-on-error /tmp/tholi-smoke.dump; rm /tmp/tholi-smoke.dump',
    ],
    90000,
  );
  assert.ok(backup.includes("CREATE DATABASE"));
  const applicationDigest = `DO $check$ DECLARE entry record; content text; BEGIN
  CREATE TEMP TABLE restore_digests (name text, digest text);
  FOR entry IN SELECT tablename FROM pg_tables WHERE schemaname = 'tholi' ORDER BY tablename LOOP
    EXECUTE format('SELECT md5(COALESCE(jsonb_agg(document ORDER BY document::text)::text, ''[]'')) FROM (SELECT to_jsonb(source_record) AS document FROM tholi.%I source_record) records', entry.tablename) INTO content;
    INSERT INTO restore_digests VALUES (entry.tablename, content);
  END LOOP;
END $check$;
SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY name)::text) FROM restore_digests d;`;
  const digests = [];
  for (const database of ["tholi", "tholi_restore"]) {
    digests.push(
      (
        await compose([
          "exec",
          "-T",
          "postgres",
          "sh",
          "-ec",
          'PGPASSWORD="$THOLI_MIGRATION_PASSWORD" psql --host=127.0.0.1 --username=tholi_migrator --dbname="$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="$2"',
          "tholi-restore-check",
          database,
          applicationDigest,
        ])
      ).trim(),
    );
  }
  assert.ok(
    /^[a-f0-9]{32}$/.test(digests[0].split(/\r?\n/).at(-1)) &&
      digests[0] === digests[1],
    "Restored application records differ from the source database.",
  );
  const restored = await compose([
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    'PGPASSWORD="$THOLI_DB_PASSWORD" psql --host=127.0.0.1 --username=tholi_runtime --dbname=tholi_restore --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align --command="$1"',
    "tholi-runtime-restore-check",
    `BEGIN;
   SET LOCAL tholi.account_id = '${scope.accountId}';
   SET LOCAL tholi.workspace_id = '${scope.workspaceId}';
   SELECT count(*) = 1 FROM tholi.accounts
    WHERE id = '${scope.accountId}'::uuid;
   COMMIT;`,
  ]);
  assert.ok(
    restored.trim() === "t",
    "The actual runtime role cannot read restored application records.",
  );
  return { passed: true, tableDigestsMatch: true, runtimeReadback: true };
}
