-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020 · Fix audit trigger for non-UUID id columns
--
-- Migration 019 fixed log_audit_event() for tables with no id column
-- (boutique_shift_requirements) by reading id via to_jsonb(...)->>'id' and
-- casting to uuid. That cast itself breaks for tables whose id is not a
-- UUID — scoring_weights.id is INTEGER (migration 000) — raising:
--   22P02 invalid input syntax for type uuid: "2"
--
-- Fix: store record_id as TEXT instead of UUID. This covers UUID ids,
-- integer ids, and the NULL case (no id column) uniformly, with no cast
-- that can fail.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ALTER COLUMN record_id TYPE TEXT USING record_id::text;

CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _record_id TEXT;
  _row       JSONB;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _record_id := _row ->> 'id';

  INSERT INTO audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    _record_id,
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
