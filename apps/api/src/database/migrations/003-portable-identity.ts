export const portableIdentity = `
-- The foundation never issued these credentials. Retain historical rows while
-- refusing to reinterpret a pre-identity token as an authenticated session.
UPDATE tholi.sessions SET status = 'revoked', revoked_at = now()
 WHERE status = 'active';
-- A service-wide logout fences an upstream grant even if its account lookup
-- finishes afterwards. Provider timestamps have second precision.
ALTER TABLE tholi.accounts ADD COLUMN auth_grants_revoked_at timestamptz;
ALTER TABLE tholi.identity_links ADD CONSTRAINT identity_links_account_identity_key
  UNIQUE (account_id, id);
DROP INDEX tholi.identity_links_account_idx;
ALTER TABLE tholi.sessions
  ADD COLUMN identity_id uuid,
  ADD COLUMN workspace_id uuid,
  ADD COLUMN client_id text CHECK (length(client_id) BETWEEN 1 AND 100),
  ADD COLUMN client_kind text CHECK (client_kind IN ('web', 'extension', 'desktop')),
  ADD COLUMN provider_session_id text CHECK (length(provider_session_id) BETWEEN 1 AND 512),
  ADD COLUMN provider_issued_at timestamptz,
  ADD COLUMN csrf_hash bytea CHECK (octet_length(csrf_hash) = 32),
  ADD COLUMN access_expires_at timestamptz,
  ADD COLUMN last_used_at timestamptz,
  ADD CONSTRAINT sessions_identity_owner_fk FOREIGN KEY (account_id, identity_id)
    REFERENCES tholi.identity_links (account_id, id),
  ADD CONSTRAINT sessions_membership_fk FOREIGN KEY (workspace_id, account_id)
    REFERENCES tholi.memberships (workspace_id, account_id),
  ADD CONSTRAINT sessions_active_identity_check CHECK (status = 'revoked' OR (
    identity_id IS NOT NULL AND workspace_id IS NOT NULL AND client_id IS NOT NULL
    AND client_kind IS NOT NULL AND csrf_hash IS NOT NULL
    AND provider_issued_at IS NOT NULL AND last_used_at IS NOT NULL
    AND access_expires_at IS NOT NULL AND access_expires_at <= expires_at)),
  ADD CONSTRAINT sessions_access_expiry_check CHECK (access_expires_at > created_at);
CREATE INDEX sessions_identity_idx ON tholi.sessions (account_id, identity_id);
CREATE INDEX sessions_workspace_idx ON tholi.sessions (workspace_id, account_id);

-- A session is also its refresh-token family. Consumed hashes remain until the
-- family expires so replay revokes the current access and successor refresh.
CREATE TABLE tholi.session_refresh_tokens (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  session_id uuid NOT NULL REFERENCES tholi.sessions (id),
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX session_refresh_tokens_session_idx
  ON tholi.session_refresh_tokens (session_id);
CREATE UNIQUE INDEX session_refresh_tokens_current_idx
  ON tholi.session_refresh_tokens (session_id) WHERE consumed_at IS NULL;

CREATE TABLE tholi.identity_flows (
  state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  browser_binding_hash bytea NOT NULL CHECK (octet_length(browser_binding_hash) = 32),
  nonce_hash bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
  sealed_verifier text NOT NULL CHECK (length(sealed_verifier) BETWEEN 1 AND 2048),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 100),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 1 AND 2048),
  destination text NOT NULL CHECK (destination IN ('account', 'download', 'client')),
  client_state text CHECK (length(client_state) BETWEEN 1 AND 512),
  code_challenge text CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CHECK (destination <> 'client' OR (client_state IS NOT NULL AND code_challenge IS NOT NULL))
);
CREATE INDEX identity_flows_expiry_idx ON tholi.identity_flows (expires_at);

CREATE TABLE tholi.identity_brokers (
  code_hash bytea PRIMARY KEY CHECK (octet_length(code_hash) = 32),
  identity_id uuid NOT NULL,
  account_id uuid NOT NULL,
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  workspace_id uuid NOT NULL,
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 100),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 1 AND 2048),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  provider_session_id text CHECK (length(provider_session_id) BETWEEN 1 AND 512),
  provider_issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (account_id, identity_id) REFERENCES tholi.identity_links (account_id, id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES tholi.memberships (workspace_id, account_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '2 minutes')
);
CREATE INDEX identity_brokers_account_idx ON tholi.identity_brokers (account_id, identity_id);
CREATE INDEX identity_brokers_workspace_idx ON tholi.identity_brokers (workspace_id, account_id);
CREATE INDEX identity_brokers_expiry_idx ON tholi.identity_brokers (expires_at);

-- Verified provider events contain identifiers, never provider credentials.
-- Markers also reject a late callback/broker issued before the logout event.
CREATE TABLE tholi.identity_logout_events (
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 512),
  subject text CHECK (length(subject) BETWEEN 1 AND 512),
  provider_session_id text CHECK (length(provider_session_id) BETWEEN 1 AND 512),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (issuer, event_id),
  CHECK (subject IS NOT NULL OR provider_session_id IS NOT NULL),
  CHECK (expires_at > issued_at)
);
CREATE INDEX identity_logout_events_expiry_idx ON tholi.identity_logout_events (expires_at);
CREATE INDEX identity_logout_events_subject_idx ON tholi.identity_logout_events (issuer, subject);
CREATE INDEX identity_logout_events_sid_idx ON tholi.identity_logout_events (issuer, provider_session_id);
`;
