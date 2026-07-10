-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 022 · Add roster_history.submitted_at
--
-- approved_at, published_at, and rejected_at have existed since the base
-- schema, one per status transition. Migration 003 added 'draft' and
-- 'submitted' to the status CHECK constraint but never added a matching
-- submitted_at column — RostersPage.tsx writes to it on submit, which
-- fails with PGRST204 "Could not find the 'submitted_at' column".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE roster_history
  ADD COLUMN submitted_at TIMESTAMPTZ;
