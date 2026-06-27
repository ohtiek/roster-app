-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 · User Boutique Roles
--
-- Joins auth.users to boutiques with a role.
-- One user can hold a role at multiple boutiques.
-- A regional_admin has boutique_id = NULL (cross-boutique access).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE user_boutique_roles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL means cross-boutique (regional_admin only)
  boutique_id  UUID        REFERENCES boutiques(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('regional_admin', 'admin', 'approver', 'reader')),
  display_name TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One role per user per boutique; regional_admin has a single (user_id, NULL) row
  UNIQUE NULLS NOT DISTINCT (user_id, boutique_id),

  -- Boutique scope rules: regional_admin must have NULL boutique_id;
  -- all other roles must have a non-NULL boutique_id
  CONSTRAINT regional_admin_has_no_boutique
    CHECK (role != 'regional_admin' OR boutique_id IS NULL),
  CONSTRAINT non_regional_has_boutique
    CHECK (role = 'regional_admin' OR boutique_id IS NOT NULL)
);

-- Index for the most common lookup: "what roles does this user have?"
CREATE INDEX user_boutique_roles_user_id_idx ON user_boutique_roles (user_id);
-- Index for "who has access to this boutique?"
CREATE INDEX user_boutique_roles_boutique_id_idx ON user_boutique_roles (boutique_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper functions (SECURITY DEFINER so RLS policies can call them safely)
-- ─────────────────────────────────────────────────────────────────────────────

-- Returns true if the current user is a regional_admin
CREATE OR REPLACE FUNCTION is_regional_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_boutique_roles
    WHERE user_id = auth.uid() AND role = 'regional_admin'
  );
$$;

-- Returns the set of boutique_ids the current user has any access to
CREATE OR REPLACE FUNCTION my_boutique_ids()
RETURNS SETOF UUID LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT boutique_id FROM user_boutique_roles
  WHERE user_id = auth.uid() AND boutique_id IS NOT NULL;
$$;

-- Returns true if the current user holds one of the given roles at a boutique
CREATE OR REPLACE FUNCTION has_role_at(bid UUID, allowed_roles TEXT[])
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_boutique_roles
    WHERE user_id = auth.uid()
      AND boutique_id = bid
      AND role = ANY(allowed_roles)
  );
$$;

-- Returns the current user's role at a given boutique (NULL if none)
CREATE OR REPLACE FUNCTION my_role_at(bid UUID)
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM user_boutique_roles
  WHERE user_id = auth.uid() AND boutique_id = bid
  LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS for user_boutique_roles itself
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_boutique_roles ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read their own role rows
CREATE POLICY ubr_select_own ON user_boutique_roles
  FOR SELECT USING (user_id = auth.uid() OR is_regional_admin());

-- Only regional_admin can manage role assignments
CREATE POLICY ubr_insert ON user_boutique_roles
  FOR INSERT WITH CHECK (is_regional_admin());

CREATE POLICY ubr_update ON user_boutique_roles
  FOR UPDATE USING (is_regional_admin());

CREATE POLICY ubr_delete ON user_boutique_roles
  FOR DELETE USING (is_regional_admin());
