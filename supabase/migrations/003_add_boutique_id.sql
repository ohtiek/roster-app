-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 · Add boutique_id to existing tables
--
-- Adds boutique_id (nullable first, then NOT NULL after backfill) to:
--   staff, vic_clients, vic_advisors (via vic_clients), scoring_weights,
--   roster_history
--
-- Also:
--   · Adds created_by UUID to roster_history (replaces free-text author tracking)
--   · Adds approved_by_id / published_by_id / rejected_by_id as UUID columns
--     alongside the old text columns (old columns dropped in a later cleanup)
--   · Adds 'draft', 'submitted', 'archived' to the status check constraint
-- ─────────────────────────────────────────────────────────────────────────────

-- ── staff ─────────────────────────────────────────────────────────────────────
ALTER TABLE staff
  ADD COLUMN boutique_id UUID REFERENCES boutiques(id) ON DELETE CASCADE;

-- Backfill all existing staff to the default boutique
UPDATE staff SET boutique_id = '00000000-0000-0000-0000-000000000001'
  WHERE boutique_id IS NULL;

ALTER TABLE staff
  ALTER COLUMN boutique_id SET NOT NULL;

CREATE INDEX staff_boutique_id_idx ON staff (boutique_id);

CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── vic_clients ───────────────────────────────────────────────────────────────
ALTER TABLE vic_clients
  ADD COLUMN boutique_id UUID REFERENCES boutiques(id) ON DELETE CASCADE;

UPDATE vic_clients SET boutique_id = '00000000-0000-0000-0000-000000000001'
  WHERE boutique_id IS NULL;

ALTER TABLE vic_clients
  ALTER COLUMN boutique_id SET NOT NULL;

CREATE INDEX vic_clients_boutique_id_idx ON vic_clients (boutique_id);

CREATE TRIGGER vic_clients_updated_at
  BEFORE UPDATE ON vic_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- vic_advisors inherits boutique scope from vic_clients — no column needed here

-- ── scoring_weights ───────────────────────────────────────────────────────────
-- Currently a singleton table (id=1, integer PK).
-- Add boutique_id so each boutique can have its own weight config.
-- The app will switch from querying by id=1 to querying by boutique_id.
ALTER TABLE scoring_weights
  ADD COLUMN boutique_id UUID REFERENCES boutiques(id) ON DELETE CASCADE;

UPDATE scoring_weights SET boutique_id = '00000000-0000-0000-0000-000000000001'
  WHERE boutique_id IS NULL;

ALTER TABLE scoring_weights
  ALTER COLUMN boutique_id SET NOT NULL;

-- Add a unique constraint: one weight config per boutique
ALTER TABLE scoring_weights
  ADD CONSTRAINT scoring_weights_boutique_unique UNIQUE (boutique_id);

CREATE INDEX scoring_weights_boutique_id_idx ON scoring_weights (boutique_id);

-- ── roster_history ────────────────────────────────────────────────────────────
ALTER TABLE roster_history
  ADD COLUMN boutique_id UUID REFERENCES boutiques(id) ON DELETE CASCADE;

UPDATE roster_history SET boutique_id = '00000000-0000-0000-0000-000000000001'
  WHERE boutique_id IS NULL;

ALTER TABLE roster_history
  ALTER COLUMN boutique_id SET NOT NULL;

CREATE INDEX roster_history_boutique_id_idx ON roster_history (boutique_id);
CREATE INDEX roster_history_boutique_date_idx ON roster_history (boutique_id, roster_date DESC);

-- created_by: the auth user who generated and submitted this roster
ALTER TABLE roster_history
  ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- New UUID-typed actor columns alongside old text columns.
-- Old columns (approved_by TEXT, published_by TEXT, rejected_by TEXT) are
-- kept for now for backward compatibility and dropped in migration 005 once
-- the app no longer writes to them.
ALTER TABLE roster_history
  ADD COLUMN approved_by_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN published_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN rejected_by_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── Extend status check constraint ───────────────────────────────────────────
-- 'pending_review' is kept for backward compatibility and maps to 'submitted'.
-- New statuses: 'draft' (saved but not submitted), 'archived' (system-archived).
ALTER TABLE roster_history
  DROP CONSTRAINT IF EXISTS roster_history_status_check;

ALTER TABLE roster_history
  ADD CONSTRAINT roster_history_status_check
    CHECK (status IN (
      'draft',          -- saved by admin, not yet submitted
      'submitted',      -- submitted for review (replaces pending_review going forward)
      'pending_review', -- legacy alias for submitted
      'approved',       -- approved by boutique approver
      'published',      -- live on the roster dashboard
      'rejected',       -- rejected by approver, returned to admin
      'archived'        -- auto- or manually-archived
    ));

-- ── Boutique name denormalised on roster_history for fast reads ───────────────
-- Avoids a JOIN in every history query
ALTER TABLE roster_history
  ADD COLUMN boutique_name TEXT;

UPDATE roster_history rh
  SET boutique_name = b.name
  FROM boutiques b
  WHERE b.id = rh.boutique_id;
