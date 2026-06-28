-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014 · VIC appointment scheduling and staff boutique loans
--
-- VIC CLIENTS — enriched profile
--   vic_clients gains tier and preferred_languages so the engine can
--   prioritise resource allocation and advisor language matching.
--
-- VIC APPOINTMENTS
--   vic_appointments — individual confirmed or tentative visit slots.
--   The roster engine should use confirmed/tentative appointments on the
--   target date (not the full VIC membership list) when deciding which
--   staff need VIC advisor cover on each shift.
--
-- STAFF BOUTIQUE LOANS
--   staff_boutiques gains is_loan and home_boutique_id to distinguish
--   temporary cross-boutique lending from permanent multi-boutique membership.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── vic_clients — tier and language preferences ───────────────────────────────
ALTER TABLE vic_clients
  ADD COLUMN tier               TEXT CHECK (tier IN ('platinum', 'gold', 'silver')),
  ADD COLUMN preferred_languages TEXT[];


-- ── vic_appointments ──────────────────────────────────────────────────────────
-- An individual visit appointment for a VIC client at a specific boutique.
-- The engine queries this table for the roster date to determine which VIC
-- clients are actually expected and which shift they will likely attend.
--
-- status values:
--   'confirmed'  — client confirmed they will attend
--   'tentative'  — probable but not confirmed
--   'cancelled'  — cancelled before the date
--   'no_show'    — confirmed but did not attend (set post-visit)
--   'visited'    — attended (set post-visit)
CREATE TABLE vic_appointments (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vic_client_id       UUID        NOT NULL REFERENCES vic_clients(id) ON DELETE CASCADE,
  boutique_id         UUID        NOT NULL REFERENCES boutiques(id)   ON DELETE CASCADE,
  appointment_date    DATE        NOT NULL,
  shift_id            UUID        REFERENCES boutique_shifts(id) ON DELETE SET NULL,
  assigned_advisor_id UUID        REFERENCES staff(id)           ON DELETE SET NULL,
  status              TEXT        NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'tentative', 'cancelled', 'no_show', 'visited')),
  notes               TEXT,
  created_by          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER vic_appointments_updated_at
  BEFORE UPDATE ON vic_appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Supports engine lookup: active appointments for a boutique on a given date
CREATE INDEX vic_appointments_boutique_date_idx ON vic_appointments (boutique_id, appointment_date)
  WHERE status IN ('confirmed', 'tentative');

CREATE INDEX vic_appointments_client_id_idx     ON vic_appointments (vic_client_id);
CREATE INDEX vic_appointments_advisor_idx        ON vic_appointments (assigned_advisor_id)
  WHERE assigned_advisor_id IS NOT NULL;

ALTER TABLE vic_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY vic_appt_select ON vic_appointments FOR SELECT
  USING (
    is_regional_admin()
    OR boutique_id IN (SELECT my_boutique_ids())
  );

-- Admin and approver can create / update appointments (approver needs visibility
-- to verify VIC coverage when reviewing rosters)
CREATE POLICY vic_appt_insert ON vic_appointments FOR INSERT
  WITH CHECK (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin', 'approver'])
  );

CREATE POLICY vic_appt_update ON vic_appointments FOR UPDATE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin', 'approver'])
  );

CREATE POLICY vic_appt_delete ON vic_appointments FOR DELETE
  USING (
    is_regional_admin()
    OR has_role_at(boutique_id, ARRAY['admin'])
  );


-- ── staff_boutiques — loan tracking ──────────────────────────────────────────
-- is_loan = true marks a row as a temporary cross-boutique lending arrangement
-- rather than a permanent multi-boutique membership.
-- home_boutique_id must be set for loan rows; it records which boutique
-- "owns" the staff member and authorised the loan.
ALTER TABLE staff_boutiques
  ADD COLUMN is_loan          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN home_boutique_id UUID    REFERENCES boutiques(id) ON DELETE SET NULL;

ALTER TABLE staff_boutiques
  ADD CONSTRAINT staff_boutiques_loan_home_check
    CHECK (NOT is_loan OR home_boutique_id IS NOT NULL);

CREATE INDEX staff_boutiques_is_loan_idx ON staff_boutiques (boutique_id)
  WHERE is_loan = true;
