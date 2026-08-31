// ─────────────────────────────────────────────────────────────────────────────
// Shared roster scoring math — the single source of truth for how a shift's
// staff mix is scored and how per-shift scores roll up into an overall score.
//
// Used by:
//   - supabase/functions/generate-roster/solver.ts (Deno, full generation)
//   - frontend/src/lib/rosterScoring.ts (browser, live recalculation when an
//     admin manually adds/removes staff from a shift in the Rosters page)
//
// Pure functions only — no DB access, no environment-specific APIs — so the
// exact same file can be imported by both a Deno Edge Function and a Vite
// frontend bundle without adaptation.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoringStaff {
  id: string
  name: string
  gender: string
  languages: string[]
  primary_skill_type_id: string | null
  is_senior_equivalent: boolean
  // The area this staff member was assigned to fill, if any. Optional so
  // existing callers (e.g. frontend/src/lib/rosterScoring.ts, which doesn't
  // yet have an area-management UI) keep compiling unchanged — omitting it
  // is equivalent to area_id: null, i.e. "not area-scoped."
  area_id?: string | null
}

export interface ScoringRequirement {
  skill_type_id: string
  skill_name: string
  min_count: number
  // area_id: undefined/null = shift-wide requirement (existing behaviour).
  // Optional for the same reason as ScoringStaff.area_id above.
  area_id?: string | null
  area_name?: string | null
}

export interface ScoringVicClient {
  id: string
  advisor_staff_ids: string[]
}

export interface ScoringWeights {
  skill_coverage: number
  vic_affiliation: number
  gender_balance: number
  seniority: number
  language_coverage: number
}

export interface ShiftScoreResult {
  score: number
  headcount: number
  skill_ok: boolean
  unmet_requirements: Array<{ skill_name: string; area_name: string | null; min_count: number; assigned: number }>
  vic_ok: boolean
  gender_pct_female: number
  languages: string[]
  seniority_ok: boolean
}

// Groups counts/lookups by (area, skill) so an area-scoped requirement is only
// satisfied by staff assigned to that specific area, while a shift-wide
// requirement (area_id null) still counts every staff member on the shift —
// matching the pre-area behaviour exactly when no areas are configured.
function areaSkillKey(areaId: string | null | undefined, skillTypeId: string): string {
  return `${areaId ?? ''}:${skillTypeId}`
}

/**
 * Score a single shift's staff mix.
 *
 * VIC coverage is "fully covered" only when every one of vicClients has at
 * least one of their advisors assigned to this shift — matching per-client
 * coverage, not just "some VIC advisor is present."
 *
 * @param vicCoverageActive whether the vic_coverage rule is enabled
 * @param genderBalanceActive whether the gender_balance rule is enabled
 */
export function scoreShiftStaff(
  requirements: ScoringRequirement[],
  assigned: ScoringStaff[],
  vicClients: ScoringVicClient[],
  weights: ScoringWeights,
  vicCoverageActive: boolean,
  genderBalanceActive: boolean,
): ShiftScoreResult {
  if (!assigned.length) {
    return {
      score: 0, headcount: 0, skill_ok: false,
      unmet_requirements: requirements.map(r => ({
        skill_name: r.skill_name, area_name: r.area_name ?? null, min_count: r.min_count, assigned: 0,
      })),
      vic_ok: false,
      gender_pct_female: 0, languages: [], seniority_ok: false,
    }
  }

  // 1. Skill coverage
  const skillCounts = new Map<string, number>()
  for (const s of assigned) {
    if (s.primary_skill_type_id) {
      const key = areaSkillKey(s.area_id, s.primary_skill_type_id)
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1)
    }
  }
  const countFor = (r: ScoringRequirement) => skillCounts.get(areaSkillKey(r.area_id, r.skill_type_id)) ?? 0
  const skillOk = requirements.every(r => countFor(r) >= r.min_count)
  const skillScore = skillOk ? 1 : requirements.reduce((a, r) => {
    return a + Math.min(countFor(r) / r.min_count, 1)
  }, 0) / Math.max(requirements.length, 1)
  const unmetRequirements = requirements
    .filter(r => countFor(r) < r.min_count)
    .map(r => ({
      skill_name: r.skill_name, area_name: r.area_name ?? null, min_count: r.min_count,
      assigned: countFor(r),
    }))

  // 2. VIC affiliation — a client is "covered" if any of their advisors is on shift
  const assignedIds = new Set(assigned.map(s => s.id))
  const vicCovered = vicClients.filter(v => v.advisor_staff_ids.some(id => assignedIds.has(id))).length
  const vicOk = vicClients.length === 0 || vicCovered === vicClients.length
  const vicEffectiveWeight = vicCoverageActive ? weights.vic_affiliation : 0
  const vicScore = vicClients.length === 0 ? 1 : vicCovered / vicClients.length

  // 3. Gender balance
  const pctF = assigned.filter(s => s.gender === 'F').length / assigned.length
  const genderEffectiveWeight = genderBalanceActive ? weights.gender_balance : 0
  const genderScore = pctF >= 0.3 && pctF <= 0.7 ? 1 : 0.5

  // 4. Seniority
  const hasSenior = assigned.some(s => s.is_senior_equivalent)
  const seniorityScore = hasSenior ? 1 : 0

  // 5. Language coverage
  const langs = new Set(assigned.flatMap(s => s.languages))
  const langScore = Math.min(langs.size / 5, 1)

  // Redistribute dropped weights so total stays at 100
  const droppedWeight = (weights.vic_affiliation - vicEffectiveWeight) + (weights.gender_balance - genderEffectiveWeight)
  const remainingBase = 1 - droppedWeight

  const score = remainingBase > 0
    ? (
        weights.skill_coverage    * skillScore +
        vicEffectiveWeight        * vicScore +
        genderEffectiveWeight     * genderScore +
        weights.seniority         * seniorityScore +
        weights.language_coverage * langScore
      ) / remainingBase * 100
    : 0

  return {
    score: Math.round(score * 10) / 10,
    headcount: assigned.length,
    skill_ok: skillOk,
    unmet_requirements: unmetRequirements,
    vic_ok: vicOk,
    gender_pct_female: Math.round(pctF * 100) / 100,
    languages: [...langs].sort(),
    seniority_ok: hasSenior,
  }
}

/**
 * Weighted-average overall score across shifts, weighted by headcount so a
 * fully-staffed shift counts for more than a barely-staffed one.
 */
export function overallScore(
  shiftScores: Array<{ shift_id: string; score: number }>,
  headcountByShift: Map<string, number>,
): number {
  const totalAssigned = [...headcountByShift.values()].reduce((a, b) => a + b, 0)
  if (totalAssigned === 0) return 0
  const weighted = shiftScores.reduce((sum, ss) => {
    return sum + ss.score * (headcountByShift.get(ss.shift_id) ?? 0)
  }, 0)
  return Math.round((weighted / totalAssigned) * 10) / 10
}
