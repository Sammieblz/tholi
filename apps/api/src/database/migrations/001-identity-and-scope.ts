export const identityAndScope = `
CREATE TABLE tholi.accounts (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deletion_pending', 'deleted')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tholi.identity_links (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES tholi.accounts (id),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);
CREATE INDEX identity_links_account_idx ON tholi.identity_links (account_id);

CREATE TABLE tholi.workspaces (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('personal', 'organization')),
  owner_account_id uuid NOT NULL REFERENCES tholi.accounts (id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  sync_revision bigint NOT NULL DEFAULT 0 CHECK (sync_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_owner_idx ON tholi.workspaces (owner_account_id);
CREATE UNIQUE INDEX workspaces_personal_owner_idx
  ON tholi.workspaces (owner_account_id) WHERE kind = 'personal';

CREATE TABLE tholi.memberships (
  workspace_id uuid NOT NULL REFERENCES tholi.workspaces (id),
  account_id uuid NOT NULL REFERENCES tholi.accounts (id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, account_id)
);
CREATE INDEX memberships_account_idx ON tholi.memberships (account_id, workspace_id);

-- Session transport, rotation and credential handling are implemented in #30.
-- Only a hash is durable; provider tokens and browser session values do not belong here.
CREATE TABLE tholi.sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES tholi.accounts (id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX sessions_account_idx ON tholi.sessions (account_id, created_at, id);
CREATE INDEX sessions_expiry_idx ON tholi.sessions (expires_at) WHERE status = 'active';

CREATE TABLE tholi.consents (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 100),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 100),
  granted boolean NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, account_id, purpose),
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES tholi.memberships (workspace_id, account_id)
);

-- Idempotency records contain a canonical payload hash, never the submitted goal,
-- observation, image or an arbitrary cached response.
CREATE TABLE tholi.requests (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, account_id, operation, idempotency_key),
  FOREIGN KEY (workspace_id, account_id)
    REFERENCES tholi.memberships (workspace_id, account_id)
);
CREATE INDEX requests_created_idx ON tholi.requests (workspace_id, created_at, id);
`;
