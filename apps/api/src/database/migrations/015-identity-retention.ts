export const identityRetention = `
-- Idle services must not retain expired PKCE proofs or session credentials forever.
-- This capability accepts only a batch size and never returns credential material.
CREATE INDEX sessions_retention_idx ON tholi.sessions(expires_at,id);
CREATE INDEX refresh_retention_idx ON tholi.session_refresh_tokens(session_id,token_hash);
CREATE FUNCTION tholi.prune_identity_metadata(batch integer)
  RETURNS TABLE(flows_deleted integer,logout_deleted integer,refresh_deleted integer,sessions_deleted integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidates uuid[];
BEGIN
  IF batch IS NULL OR batch NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid identity retention budget.' USING ERRCODE='22023';
  END IF;
  WITH due AS (SELECT state_hash FROM tholi.identity_flows WHERE expires_at<=clock_timestamp()
    ORDER BY expires_at,state_hash LIMIT batch FOR UPDATE SKIP LOCKED)
    DELETE FROM tholi.identity_flows f USING due WHERE f.state_hash=due.state_hash;
  GET DIAGNOSTICS flows_deleted=ROW_COUNT;
  WITH due AS (SELECT issuer,event_id FROM tholi.identity_logout_events WHERE expires_at<=clock_timestamp()
    ORDER BY expires_at,issuer,event_id LIMIT batch FOR UPDATE SKIP LOCKED)
    DELETE FROM tholi.identity_logout_events e USING due WHERE (e.issuer,e.event_id)=(due.issuer,due.event_id);
  GET DIAGNOSTICS logout_deleted=ROW_COUNT;
  -- Match refresh rotation's parent-before-child lock order. Keep the complete
  -- replay family until its absolute session expiry, including revoked sessions.
  SELECT array_agg(id) INTO candidates FROM (SELECT id FROM tholi.sessions
    WHERE expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT batch FOR UPDATE SKIP LOCKED) due;
  WITH due AS (SELECT token_hash FROM tholi.session_refresh_tokens WHERE session_id=ANY(candidates)
    ORDER BY session_id,token_hash LIMIT batch FOR UPDATE SKIP LOCKED)
    DELETE FROM tholi.session_refresh_tokens r USING due WHERE r.token_hash=due.token_hash;
  GET DIAGNOSTICS refresh_deleted=ROW_COUNT;
  DELETE FROM tholi.sessions s WHERE s.id=ANY(candidates)
    AND NOT EXISTS(SELECT FROM tholi.session_refresh_tokens r WHERE r.session_id=s.id);
  GET DIAGNOSTICS sessions_deleted=ROW_COUNT;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION tholi.prune_identity_metadata(integer) FROM PUBLIC;
`;
