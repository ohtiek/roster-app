-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 · Staff employment model
--
-- Adds employment classification and contracted hours to staff so the roster
-- engine can respect award conditions and part-time limits.
--
-- Adds leave_type to staff_unavailability for HR reporting and leave-balance
-- tracking without requiring the external leave system to be the source of truth.
--
-- No new tables — all changes are additive columns on existing tables.
-- No RLS changes needed — existing table-level policies continue to apply.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── staff — employment classification ────────────────────────────────────────

ALTER TABLE staff
  ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'casual', 'contractor')),
  ADD COLUMN contracted_hours_per_week NUMERIC(5,2)
    CHECK (contracted_hours_per_week IS NULL OR contracted_hours_per_week > 0);

-- casual and contractor staff typically have no fixed contracted hours
-- full_time and part_time staff will have contracted_hours_per_week set by admin


-- ── staff_unavailability — leave type ────────────────────────────────────────
-- Categorises what kind of absence the block represents.
-- Does not affect engine logic (the engine only cares about the time range)
-- but enables leave-balance reporting without relying on source_ref alone.
--
-- 'public_holiday' — boutique is closed; typically inserted by admin in bulk
-- 'toil'           — time off in lieu for extra hours worked
ALTER TABLE staff_unavailability
  ADD COLUMN leave_type TEXT
    CHECK (leave_type IN (
      'annual',
      'sick',
      'toil',
      'parental',
      'public_holiday',
      'unpaid',
      'other'
    ));
