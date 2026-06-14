/// <reference types="vite/client" />
// ─── Supabase client ──────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import type { StaffMember, VICClient, ScoringWeights, VICAdvisorRow } from './types'

const meta = (import.meta as unknown as { env: Record<string, string> }).env
const url  = meta['VITE_SUPABASE_URL']      ?? ''
const anon = meta['VITE_SUPABASE_ANON_KEY'] ?? ''

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n' +
    'Copy .env.example to .env and fill in your Supabase project credentials.'
  )
}

export const supabase = createClient(url, anon)

// ── Staff ──────────────────────────────────────────────────────────────────────

export async function fetchStaff(): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from('staff').select('*').order('name')
  if (error) throw error
  return data as StaffMember[]
}

export async function upsertStaff(s: StaffMember): Promise<StaffMember> {
  const { id, created_at, updated_at, ...rest } = s as any
  const payload = id ? { id, ...rest } : rest
  const { data, error } = await supabase
    .from('staff').upsert(payload, { onConflict: 'id' }).select().single()
  if (error) throw error
  return data as StaffMember
}

export async function deleteStaff(id: string): Promise<void> {
  const { error } = await supabase.from('staff').delete().eq('id', id)
  if (error) throw error
}

// ── VIC clients ────────────────────────────────────────────────────────────────

export async function fetchVICClients(): Promise<VICClient[]> {
  const [{ data: clients, error: ce }, { data: advisors, error: ae }] = await Promise.all([
    supabase.from('vic_clients').select('*').order('name'),
    supabase.from('vic_advisors').select('vic_client_id, staff_id'),
  ])
  if (ce) throw ce
  if (ae) throw ae
  const advisorMap: Record<string, string[]> = {}
  for (const row of (advisors ?? []) as VICAdvisorRow[]) {
    if (!advisorMap[row.vic_client_id]) advisorMap[row.vic_client_id] = []
    advisorMap[row.vic_client_id].push(row.staff_id)
  }
  return (clients ?? []).map(c => ({
    ...c,
    affiliated_advisor_ids: advisorMap[c.id] ?? [],
  })) as VICClient[]
}

export async function upsertVICClient(v: VICClient): Promise<VICClient> {
  const { affiliated_advisor_ids, created_at, updated_at, ...rest } = v as any
  const { data, error } = await supabase
    .from('vic_clients').upsert(rest, { onConflict: 'id' }).select().single()
  if (error) throw error
  const clientId = data.id
  await supabase.from('vic_advisors').delete().eq('vic_client_id', clientId)
  if (affiliated_advisor_ids.length > 0) {
    const rows = affiliated_advisor_ids.map((sid: string) => ({ vic_client_id: clientId, staff_id: sid }))
    const { error: ae } = await supabase.from('vic_advisors').insert(rows)
    if (ae) throw ae
  }
  return { ...data, affiliated_advisor_ids } as VICClient
}

export async function deleteVICClient(id: string): Promise<void> {
  const { error } = await supabase.from('vic_clients').delete().eq('id', id)
  if (error) throw error
}

// ── Scoring weights ────────────────────────────────────────────────────────────

export async function fetchWeights(): Promise<ScoringWeights> {
  const { data, error } = await supabase
    .from('scoring_weights')
    .select('skill_coverage,vic_affiliation,gender_balance,seniority,language_coverage')
    .eq('id', 1).single()
  if (error) throw error
  return data as ScoringWeights
}

export async function saveWeights(w: ScoringWeights): Promise<void> {
  const { error } = await supabase
    .from('scoring_weights')
    .update({ ...w, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw error
}

// ── Roster history ─────────────────────────────────────────────────────────────

export type RosterStatus = 'pending_review' | 'approved' | 'published' | 'rejected'

export interface RosterHistoryRow {
  id: string
  roster_date: string
  overall_score: number
  solver_used: string
  status: RosterStatus
  override_count: number
  override_ids?: string[]
  approved_at?: string
  published_at?: string
  rejected_at?: string
  approved_by?: string
  published_by?: string
  notes?: string
  payload?: unknown
  created_at: string
}

/**
 * Save a roster draft to history with status = pending_review.
 * Called from RosterPlannerTab when the manager clicks "Send for review".
 */
export async function saveRosterDraft(params: {
  date: string
  score: number
  solver: string
  overrideIds: string[]
  payload: unknown
}): Promise<RosterHistoryRow> {
  const { data, error } = await supabase
    .from('roster_history')
    .insert({
      roster_date:   params.date,
      overall_score: params.score,
      solver_used:   params.solver,
      override_ids:  params.overrideIds,
      status:        'pending_review',
      payload:       params.payload,
    })
    .select()
    .single()
  if (error) throw error
  return data as RosterHistoryRow
}

/**
 * Kept for backward compatibility — now saves as pending_review.
 * @deprecated Use saveRosterDraft instead.
 */
export async function saveRosterHistory(
  date: string,
  score: number,
  solver: string,
  payload: unknown,
): Promise<void> {
  await saveRosterDraft({ date, score, solver, overrideIds: [], payload })
}

/**
 * Fetch rosters in pending_review state (shown at top of Publish tab).
 */
export async function fetchPendingRosters(): Promise<RosterHistoryRow[]> {
  const { data, error } = await supabase
    .from('roster_history')
    .select('id,roster_date,overall_score,solver_used,status,override_count,override_ids,payload,created_at')
    .eq('status', 'pending_review')
    .order('roster_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as RosterHistoryRow[]
}

/**
 * Fetch all roster history rows ordered by date (history list section).
 */
export async function fetchRosterHistory(limit = 30): Promise<RosterHistoryRow[]> {
  const { data, error } = await supabase
    .from('roster_history')
    .select('id,roster_date,overall_score,solver_used,status,override_count,approved_at,published_at,rejected_at,notes,created_at')
    .order('roster_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as RosterHistoryRow[]
}

/**
 * Fetch a single roster history row with its full payload (for preview modal).
 */
export async function fetchRosterById(id: string): Promise<RosterHistoryRow | null> {
  const { data, error } = await supabase
    .from('roster_history')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return data as RosterHistoryRow
}

/**
 * Approve a pending roster (status → approved).
 */
export async function approveRoster(id: string, approvedBy: string, notes?: string): Promise<void> {
  const { error } = await supabase
    .from('roster_history')
    .update({
      status:      'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      notes:       notes ?? null,
    })
    .eq('id', id)
    .eq('status', 'pending_review')  // guard: only approve pending rosters
  if (error) throw error
}

/**
 * Reject a pending roster (status → rejected).
 */
export async function rejectRoster(id: string, rejectedBy: string, notes?: string): Promise<void> {
  const { error } = await supabase
    .from('roster_history')
    .update({
      status:      'rejected',
      rejected_at: new Date().toISOString(),
      rejected_by: rejectedBy,
      notes:       notes ?? null,
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * Publish an approved roster (status → published).
 */
export async function publishRoster(id: string, publishedBy: string): Promise<void> {
  const { error } = await supabase
    .from('roster_history')
    .update({
      status:       'published',
      published_at: new Date().toISOString(),
      published_by: publishedBy,
    })
    .eq('id', id)
    .eq('status', 'approved')  // guard: only publish approved rosters
  if (error) throw error
}

/**
 * Fetch the latest published roster for a given date (used by the front-end dashboard).
 */
export async function fetchPublishedRoster(date: string): Promise<RosterHistoryRow | null> {
  const { data, error } = await supabase
    .from('roster_history')
    .select('*')
    .eq('roster_date', date)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .single()
  if (error) return null
  return data as RosterHistoryRow
}
