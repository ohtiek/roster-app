-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030 · Boutique areas (skillset requirements per store zone)
--
-- Client request: shift requirements today are store-wide ("this shift needs
-- 1 Floor Manager, 1 Cashier"). The client wants to specify a required
-- skillset per physical area of the boutique (e.g. Counter, Fitting Room,
-- Stockroom, VIP Room) so the engine fills each area's staffing need, not
-- just the shift's overall headcount.
--
-- NEW TABLE
--   boutique_areas             — physical zones within a boutique
--
-- EXTENDED TABLES
--   boutique_shift_requirements — gains nullable area_id; NULL keeps today's
--                                 shift-wide meaning, set = area-scoped
--   boutique_shift_day_overrides — gains the same nullable area_id, so a
--                                 day-of-week override can also be area-scoped
--
-- Both extensions are additive and default to NULL, so every existing
-- requirement/override row keeps its current (shift-wide) behaviour with no
-- backfill needed.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── boutique_areas ────────────────────────────────────────────────────────────
-- A named zone within a boutique (e.g. 'Counter', 'Fitting Room', 'Stockroom').
-- Areas are boutique-scoped, not shift-scoped — the same set of areas applies
-- across all of a boutique's shifts.
CREATE TABLE boutique_areas (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id UUID        NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  sort_order  SMALLINT    NOT NULL DEFAULT 0,   -- controls display order in UI
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (boutique_id, name)
);

CREATE INDEX boutique_areas_boutique_id_idx ON boutique_areas (boutique_id);

CREATE TRIGGER boutique_areas_updated_at
  BEFORE UPDATE ON boutique_areas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE boutique_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY boutique_areas_select ON boutique_areas FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY boutique_areas_insert ON boutique_areas FOR INSERT
  WITH CHECK (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY boutique_areas_update ON boutique_areas FOR UPDATE
  USING (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY boutique_areas_delete ON boutique_areas FOR DELETE
  USING (has_role_at(boutique_id, ARRAY['admin']));


-- ── boutique_shift_requirements — add area_id ─────────────────────────────────
-- The table's original PRIMARY KEY (shift_id, skill_type_id) assumed one
-- requirement row per skill per shift. With areas, a shift can need the same
-- skill in more than one area (e.g. 1 Sr. Stylist in the Fitting Room *and*
-- 1 Sr. Stylist at the Counter), so the composite PK is replaced with a
-- surrogate id and two partial unique indexes preserve the old and new
-- uniqueness rules:
--   · at most one shift-wide row per (shift_id, skill_type_id) — area_id NULL
--   · at most one area-scoped row per (shift_id, area_id, skill_type_id)
--
-- log_audit_event() (migrations 019/020) reads record_id via
-- to_jsonb(row)->>'id' rather than a hardcoded column reference, so adding
-- an id column here needs no change to the audit trigger.
ALTER TABLE boutique_shift_requirements
  ADD COLUMN id      UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN area_id UUID REFERENCES boutique_areas(id) ON DELETE CASCADE;

ALTER TABLE boutique_shift_requirements DROP CONSTRAINT boutique_shift_requirements_pkey;
ALTER TABLE boutique_shift_requirements ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX boutique_shift_req_shiftwide_uniq
  ON boutique_shift_requirements (shift_id, skill_type_id) WHERE area_id IS NULL;
CREATE UNIQUE INDEX boutique_shift_req_area_uniq
  ON boutique_shift_requirements (shift_id, area_id, skill_type_id) WHERE area_id IS NOT NULL;

CREATE INDEX boutique_shift_req_area_id_idx ON boutique_shift_requirements (area_id) WHERE area_id IS NOT NULL;

-- RLS policies from migration 008 reference shift_id only and are unaffected
-- by the PK/area_id change — no policy changes needed.


-- ── boutique_shift_day_overrides — add area_id ────────────────────────────────
-- Same reasoning as above: a day-of-week override can now target one area's
-- requirement instead of only the shift-wide one.
ALTER TABLE boutique_shift_day_overrides
  ADD COLUMN area_id UUID REFERENCES boutique_areas(id) ON DELETE CASCADE;

-- Replace the old (shift_id, skill_type_id, day_of_week) unique constraint
-- with the same shift-wide/area-scoped split used above. The constraint's
-- auto-generated name is looked up rather than hardcoded, since Postgres
-- truncates long auto-generated names to 63 bytes and it's easy to guess
-- the truncation point wrong.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'boutique_shift_day_overrides'::regclass
    AND contype = 'u';

  EXECUTE format('ALTER TABLE boutique_shift_day_overrides DROP CONSTRAINT %I', cname);
END $$;

CREATE UNIQUE INDEX boutique_shift_day_override_shiftwide_uniq
  ON boutique_shift_day_overrides (shift_id, skill_type_id, day_of_week) WHERE area_id IS NULL;
CREATE UNIQUE INDEX boutique_shift_day_override_area_uniq
  ON boutique_shift_day_overrides (shift_id, area_id, skill_type_id, day_of_week) WHERE area_id IS NOT NULL;

CREATE INDEX shift_day_overrides_area_id_idx ON boutique_shift_day_overrides (area_id) WHERE area_id IS NOT NULL;
