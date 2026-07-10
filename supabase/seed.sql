-- ─────────────────────────────────────────────────────────────────────────────
-- Sample Data Seed — Maison Aurore
-- Paste into Supabase SQL Editor and run.
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Boutiques ──────────────────────────────────────────────────────────────
-- Rename the default boutique (created by migration 001) to Sydney.
-- Add Melbourne as a second boutique.

UPDATE boutiques
SET name = 'Maison Aurore Sydney', location = 'Sydney CBD, NSW', timezone = 'Australia/Sydney'
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO boutiques (id, name, location, timezone)
VALUES ('00000000-0000-0000-0000-000000000002', 'Maison Aurore Melbourne', 'QV Melbourne, VIC', 'Australia/Melbourne')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location;

-- ── 2. Staff ──────────────────────────────────────────────────────────────────
-- 10 staff for Sydney · 6 for Melbourne
-- employment_type + contracted_hours_per_week added by migration 012.
-- role must match the legacy CHECK constraint values.

INSERT INTO staff (id, name, role, seniority, gender, languages, employment_type, contracted_hours_per_week, avatar_color)
VALUES
  -- Sydney
  ('20000000-0000-0000-0000-000000000001', 'Sophie Chen',       'Floor Manager',   'manager', 'F', ARRAY['Mandarin','English'],            'full_time',  38, '#7C3AED'),
  ('20000000-0000-0000-0000-000000000002', 'James Harrington',  'Sr. Stylist',     'senior',  'M', ARRAY['English'],                       'full_time',  38, '#1D4ED8'),
  ('20000000-0000-0000-0000-000000000003', 'Mei Lin',           'VIC Advisor',     'senior',  'F', ARRAY['Mandarin','Cantonese','English'], 'full_time',  38, '#B45309'),
  ('20000000-0000-0000-0000-000000000004', 'Aiden Park',        'Jr. Stylist',     'junior',  'M', ARRAY['Korean','English'],              'full_time',  38, '#0891B2'),
  ('20000000-0000-0000-0000-000000000005', 'Isabelle Moreau',   'VIC Advisor',     'senior',  'F', ARRAY['French','English'],              'full_time',  38, '#BE185D'),
  ('20000000-0000-0000-0000-000000000006', 'Marcus Webb',       'Cashier',         'junior',  'M', ARRAY['English'],                       'part_time',  20, '#065F46'),
  ('20000000-0000-0000-0000-000000000007', 'Priya Sharma',      'Jr. Stylist',     'junior',  'F', ARRAY['Hindi','English'],               'full_time',  38, '#9D174D'),
  ('20000000-0000-0000-0000-000000000008', 'Tom Fletcher',      'Stock Associate', 'junior',  'M', ARRAY['English'],                       'part_time',  24, '#92400E'),
  ('20000000-0000-0000-0000-000000000009', 'Yuki Tanaka',       'Sr. Stylist',     'senior',  'F', ARRAY['Japanese','English'],            'full_time',  38, '#4F46E5'),
  ('20000000-0000-0000-0000-000000000010', 'Lena Kovacs',       'Jr. Stylist',     'junior',  'F', ARRAY['Hungarian','English'],           'casual',      0, '#0F766E'),
  -- Melbourne
  ('20000000-0000-0000-0000-000000000011', 'David Nguyen',      'Floor Manager',   'manager', 'M', ARRAY['Vietnamese','English'],          'full_time',  38, '#1E40AF'),
  ('20000000-0000-0000-0000-000000000012', 'Chloe Martin',      'Sr. Stylist',     'senior',  'F', ARRAY['French','English'],              'full_time',  38, '#7C2D12'),
  ('20000000-0000-0000-0000-000000000013', 'Ryan O''Brien',     'Jr. Stylist',     'junior',  'M', ARRAY['English'],                       'full_time',  38, '#166534'),
  ('20000000-0000-0000-0000-000000000014', 'Ananya Iyer',       'VIC Advisor',     'senior',  'F', ARRAY['Tamil','Hindi','English'],       'full_time',  38, '#6D28D9'),
  ('20000000-0000-0000-0000-000000000015', 'Ben Carter',        'Cashier',         'junior',  'M', ARRAY['English'],                       'part_time',  20, '#0369A1'),
  ('20000000-0000-0000-0000-000000000016', 'Zoe Williams',      'Jr. Stylist',     'junior',  'F', ARRAY['English'],                       'casual',      0, '#C2410C')
