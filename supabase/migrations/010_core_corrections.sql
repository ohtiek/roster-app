-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010 · Core corrections
--
-- 1. STAFF ↔ AUTH IDENTITY
--    Adds user_id to staff so a staff member can log in and self-serve
--    (view their own schedule, submit ad-hoc unavailability).
--    Nullable — not every staff record needs a login.
--
-- 2. ROSTER AMENDMENT FLOW
--    Adds parent_roster_id, amended_at, amended_by_id to roster_history.
--    Adds 'published_amended' status for superseded published rosters.
--    A trigger automatically moves the original to 'published_amended' when
--    an amendment (child roster with parent_roster_id set) is published.
--
--    Amendment lifecycle:
--      admin creates draft with parent_roster_id = original.id
--        → normal submitted → approved → published flow
--      on publish of amendment: trigger sets original status → 'published_amended'
--      unique index on (boutique_id, roster_date) WHERE status = 'published'
--      continues to enforce one live roster per boutique per date.
--
-- NOTE: scoring_weights client-side fix
--    Migration 003 already added boutique_id to scoring_weights with a unique
--    constraint. The application client must be updated to query by boutique_id
--    instead of the legacy integer PK (WHERE id = 1). No schema change needed.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Staff ↔ auth identity ──────────────────────────────────────────────

ALTER TABLE staff
  ADD COLUMN user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX staff_user_id_idx ON staff (user_id) WHERE user_id IS NOT NULL;

-- Allow a logged-in staff member to read their own record.
-- Additive with the existing staff_select policy (migration 004).
CREATE POLICY staff_self_select ON staff FOR SELECT
  USING (user_id IS NOT NULL AND user_id = auth.uid());

-- Allow staff to read their own unavailability and required-work records.
-- Additive with the boutique-scoped policies (migration 008).
CREATE POLICY staff_unavail_self_select ON staff_unavailability FOR SELECT
  USING (
    staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid())
  );

CREATE POLICY staff_req_work_self_select ON staff_required_work FOR SELECT
  USING (
    staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid())
  );

-- Allow staff to manage their own ad-hoc unavailability entries.
-- source = 'ad_hoc' is enforced so staff cannot modify leave_system imports.
CREATE POLICY staff_unavail_self_insert ON staff_unavailability FOR INSERT
  WITH CHECK (
    staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid())
    AND source = 'ad_hoc'
  );

CREATE POLICY staff_unavail_self_update ON staff_unavailability FOR UPDATE
  USING (
    staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid())
    AND source = 'ad_hoc'
  );

CREATE POLICY staff_unavail_self_delete ON staff_unavailability FOR DELETE
  USING (
    staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid())
    AND source = 'ad_hoc'
  );


-- ── 2. Roster amendment flow ──────────────────────────────────────────────

ALTER TABLE roster_history
  ADD COLUMN parent_roster_id UUID        REFERENCES roster_history(id) ON DELETE SET NULL,
  ADD COLUMN amended_at       TIMESTAMPTZ,
  ADD COLUMN amended_by_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL;

-- Constraint: amendment records must reference a published or published_amended parent
-- (checked at application layer; DB allows any parent to avoid chicken-and-egg on insert)
CREATE INDEX roster_history_parent_id_idx ON roster_history (parent_roster_id)
  WHERE parent_roster_id IS NOT NULL;

-- Extend status to include published_amended
ALTER TABLE roster_history
  DROP CONSTRAINT IF EXISTS roster_history_status_check;

ALTER TABLE roster_history
  ADD CONSTRAINT roster_history_status_check
    CHECK (status IN (
      'draft',
      'submitted',
      'pending_review',   -- legacy alias for submitted
      'approved',
      'published',
      'published_amended', -- superseded by a later amendment; kept for audit trail
      'rejected',
      'archived'
    ));

-- The existing partial unique index (migration 006) covers WHERE status = 'published'.
-- 'published_amended' rows are intentionally excluded so the original and its
-- amendment can co-exist while the amendment is in flight, and the index still
-- enforces exactly one live published roster per boutique per date.

-- Trigger: when an amendment roster is published, archive the original.
CREATE OR REPLACE FUNCTION archive_superseded_roster()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only act when a child roster (parent_roster_id IS NOT NULL) transitions
  -- to 'published'. The WHEN clause on the trigger already guards this.
  UPDATE roster_history
  SET    status        = 'published_amended',
         amended_at    = now(),
         amended_by_id = NEW.published_by_id
  WHERE  id     = NEW.parent_roster_id
    AND  status = 'published';

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archive_superseded_roster
  AFTER UPDATE ON roster_history
  FOR EACH ROW
  WHEN (
    NEW.status            = 'published'
    AND OLD.status        != 'published'
    AND NEW.parent_roster_id IS NOT NULL
  )
  EXECUTE FUNCTION archive_superseded_roster();
