export const serviceData = `
-- #58 defines the validated product catalog. No prices or paid entitlements are seeded.
CREATE TABLE tholi.plan_versions (
  plan_id text NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 100),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, version)
);

CREATE TABLE tholi.entitlements (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces (id),
  id uuid NOT NULL,
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'ended')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (plan_id, plan_version) REFERENCES tholi.plan_versions (plan_id, version),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX entitlements_plan_idx ON tholi.entitlements (plan_id, plan_version);
CREATE INDEX entitlements_active_idx ON tholi.entitlements (workspace_id, starts_at, id)
  WHERE status = 'active';

CREATE TABLE tholi.credit_grants (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces (id),
  id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  amount bigint NOT NULL CHECK (amount > 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE tholi.credit_reservations (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'settled', 'released', 'uncertain')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES tholi.requests (workspace_id, id),
  CHECK (expires_at > created_at)
);
CREATE INDEX credit_reservations_pending_idx
  ON tholi.credit_reservations (workspace_id, expires_at, id)
  WHERE status IN ('active', 'uncertain');

CREATE TABLE tholi.credit_settlements (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, reservation_id),
  FOREIGN KEY (workspace_id, reservation_id)
    REFERENCES tholi.credit_reservations (workspace_id, id)
);

-- One append-only amount owner per event. The ledger is derived rather than
-- storing a second, independently mutable balance or duplicate credit event.
CREATE VIEW tholi.credit_ledger WITH (security_invoker = true) AS
  SELECT workspace_id, id, 'grant'::text AS kind, amount, created_at
    FROM tholi.credit_grants
  UNION ALL
  SELECT workspace_id, id, 'settlement'::text AS kind, -amount AS amount, created_at
    FROM tholi.credit_settlements;

CREATE TABLE tholi.usage_records (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  input_units bigint NOT NULL CHECK (input_units >= 0),
  output_units bigint NOT NULL CHECK (output_units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, request_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES tholi.requests (workspace_id, id)
);
CREATE INDEX usage_records_created_idx ON tholi.usage_records (workspace_id, created_at, id);

-- Only explicitly saved, structurally filtered routes are currently admitted.
-- Local knowledge, inference projections, images and raw prompts are not mirrored.
CREATE TABLE tholi.saved_artifacts (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'saved_route'),
  content jsonb,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  sync_revision bigint NOT NULL CHECK (sync_revision > 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, sync_revision),
  FOREIGN KEY (workspace_id, owner_account_id)
    REFERENCES tholi.memberships (workspace_id, account_id),
  CHECK ((deleted_at IS NULL AND content IS NOT NULL AND jsonb_typeof(content) = 'object')
    OR (deleted_at IS NOT NULL AND content IS NULL))
);
CREATE INDEX saved_artifacts_owner_idx
  ON tholi.saved_artifacts (workspace_id, owner_account_id, updated_at, id);

-- Execution, claims, retries and provider delivery are #32. This metadata cannot
-- authorize a handler or contain arbitrary raw observations or access tokens.
CREATE TABLE tholi.jobs (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces (id),
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  request_id uuid,
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 100),
  version integer NOT NULL CHECK (version > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  record_references jsonb NOT NULL CHECK (jsonb_typeof(record_references) = 'object'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled', 'uncertain')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_owner text CHECK (length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, kind, version, idempotency_key),
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES tholi.memberships (workspace_id, account_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES tholi.requests (workspace_id, id),
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX jobs_request_idx ON tholi.jobs (workspace_id, request_id);
CREATE INDEX jobs_actor_idx ON tholi.jobs (workspace_id, account_id, created_at, id);
CREATE INDEX jobs_claim_idx ON tholi.jobs (available_at, workspace_id, id)
  WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON tholi.jobs (lease_expires_at, workspace_id, id)
  WHERE status = 'running';

CREATE TABLE tholi.outbox (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (length(event_kind) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published')),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, event_kind, idempotency_key),
  FOREIGN KEY (workspace_id, job_id) REFERENCES tholi.jobs (workspace_id, id),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);
CREATE INDEX outbox_job_idx ON tholi.outbox (workspace_id, job_id);
CREATE INDEX outbox_publish_idx ON tholi.outbox (available_at, workspace_id, id)
  WHERE status = 'pending';
`;
