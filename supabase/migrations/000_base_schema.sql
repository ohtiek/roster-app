-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 000 · Base schema
--
-- Creates the core tables that must exist before migrations 001-015.
-- These tables were originally created directly in Supabase before the
-- migrations system was introduced; this file reconstructs them for
-- fresh environment setup.
--
-- Run this FIRST in a new Supabase project, then run 001 through 015 in order
-- (skipping the post-deploy cleanup files: 005, 007, 009 — run those only
-- after the app has been updated to use the new normalised columns).
-- ─────────────────────────────────────────────────────────────────────────────


-- ── staff ──────────────────────────────────────────────────────────────────────
-- Core staff member records.
-- role, available_shifts, must_work_dates, cannot_work_dates are legacy columns
-- that will be replaced by normalised tables in migrations 006 and 008.
-- They are kept here because the backfill steps in those migrations read from them.
CREATE TABLE staff (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  role              TEXT        NOT NULL
    CHECK (role IN ('Floor Manager','Sr. Stylist','Jr. Stylist','VIC Advisor','Cashier','Stock Associate')),
  seniority         TEXT        NOT NULL DEFAULT 'junior'
    CHECK (seniority IN ('junior', 'senior', 'manager')),
  gender            TEXT        NOT NULL DEFAULT 'M'
    CHECK (gender IN ('M', 'F', 'NB')),
  languages         TEXT[]      NOT NULL DEFAULT '{}',
  available_shifts  TEXT[]      NOT NULL DEFAULT '{}',
  must_work_dates   TEXT[]      NOT NULL DEFAULT '{}',
  cannot_work_dates TEXT[]      NOT NULL DEFAULT '{}',
  avatar_color      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── vic_clients ────────────────────────────────────────────────────────────────
CREATE TABLE vic_clients (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  expected_visit_date DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── vic_advisors ───────────────────────────────────────────────────────────────
-- Which staff member advises which VIC client.
-- Extended to a three-way junction (vic_client_id, boutique_id, staff_id) in
-- migration 003.
CREATE TABLE vic_advisors (
  vic_client_id UUID NOT NULL REFERENCES vic_clients(id) ON DELETE CASCADE,
  staff_id      UUID NOT NULL REFERENCES staff(id)       ON DELETE CASCADE,
  PRIMARY KEY (vic_client_id, staff_id)
);


-- ── scoring_weights ────────────────────────────────────────────────────────────
-- Singleton row (id = 1) storing the weights used by the roster scoring engine.
-- boutique_id is added and the integer PK retired in migration 003.
CREATE TABLE scoring_weights (
  id                INTEGER     PRIMARY KEY,
  skill_coverage    FLOAT       NOT NULL DEFAULT 0.35,
  vic_affiliation   FLOAT       NOT NULL DEFAULT 0.25,
  gender_balance    FLOAT       NOT NULL DEFAULT 0.15,
  seniority         FLOAT       NOT NULL DEFAULT 0.15,
  language_coverage FLOAT       NOT NULL DEFAULT 0.10,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton weights row
INSERT INTO scoring_weights (id) VALUES (1);


-- ── roster_history ─────────────────────────────────────────────────────────────
-- Generated roster plans with approval lifecycle.
-- approved_by / published_by / rejected_by are free-text legacy columns;
-- they are replaced by UUID actor columns in migration 003 and dropped in 005.
CREATE TABLE roster_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_date    DATE        NOT NULL,
  overall_score  FLOAT,
  solver_used    TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'published', 'rejected')),
  override_count INTEGER     NOT NULL DEFAULT 0,
  override_ids   UUID[]      NOT NULL DEFAULT '{}',
  payload        JSONB,
  approved_by    TEXT,
  published_by   TEXT,
  rejected_by    TEXT,
  approved_at    TIMESTAMPTZ,
  published_at   TIMESTAMPTZ,
  rejected_at    TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
