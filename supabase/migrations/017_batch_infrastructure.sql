-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 · Nightly batch infrastructure
--
-- BATCH RUN LOG
--   batch_run_log  — audit trail for every trigger-batch invocation
--                    (ETL webhook, pg_cron, or manual admin trigger)
--
-- PG_CRON SCHEDULE (requires pg_cron + pg_net extensions in Supabase)
--   Uncomment the cron.schedule block below after configuring:
--     app.supabase_url        — your project's API URL
--     app.service_role_key    — service role secret key
--   Both are set via ALTER DATABASE ... SET "app.<key>" = '<value>';
--   or via Supabase project settings → Database → Connection Strings.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── batch_run_log ─────────────────────────────────────────────────────────────
-- One row per trigger-batch invocation. Written by the Edge Function using
-- the service role key (bypasses RLS on INSERT/UPDATE).
CREATE TABLE batch_run_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT        NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('pg_cron', 'webhook', 'manual', 'internal')),
  target_date         DATE        NOT NULL,
  boutique_ids        UUID[],                  -- NULL = all boutiques processed
  status              TEXT        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')),
  boutiques_processed INTEGER,
  errors              TEXT[],
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX batch_run_log_target_date_idx  ON batch_run_log (target_date DESC);
CREATE INDEX batch_run_log_status_idx       ON batch_run_log (status) WHERE status = 'running';

ALTER TABLE batch_run_log ENABLE ROW LEVEL SECURITY;

-- Regional admins and boutique admins can read the log; service role writes it
CREATE POLICY batch_run_log_select ON batch_run_log FOR SELECT
  USING (
    is_regional_admin()
    OR EXISTS (
      SELECT 1 FROM user_boutique_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );


-- ── pg_cron nightly schedule ──────────────────────────────────────────────────
-- Requires the pg_cron and pg_net extensions to be enabled in your Supabase project.
-- Enable via: Supabase Dashboard → Database → Extensions → pg_cron / pg_net.
--
-- Before enabling, configure the app settings:
--
--   ALTER DATABASE postgres
--     SET "app.supabase_url"      = 'https://YOUR_PROJECT_REF.supabase.co';
--   ALTER DATABASE postgres
--     SET "app.service_role_key"  = 'YOUR_SERVICE_ROLE_KEY';
--
-- Then uncomment and run this block:
--
-- SELECT cron.schedule(
--   'nightly-roster-batch',               -- job name (unique)
--   '0 2 * * *',                          -- 2:00 AM UTC every day
--   $$
--   SELECT net.http_post(
--     url     := current_setting('app.supabase_url') || '/functions/v1/trigger-batch',
--     headers := jsonb_build_object(
--       'Content-Type',   'application/json',
--       'Authorization',  'Bearer ' || current_setting('app.service_role_key'),
--       'X-Batch-Source', 'pg_cron'
--     ),
--     body := '{"source":"pg_cron","run_sync_leave":true}'::jsonb
--   );
--   $$
-- );
--
-- To change the schedule time or remove the job:
--   SELECT cron.unschedule('nightly-roster-batch');
--   SELECT cron.schedule('nightly-roster-batch', '0 3 * * *', ...);
