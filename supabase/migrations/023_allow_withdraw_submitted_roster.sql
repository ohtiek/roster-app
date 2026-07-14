-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023 · Allow admin to withdraw a submitted roster
--
-- Previously an admin could only update their own roster while it was
-- 'draft' or 'rejected' — once submitted, only an approver could move it
-- (approve/reject), leaving no way to recall a mistaken submission before
-- an approver acts on it.
--
-- Adds 'submitted' to the admin update policy's USING clause. The WITH
-- CHECK clause is unchanged (still only draft/submitted/pending_review),
-- so this does not let an admin approve, publish, or reject — it only
-- lets them move their own submitted roster back to draft.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS roster_update_admin ON roster_history;

CREATE POLICY roster_update_admin ON roster_history FOR UPDATE
  USING (
    has_role_at(boutique_id, ARRAY['admin'])
    AND status IN ('draft', 'rejected', 'submitted')  -- submitted: allows withdraw back to draft
    AND created_by = auth.uid()
  )
  WITH CHECK (
    status IN ('draft', 'submitted', 'pending_review')
  );
