-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013 · Approval workflow completeness
--
-- DEADLINES
--   roster_history gains submit_deadline and approve_deadline so the app
--   can surface urgency and trigger escalation when SLAs are breached.
--   Values are set by the application at roster creation time, typically
--   derived from boutique_engine_config lead-time settings (future).
--
-- APPROVAL DELEGATION
--   user_boutique_roles gains approver_delegate_id so a boutique approver
--   can nominate a stand-in for periods of absence. The application must
--   treat a delegate's approve/reject/publish actions as equivalent to the
--   primary approver's for that boutique.
--   Only one level of delegation is supported; chains are not.
--
-- No new tables. No RLS changes — existing policies continue to apply.
-- The delegate check is enforced at the application layer; the DB stores
-- the relationship only.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── roster_history — deadlines ────────────────────────────────────────────────
ALTER TABLE roster_history
  ADD COLUMN submit_deadline  TIMESTAMPTZ,
  ADD COLUMN approve_deadline TIMESTAMPTZ;

-- Constraint: if both are set, submit must precede approve
ALTER TABLE roster_history
  ADD CONSTRAINT roster_deadlines_order
    CHECK (
      submit_deadline IS NULL
      OR approve_deadline IS NULL
      OR approve_deadline > submit_deadline
    );


-- ── user_boutique_roles — approver delegation ────────────────────────────────
-- approver_delegate_id: the auth.users id of the stand-in approver.
-- Only meaningful when the row's role = 'approver'.
-- The delegate must themselves hold an approver or admin role at the same
-- boutique (enforced at application layer).
ALTER TABLE user_boutique_roles
  ADD COLUMN approver_delegate_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
