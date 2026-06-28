-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009 · Drop legacy staff columns superseded by migration 008
--
-- Run AFTER the application has been updated to:
--   · read skills via staff_skills + skill_types (not staff.role)
--   · read unavailability via staff_unavailability (not staff.cannot_work_dates)
--   · read required-work dates via staff_required_work (not staff.must_work_dates)
--
-- Do NOT run this until the app deploy is complete and confirmed.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE staff DROP COLUMN IF EXISTS role;
ALTER TABLE staff DROP COLUMN IF EXISTS cannot_work_dates;
ALTER TABLE staff DROP COLUMN IF EXISTS must_work_dates;
