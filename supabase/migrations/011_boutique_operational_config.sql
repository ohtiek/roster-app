-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 · Boutique operational configuration
--
-- REGIONS
--   regions                        — org-hierarchy above boutique level;
--                                    scopes regional_admin access
--
-- BOUTIQUE METADATA
--   boutiques gains address, store_code, region_id
--
-- OPERATIONAL TABLES
--   boutique_closures              — planned closure dates and public holidays
--   boutique_engine_config         — per-boutique tuning for the roster engine
--                                    (replaces hardcoded constants in engine.ts)
--
-- SHIFT REQUIREMENT EXTENSIONS
--   boutique_shift_requirements    — gains max_count (upper headcount bound)
--   boutique_shift_day_overrides   — day-of-week specific requirement overrides
--                                    (e.g. weekends need more staff than weekdays)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── regions ───────────────────────────────────────────────────────────────────
-- Lightweight org-hierarchy node above boutique level.
-- A regional_admin can be scoped to a region in a future migration.
CREATE TABLE regions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY regions_select ON regions FOR SELECT TO authenticated USING (true);
CREATE POLICY regions_insert ON regions FOR INSERT WITH CHECK (is_regional_admin());
CREATE POLICY regions_update ON regions FOR UPDATE USING (is_regional_admin());
CREATE POLICY regions_delete ON regions FOR DELETE USING (is_regional_admin());


-- ── boutiques — extended metadata ────────────────────────────────────────────
ALTER TABLE boutiques
  ADD COLUMN address    TEXT,
  ADD COLUMN store_code TEXT UNIQUE,
  ADD COLUMN region_id  UUID REFERENCES regions(id) ON DELETE SET NULL;

CREATE INDEX boutiques_region_id_idx ON boutiques (region_id) WHERE region_id IS NOT NULL;


-- ── boutique_closures ─────────────────────────────────────────────────────────
-- Planned closure dates for a boutique (public holidays, stock-takes, refits).
-- The roster engine and date-picker UI should refuse to generate rosters on
-- dates present in this table for the target boutique.
CREATE TABLE boutique_closures (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id  UUID        NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  closure_date DATE        NOT NULL,
  reason       TEXT,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (boutique_id, closure_date)
);

CREATE INDEX boutique_closures_boutique_date_idx ON boutique_closures (boutique_id, closure_date);

ALTER TABLE boutique_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY boutique_closures_select ON boutique_closures FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY boutique_closures_insert ON boutique_closures FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY boutique_closures_update ON boutique_closures FOR UPDATE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY boutique_closures_delete ON boutique_closures FOR DELETE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );


-- ── boutique_engine_config ────────────────────────────────────────────────────
-- Per-boutique tuning parameters for the roster engine.
-- Replaces the hardcoded constants in engine.ts so each boutique can be
-- configured independently without a code deploy.
--
-- target_headcount_per_shift  — target total staff per shift (engine fills to this)
-- max_consecutive_shifts      — fatigue threshold: flag if staff exceed this in one day
-- min_rest_hours              — minimum hours between closing shift end and next shift start
-- vic_priority_boost          — scoring bonus applied to VIC advisors when optimiseForVIC=true
CREATE TABLE boutique_engine_config (
  boutique_id                UUID        PRIMARY KEY REFERENCES boutiques(id) ON DELETE CASCADE,
  target_headcount_per_shift SMALLINT    NOT NULL DEFAULT 7  CHECK (target_headcount_per_shift > 0),
  max_consecutive_shifts     SMALLINT    NOT NULL DEFAULT 3  CHECK (max_consecutive_shifts > 0),
  min_rest_hours             SMALLINT    NOT NULL DEFAULT 10 CHECK (min_rest_hours >= 0),
  vic_priority_boost         NUMERIC(5,1) NOT NULL DEFAULT 20 CHECK (vic_priority_boost >= 0),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER boutique_engine_config_updated_at
  BEFORE UPDATE ON boutique_engine_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed default boutique with the values currently hardcoded in engine.ts
INSERT INTO boutique_engine_config (boutique_id)
VALUES ('00000000-0000-0000-0000-000000000001');

ALTER TABLE boutique_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY engine_config_select ON boutique_engine_config FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY engine_config_insert ON boutique_engine_config FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY engine_config_update ON boutique_engine_config FOR UPDATE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );

CREATE POLICY engine_config_delete ON boutique_engine_config FOR DELETE
  USING (is_regional_admin());


-- ── boutique_shift_requirements — add max_count ───────────────────────────────
-- Adds an optional upper headcount bound per skill type per shift.
-- NULL = no cap (existing behaviour).
-- The engine should not assign more of a given skill type than max_count.
ALTER TABLE boutique_shift_requirements
  ADD COLUMN max_count SMALLINT
    CHECK (max_count IS NULL OR max_count >= min_count);


-- ── boutique_shift_day_overrides ──────────────────────────────────────────────
-- Day-of-week specific requirement overrides for a shift + skill type.
-- When present, these take precedence over the base boutique_shift_requirements
-- row for the matching day.
--
-- day_of_week follows PostgreSQL EXTRACT(DOW FROM date) convention:
--   0 = Sunday, 1 = Monday, … 6 = Saturday
--
-- Engine lookup order:
--   1. Check boutique_shift_day_overrides for (shift_id, skill_type_id, day_of_week)
--   2. If found, use override min_count / max_count
--   3. Otherwise fall back to boutique_shift_requirements
CREATE TABLE boutique_shift_day_overrides (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      UUID     NOT NULL REFERENCES boutique_shifts(id) ON DELETE CASCADE,
  skill_type_id UUID     NOT NULL REFERENCES skill_types(id)     ON DELETE RESTRICT,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  min_count     SMALLINT NOT NULL DEFAULT 1 CHECK (min_count > 0),
  max_count     SMALLINT          CHECK (max_count IS NULL OR max_count >= min_count),

  UNIQUE (shift_id, skill_type_id, day_of_week)
);

CREATE INDEX shift_day_overrides_shift_id_idx       ON boutique_shift_day_overrides (shift_id);
CREATE INDEX shift_day_overrides_skill_type_id_idx  ON boutique_shift_day_overrides (skill_type_id);

ALTER TABLE boutique_shift_day_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY shift_day_override_select ON boutique_shift_day_overrides FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_day_overrides.shift_id
        AND bs.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY shift_day_override_insert ON boutique_shift_day_overrides FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_day_overrides.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY shift_day_override_update ON boutique_shift_day_overrides FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_day_overrides.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY shift_day_override_delete ON boutique_shift_day_overrides FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_day_overrides.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );
