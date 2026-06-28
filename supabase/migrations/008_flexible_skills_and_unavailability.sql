-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008 · Flexible skills and hour-level unavailability
--
-- SKILLS
--   skill_types                — normalised role/skill definitions (replaces
--                                hardcoded Role enum and engine constants)
--   staff_skills               — many-to-many: a staff member can hold
--                                multiple skills at different proficiency levels
--   boutique_shift_requirements — configurable per-shift skill requirements
--                                (replaces hardcoded SHIFT_MIN in engine.ts)
--
-- UNAVAILABILITY
--   staff_unavailability       — hour-level unavailability blocks with source
--                                tracking (replaces cannot_work_dates TEXT[])
--   staff_required_work        — required-work dates with source tracking
--                                (replaces must_work_dates TEXT[])
--
-- Legacy columns staff.role, staff.must_work_dates, staff.cannot_work_dates
-- are kept for backward compatibility and dropped in migration 009 post-deploy.
-- staff.seniority is a career-level field and is intentionally kept.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── skill_types ───────────────────────────────────────────────────────────────
-- Defines every skill/role type in the system.
--
-- is_vic_eligible      replaces the hardcoded VIC_ELIGIBLE_ROLES set in engine.ts
-- is_senior_equivalent replaces the hardcoded SENIOR_ROLES set in engine.ts
-- engine_priority      replaces the hardcoded priority map in engine.ts
--   (higher = engine assigns this skill type to a shift first)
CREATE TABLE skill_types (
  id                   UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT     NOT NULL UNIQUE,
  category             TEXT,                        -- e.g. 'management', 'styling', 'operations'
  is_vic_eligible      BOOLEAN  NOT NULL DEFAULT false,
  is_senior_equivalent BOOLEAN  NOT NULL DEFAULT false,
  engine_priority      SMALLINT NOT NULL DEFAULT 1, -- used by roster engine for assignment ordering
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed from the existing hardcoded Role enum + engine constants
INSERT INTO skill_types (name, category, is_vic_eligible, is_senior_equivalent, engine_priority)
VALUES
  ('Floor Manager',   'management',       true,  true,  5),
  ('Sr. Stylist',     'styling',          true,  true,  3),
  ('Jr. Stylist',     'styling',          false, false, 2),
  ('VIC Advisor',     'client_relations', true,  true,  4),
  ('Cashier',         'operations',       false, false, 2),
  ('Stock Associate', 'operations',       false, false, 1);


-- ── staff_skills ──────────────────────────────────────────────────────────────
-- A staff member can hold multiple skills.
-- is_primary marks the main role (one per staff member) used for display
-- and as the fallback when boutique_shift_requirements is not yet configured.
-- proficiency_level is free-text so boutiques can define their own scale
-- (e.g. 'competent' | 'proficient' | 'expert', or numeric levels).
CREATE TABLE staff_skills (
  staff_id          UUID    NOT NULL REFERENCES staff(id)       ON DELETE CASCADE,
  skill_type_id     UUID    NOT NULL REFERENCES skill_types(id) ON DELETE RESTRICT,
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  proficiency_level TEXT,
  certified_at      DATE,
  expires_at        DATE,                    -- NULL = no expiry
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (staff_id, skill_type_id),
  CONSTRAINT staff_skills_expiry_order CHECK (expires_at IS NULL OR expires_at > certified_at)
);

CREATE INDEX staff_skills_skill_type_id_idx ON staff_skills (skill_type_id);

-- Backfill: map staff.role (primary role) to the seeded skill_types
INSERT INTO staff_skills (staff_id, skill_type_id, is_primary)
SELECT s.id, st.id, true
FROM   staff s
JOIN   skill_types st ON lower(st.name) = lower(s.role)
WHERE  s.role IS NOT NULL;


-- ── boutique_shift_requirements ───────────────────────────────────────────────
-- Defines how many of each skill type are required on a given boutique shift.
-- Replaces the hardcoded SHIFT_MIN = { 'Floor Manager': 1, ... } in engine.ts.
-- The engine loads this table at roster-generation time instead of reading
-- a static constant.
CREATE TABLE boutique_shift_requirements (
  shift_id      UUID     NOT NULL REFERENCES boutique_shifts(id) ON DELETE CASCADE,
  skill_type_id UUID     NOT NULL REFERENCES skill_types(id)     ON DELETE RESTRICT,
  min_count     SMALLINT NOT NULL DEFAULT 1 CHECK (min_count > 0),
  PRIMARY KEY (shift_id, skill_type_id)
);

CREATE INDEX boutique_shift_req_shift_id_idx       ON boutique_shift_requirements (shift_id);
CREATE INDEX boutique_shift_req_skill_type_id_idx  ON boutique_shift_requirements (skill_type_id);

-- Seed default boutique's three shifts with the existing hardcoded requirements:
--   Floor Manager ×1, Sr. Stylist ×1, VIC Advisor ×1, Cashier ×1
INSERT INTO boutique_shift_requirements (shift_id, skill_type_id, min_count)
SELECT bs.id, st.id, 1
FROM   boutique_shifts bs
JOIN   skill_types st ON st.name IN ('Floor Manager', 'Sr. Stylist', 'VIC Advisor', 'Cashier')
WHERE  bs.boutique_id = '00000000-0000-0000-0000-000000000001';


-- ── staff_unavailability ──────────────────────────────────────────────────────
-- Hour-level unavailability blocks per staff member.
-- Replaces the date-only cannot_work_dates TEXT[] array.
--
-- source values:
--   'leave_system' — imported from the company leave / HR system
--   'ad_hoc'       — submitted directly in the roster app (admin or staff)
--   'manual'       — legacy data entered before source tracking was added
--
-- source_ref stores the external system's reference ID (e.g. leave request ID)
-- so records can be reconciled or de-duplicated on re-import.
--
-- The roster engine excludes staff who have an unavailability block overlapping
-- a shift's time window on the target date:
--   starts_at < shift_end AND ends_at > shift_start
CREATE TABLE staff_unavailability (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'manual'
                CHECK (source IN ('leave_system', 'ad_hoc', 'manual')),
  source_ref  TEXT,       -- external leave system reference ID
  reason      TEXT,       -- optional note shown in planner UI
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT staff_unavailability_time_order CHECK (ends_at > starts_at)
);

CREATE INDEX staff_unavailability_staff_id_idx   ON staff_unavailability (staff_id);
-- Supports the engine's overlap query for a target date window
CREATE INDEX staff_unavailability_time_range_idx ON staff_unavailability (staff_id, starts_at, ends_at);

-- Backfill from cannot_work_dates TEXT[]: each date becomes a full-day block
INSERT INTO staff_unavailability (staff_id, starts_at, ends_at, source, reason)
SELECT
  s.id,
  (d::DATE)::TIMESTAMPTZ,
  ((d::DATE) + INTERVAL '1 day')::TIMESTAMPTZ,
  'manual',
  'Imported from cannot_work_dates'
FROM staff s, unnest(s.cannot_work_dates) AS d
WHERE array_length(s.cannot_work_dates, 1) > 0;


-- ── staff_required_work ───────────────────────────────────────────────────────
-- Dates a staff member is required to work (must_work_dates).
-- Kept as date-level (no time component needed — the engine boosts priority
-- for any shift on that date).
CREATE TABLE staff_required_work (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date  DATE        NOT NULL,
  source     TEXT        NOT NULL DEFAULT 'manual'
               CHECK (source IN ('leave_system', 'ad_hoc', 'manual')),
  source_ref TEXT,
  reason     TEXT,
  created_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (staff_id, work_date)
);

CREATE INDEX staff_required_work_staff_id_idx ON staff_required_work (staff_id);
CREATE INDEX staff_required_work_date_idx     ON staff_required_work (work_date);

-- Backfill from must_work_dates TEXT[]
INSERT INTO staff_required_work (staff_id, work_date, source, reason)
SELECT
  s.id,
  d::DATE,
  'manual',
  'Imported from must_work_dates'
FROM staff s, unnest(s.must_work_dates) AS d
WHERE array_length(s.must_work_dates, 1) > 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- skill_types: global read; only regional_admin can manage
ALTER TABLE skill_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY skill_types_select ON skill_types FOR SELECT TO authenticated USING (true);
CREATE POLICY skill_types_insert ON skill_types FOR INSERT WITH CHECK (is_regional_admin());
CREATE POLICY skill_types_update ON skill_types FOR UPDATE USING (is_regional_admin());
CREATE POLICY skill_types_delete ON skill_types FOR DELETE USING (is_regional_admin());

-- staff_skills: readable by anyone with boutique access to a shift that includes the staff;
-- write access for boutique admins (scoped via staff_boutiques)
ALTER TABLE staff_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_skills_select ON staff_skills FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_skills.staff_id
        AND sb.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY staff_skills_insert ON staff_skills FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_skills.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_skills_update ON staff_skills FOR UPDATE
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_skills.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_skills_delete ON staff_skills FOR DELETE
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_skills.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

-- boutique_shift_requirements: readable by anyone at the boutique; admin can write
ALTER TABLE boutique_shift_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY shift_req_select ON boutique_shift_requirements FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_requirements.shift_id
        AND bs.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY shift_req_insert ON boutique_shift_requirements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_requirements.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY shift_req_update ON boutique_shift_requirements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_requirements.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY shift_req_delete ON boutique_shift_requirements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = boutique_shift_requirements.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );

-- staff_unavailability: admin at any linked boutique can read and write;
-- the staff member's own record is accessible via boutique membership
ALTER TABLE staff_unavailability ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_unavail_select ON staff_unavailability FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_unavailability.staff_id
        AND sb.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY staff_unavail_insert ON staff_unavailability FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_unavailability.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_unavail_update ON staff_unavailability FOR UPDATE
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_unavailability.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_unavail_delete ON staff_unavailability FOR DELETE
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_unavailability.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

-- staff_required_work: same access pattern as staff_unavailability
ALTER TABLE staff_required_work ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_req_work_select ON staff_required_work FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_required_work.staff_id
        AND sb.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY staff_req_work_insert ON staff_required_work FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_required_work.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_req_work_update ON staff_required_work FOR UPDATE
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_required_work.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_req_work_delete ON staff_required_work FOR DELETE
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM staff_boutiques sb
      WHERE sb.staff_id = staff_required_work.staff_id
        AND has_role_at(sb.boutique_id, ARRAY['admin'])
    )
  );