ON CONFLICT (id) DO NOTHING;

-- ── 3. Staff ↔ Boutiques ──────────────────────────────────────────────────────

INSERT INTO staff_boutiques (staff_id, boutique_id, valid_from)
VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000002', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000002', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000002', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000002', '2024-01-01'),
  ('20000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000002', '2024-01-01')
ON CONFLICT (staff_id, boutique_id) DO NOTHING;

-- ── 4. Staff skills ───────────────────────────────────────────────────────────
-- Skill type IDs looked up by name (seeded by migration 008).

INSERT INTO staff_skills (staff_id, skill_type_id, is_primary, proficiency_level)
SELECT s.id, st.id, v.is_primary, v.proficiency_level
FROM (VALUES
  -- Sophie Chen
  ('20000000-0000-0000-0000-000000000001', 'Floor Manager',   true,  'expert'),
  ('20000000-0000-0000-0000-000000000001', 'Sr. Stylist',     false, 'expert'),
  -- James Harrington
  ('20000000-0000-0000-0000-000000000002', 'Sr. Stylist',     true,  'expert'),
  ('20000000-0000-0000-0000-000000000002', 'VIC Advisor',     false, 'intermediate'),
  -- Mei Lin
  ('20000000-0000-0000-0000-000000000003', 'VIC Advisor',     true,  'expert'),
  ('20000000-0000-0000-0000-000000000003', 'Sr. Stylist',     false, 'advanced'),
  -- Aiden Park
  ('20000000-0000-0000-0000-000000000004', 'Jr. Stylist',     true,  'intermediate'),
  -- Isabelle Moreau
  ('20000000-0000-0000-0000-000000000005', 'VIC Advisor',     true,  'expert'),
  ('20000000-0000-0000-0000-000000000005', 'Sr. Stylist',     false, 'advanced'),
  -- Marcus Webb
  ('20000000-0000-0000-0000-000000000006', 'Cashier',         true,  'intermediate'),
  -- Priya Sharma
  ('20000000-0000-0000-0000-000000000007', 'Jr. Stylist',     true,  'intermediate'),
  ('20000000-0000-0000-0000-000000000007', 'Cashier',         false, 'beginner'),
  -- Tom Fletcher
  ('20000000-0000-0000-0000-000000000008', 'Stock Associate', true,  'intermediate'),
  -- Yuki Tanaka
  ('20000000-0000-0000-0000-000000000009', 'Sr. Stylist',     true,  'expert'),
  ('20000000-0000-0000-0000-000000000009', 'VIC Advisor',     false, 'advanced'),
  -- Lena Kovacs
  ('20000000-0000-0000-0000-000000000010', 'Jr. Stylist',     true,  'beginner'),
  -- David Nguyen
  ('20000000-0000-0000-0000-000000000011', 'Floor Manager',   true,  'expert'),
  ('20000000-0000-0000-0000-000000000011', 'Sr. Stylist',     false, 'advanced'),
  -- Chloe Martin
  ('20000000-0000-0000-0000-000000000012', 'Sr. Stylist',     true,  'expert'),
  ('20000000-0000-0000-0000-000000000012', 'VIC Advisor',     false, 'advanced'),
  -- Ryan O'Brien
  ('20000000-0000-0000-0000-000000000013', 'Jr. Stylist',     true,  'intermediate'),
  -- Ananya Iyer
  ('20000000-0000-0000-0000-000000000014', 'VIC Advisor',     true,  'expert'),
  ('20000000-0000-0000-0000-000000000014', 'Sr. Stylist',     false, 'advanced'),
  -- Ben Carter
  ('20000000-0000-0000-0000-000000000015', 'Cashier',         true,  'intermediate'),
  -- Zoe Williams
  ('20000000-0000-0000-0000-000000000016', 'Jr. Stylist',     true,  'beginner')
) AS v(staff_id, skill_name, is_primary, proficiency_level)
JOIN staff     s  ON s.id   = v.staff_id::uuid
JOIN skill_types st ON st.name = v.skill_name
ON CONFLICT (staff_id, skill_type_id) DO NOTHING;

