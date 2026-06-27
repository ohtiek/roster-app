-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 · Boutiques
--
-- Creates the boutiques table — the top-level organisational unit.
-- Every staff member, VIC client, roster, and scoring config will be
-- scoped to a boutique row after migration 003.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE boutiques (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  location    TEXT,
  timezone    TEXT        NOT NULL DEFAULT 'UTC',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER boutiques_updated_at
  BEFORE UPDATE ON boutiques
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Seed: default boutique for existing single-store data ─────────────────────
-- All existing rows (staff, VIC, rosters, weights) will be linked to this
-- boutique in migration 003.
INSERT INTO boutiques (id, name, location, timezone)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Boutique', NULL, 'UTC');
