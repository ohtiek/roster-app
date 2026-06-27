# Supabase Migrations

Run these in order in the Supabase SQL editor (Dashboard → SQL Editor → New query).

| File | What it does |
|------|-------------|
| `001_boutiques.sql` | Creates the `boutiques` table; seeds a default boutique for existing data |
| `002_user_boutique_roles.sql` | Creates the `user_boutique_roles` join table; adds RLS helper functions; enables RLS on the table |
| `003_add_boutique_id.sql` | Junction tables `staff_boutiques` and `vic_client_boutiques` (many-to-many, time-bounded); extends `vic_advisors` to three-way junction; adds `boutique_id` to `scoring_weights` and `roster_history`; adds `created_by` + `*_by_id` UUID columns; extends status constraint with `draft`, `submitted`, `archived` |
| `004_rls_policies.sql` | Enables RLS and creates all policies on all tables |
| `005_cleanup_legacy_columns.sql` | **Run after app deploy** — drops old free-text `approved_by`, `published_by`, `rejected_by` columns |
| `006_dynamic_shifts.sql` | Creates `boutique_shifts` (per-boutique shift definitions, time-bounded) and `staff_shift_availability` (replaces `staff.available_shifts TEXT[]`); seeds default three shifts; backfills staff availability from legacy column; adds partial unique index for one published roster per boutique per date |
| `007_cleanup_available_shifts.sql` | **Run after app deploy** — drops legacy `staff.available_shifts` column |
| `008_flexible_skills_and_unavailability.sql` | Creates `skill_types` (replaces hardcoded Role enum and engine constants), `staff_skills` (multi-skill support), `boutique_shift_requirements` (replaces hardcoded SHIFT_MIN), `staff_unavailability` (hour-level blocks with leave-system source tracking, replaces `cannot_work_dates`), `staff_required_work` (replaces `must_work_dates`); backfills all new tables from legacy columns |
| `009_cleanup_legacy_staff_columns.sql` | **Run after app deploy** — drops legacy `staff.role`, `staff.cannot_work_dates`, `staff.must_work_dates` columns |
| `010_core_corrections.sql` | Adds `staff.user_id` (auth identity for self-service); RLS policies for staff self-service on own unavailability; adds `parent_roster_id`, `amended_at`, `amended_by_id` to `roster_history`; adds `published_amended` status; trigger to auto-archive superseded published rosters on amendment publish |
| `011_boutique_operational_config.sql` | Creates `regions` table; extends `boutiques` with `address`, `store_code`, `region_id`; creates `boutique_closures` (planned closure and holiday dates); creates `boutique_engine_config` (per-boutique engine tuning replacing hardcoded TypeScript constants); adds `max_count` to `boutique_shift_requirements`; creates `boutique_shift_day_overrides` (day-of-week staffing overrides) |
| `012_staff_employment.sql` | Adds `employment_type` and `contracted_hours_per_week` to `staff`; adds `leave_type` to `staff_unavailability` |
| `013_approval_workflow.sql` | Adds `submit_deadline` and `approve_deadline` to `roster_history`; adds `approver_delegate_id` to `user_boutique_roles` |
| `014_vic_appointments_and_loans.sql` | Adds `tier` and `preferred_languages` to `vic_clients`; creates `vic_appointments` (individual confirmed/tentative visit slots per boutique per date); adds `is_loan` and `home_boutique_id` to `staff_boutiques` |
| `015_audit_analytics_views.sql` | Creates `audit_log` with SECURITY DEFINER triggers on sensitive tables; creates `scoring_weights_history` (snapshot on every weight change); creates `roster_actuals` (planned vs actual attendance); creates `active_staff_skills` view (auto-excludes expired skill certifications) |

## After running migrations

1. Go to **Authentication → Users** in Supabase and create at least one user per role.
2. Insert rows into `user_boutique_roles` to assign roles:

```sql
-- Example: make a user a Boutique Admin at the default boutique
INSERT INTO user_boutique_roles (user_id, boutique_id, role, display_name)
VALUES (
  '<user-uuid-from-auth>',
  '00000000-0000-0000-0000-000000000001',
  'admin',
  'Sarah K.'
);

-- Example: Regional Admin (no boutique_id)
INSERT INTO user_boutique_roles (user_id, boutique_id, role, display_name)
VALUES ('<user-uuid>', NULL, 'regional_admin', 'Regional Manager');
```

3. Update the default boutique name and location:

```sql
UPDATE boutiques
SET name = 'Sydney CBD', location = 'Sydney, Australia', timezone = 'Australia/Sydney'
WHERE id = '00000000-0000-0000-0000-000000000001';
```
