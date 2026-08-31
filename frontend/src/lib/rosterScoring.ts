// ─────────────────────────────────────────────────────────────────────────────
// Live roster score recalculation for manual staff add/remove edits.
//
// The actual scoring math lives in supabase/functions/_shared/scoring.ts —
// the same file the generate-roster Edge Function uses — so a manual edit
// here and a fresh generation always agree on how a shift is scored. This
// file only handles the browser-side concerns: fetching the staff/skill/VIC
// reference data needed to score with, and adapting it into the shapes the
// shared module expects.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import {
  scoreShiftStaff, overallScore,
  type ScoringStaff, type ScoringRequirement, type ScoringVicClient, type ScoringWeights,
} from '../../../supabase/functions/_shared/scoring.ts'
import type { RosterAssignment, RosterShiftScore, RosterVicCoverage, BoutiqueArea } from './types'

export interface ShiftOrderEntry {
  shift_id: string
  shift_name: string
  duration_hours: number
}

export interface ScoringRefData {
  staffById: Map<string, ScoringStaff>
  allStaff: { id: string; name: string }[]
  requirementsByShift: Map<string, ScoringRequirement[]>
  areas: BoutiqueArea[]   // active areas, for the assignment area picker
  vicClients: ScoringVicClient[]
  vicClientNames: Map<string, string>
  weights: ScoringWeights
  vicCoverageActive: boolean
  genderBalanceActive: boolean
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  skill_coverage: 0.35, vic_affiliation: 0.25,
  gender_balance: 0.15, seniority: 0.15, language_coverage: 0.10,
}

function shiftDurationHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return (eh * 60 + em - sh * 60 - sm) / 60
}

export async function loadShiftOrder(shiftIds: string[]): Promise<ShiftOrderEntry[]> {
  const { data } = await supabase
    .from('boutique_shifts')
    .select('id, name, start_time, end_time, sort_order')
    .in('id', shiftIds)
    .order('sort_order')

  return (data ?? []).map(s => ({
    shift_id: s.id,
    shift_name: s.name,
    duration_hours: shiftDurationHours(s.start_time, s.end_time),
  }))
}