-- ── 5. Staff availability days (part-time / casual restrictions) ──────────────
-- No rows = available all days. Only insert where availability is limited.
-- 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat

INSERT INTO staff_availability_days (staff_id, boutique_id, day_of_week)
SELECT s.staff_id, s.boutique_id, d.day
FROM (VALUES
  -- Marcus Webb (part-time Sydney): Mon–Fri only
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001'),
  -- Lena Kovacs (casual Sydney): Wed–Sun
  ('20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
  -- Zoe Williams (casual Melbourne): Thu–Sun
  ('20000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000002')
) AS s(staff_id, boutique_id)
CROSS JOIN (VALUES (1),(2),(3),(4),(5)) AS d(day)   -- Mon–Fri for Marcus
WHERE s.staff_id = '20000000-0000-0000-0000-000000000006'

UNION ALL

SELECT '20000000-0000-0000-0000-000000000010'::uuid,
       '00000000-0000-0000-0000-000000000001'::uuid,
       d.day
FROM (VALUES (0),(3),(4),(5),(6)) AS d(day)          -- Sun, Wed–Sat for Lena

UNION ALL

SELECT '20000000-0000-0000-0000-000000000016'::uuid,
       '00000000-0000-0000-0000-000000000002'::uuid,
       d.day
FROM (VALUES (0),(4),(5),(6)) AS d(day)               -- Sun, Thu–Sat for Zoe

ON CONFLICT (staff_id, boutique_id, day_of_week) DO NOTHING;

-- ── 6. Boutique shifts ────────────────────────────────────────────────────────

INSERT INTO boutique_shifts (id, boutique_id, name, start_time, end_time, sort_order, valid_from)
VALUES
  -- Sydney
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Opening', '09:00', '14:00', 1, '2024-01-01'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Midday',  '12:00', '17:30', 2, '2024-01-01'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Closing', '15:00', '20:00', 3, '2024-01-01'),
  -- Melbourne
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'Opening', '09:30', '14:30', 1, '2024-01-01'),
  ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'Closing', '14:00', '20:00', 2, '2024-01-01')
ON CONFLICT (id) DO NOTHING;

-- ── 7. Shift requirements ─────────────────────────────────────────────────────

INSERT INTO boutique_shift_requirements (shift_id, skill_type_id, min_count, max_count)
SELECT r.shift_id::uuid, st.id, r.min_count, r.max_count
FROM (VALUES
  -- Sydney Opening: 1 FM, 1 VIC Advisor, 2 Sr Stylist, 1 Cashier
  ('30000000-0000-0000-0000-000000000001', 'Floor Manager',   1, 1),
  ('30000000-0000-0000-0000-000000000001', 'VIC Advisor',     1, 2),
  ('30000000-0000-0000-0000-000000000001', 'Sr. Stylist',     2, 3),
  ('30000000-0000-0000-0000-000000000001', 'Cashier',         1, 1),
  -- Sydney Midday: 1 Sr Stylist, 2 Jr Stylist, 1 VIC Advisor, 1 Cashier
  ('30000000-0000-0000-0000-000000000002', 'Sr. Stylist',     1, 2),
  ('30000000-0000-0000-0000-000000000002', 'Jr. Stylist',     2, 3),
  ('30000000-0000-0000-0000-000000000002', 'VIC Advisor',     1, 2),
  ('30000000-0000-0000-0000-000000000002', 'Cashier',         1, 1),
  -- Sydney Closing: 1 FM, 1 Sr Stylist, 2 Jr Stylist
  ('30000000-0000-0000-0000-000000000003', 'Floor Manager',   1, 1),
  ('30000000-0000-0000-0000-000000000003', 'Sr. Stylist',     1, 2),
  ('30000000-0000-0000-0000-000000000003', 'Jr. Stylist',     2, 3),
  -- Melbourne Opening: 1 FM, 1 VIC Advisor, 1 Jr Stylist, 1 Cashier
  ('30000000-0000-0000-0000-000000000004', 'Floor Manager',   1, 1),
  ('30000000-0000-0000-0000-000000000004', 'VIC Advisor',     1, 1),
  ('30000000-0000-0000-0000-000000000004', 'Jr. Stylist',     1, 2),
  ('30000000-0000-0000-0000-000000000004', 'Cashier',         1, 1),
  -- Melbourne Closing: 1 Sr Stylist, 2 Jr Stylist
  ('30000000-0000-0000-0000-000000000005', 'Sr. Stylist',     1, 1),
  ('30000000-0000-0000-0000-000000000005', 'Jr. Stylist',     2, 2)
) AS r(shift_id, skill_name, min_count, max_count)
JOIN skill_types st ON st.name = r.skill_name
ON CONFLICT (shift_id, skill_type_id) DO NOTHING;

