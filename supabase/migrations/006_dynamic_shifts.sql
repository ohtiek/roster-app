-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006 · Dynamic shift definitions
--
-- Replaces the hardcoded 'morning' | 'afternoon' | 'closing' enum with a
-- per-boutique shift definition table. Supports boutiques and pop-up stores
-- with arbitrary shift structures, times, and validity windows.
--
-- New tables:
--   boutique_shifts          — shift definitions per boutique (time-bounded)
--   staff_shift_availability — replaces staff.available_shifts TEXT[]
--
-- Also adds:
--   · Partial unique index enforcing one published roster per boutique per date
-- ─────────────────────────────────────────────────────────────────────────────

-- ── boutique_shifts ───────────────────────────────────────────────────────────
-- Each row is one shift slot for a boutique.
-- valid_from / valid_until bounds when the shift exists — a pop-up store can
-- define shifts that are only active for its event window.
-- The roster engine for boutique B on date D loads shifts where:
--   valid_from <= D AND (valid_until IS NULL OR valid_until >= D)
CREATE TABLE boutique_shifts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id UUID        NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,           -- e.g. 'Morning', 'VIP Evening', 'Late Night'
  start_time  TIME        NOT NULL,           -- e.g. 08:00
  end_time    TIME        NOT NULL,           -- e.g. 14:00
  sort_order  SMALLINT    NOT NULL DEFAULT 0, -- controls display order in UI
  valid_from  DATE        NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,                           -- NULL = open-ended
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (boutique_id, name),
  CONSTRAINT boutique_shifts_time_order CHECK (end_time > start_time),
  CONSTRAINT boutique_shifts_date_order CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX boutique_shifts_boutique_id_idx   ON boutique_shifts (boutique_id);
-- Supports loading active shifts for a roster date
CREATE INDEX boutique_shifts_boutique_date_idx ON boutique_shifts (boutique_id, valid_from, valid_until);

-- ── Seed default boutique with standard three-shift schedule ──────────────────
INSERT INTO boutique_shifts (boutique_id, name, start_time, end_time, sort_order, valid_from)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Morning',   '08:00', '14:00', 0, '2000-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'Afternoon', '14:00', '18:00', 1, '2000-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'Closing',   '18:00', '22:00', 2, '2000-01-01');

-- ── staff_shift_availability ──────────────────────────────────────────────────
-- Replaces staff.available_shifts TEXT[].
-- A staff member indicates which specific boutique shifts they are available for.
-- Since shift_id already scopes to a boutique (via boutique_shifts.boutique_id),
-- no additional boutique_id column is needed here.
CREATE TABLE staff_shift_availability (
  staff_id UUID NOT NULL REFERENCES staff(id)           ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES boutique_shifts(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, shift_id)
);

CREATE INDEX staff_shift_availability_shift_id_idx ON staff_shift_availability (shift_id);

-- ── Backfill staff_shift_availability from staff.available_shifts TEXT[] ──────
-- Maps the legacy lowercase shift names to the seeded boutique_shifts rows.
-- Only applies to the default boutique; multi-boutique availability must be
-- configured per boutique after migration.
INSERT INTO staff_shift_availability (staff_id, shift_id)
SELECT DISTINCT s.id, bs.id
FROM   staff s
JOIN   boutique_shifts bs
       ON bs.boutique_id = '00000000-0000-0000-0000-000000000001'
       AND lower(bs.name) = ANY(
         SELECT lower(elem) FROM unnest(s.available_shifts) AS elem
       )
WHERE  s.available_shifts IS NOT NULL;

-- staff.available_shifts TEXT[] is now legacy.
-- It is NOT dropped here so the application can continue reading it during
-- the transition period. Drop it in migration 007 once the app is updated.

-- ── Enforce one published roster per boutique per date ────────────────────────
-- Prevents the live dashboard from seeing multiple published rosters for the
-- same boutique on the same day.
CREATE UNIQUE INDEX roster_one_published_per_boutique_date
  ON roster_history (boutique_id, roster_date)
  WHERE status = 'published';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- boutique_shifts: any user at the boutique can read; only admin can write
ALTER TABLE boutique_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY boutique_shifts_select ON boutique_shifts FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY boutique_shifts_insert ON boutique_shifts FOR INSERT
  WITH CHECK (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY boutique_shifts_update ON boutique_shifts FOR UPDATE
  USING (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY boutique_shifts_delete ON boutique_shifts FOR DELETE
  USING (has_role_at(boutique_id, ARRAY['admin']));

-- staff_shift_availability: readable by anyone at the boutique the shift belongs to
ALTER TABLE staff_shift_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_shift_avail_select ON staff_shift_availability FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = staff_shift_availability.shift_id
        AND bs.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY staff_shift_avail_insert ON staff_shift_availability FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = staff_shift_availability.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY staff_shift_avail_delete ON staff_shift_availability FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM boutique_shifts bs
      WHERE bs.id = staff_shift_availability.shift_id
        AND has_role_at(bs.boutique_id, ARRAY['admin'])
    )
  );
