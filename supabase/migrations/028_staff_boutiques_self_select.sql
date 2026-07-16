-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028 · Let a staff member read their own staff_boutiques link
--
-- Migration 010 added staff_self_select so a logged-in staff member can read
-- their own `staff` row, but staff_boutiques kept only staff_boutiques_select
-- (migration 004), which gates on my_boutique_ids() — populated from
-- user_boutique_roles. A plain staff login has no user_boutique_roles row at
-- all, so that policy always evaluated to false for them.
--
-- Effect: useSession.ts's embedded join
--   staff.select('id, staff_boutiques(boutique_id)').eq('user_id', ...)
-- returned the staff row but silently dropped the nested staff_boutiques
-- rows (RLS-filtered, not an error), leaving staffBoutiqueId undefined and
-- "My Schedule" reporting the account isn't linked to a boutique — even
-- though it is. Same root-cause shape as migration 026, one table over.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY staff_boutiques_self_select ON staff_boutiques FOR SELECT
  USING (
    staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid())
  );
