-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007 · Drop legacy staff.available_shifts column
--
-- Run AFTER the application has been updated to read/write shift availability
-- via staff_shift_availability instead of staff.available_shifts.
-- Do NOT run this until the app deploy is complete.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE staff DROP COLUMN IF EXISTS available_shifts;