-- ── 8. Engine config ──────────────────────────────────────────────────────────

INSERT INTO boutique_engine_config
  (boutique_id, target_headcount_per_shift, max_consecutive_shifts, min_rest_hours, vic_priority_boost, max_hours_per_day)
VALUES
  ('00000000-0000-0000-0000-000000000001', 6, 3, 10, 25, 10),
  ('00000000-0000-0000-0000-000000000002', 4, 3, 10, 20, 10)
ON CONFLICT (boutique_id) DO NOTHING;

-- ── 9. Scoring weights ────────────────────────────────────────────────────────
-- id=1 row (default boutique) already exists from migration 000 seed.
-- id=2 is for Melbourne.

INSERT INTO scoring_weights (id, boutique_id, skill_coverage, vic_affiliation, gender_balance, seniority, language_coverage)
VALUES (2, '00000000-0000-0000-0000-000000000002', 0.35, 0.25, 0.15, 0.15, 0.10)
ON CONFLICT (id) DO NOTHING;

-- ── 10. Rule config ───────────────────────────────────────────────────────────

INSERT INTO boutique_rule_config (boutique_id, rule_key, is_enabled, severity)
SELECT b.id, r.rule_key, r.is_enabled::boolean, r.severity
FROM (VALUES
  ('max_hours_per_day',        'true', 'hard_block'),
  ('weekly_hours_cap',         'true', 'warning'),
  ('min_rest_hours',           'true', 'hard_block'),
  ('max_consecutive_shifts',   'true', 'warning'),
  ('certification_expiry',     'true', 'hard_block'),
  ('vic_coverage',             'true', 'warning'),
  ('gender_balance',           'true', 'warning'),
  ('day_of_week_availability', 'true', 'hard_block')
) AS r(rule_key, is_enabled, severity)
CROSS JOIN boutiques b
WHERE b.id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
)
ON CONFLICT (boutique_id, rule_key) DO NOTHING;

-- ── 11. VIC clients ───────────────────────────────────────────────────────────

INSERT INTO vic_clients (id, name, tier, preferred_languages)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'Eleanor Zhao',    'platinum', ARRAY['Mandarin','English']),
  ('40000000-0000-0000-0000-000000000002', 'Charles Beaumont','gold',     ARRAY['French','English']),
  ('40000000-0000-0000-0000-000000000003', 'Yuna Kim',        'gold',     ARRAY['Korean','English']),
  ('40000000-0000-0000-0000-000000000004', 'Haruki Mori',     'silver',   ARRAY['Japanese','English']),
  ('40000000-0000-0000-0000-000000000005', 'Priya Mehta',     'silver',   ARRAY['Hindi','English'])
ON CONFLICT (id) DO NOTHING;

-- ── 12. VIC client ↔ boutiques ────────────────────────────────────────────────

