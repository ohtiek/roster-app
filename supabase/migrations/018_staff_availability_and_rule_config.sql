-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018 · Staff day-of-week availability + per-boutique rule config
--
-- STAFF_AVAILABILITY_DAYS
--   Per-boutique contracted working days for each staff member.
--   Closes the gap where a Monday-Wednesday-Friday part-timer could appear
--   eligible on any day. The engine (and admin UI) checks this table when
--   the 'day_of_week_availability' rule is enabled in boutique_rule_config.
--
-- BOUTIQUE_RULE_CONFIG
--   Named rule toggles per boutique. Each row controls one named rule:
--     is_enabled   — whether the rule runs at all
--     severity     — 'hard_block'  → engine refuses to assign; skip the staff
--                    'warning'     → engine assigns but flags in hours_warnings /
--                                    fatigue_flags
--   Thresholds (e.g. max hours value) remain in boutique_engine_config;
--   this table only controls whether the rule fires and how loudly.
--
-- KNOWN RULE KEYS
--   max_hours_per_day       daily hours ceiling (boutique_engine_config.max_hours_per_day)
--   weekly_hours_cap        weekly contracted cap for part_time / casual staff
--   min_rest_hours          rest between closing shift end and next shift start
--   max_consecutive_shifts  fatigue: max shifts in one day
--   certification_expiry    exclude staff whose skill cert has expired
--   vic_coverage            flag shifts with uncovered VIC clients
--   gender_balance          flag shifts outside 30-70 % female band
--   day_of_week_availability filter staff not contracted on this weekday
-- ─────────────────────────────────────────────────────────────────────────────


-- ── staff_availability_days ───────────────────────────────────────────────────
-- Records which days of the week a staff member is contracted to work at a
-- specific boutique. If no rows exist for a staff member, any day is assumed
-- available (backward-compatible with pre-018 data).
--
-- day_of_week follows PostgreSQL EXTRACT(DOW) convention:
--   0 = Sunday, 1 = Monday, … 6 = Saturday
CREATE TABLE staff_availability_days (
  staff_id    UUID     NOT NULL REFERENCES staff(id)     ON DELETE CASCADE,
  boutique_id UUID     NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),

  PRIMARY KEY (staff_id, boutique_id, day_of_week)
);

CREATE INDEX staff_avail_days_boutique_idx ON staff_availability_days (boutique_id, day_of_week);

ALTER TABLE staff_availability_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_avail_days_select ON staff_availability_days FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY staff_avail_days_insert ON staff_availability_days FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY staff_avail_days_update ON staff_availability_days FOR UPDATE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY staff_avail_days_delete ON staff_availability_days FOR DELETE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );


-- ── boutique_rule_config ──────────────────────────────────────────────────────
CREATE TABLE boutique_rule_config (
  boutique_id UUID     NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  rule_key    TEXT     NOT NULL,
  is_enabled  BOOLEAN  NOT NULL DEFAULT true,
  severity    TEXT     NOT NULL DEFAULT 'warning'
                CHECK (severity IN ('hard_block', 'warning')),
  updated_by  UUID     REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (boutique_id, rule_key)
);

CREATE TRIGGER boutique_rule_config_updated_at
  BEFORE UPDATE ON boutique_rule_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE boutique_rule_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY rule_config_select ON boutique_rule_config FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY rule_config_insert ON boutique_rule_config FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY rule_config_update ON boutique_rule_config FOR UPDATE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY rule_config_delete ON boutique_rule_config FOR DELETE
  USING (is_regional_admin());


-- ── Seed default boutique with sensible rule defaults ─────────────────────────
-- All eight named rules are seeded so the Rules page can display them
-- immediately without requiring the admin to manually create rows.
INSERT INTO boutique_rule_config (boutique_id, rule_key, is_enabled, severity)
VALUES
  -- Hard constraints: things that create legal or operational risk
  ('00000000-0000-0000-0000-000000000001', 'max_hours_per_day',        true,  'warning'),
  ('00000000-0000-0000-0000-000000000001', 'weekly_hours_cap',         true,  'warning'),
  ('00000000-0000-0000-0000-000000000001', 'min_rest_hours',           true,  'warning'),
  ('00000000-0000-0000-0000-000000000001', 'max_consecutive_shifts',   true,  'warning'),
  ('00000000-0000-0000-0000-000000000001', 'certification_expiry',     true,  'hard_block'),
  -- Soft constraints: coverage and quality targets
  ('00000000-0000-0000-0000-000000000001', 'vic_coverage',             true,  'warning'),
  ('00000000-0000-0000-0000-000000000001', 'gender_balance',           true,  'warning'),
  -- Disabled by default until staff_availability_days is populated
  ('00000000-0000-0000-0000-000000000001', 'day_of_week_availability', false, 'hard_block');
