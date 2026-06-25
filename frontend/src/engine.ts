/**
 * Roster engine — pure TypeScript greedy solver.
 * Runs entirely in the browser — no backend server needed.
 * For the Supabase/Vercel stack this replaces the Python OR-Tools engine.
 *
 * Scoring weights (configurable):
 *   skill_coverage   0.35
 *   vic_affiliation  0.25
 *   gender_balance   0.15
 *   seniority        0.15
 *   language_coverage 0.10
 */

import type {
  StaffMember, VICClient, ScoringWeights,
  ShiftName, ShiftAssignment, ShiftScore, VICCoverage, RosterResponse,
} from './types'

const SHIFTS: ShiftName[] = ['morning', 'afternoon', 'closing']

const SHIFT_MIN: Record<string, number> = {
  'Floor Manager': 1, 'Sr. Stylist': 1, 'VIC Advisor': 1, 'Cashier': 1,
}

const VIC_ELIGIBLE_ROLES = new Set(['Floor Manager', 'Sr. Stylist', 'VIC Advisor'])
const SENIOR_ROLES = new Set(['Floor Manager', 'Sr. Stylist', 'VIC Advisor'])

function scoreShift(
  assigned: StaffMember[],
  vicClients: VICClient[],
  weights: ScoringWeights,
  shift: ShiftName,
): ShiftScore {
  if (!assigned.length) return {
    shift, score: 0, skill_ok: false, vic_ok: false,
    gender_pct_female: 0, languages: [], seniority_ok: false,
  }

  // 1 skill coverage
  const roleCounts: Record<string, number> = {}
  for (const s of assigned) roleCounts[s.role] = (roleCounts[s.role] ?? 0) + 1
  const skillOk = Object.entries(SHIFT_MIN).every(([r, n]) => (roleCounts[r] ?? 0) >= n)
  const skillScore = skillOk ? 1 : Object.entries(SHIFT_MIN)
    .reduce((a, [r, n]) => a + Math.min((roleCounts[r] ?? 0) / n, 1), 0) / Object.keys(SHIFT_MIN).length

  // 2 VIC affiliation
  const advIds = new Set(assigned.filter(s => VIC_ELIGIBLE_ROLES.has(s.role)).map(s => s.id))
  let vicCovered = 0
  for (const v of vicClients) if (v.affiliated_advisor_ids.some(id => advIds.has(id))) vicCovered++
  const vicScore = vicCovered / Math.max(vicClients.length, 1)
  const vicOk = vicCovered === vicClients.length

  // 3 gender balance
  const femaleCount = assigned.filter(s => s.gender === 'F').length
  const pctF = femaleCount / assigned.length
  const genderScore = pctF <= 0.7 && pctF >= 0.3 ? 1 : 0.5

  // 4 seniority
  const hasSenior = assigned.some(s => SENIOR_ROLES.has(s.role))
  const seniorityScore = hasSenior ? 1 : 0

  // 5 language coverage
  const langs = new Set(assigned.flatMap(s => s.languages))
  const langScore = Math.min(langs.size / 5, 1)

  const total = (
    weights.skill_coverage    * skillScore +
    weights.vic_affiliation   * vicScore +
    weights.gender_balance    * genderScore +
    weights.seniority         * seniorityScore +
    weights.language_coverage * langScore
  ) * 100

  return {
    shift,
    score: Math.round(total * 10) / 10,
    skill_ok: skillOk,
    vic_ok: vicOk,
    gender_pct_female: Math.round(pctF * 100) / 100,
    languages: [...langs].sort(),
    seniority_ok: hasSenior,
  }
}

function buildVICCoverage(
  shiftMap: Record<ShiftName, StaffMember[]>,
  vicClients: VICClient[],
): VICCoverage[] {
  return vicClients.map(v => {
    const cov: VICCoverage = {
      client_id: v.id, client_name: v.name, fully_covered: false,
    }
    for (const shift of SHIFTS) {
      const match = shiftMap[shift].find(s => v.affiliated_advisor_ids.includes(s.id))
      if (match) {
        const key = `${shift}_advisor` as keyof VICCoverage
        ;(cov as any)[key] = match.name
      }
    }
    cov.fully_covered = !!(cov.morning_advisor && cov.afternoon_advisor && cov.closing_advisor)
    return cov
  })
}

