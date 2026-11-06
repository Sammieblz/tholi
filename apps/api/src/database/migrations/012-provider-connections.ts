export const providerConnections = `
-- Credentials use the current account's runtime scope and a separate operator
-- encryption keyring. Metadata tombstones retain revision and request provenance.
CREATE FUNCTION tholi.valid_sealed_provider_key(value jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE(jsonb_typeof(value)='object'
    AND value ?& ARRAY['version','keyVersion','iv','ciphertext','tag']
    AND value-ARRAY['version','keyVersion','iv','ciphertext','tag']='{}'::jsonb
    AND value->>'version'='1' AND jsonb_typeof(value->'version')='number'
    AND jsonb_typeof(value->'keyVersion')='string' AND value->>'keyVersion' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    AND jsonb_typeof(value->'iv')='string' AND value->>'iv' ~ '^[A-Za-z0-9_-]{16}$'
    AND jsonb_typeof(value->'ciphertext')='string' AND length(value->>'ciphertext') BETWEEN 2 AND 10923
      AND value->>'ciphertext' ~ '^[A-Za-z0-9_-]+$'
    AND jsonb_typeof(value->'tag')='string' AND value->>'tag' ~ '^[A-Za-z0-9_-]{22}$',false) $$;

CREATE TABLE tholi.provider_connections (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES tholi.accounts(id),
  provider text NOT NULL CHECK(provider IN ('openai','anthropic','openrouter')),
  model_id text NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
  catalog_revision text NOT NULL CHECK(catalog_revision ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  routing_policy_version text NOT NULL CHECK(routing_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  policy_digest bytea NOT NULL CHECK(octet_length(policy_digest)=32),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','removed')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  sealed_key jsonb CHECK(sealed_key IS NULL OR tholi.valid_sealed_provider_key(sealed_key)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at timestamptz,
  UNIQUE(account_id,provider),
  UNIQUE(account_id,id),
  CHECK((status='removed')=(sealed_key IS NULL)),
  CHECK(verified_at IS NULL OR (status='active' AND verified_at>=created_at)),
  CHECK(updated_at>=created_at)
);
ALTER TABLE tholi.provider_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_connection_read ON tholi.provider_connections FOR SELECT USING(
  account_id=tholi.actor_account_id() AND EXISTS(SELECT FROM tholi.accounts a WHERE a.id=account_id AND a.status='active'));
CREATE POLICY provider_connection_create ON tholi.provider_connections FOR INSERT WITH CHECK(
  account_id=tholi.actor_account_id() AND EXISTS(SELECT FROM tholi.accounts a WHERE a.id=account_id AND a.status='active'));
CREATE POLICY provider_connection_change ON tholi.provider_connections FOR UPDATE USING(
  account_id=tholi.actor_account_id() AND EXISTS(SELECT FROM tholi.accounts a WHERE a.id=account_id AND a.status='active'))
  WITH CHECK(account_id=tholi.actor_account_id() AND EXISTS(SELECT FROM tholi.accounts a WHERE a.id=account_id AND a.status='active'));

-- Extend the existing strict audit owner without rewriting or weakening its old
-- kind/shape predicates. Existing constraint expressions are trusted schema data.
DO $$ DECLARE old_name text; old_expression text;
BEGIN
  SELECT c.conname,pg_get_expr(c.conbin,c.conrelid) INTO STRICT old_name,old_expression
    FROM pg_constraint c WHERE c.conrelid='tholi.security_audit'::regclass AND c.contype='c'
      AND pg_get_expr(c.conbin,c.conrelid) LIKE '%membership.changed%'
      AND pg_get_expr(c.conbin,c.conrelid) NOT LIKE '%details%';
  EXECUTE format('ALTER TABLE tholi.security_audit DROP CONSTRAINT %I',old_name);
  EXECUTE format('ALTER TABLE tholi.security_audit ADD CONSTRAINT security_audit_provider_kind CHECK ((%s) OR kind=''provider.connection.changed'')',old_expression);
  SELECT c.conname,pg_get_expr(c.conbin,c.conrelid) INTO STRICT old_name,old_expression
    FROM pg_constraint c WHERE c.conrelid='tholi.security_audit'::regclass AND c.contype='c'
      AND pg_get_expr(c.conbin,c.conrelid) LIKE '%membership.changed%'
      AND pg_get_expr(c.conbin,c.conrelid) LIKE '%details%';
  EXECUTE format('ALTER TABLE tholi.security_audit DROP CONSTRAINT %I',old_name);
  EXECUTE format('ALTER TABLE tholi.security_audit ADD CONSTRAINT security_audit_provider_shape CHECK ((kind<>''provider.connection.changed'' AND (%s)) OR
    (kind=''provider.connection.changed'' AND subject_id IS NOT NULL
      AND details ?& ARRAY[''provider'',''revision'',''status''] AND details-ARRAY[''provider'',''revision'',''status'']=''{}''::jsonb
      AND details->>''provider'' IN (''openai'',''anthropic'',''openrouter'')
      AND jsonb_typeof(details->''provider'')=''string''
      AND jsonb_typeof(details->''revision'')=''string'' AND details->>''revision'' ~ ''^[1-9][0-9]{0,18}$''
      AND jsonb_typeof(details->''status'')=''string'' AND details->>''status'' IN (''active'',''disabled'',''removed'')))',old_expression);
END $$;

CREATE FUNCTION tholi.guard_provider_connection() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.status<>'active' OR NEW.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'The provider connection is invalid.' USING ERRCODE='22023';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'The provider connection identity is immutable.' USING ERRCODE='42501';
    END IF;
    IF NEW.revision=OLD.revision AND to_jsonb(NEW)-ARRAY['verified_at','updated_at']=to_jsonb(OLD)-ARRAY['verified_at','updated_at'] THEN
      IF NEW.status<>'active' OR NEW.verified_at IS NULL OR (OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
        RAISE EXCEPTION 'The provider verification is invalid.' USING ERRCODE='22023';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.revision<>OLD.revision+1 OR NEW.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'The provider connection revision changed.' USING ERRCODE='40001';
    END IF;
  END IF;
  INSERT INTO tholi.security_audit(account_id,subject_id,kind,details)
    VALUES(NEW.account_id,NEW.id,'provider.connection.changed',
      jsonb_build_object('provider',NEW.provider,'revision',NEW.revision::text,'status',NEW.status));
  RETURN NEW;
END $$;
CREATE TRIGGER provider_connection_guard BEFORE INSERT OR UPDATE ON tholi.provider_connections
  FOR EACH ROW EXECUTE FUNCTION tholi.guard_provider_connection();

/** Account status change owns immediate key invalidation, including fenced deletion. */
CREATE FUNCTION tholi.revoke_account_provider_connections() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status IN ('deletion_pending','deleted') THEN
    UPDATE tholi.provider_connections SET status='removed',sealed_key=NULL,verified_at=NULL,
      revision=revision+1,updated_at=clock_timestamp()
      WHERE account_id=NEW.id AND (status<>'removed' OR sealed_key IS NOT NULL);
  ELSIF NEW.status='suspended' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE tholi.provider_connections SET status='disabled',verified_at=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE account_id=NEW.id AND status='active';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_provider_connections AFTER UPDATE OF status ON tholi.accounts
  FOR EACH ROW EXECUTE FUNCTION tholi.revoke_account_provider_connections();

CREATE FUNCTION tholi.provider_connection_current(target uuid,expected_revision bigint,expected_digest bytea) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM tholi.provider_connections p JOIN tholi.accounts a ON a.id=p.account_id AND a.status='active'
    WHERE p.id=target AND p.account_id=tholi.actor_account_id() AND p.status='active' AND p.sealed_key IS NOT NULL
      AND p.revision=expected_revision AND p.policy_digest=expected_digest) $$;
CREATE FUNCTION tholi.mark_provider_connection_verified(target uuid,expected_revision bigint,expected_digest bytea) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM tholi.accounts WHERE id=tholi.actor_account_id() AND status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE tholi.provider_connections SET verified_at=COALESCE(verified_at,clock_timestamp()),updated_at=clock_timestamp()
    WHERE account_id=tholi.actor_account_id() AND id=target AND status='active' AND sealed_key IS NOT NULL
      AND revision=expected_revision AND policy_digest=expected_digest;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION tholi.valid_sealed_provider_key(jsonb),tholi.guard_provider_connection(),
  tholi.revoke_account_provider_connections(),tholi.provider_connection_current(uuid,bigint,bytea),
  tholi.mark_provider_connection_verified(uuid,bigint,bytea) FROM PUBLIC;
`;
