-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 · Boutique marketing events
--
-- Client request: the roster should surface marketing/store events (launches,
-- previews, VIC dinners, team meetings, on-boarding, etc.) alongside shift
-- assignments, the way their spreadsheet shows colored banner rows above the
-- day columns. These are informational date-range banners, not shift
-- assignments — no staff_id, no engine involvement.
--
-- NEW TABLE
--   boutique_events — one row per event, boutique-scoped, spans starts_on..ends_on
--
-- Visible to anyone who can already see the boutique's roster (admin,
-- approver, reader, staff, regional_admin); only an admin at the boutique can
-- create/edit/delete them, mirroring how boutique_areas is managed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE boutique_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id UUID        NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  starts_on   DATE        NOT NULL,
  ends_on     DATE        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#B8973A',
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (ends_on >= starts_on)
);

CREATE INDEX boutique_events_boutique_range_idx
  ON boutique_events (boutique_id, starts_on, ends_on);

CREATE TRIGGER boutique_events_set_updated_at
  BEFORE UPDATE ON boutique_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE boutique_events ENABLE ROW LEVEL SECURITY;

-- SELECT: regional admin sees all; admin/approver/reader/staff see their own
-- boutique's events, same reach as roster_history's read policies.
CREATE POLICY boutique_events_select_regional ON boutique_events FOR SELECT
  USING (is_regional_admin());

CREATE POLICY boutique_events_select_role ON boutique_events FOR SELECT
  USING (has_role_at(boutique_id, ARRAY['admin', 'approver', 'reader']));

CREATE POLICY boutique_events_select_staff ON boutique_events FOR SELECT
  USING (is_staff_at(boutique_id));

-- INSERT/UPDATE/DELETE: admin only, mirroring boutique_areas management.
CREATE POLICY boutique_events_insert ON boutique_events FOR INSERT
  WITH CHECK (
    has_role_at(boutique_id, ARRAY['admin'])
    AND created_by = auth.uid()
  );

CREATE POLICY boutique_events_update ON boutique_events FOR UPDATE
  USING (has_role_at(boutique_id, ARRAY['admin']))
  WITH CHECK (has_role_at(boutique_id, ARRAY['admin']));

CREATE POLICY boutique_events_delete ON boutique_events FOR DELETE
  USING (has_role_at(boutique_id, ARRAY['admin']));