export function generateRoster(
  date: string,
  staff: StaffMember[],
  vicClients: VICClient[],
  weights: ScoringWeights,
  optimiseForVIC = false,
): RosterResponse {
  const available = staff.filter(s => !(s.cannot_work_dates ?? []).includes(date))
  const vicAdvisorIds = new Set(vicClients.flatMap(v => v.affiliated_advisor_ids))
  const shiftMap: Record<ShiftName, StaffMember[]> = { morning: [], afternoon: [], closing: [] }
  const assignedIds = new Set<string>()

  function priority(s: StaffMember): number {
    return ((s.must_work_dates ?? []).includes(date) ? 100 : 0) +
      (optimiseForVIC && vicAdvisorIds.has(s.id) ? 20 : 0) +
      ({ 'Floor Manager': 5, 'VIC Advisor': 4, 'Sr. Stylist': 3, 'Jr. Stylist': 2, 'Cashier': 2, 'Stock Associate': 1 }[s.role] ?? 0) +
      s.languages.length
  }

  for (const shift of SHIFTS) {
    const eligible = available
      .filter(s => s.available_shifts.includes(shift) && !assignedIds.has(s.id))
      .sort((a, b) => priority(b) - priority(a))

    const chosen: StaffMember[] = []

    // Pass 1: mandatory roles
    for (const [role, needed] of Object.entries(SHIFT_MIN)) {
      const candidates = eligible.filter(s => s.role === role && !chosen.includes(s))
      chosen.push(...candidates.slice(0, needed))
    }

    // Pass 2: VIC advisor coverage (if optimising)
    if (optimiseForVIC) {
      for (const v of vicClients) {
        const covered = chosen.some(s => v.affiliated_advisor_ids.includes(s.id))
        if (!covered) {
          const adv = eligible.find(s => v.affiliated_advisor_ids.includes(s.id) && !chosen.includes(s))
          if (adv) chosen.push(adv)
        }
      }
    }

    // Pass 3: fill to ~7 staff
    for (const s of eligible) {
      if (chosen.length >= 7) break
      if (!chosen.includes(s)) chosen.push(s)
    }

    shiftMap[shift] = chosen

    // VIC advisors can span shifts; regular staff are locked to one
    if (!optimiseForVIC) {
      chosen.forEach(s => assignedIds.add(s.id))
    } else {
      chosen.filter(s => !vicAdvisorIds.has(s.id)).forEach(s => assignedIds.add(s.id))
    }
  }

  // Build assignments
  const assignments: ShiftAssignment[] = []
  const staffShifts: Record<string, ShiftName[]> = {}
  for (const shift of SHIFTS) {
    for (const s of shiftMap[shift]) {
      if (!staffShifts[s.id]) staffShifts[s.id] = []
      staffShifts[s.id].push(shift)
      assignments.push({ staff_id: s.id, shift, is_vic_active: vicAdvisorIds.has(s.id) })
    }
  }

  const shiftScores = SHIFTS.map(sh => scoreShift(shiftMap[sh], vicClients, weights, sh))
  const totalStaff = SHIFTS.reduce((a, sh) => a + shiftMap[sh].length, 0)
  const overall = totalStaff > 0
    ? shiftScores.reduce((a, ss, i) => a + ss.score * shiftMap[SHIFTS[i]].length, 0) / totalStaff
    : 0

  const fatigue = Object.entries(staffShifts)
    .filter(([, shifts]) => shifts.length > 1)
    .map(([id, shifts]) => {
      const s = staff.find(x => x.id === id)!
      return { staff_id: id, name: s.name, shifts: shifts as string[], level: 'caution', note: `${s.name} is on multiple shifts today. Confirm rest day tomorrow.` }
    })

  return {
    date,
    overall_score: Math.round(overall * 10) / 10,
    assignments,
    shift_scores: shiftScores,
    vic_coverage: buildVICCoverage(shiftMap, vicClients),
    changes_from_baseline: [],
    fatigue_flags: fatigue,
    solver_used: 'greedy-ts',
  }
}
