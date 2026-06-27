-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005 · Drop legacy free-text actor columns
--
-- Run this AFTER the application has been updated to write approved_by_id,
-- published_by_id, and rejected_by_id instead of the old text columns.
-- Do NOT run this until the app deploy is complete.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE roster_history
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS rejected_by;
