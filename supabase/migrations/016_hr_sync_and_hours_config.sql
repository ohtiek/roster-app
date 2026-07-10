-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 · HR sync identifier + daily hours cap
--
-- staff.external_hr_id
--   Idempotent upsert key for the ETL-driven staff and leave sync.
--   Populated by the sync-staff Edge Function; NULL for staff created
--   manually in the admin portal.
--
-- boutique_engine_config.max_hours_per_day
--   Daily hard ceiling applied to every staff member during roster
--   generation and override constraint checking. Default 10 hours.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE staff
  ADD COLUMN external_hr_id TEXT UNIQUE;

CREATE INDEX staff_external_hr_id_idx ON staff (external_hr_id)
  WHERE external_hr_id IS NOT NULL;

ALTER TABLE boutique_engine_config
  ADD COLUMN max_hours_per_day SMALLINT NOT NULL DEFAULT 10
    CHECK (max_hours_per_day > 0);
