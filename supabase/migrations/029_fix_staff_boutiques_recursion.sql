-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 029 · Fix infinite recursion in staff_boutiques_self_select
--
-- Migration 028 added:
--   CREATE POLICY staff_boutiques_self_select ON staff_boutiques FOR SELECT
--     USING (staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid()));
--
-- That inline subquery runs as the querying role, so it re-evaluates staff's
-- own RLS policies — and staff_select (migration 004) reads staff_boutiques
-- to check boutique membership. staff_boutiques -> staff -> staff_boutiques,
-- an infinite loop ("infinite recursion detected in policy for relation
-- staff_boutiques").
--
-- Every other cross-table policy check in this schema (is_regional_admin,
-- has_role_at, my_boutique_ids, is_staff_at) goes through a SECURITY DEFINER
-- function specifically to avoid this: such a function executes as its
-- owner, which is exempt from RLS, so the inner query never re-triggers
-- policy evaluation. Migration 028 didn't follow that pattern — fixing it
-- here instead of rewriting 028, since 028 has already been applied.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS staff_boutiques_self_select ON staff_boutiques;

CREATE OR REPLACE FUNCTION my_staff_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT id FROM staff WHERE user_id = auth.uid();
$$;

CREATE POLICY staff_boutiques_self_select ON staff_boutiques FOR SELECT
  USING (staff_id = my_staff_id());
