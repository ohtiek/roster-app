-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015 · Audit trail, analytics tables, and views
--
-- AUDIT TRAIL
--   audit_log                  — generic trigger-populated change log for
--                                sensitive tables (staff, roster_history,
--                                staff_unavailability, shift requirements,
--                                scoring weights)
--   scoring_weights_history    — dedicated snapshot history of weight changes
--                                per boutique, so score degradation can be
--                                traced to a weight configuration change
--
-- ANALYTICS
--   roster_actuals             — actual attendance vs the published roster plan;
--                                feeds compliance reporting and engine improvement
--
-- VIEWS
--   active_staff_skills        — staff_skills filtered to non-expired rows;
--                                the roster engine and admin UI should read
--                                this view instead of the raw table so expired
--                                certifications are automatically excluded
-- ─────────────────────────────────────────────────────────────────────────────


-- ── audit_log ────────────────────────────────────────────────────────────────
-- Populated exclusively by SECURITY DEFINER trigger functions.
-- No direct INSERT/UPDATE/DELETE policies are granted to end users.
CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT        NOT NULL,
  record_id   UUID        NOT NULL,
  action      TEXT        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_data    JSONB,
  new_data    JSONB
);

CREATE INDEX audit_log_table_record_idx ON audit_log (table_name, record_id);
CREATE INDEX audit_log_changed_at_idx   ON audit_log (changed_at DESC);
CREATE INDEX audit_log_changed_by_idx   ON audit_log (changed_by) WHERE changed_by IS NOT NULL;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Regional admin sees all; boutique admin sees all (no boutique scoping on the
-- log itself — a future migration can add boutique_id to the log if needed).
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM user_boutique_roles ubr
      WHERE ubr.user_id = auth.uid()
        AND ubr.role = 'admin'
        AND ubr.boutique_id IS NOT NULL
    )
  );

-- Generic audit trigger — fires on INSERT / UPDATE / DELETE on any attached table
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _record_id UUID;
BEGIN
  _record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;

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

-- Attach audit trigger to sensitive tables
CREATE TRIGGER audit_staff
  AFTER INSERT OR UPDATE OR DELETE ON staff
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_roster_history
  AFTER INSERT OR UPDATE OR DELETE ON roster_history
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_staff_unavailability
  AFTER INSERT OR UPDATE OR DELETE ON staff_unavailability
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_boutique_shift_requirements
  AFTER INSERT OR UPDATE OR DELETE ON boutique_shift_requirements
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

CREATE TRIGGER audit_scoring_weights
  AFTER INSERT OR UPDATE OR DELETE ON scoring_weights
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();


-- ── scoring_weights_history ───────────────────────────────────────────────────
-- A snapshot is appended every time scoring_weights is inserted or updated.
-- Allows score changes to be traced back to a weight configuration change.
-- Populated by trigger only — no direct user writes.
CREATE TABLE scoring_weights_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id UUID        NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  weights     JSONB       NOT NULL,
  changed_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scoring_weights_history_boutique_idx
  ON scoring_weights_history (boutique_id, changed_at DESC);

ALTER TABLE scoring_weights_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY scoring_weights_history_select ON scoring_weights_history FOR SELECT
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

-- Trigger: snapshot weights on every insert or update
CREATE OR REPLACE FUNCTION snapshot_scoring_weights()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO scoring_weights_history (boutique_id, weights, changed_by)
  VALUES (
    NEW.boutique_id,
    -- store the weight fields without system/PK columns
    to_jsonb(NEW)
      - 'id'
      - 'boutique_id'
      - 'created_at'
      - 'updated_at',
    auth.uid()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_scoring_weights_history
  AFTER INSERT OR UPDATE ON scoring_weights
  FOR EACH ROW EXECUTE FUNCTION snapshot_scoring_weights();


-- ── roster_actuals ────────────────────────────────────────────────────────────
-- Records whether each planned staff–shift assignment was actually fulfilled.
-- Populated by admin post-shift (or via future integration with time-and-attendance).
-- Feeds compliance reporting and long-term engine improvement.
CREATE TABLE roster_actuals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id   UUID        NOT NULL REFERENCES roster_history(id) ON DELETE CASCADE,
  staff_id    UUID        NOT NULL REFERENCES staff(id)          ON DELETE CASCADE,
  shift_id    UUID        NOT NULL REFERENCES boutique_shifts(id) ON DELETE CASCADE,
  attended    BOOLEAN     NOT NULL DEFAULT true,
  notes       TEXT,
  recorded_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (roster_id, staff_id, shift_id)
);

CREATE INDEX roster_actuals_roster_id_idx ON roster_actuals (roster_id);
CREATE INDEX roster_actuals_staff_id_idx  ON roster_actuals (staff_id);

ALTER TABLE roster_actuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_actuals_select ON roster_actuals FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM roster_history rh
      WHERE rh.id = roster_actuals.roster_id
        AND rh.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY roster_actuals_insert ON roster_actuals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roster_history rh
      WHERE rh.id = roster_actuals.roster_id
        AND has_role_at(rh.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY roster_actuals_update ON roster_actuals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM roster_history rh
      WHERE rh.id = roster_actuals.roster_id
        AND has_role_at(rh.boutique_id, ARRAY['admin'])
    )
  );

-- No DELETE policy — actuals are an immutable record once entered.


-- ── active_staff_skills (view) ────────────────────────────────────────────────
-- Returns only non-expired staff skill rows.
-- The roster engine and admin UI should query this view instead of the raw
-- staff_skills table so expired certifications are automatically excluded.
--
-- Usage: join to skill_types for is_vic_eligible / engine_priority as needed.
CREATE VIEW active_staff_skills AS
SELECT *
FROM   staff_skills
WHERE  expires_at IS NULL
   OR  expires_at >= CURRENT_DATE;
