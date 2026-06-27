-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004 · Row Level Security policies
--
-- Enforces boutique isolation at the database layer.
-- Helper functions (is_regional_admin, my_boutique_ids, has_role_at,
-- my_role_at) are defined in migration 002.
--
-- Policy matrix per table:
--
--   regional_admin  → SELECT all rows; no INSERT/UPDATE/DELETE (read-only oversight)
--   admin           → full CRUD on own boutique
--   approver        → SELECT + UPDATE status on own boutique's roster_history only
--   reader          → SELECT published rosters for own boutique only
--
-- For staff / vic_clients / vic_advisors / scoring_weights:
--   admin           → full CRUD on own boutique
--   approver/reader → SELECT own boutique (approver needs to see staff during review)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── boutiques ─────────────────────────────────────────────────────────────────
ALTER TABLE boutiques ENABLE ROW LEVEL SECURITY;

-- Regional admin manages boutiques
CREATE POLICY boutiques_select ON boutiques FOR SELECT
  USING (
    is_regional_admin()
    OR id IN (SELECT my_boutique_ids())
  );

CREATE POLICY boutiques_insert ON boutiques FOR INSERT
  WITH CHECK (is_regional_admin());

CREATE POLICY boutiques_update ON boutiques FOR UPDATE
  USING (is_regional_admin());

CREATE POLICY boutiques_delete ON boutiques FOR DELETE
  USING (is_regional_admin());

-- ── staff ─────────────────────────────────────────────────────────────────────
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

-- Any user at the boutique can read staff (approvers need it during review)
CREATE POLICY staff_select ON staff FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

-- Only admin can write staff
CREATE POLICY staff_insert ON staff FOR INSERT
  WITH CHECK (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY staff_update ON staff FOR UPDATE
  USING (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY staff_delete ON staff FOR DELETE
  USING (has_role_at(boutique_id, ARRAY['admin']));

-- ── vic_clients ───────────────────────────────────────────────────────────────
ALTER TABLE vic_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY vic_clients_select ON vic_clients FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

CREATE POLICY vic_clients_insert ON vic_clients FOR INSERT
  WITH CHECK (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY vic_clients_update ON vic_clients FOR UPDATE
  USING (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY vic_clients_delete ON vic_clients FOR DELETE
  USING (has_role_at(boutique_id, ARRAY['admin']));

-- ── vic_advisors ──────────────────────────────────────────────────────────────
-- Scoped via the parent vic_client's boutique_id
ALTER TABLE vic_advisors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vic_advisors_select ON vic_advisors FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM vic_clients vc
      WHERE vc.id = vic_advisors.vic_client_id
        AND vc.boutique_id IN (SELECT my_boutique_ids())
    )
  );

CREATE POLICY vic_advisors_insert ON vic_advisors FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vic_clients vc
      WHERE vc.id = vic_advisors.vic_client_id
        AND has_role_at(vc.boutique_id, ARRAY['admin'])
    )
  );

CREATE POLICY vic_advisors_delete ON vic_advisors FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM vic_clients vc
      WHERE vc.id = vic_advisors.vic_client_id
        AND has_role_at(vc.boutique_id, ARRAY['admin'])
    )
  );

-- ── scoring_weights ───────────────────────────────────────────────────────────
ALTER TABLE scoring_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY weights_select ON scoring_weights FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

-- Admin reads and writes weights for own boutique
CREATE POLICY weights_insert ON scoring_weights FOR INSERT
  WITH CHECK (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY weights_update ON scoring_weights FOR UPDATE
  USING (has_role_at(boutique_id, ARRAY['admin']));

-- ── roster_history ────────────────────────────────────────────────────────────
ALTER TABLE roster_history ENABLE ROW LEVEL SECURITY;

-- SELECT: regional admin sees all; admin/approver see own boutique;
--         reader sees only published rosters at own boutique
CREATE POLICY roster_select_regional ON roster_history FOR SELECT
  USING (is_regional_admin());

CREATE POLICY roster_select_admin_approver ON roster_history FOR SELECT
  USING (
    has_role_at(boutique_id, ARRAY['admin', 'approver'])
  );

CREATE POLICY roster_select_reader ON roster_history FOR SELECT
  USING (
    status = 'published'
    AND has_role_at(boutique_id, ARRAY['reader'])
  );

-- INSERT: only admin can create roster rows (draft / submitted)
CREATE POLICY roster_insert ON roster_history FOR INSERT
  WITH CHECK (
    has_role_at(boutique_id, ARRAY['admin'])
    AND status IN ('draft', 'submitted', 'pending_review')
    AND created_by = auth.uid()
  );

-- UPDATE: split by what each role is allowed to change
--
--   admin:    may update own draft (status=draft) or re-submit a rejected roster
--   approver: may transition submitted → approved/rejected, approved → published

CREATE POLICY roster_update_admin ON roster_history FOR UPDATE
  USING (
    has_role_at(boutique_id, ARRAY['admin'])
    AND status IN ('draft', 'rejected')   -- can only edit draft or revise rejected
    AND created_by = auth.uid()           -- can only edit own rosters
  )
  WITH CHECK (
    status IN ('draft', 'submitted', 'pending_review')  -- can save or submit
  );

CREATE POLICY roster_update_approver ON roster_history FOR UPDATE
  USING (
    has_role_at(boutique_id, ARRAY['approver'])
    AND status IN ('submitted', 'pending_review', 'approved')
  )
  WITH CHECK (
    status IN ('approved', 'rejected', 'published')
  );

-- DELETE: no one deletes rosters (audit trail); archiving is a status update
-- (Intentionally no DELETE policy — implicit deny)
