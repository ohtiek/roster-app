-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021 · Grant base schema access to anon/authenticated
--
-- Every table in this project relies on RLS policies (migration 004 onward)
-- to restrict row-level access. RLS only ever gets evaluated once the
-- coarser Postgres GRANT check passes — and this project was missing the
-- baseline grants Supabase normally provisions automatically at project
-- creation. Every REST call was failing with:
--   42501 permission denied for schema public
-- before RLS ever had a chance to run.
--
-- Granting broad table-level access here is safe: RLS policies (already in
-- place) are what actually decide which rows anon/authenticated can see or
-- change, exactly as Supabase's own default template does.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Apply the same defaults to tables/sequences created by future migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