INSERT INTO vic_client_boutiques (vic_client_id, boutique_id, valid_from)
VALUES
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '2024-01-01'),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '2024-01-01'),
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', '2024-01-01')
ON CONFLICT (vic_client_id, boutique_id) DO NOTHING;

-- ── 13. VIC advisors ──────────────────────────────────────────────────────────

INSERT INTO vic_advisors (vic_client_id, boutique_id, staff_id)
VALUES
  -- Eleanor Zhao (platinum) → Mei Lin + Isabelle Moreau (Sydney)
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005'),
  -- Charles Beaumont → Isabelle Moreau (Sydney)
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005'),
  -- Yuna Kim → Mei Lin (Sydney) + Ananya Iyer (Melbourne)
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000014'),
  -- Haruki Mori → Yuki Tanaka (Sydney)
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000009'),
  -- Priya Mehta → Ananya Iyer (Melbourne)
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000014')
ON CONFLICT (vic_client_id, boutique_id, staff_id) DO NOTHING;

-- ── 14. Upcoming VIC appointments ─────────────────────────────────────────────

INSERT INTO vic_appointments (id, vic_client_id, boutique_id, appointment_date, shift_id, assigned_advisor_id, status, notes)
VALUES
  ('50000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    CURRENT_DATE + 3,
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    'confirmed',
    'New season preview — Mandarin preferred'),
  ('50000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    CURRENT_DATE + 7,
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000005',
    'tentative',
    NULL),
  ('50000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    CURRENT_DATE + 10,
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000009',
    'confirmed',
    'Interested in new handbag collection'),
  ('50000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    CURRENT_DATE + 5,
    '30000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000014',
    'confirmed',
    NULL)
ON CONFLICT (id) DO NOTHING;

-- ── 15. Sample leave ──────────────────────────────────────────────────────────

INSERT INTO staff_unavailability (id, staff_id, starts_at, ends_at, source, leave_type, reason)
VALUES
  -- Aiden Park: annual leave in 2 weeks
  ('60000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000004',
    (CURRENT_DATE + 14)::timestamptz,
    (CURRENT_DATE + 18 + INTERVAL '23 hours 59 minutes'),
    'ad_hoc', 'annual', 'Booked holiday'),
  -- Marcus Webb: sick today
  ('60000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000006',
    CURRENT_DATE::timestamptz,
    (CURRENT_DATE + INTERVAL '23 hours 59 minutes'),
    'ad_hoc', 'sick', NULL),
  -- Lena Kovacs: unavailable next Monday
  ('60000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000010',
    date_trunc('week', CURRENT_DATE + 7)::timestamptz,
    (date_trunc('week', CURRENT_DATE + 7) + INTERVAL '23 hours 59 minutes'),
    'manual', 'other', 'Unavailable'),
  -- Priya Sharma: parental leave starts in 3 weeks
  ('60000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000007',
    (CURRENT_DATE + 21)::timestamptz,
    (CURRENT_DATE + 111 + INTERVAL '23 hours 59 minutes'),
    'leave_system', 'parental', 'Maternity leave'),
  -- Zoe Williams: TOIL next Friday
  ('60000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000016',
    (date_trunc('week', CURRENT_DATE + 7) + INTERVAL '4 days')::timestamptz,
    (date_trunc('week', CURRENT_DATE + 7) + INTERVAL '4 days 23 hours 59 minutes'),
    'ad_hoc', 'toil', NULL)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- After running this seed, create at least one admin user:
--
-- 1. Supabase Dashboard → Authentication → Users → Add user
-- 2. Copy the new user's UUID, then run:
--
--    INSERT INTO user_boutique_roles (user_id, boutique_id, role)
--    VALUES ('<your-user-uuid>', '00000000-0000-0000-0000-000000000001', 'admin');
--
-- For regional admin (access to all boutiques):
--
--    INSERT INTO user_boutique_roles (user_id, boutique_id, role)
--    VALUES ('<your-user-uuid>', NULL, 'regional_admin');
-- ─────────────────────────────────────────────────────────────────────────────
