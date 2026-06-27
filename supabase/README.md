# Supabase Migrations

Run these in order in the Supabase SQL editor (Dashboard → SQL Editor → New query).

| File | What it does |
|------|-------------|
| `001_boutiques.sql` | Creates the `boutiques` table; seeds a default boutique for existing data |
| `002_user_boutique_roles.sql` | Creates the `user_boutique_roles` join table; adds RLS helper functions; enables RLS on the table |
| `003_add_boutique_id.sql` | Adds `boutique_id` to `staff`, `vic_clients`, `scoring_weights`, `roster_history`; backfills to the default boutique; adds `created_by` + `*_by_id` UUID columns to `roster_history`; extends status constraint with `draft`, `submitted`, `archived` |
| `004_rls_policies.sql` | Enables RLS and creates all policies on `boutiques`, `staff`, `vic_clients`, `vic_advisors`, `scoring_weights`, `roster_history` |
| `005_cleanup_legacy_columns.sql` | **Run last, after app is deployed** — drops old free-text `approved_by`, `published_by`, `rejected_by` columns |

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
