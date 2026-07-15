-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025 · Replace-the-published-roster workflow
--
-- roster_one_published_per_boutique_date (migration 006) allows at most one
-- 'published' row per (boutique_id, roster_date) — intentional, so the
-- reader-facing dashboard never sees two competing published rosters for the
-- same day. But there was no way to actually REPLACE an already-published
-- roster with a corrected one: publishing a second approved roster for the
-- same date just hit the raw unique-violation.
--
-- The status enum already has 'published_amended' for exactly this case —
-- the previously-published roster, now superseded — but nothing ever
-- transitioned a roster into it.
--
-- publish_roster() does both steps atomically in one transaction:
--   1. any existing 'published' row for the same boutique+date becomes
--      'published_amended'
--   2. the target roster (must be 'approved') becomes 'published'
--
-- SECURITY DEFINER so it can perform the supersede step regardless of the
-- generic roster_update_approver RLS policy (which intentionally does not
-- allow touching an already-published row) — but it does its own
-- authorization check up front, so this doesn't loosen who can publish.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION publish_roster(target_roster_id UUID)
RETURNS roster_history
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _boutique_id UUID;
  _roster_date DATE;
  _status TEXT;
  _result roster_history;
BEGIN
  SELECT boutique_id, roster_date, status INTO _boutique_id, _roster_date, _status
  FROM roster_history WHERE id = target_roster_id;

  IF _boutique_id IS NULL THEN
    RAISE EXCEPTION 'Roster not found';
  END IF;

  IF NOT has_role_at(_boutique_id, ARRAY['approver']) THEN
    RAISE EXCEPTION 'Only an approver at this boutique can publish this roster';
  END IF;

  IF _status != 'approved' THEN
    RAISE EXCEPTION 'Only an approved roster can be published (current status: %)', _status;
  END IF;

  -- Supersede whatever is currently published for this boutique+date
  UPDATE roster_history
  SET status = 'published_amended'
  WHERE boutique_id = _boutique_id
    AND roster_date = _roster_date
    AND status = 'published'
    AND id != target_roster_id;

  UPDATE roster_history
  SET status = 'published', published_at = now()
  WHERE id = target_roster_id
  RETURNING * INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION publish_roster(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_roster(UUID) TO authenticated;
