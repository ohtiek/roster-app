-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019 · Fix audit trigger for composite-PK tables
--
-- log_audit_event() (migration 015) directly referenced NEW.id / OLD.id.
-- boutique_shift_requirements has a composite primary key
-- (shift_id, skill_type_id) and no id column, so any INSERT/UPDATE/DELETE
-- on that table raised: 42703 record "old"/"new" has no field "id".
--
-- Fix: derive record_id via to_jsonb(...)->>'id', which safely returns NULL
-- when the row has no id column, instead of a direct (and unsafe) field
-- reference. audit_log.record_id is relaxed to nullable to allow this.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ALTER COLUMN record_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _record_id UUID;
  _row       JSONB;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _record_id := (_row ->> 'id')::uuid;

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
