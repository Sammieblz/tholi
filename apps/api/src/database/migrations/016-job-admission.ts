export const jobAdmission = `
-- Finite durable backlog, shared across API replicas. Only operators change limits.
CREATE TABLE tholi.job_admission (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  normal_limit integer NOT NULL DEFAULT 2048 CHECK(normal_limit BETWEEN 1 AND 8192),
  recovery_limit integer NOT NULL DEFAULT 128 CHECK(recovery_limit BETWEEN 1 AND 512),
  workspace_limit integer NOT NULL DEFAULT 64 CHECK(workspace_limit BETWEEN 1 AND 256),
  normal_count integer NOT NULL DEFAULT 0 CHECK(normal_count>=0),
  recovery_count integer NOT NULL DEFAULT 0 CHECK(recovery_count>=0)
);
INSERT INTO tholi.job_admission(singleton,normal_count,recovery_count)
SELECT true,
  count(*) FILTER(WHERE kind NOT IN('account.delete','file.expire','inference.reconcile')),
  count(*) FILTER(WHERE kind IN('account.delete','file.expire','inference.reconcile'))
FROM tholi.jobs WHERE status IN('queued','running','uncertain');
REVOKE ALL ON tholi.job_admission FROM PUBLIC;
CREATE INDEX jobs_admission_idx ON tholi.jobs(workspace_id,kind)
  WHERE status IN('queued','running','uncertain');
CREATE FUNCTION tholi.admit_job_backlog() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_active boolean:=false; new_active boolean:=false;
  old_recovery boolean:=false; new_recovery boolean:=false;
  policy tholi.job_admission; workspace_count integer;
BEGIN
  IF TG_OP<>'INSERT' THEN
    old_active:=OLD.status IN('queued','running','uncertain');
    old_recovery:=OLD.kind IN('account.delete','file.expire','inference.reconcile');
  END IF;
  IF TG_OP<>'DELETE' THEN
    new_active:=NEW.status IN('queued','running','uncertain');
    new_recovery:=NEW.kind IN('account.delete','file.expire','inference.reconcile');
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.workspace_id=NEW.workspace_id AND old_active=new_active
      AND old_recovery=new_recovery THEN RETURN NEW; END IF;
  END IF;
  -- An actual row update serializes writers, including snapshot-isolated callers.
  -- Replays which already have a job never consume another backlog slot.
  UPDATE tholi.job_admission SET normal_count=normal_count WHERE singleton;
  IF TG_OP='INSERT' THEN
    IF EXISTS(SELECT FROM tholi.jobs j WHERE j.workspace_id=NEW.workspace_id
      AND (j.id=NEW.id OR (j.account_id=NEW.account_id AND j.kind=NEW.kind AND j.version=NEW.version AND j.idempotency_key=NEW.idempotency_key))) THEN RETURN NEW; END IF;
  END IF;
  UPDATE tholi.job_admission SET
    normal_count=normal_count-(old_active AND NOT old_recovery)::integer+(new_active AND NOT new_recovery)::integer,
    recovery_count=recovery_count-(old_active AND old_recovery)::integer+(new_active AND new_recovery)::integer
    WHERE singleton RETURNING * INTO policy;
  IF new_active THEN
    IF (new_recovery AND policy.recovery_count>policy.recovery_limit)
       OR (NOT new_recovery AND policy.normal_count>policy.normal_limit) THEN
      RAISE EXCEPTION 'The durable job backlog is full.' USING ERRCODE='P4406';
    END IF;
    IF NOT new_recovery THEN
      SELECT count(*) INTO workspace_count FROM tholi.jobs
        WHERE workspace_id=NEW.workspace_id AND status IN('queued','running','uncertain')
          AND kind NOT IN('account.delete','file.expire','inference.reconcile')
          AND NOT (TG_OP='UPDATE' AND id=NEW.id);
      IF workspace_count>=policy.workspace_limit THEN
        RAISE EXCEPTION 'The workspace job backlog is full.' USING ERRCODE='P4406';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tholi.admit_job_backlog() FROM PUBLIC;
CREATE TRIGGER jobs_backlog BEFORE INSERT OR UPDATE OR DELETE ON tholi.jobs
  FOR EACH ROW EXECUTE FUNCTION tholi.admit_job_backlog();
`;