export async function loadScoringRefData(boutiqueId: string, shiftIds: string[]): Promise<ScoringRefData> {
  const [
    { data: staffBoutiques },
    { data: reqRows },
    { data: vicClientBoutiques },
    { data: weightsRow },
    { data: ruleRows },
    { data: areaRows },
  ] = await Promise.all([
    supabase.from('staff_boutiques').select('staff_id').eq('boutique_id', boutiqueId),
    supabase.from('boutique_shift_requirements')
      .select('shift_id, min_count, area_id, boutique_areas(name), skill_types(id, name)')
      .in('shift_id', shiftIds),
    supabase.from('vic_client_boutiques').select('vic_client_id').eq('boutique_id', boutiqueId),
    supabase.from('scoring_weights')
      .select('skill_coverage, vic_affiliation, gender_balance, seniority, language_coverage')
      .eq('boutique_id', boutiqueId).maybeSingle(),
    supabase.from('boutique_rule_config')
      .select('rule_key, is_enabled').eq('boutique_id', boutiqueId)
      .in('rule_key', ['vic_coverage', 'gender_balance']),
    supabase.from('boutique_areas').select('id, name, sort_order, is_active')
      .eq('boutique_id', boutiqueId).eq('is_active', true).order('sort_order'),
  ])

  const staffIds = (staffBoutiques ?? []).map(r => r.staff_id)

  const [{ data: staffRows }, { data: skillRows }, { data: vicAdvisorRows }, { data: vicClientRows }] = await Promise.all([
    staffIds.length
      ? supabase.from('staff').select('id, name, gender, languages').in('id', staffIds)
      : Promise.resolve({ data: [] as any[] }),
    staffIds.length
      ? supabase.from('staff_skills')
          .select('staff_id, is_primary, skill_types(id, is_senior_equivalent)')
          .in('staff_id', staffIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('vic_advisors').select('vic_client_id, staff_id').eq('boutique_id', boutiqueId),
    (vicClientBoutiques ?? []).length
      ? supabase.from('vic_clients').select('id, name').in('id', (vicClientBoutiques ?? []).map(v => v.vic_client_id))
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Primary skill + "any skill senior-equivalent" per staff member
  const primarySkillByStaff = new Map<string, string>()
  const seniorByStaff = new Set<string>()
  for (const row of skillRows ?? []) {
    const st = row.skill_types as any
    if (row.is_primary) primarySkillByStaff.set(row.staff_id, st.id)
    if (st?.is_senior_equivalent) seniorByStaff.add(row.staff_id)
  }

  const staffById = new Map<string, ScoringStaff>()
  for (const s of staffRows ?? []) {
    staffById.set(s.id, {
      id: s.id,
      name: s.name,
      gender: s.gender,
      languages: s.languages ?? [],
      primary_skill_type_id: primarySkillByStaff.get(s.id) ?? null,
      is_senior_equivalent: seniorByStaff.has(s.id),
    })
  }

  const requirementsByShift = new Map<string, ScoringRequirement[]>()
  for (const r of reqRows ?? []) {
    const st = r.skill_types as any
    const area = r.boutique_areas as any
    if (!requirementsByShift.has(r.shift_id)) requirementsByShift.set(r.shift_id, [])
    requirementsByShift.get(r.shift_id)!.push({
      skill_type_id: st.id, skill_name: st.name, min_count: r.min_count,
      area_id: r.area_id, area_name: area?.name ?? null,
    })
  }

  const advisorsByClient = new Map<string, string[]>()
  for (const va of vicAdvisorRows ?? []) {
    if (!advisorsByClient.has(va.vic_client_id)) advisorsByClient.set(va.vic_client_id, [])
    advisorsByClient.get(va.vic_client_id)!.push(va.staff_id)
  }
  const vicClients: ScoringVicClient[] = (vicClientBoutiques ?? []).map(v => ({
    id: v.vic_client_id, advisor_staff_ids: advisorsByClient.get(v.vic_client_id) ?? [],
  }))
  const vicClientNames = new Map<string, string>((vicClientRows ?? []).map(vc => [vc.id, vc.name]))

  const ruleMap = new Map((ruleRows ?? []).map(r => [r.rule_key, r.is_enabled]))

  return {
    staffById,
    allStaff: (staffRows ?? []).map(s => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
    requirementsByShift,
    areas: areaRows ?? [],
    vicClients,
    vicClientNames,
    weights: weightsRow ?? DEFAULT_WEIGHTS,
    vicCoverageActive: ruleMap.get('vic_coverage') ?? true,
    genderBalanceActive: ruleMap.get('gender_balance') ?? true,
  }
}

export function recomputeRoster(
  assignments: RosterAssignment[],
  shiftOrder: ShiftOrderEntry[],
  ref: ScoringRefData,
): { shiftScores: RosterShiftScore[]; overallScore: number; vicCoverage: RosterVicCoverage[] } {
  const byShift = new Map<string, RosterAssignment[]>()
  for (const a of assignments) {
    if (!byShift.has(a.shift_id)) byShift.set(a.shift_id, [])
    byShift.get(a.shift_id)!.push(a)
  }

  const shiftScores: RosterShiftScore[] = shiftOrder.map(({ shift_id, shift_name }) => {
    const assignedHere = byShift.get(shift_id) ?? []
    // area_id lives on the assignment (which area this staff member is
    // covering on this shift), not on the staff's static profile, so it's
    // merged in here rather than carried on ref.staffById's entries.
    const scoringStaff = assignedHere
      .map((a): ScoringStaff | null => {
        const base = ref.staffById.get(a.staff_id)
        return base ? { ...base, area_id: a.area_id } : null
      })
      .filter((s): s is ScoringStaff => !!s)
    const requirements = ref.requirementsByShift.get(shift_id) ?? []
    const result = scoreShiftStaff(
      requirements, scoringStaff, ref.vicClients, ref.weights,
      ref.vicCoverageActive, ref.genderBalanceActive,
    )
    return { shift_id, shift_name, ...result }
  })

  const headcountByShift = new Map(shiftScores.map(s => [s.shift_id, s.headcount]))

  const vicCoverage: RosterVicCoverage[] = ref.vicClients.map(vc => {
    const shiftsCovered: Record<string, string> = {}
    for (const { shift_id, shift_name } of shiftOrder) {
      const advisor = (byShift.get(shift_id) ?? []).find(a => vc.advisor_staff_ids.includes(a.staff_id))
      if (advisor) shiftsCovered[shift_name] = advisor.staff_name
    }
    return {
      client_id: vc.id,
      client_name: ref.vicClientNames.get(vc.id) ?? '',
      shifts_covered: shiftsCovered,
      fully_covered: Object.keys(shiftsCovered).length === shiftOrder.length,
    }
  })

  return { shiftScores, overallScore: overallScore(shiftScores, headcountByShift), vicCoverage }
}
