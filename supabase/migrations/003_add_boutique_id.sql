-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 · Add boutique_id to existing tables
--
-- Staff and VIC clients are global entities that can be linked to multiple
-- boutiques. The boutique relationship is modelled as many-to-many via
-- junction tables, NOT as a boutique_id column on the entity itself.
-- The roster plan (roster_history) is what captures which staff were
-- actually assigned at a specific boutique on a specific date.
--
-- New junction tables:
--   staff_boutiques       — which boutiques a staff member is eligible for
--   vic_client_boutiques  — which boutiques a VIC client visits
--
-- vic_advisors gains boutique_id, becoming a three-way junction:
--   (vic_client_id, boutique_id, staff_id)
--   — because the advisor for a client may differ per boutique
--
-- scoring_weights and roster_history are one-per-boutique and keep a direct
-- boutique_id FK (correct as-is).
--
-- Also:
--   · Adds created_by UUID to roster_history
--   · Adds approved_by_id / published_by_id / rejected_by_id as UUID columns
--     alongside the old text columns (dropped in migration 005 post-deploy)
--   · Adds 'draft', 'submitted', 'archived' to the status check constraint
-- ─────────────────────────────────────────────────────────────────────────────

-- ── updated_at trigger on staff and vic_clients ───────────────────────────────
CREATE TRIGGER staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vic_clients_updated_at
  BEFORE UPDATE ON vic_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── staff_boutiques ───────────────────────────────────────────────────────────
-- Many-to-many, time-bounded: a staff member is eligible to work at a boutique
-- only during the [valid_from, valid_until] window.
-- The roster engine for boutique X on date D filters to rows where
--   valid_from <= D AND (valid_until IS NULL OR valid_until >= D).
-- valid_until = NULL means the assignment is open-ended (still active).
CREATE TABLE staff_boutiques (
  staff_id    UUID NOT NULL REFERENCES staff(id)     ON DELETE CASCADE,
  boutique_id UUID NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  valid_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  PRIMARY KEY (staff_id, boutique_id),
  CONSTRAINT staff_boutiques_date_order CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX staff_boutiques_boutique_id_idx ON staff_boutiques (boutique_id);
-- Supports date-range queries when generating a roster for a specific date
CREATE INDEX staff_boutiques_boutique_date_idx ON staff_boutiques (boutique_id, valid_from, valid_until);

-- Backfill: all existing staff belong to the default boutique from the beginning
INSERT INTO staff_boutiques (staff_id, boutique_id, valid_from, valid_until)
SELECT id, '00000000-0000-0000-0000-000000000001', '2000-01-01', NULL FROM staff;

-- ── vic_client_boutiques ──────────────────────────────────────────────────────
-- Many-to-many, time-bounded: a VIC client visits a boutique during a specific
-- window. This replaces the global expected_visit_date on vic_clients for
-- boutique-scoped visit planning.
-- valid_until = NULL means the relationship is open-ended.
CREATE TABLE vic_client_boutiques (
  vic_client_id UUID NOT NULL REFERENCES vic_clients(id) ON DELETE CASCADE,
  boutique_id   UUID NOT NULL REFERENCES boutiques(id)   ON DELETE CASCADE,
  valid_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until   DATE,
  PRIMARY KEY (vic_client_id, boutique_id),
  CONSTRAINT vic_client_boutiques_date_order CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX vic_client_boutiques_boutique_id_idx ON vic_client_boutiques (boutique_id);
-- Supports date-range queries when the engine looks up active VIC clients for a date
CREATE INDEX vic_client_boutiques_boutique_date_idx ON vic_client_boutiques (boutique_id, valid_from, valid_until);

-- Backfill: all existing VIC clients belong to the default boutique from the beginning
INSERT INTO vic_client_boutiques (vic_client_id, boutique_id, valid_from, valid_until)
SELECT id, '00000000-0000-0000-0000-000000000001', '2000-01-01', NULL FROM vic_clients;

-- ── vic_advisors — add boutique_id (three-way junction) ───────────────────────
-- The advisor for a VIC client can differ per boutique.
-- Old PK was (vic_client_id, staff_id); new PK is (vic_client_id, boutique_id, staff_id).
ALTER TABLE vic_advisors DROP CONSTRAINT IF EXISTS vic_advisors_pkey;

ALTER TABLE vic_advisors
  ADD COLUMN boutique_id UUID REFERENCES boutiques(id) ON DELETE CASCADE;

-- Backfill all existing advisor rows to the default boutique
UPDATE vic_advisors SET boutique_id = '00000000-0000-0000-0000-000000000001'
  WHERE boutique_id IS NULL;

ALTER TABLE vic_advisors
  ALTER COLUMN boutique_id SET NOT NULL;

ALTER TABLE vic_advisors
  ADD PRIMARY KEY (vic_client_id, boutique_id, staff_id);

CREATE INDEX vic_advisors_boutique_id_idx ON vic_advisors (boutique_id);

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
