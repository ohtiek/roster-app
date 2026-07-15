-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 · Let a staff member read published rosters for their boutique
--
-- roster_history's three SELECT policies (migration 004) all gate on
-- has_role_at() / is_regional_admin(), which check user_boutique_roles.
-- A plain staff member — linked only via staff.user_id = auth.uid(), with no
-- user_boutique_roles row at all — matched none of them, so "My Schedule"
-- would always be empty regardless of what the frontend queries for.
--
-- Added narrowly (a new is_staff_at() helper + one new policy) rather than
-- broadening my_boutique_ids(), since that function backs policies on many
-- other tables (boutiques, vic_clients, scoring_weights, ...) whose access
-- rules shouldn't change as a side effect of this.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_staff_at(bid UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff s
    JOIN staff_boutiques sb ON sb.staff_id = s.id
    WHERE s.user_id = auth.uid() AND sb.boutique_id = bid
  );
$$;

CREATE POLICY roster_select_staff ON roster_history FOR SELECT
  USING (
    status = 'published'
    AND is_staff_at(boutique_id)
  );
