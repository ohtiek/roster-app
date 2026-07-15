-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024 · Allow a user to hold more than one role at the same boutique
--
-- user_boutique_roles previously had UNIQUE (user_id, boutique_id), which
-- caps a user at exactly one role per boutique — a small boutique's single
-- manager could not hold both 'admin' (submit rosters) and 'approver'
-- (approve/reject/publish them) at the same time, which is an intended,
-- accepted workflow (self-approval is allowed; there is no
-- separation-of-duties requirement in this app).
--
-- Relaxes the constraint to UNIQUE (user_id, boutique_id, role): still
-- prevents the same role being assigned twice, but now allows distinct
-- roles (e.g. admin + approver) for the same user at the same boutique.
-- No existing data is affected — every current row already satisfies the
-- new, looser constraint.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the existing (user_id, boutique_id) unique constraint by looking up
-- its actual name rather than assuming Postgres's default auto-generated
-- one, since it was declared inline without an explicit name in migration 002.
DO $$
DECLARE
  _constraint_name TEXT;
BEGIN
  SELECT con.conname INTO _constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'user_boutique_roles'
    AND con.contype = 'u'
    AND (SELECT array_agg(k ORDER BY k) FROM unnest(con.conkey) AS k) = (
      SELECT array_agg(attnum ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = rel.oid AND attname IN ('user_id', 'boutique_id')
    );

  IF _constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE user_boutique_roles DROP CONSTRAINT %I', _constraint_name);
  END IF;
END $$;

ALTER TABLE user_boutique_roles
  ADD CONSTRAINT user_boutique_roles_user_id_boutique_id_role_key
    UNIQUE NULLS NOT DISTINCT (user_id, boutique_id, role);
