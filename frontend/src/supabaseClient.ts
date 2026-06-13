// ─── Supabase client ───────────────────────────────────────────────────────────
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env
// These are safe to expose in the browser (they are public anon keys).

import { createClient } from '@supabase/supabase-js'
import type { StaffMember, VICClient, ScoringWeights, VICAdvisorRow } from './types'

const url  = import.meta.env.VITE_SUPABASE_URL  as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n' +
    'Copy .env.example to .env and fill in your Supabase project credentials.'
  )
}

export const supabase = createClient(url, anon)

// ─── Staff ─────────────────────────────────────────────────────────────────────

export async function fetchStaff(): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('name')
  if (error) throw error
  return data as StaffMember[]
}

export async function upsertStaff(s: StaffMember): Promise<StaffMember> {
  const { id, created_at, ...rest } = s as any
  const payload = id ? { id, ...rest } : rest
  const { data, error } = await supabase
    .from('staff')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data as StaffMember
}

export async function deleteStaff(id: string): Promise<void> {
  const { error } = await supabase.from('staff').delete().eq('id', id)
  if (error) throw error
}

// ─── VIC clients ───────────────────────────────────────────────────────────────

export async function fetchVICClients(): Promise<VICClient[]> {
  // Fetch clients + their advisor junctions in parallel
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
  const { affiliated_advisor_ids, ...rest } = v

  // Upsert the client row
  const { data, error } = await supabase
    .from('vic_clients')
    .upsert(rest, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error

  // Replace advisor junctions
  const clientId = data.id
  await supabase.from('vic_advisors').delete().eq('vic_client_id', clientId)
  if (affiliated_advisor_ids.length > 0) {
    const rows = affiliated_advisor_ids.map(sid => ({
      vic_client_id: clientId,
      staff_id: sid,
    }))
    const { error: ae } = await supabase.from('vic_advisors').insert(rows)
    if (ae) throw ae
  }

  return { ...data, affiliated_advisor_ids } as VICClient
}

export async function deleteVICClient(id: string): Promise<void> {
  // Cascade deletes advisors via FK
  const { error } = await supabase.from('vic_clients').delete().eq('id', id)
  if (error) throw error
}

// ─── Scoring weights ───────────────────────────────────────────────────────────

export async function fetchWeights(): Promise<ScoringWeights> {
  const { data, error } = await supabase
    .from('scoring_weights')
    .select('skill_coverage,vic_affiliation,gender_balance,seniority,language_coverage')
    .eq('id', 1)
    .single()
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

// ─── Roster history ────────────────────────────────────────────────────────────

export async function saveRosterHistory(
  date: string,
  score: number,
  solver: string,
  payload: unknown,
): Promise<void> {
  const { error } = await supabase.from('roster_history').insert({
    roster_date:   date,
    overall_score: score,
    solver_used:   solver,
    payload,
  })
  if (error) throw error
}
