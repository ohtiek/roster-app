/**
 * Pure greedy roster solver — no DB, no Deno APIs.
 * Ported from frontend/src/engine.ts and extended with DB-driven config.
 */

export interface SolverShift {
  id: string
  name: string
  start_time: string        // 'HH:MM'
  end_time: string          // 'HH:MM'
  sort_order: number
  duration_hours: number
  requirements: Array<{
    skill_type_id: string
    skill_name: string
    min_count: number
    max_count: number | null
    is_vic_eligible: boolean
    is_senior_equivalent: boolean
    engine_priority: number
  }>
}

export interface SolverStaff {
  id: string
  name: string
  gender: string
  languages: string[]
  seniority: string
  employment_type: string
  contracted_hours_per_week: number | null
  skills: Array<{
    skill_type_id: string
    skill_name: string
    is_vic_eligible: boolean
    is_senior_equivalent: boolean
    engine_priority: number
    is_primary: boolean
  }>
  available_shift_ids: Set<string>
  unavailable_shift_ids: Set<string>   // blocked by leave / unavailability
  required_today: boolean
  weekly_hours_so_far: number
}

export interface SolverVICClient {
  id: string
  name: string
  advisor_staff_ids: string[]
}

export interface SolverConfig {
  target_headcount_per_shift: number
  max_consecutive_shifts: number
  min_rest_hours: number
  vic_priority_boost: number
  max_hours_per_day: number
  weights: {
    skill_coverage: number
    vic_affiliation: number
    gender_balance: number
    seniority: number
    language_coverage: number
  }
}

export interface SolverInput {
  roster_date: string
  shifts: SolverShift[]
  staff: SolverStaff[]
  vic_clients: SolverVICClient[]
  config: SolverConfig
}

export interface SolverResult {
  assignments: Array<{
    shift_id: string
    shift_name: string
    staff_id: string
    staff_name: string
    is_vic_active: boolean
    shift_duration_hours: number
  }>
  shift_scores: Array<{
    shift_id: string
    shift_name: string
    score: number
    skill_ok: boolean
    vic_ok: boolean
    gender_pct_female: number
    languages: string[]
    seniority_ok: boolean
  }>
  vic_coverage: Array<{
    client_id: string
    client_name: string
    shifts_covered: Record<string, string>   // shift_name -> advisor_name
    fully_covered: boolean
  }>
  fatigue_flags: Array<{
    staff_id: string
    staff_name: string
    shifts: string[]
    level: string
    note: string
  }>
  hours_warnings: Array<{
    staff_id: string
    staff_name: string
    assigned_hours_today: number
    daily_limit: number
    weekly_hours_so_far: number
    weekly_hours_projected: number
    weekly_cap: number | null
    type: 'daily' | 'weekly'
  }>
  overall_score: number
  solver_used: string
}

export function solve(input: SolverInput): SolverResult {
  const { shifts, staff, vic_clients, config } = input
  const sortedShifts = [...shifts].sort((a, b) => a.sort_order - b.sort_order)

  const vicAdvisorIds = new Set(vic_clients.flatMap(v => v.advisor_staff_ids))

  // shift_id -> staff assigned to that shift
  const shiftAssignments = new Map<string, SolverStaff[]>()
  for (const s of sortedShifts) shiftAssignments.set(s.id, [])

  // Daily hours accumulated per staff member
  const dailyHours = new Map<string, number>()

  // Non-VIC staff are locked to one shift after assignment
  const lockedStaffIds = new Set<string>()

  for (const shift of sortedShifts) {
    const eligible = staff.filter(s =>
      s.available_shift_ids.has(shift.id) &&
      !s.unavailable_shift_ids.has(shift.id) &&
      (!lockedStaffIds.has(s.id) || vicAdvisorIds.has(s.id))
    )

    function priority(s: SolverStaff): number {
      const maxEngPriority = s.skills.reduce((m, sk) => Math.max(m, sk.engine_priority), 0)
      return (
        (s.required_today ? 100 : 0) +
        (vicAdvisorIds.has(s.id) ? config.vic_priority_boost : 0) +
        maxEngPriority +
        s.languages.length
      )
    }

    const sorted = [...eligible].sort((a, b) => priority(b) - priority(a))
    const assigned: SolverStaff[] = []

    // Pass 1: fill minimum requirements per skill type, highest engine_priority first
    const reqsByPriority = [...shift.requirements].sort((a, b) => b.engine_priority - a.engine_priority)
    for (const req of reqsByPriority) {
      let filled = 0
      for (const s of sorted) {
        if (filled >= req.min_count) break
        if (assigned.includes(s)) continue
        if (s.skills.some(sk => sk.skill_type_id === req.skill_type_id)) {
          assigned.push(s)
          filled++
        }
      }
    }

    // Pass 2: ensure each VIC client has at least one advisor on shift
    for (const vic of vic_clients) {
      if (assigned.some(s => vic.advisor_staff_ids.includes(s.id))) continue
      const adv = sorted.find(s => vic.advisor_staff_ids.includes(s.id) && !assigned.includes(s))
      if (adv) assigned.push(adv)
    }

    // Pass 3: fill to target headcount
    for (const s of sorted) {
      if (assigned.length >= config.target_headcount_per_shift) break
      if (!assigned.includes(s)) assigned.push(s)
    }

    // Trim to max_count per skill type
    const finalAssigned: SolverStaff[] = []
    const skillUsed = new Map<string, number>()
    for (const s of assigned) {
      const primary = s.skills.find(sk => sk.is_primary)
      if (primary) {
        const req = shift.requirements.find(r => r.skill_type_id === primary.skill_type_id)
        const used = skillUsed.get(primary.skill_type_id) ?? 0
        if (req?.max_count != null && used >= req.max_count) continue
        skillUsed.set(primary.skill_type_id, used + 1)
      }
      finalAssigned.push(s)
    }

    shiftAssignments.set(shift.id, finalAssigned)

    for (const s of finalAssigned) {
      dailyHours.set(s.id, (dailyHours.get(s.id) ?? 0) + shift.duration_hours)
      if (!vicAdvisorIds.has(s.id)) lockedStaffIds.add(s.id)
    }
  }

  // Assemble assignments output
  const assignments: SolverResult['assignments'] = []
  for (const shift of sortedShifts) {
    for (const s of shiftAssignments.get(shift.id) ?? []) {
      assignments.push({
        shift_id: shift.id,
        shift_name: shift.name,
        staff_id: s.id,
        staff_name: s.name,
        is_vic_active: vicAdvisorIds.has(s.id),
        shift_duration_hours: shift.duration_hours,
      })
    }
  }

  // Score each shift
  const shift_scores = sortedShifts.map(shift =>
    scoreShift(shift, shiftAssignments.get(shift.id) ?? [], vic_clients, config.weights)
  )

  // VIC coverage report
  const vic_coverage: SolverResult['vic_coverage'] = vic_clients.map(vc => {
    const shiftsCovered: Record<string, string> = {}
    for (const shift of sortedShifts) {
      const advisor = (shiftAssignments.get(shift.id) ?? []).find(s => vc.advisor_staff_ids.includes(s.id))
      if (advisor) shiftsCovered[shift.name] = advisor.name
    }
    return {
      client_id: vc.id,
      client_name: vc.name,
      shifts_covered: shiftsCovered,
      fully_covered: Object.keys(shiftsCovered).length === sortedShifts.length,
    }
  })

  // Fatigue flags
  const staffShiftNames = new Map<string, string[]>()
  for (const a of assignments) {
    if (!staffShiftNames.has(a.staff_id)) staffShiftNames.set(a.staff_id, [])
    staffShiftNames.get(a.staff_id)!.push(a.shift_name)
  }

  const fatigue_flags: SolverResult['fatigue_flags'] = []
  for (const [staffId, shiftNames] of staffShiftNames) {
    if (shiftNames.length >= config.max_consecutive_shifts) {
      const s = staff.find(x => x.id === staffId)!
      fatigue_flags.push({
        staff_id: staffId,
        staff_name: s.name,
        shifts: shiftNames,
        level: 'caution',
        note: `${s.name} is on ${shiftNames.length} shifts today — confirm rest day tomorrow.`,
      })
    }
  }

  // Hours warnings
  const hours_warnings: SolverResult['hours_warnings'] = []
  for (const s of staff) {
    const todayHours = dailyHours.get(s.id) ?? 0
    if (todayHours === 0) continue

    if (todayHours > config.max_hours_per_day) {
      hours_warnings.push({
        staff_id: s.id,
        staff_name: s.name,
        assigned_hours_today: todayHours,
        daily_limit: config.max_hours_per_day,
        weekly_hours_so_far: s.weekly_hours_so_far,
        weekly_hours_projected: s.weekly_hours_so_far + todayHours,
        weekly_cap: null,
        type: 'daily',
      })
    }

    if (
      (s.employment_type === 'part_time' || s.employment_type === 'casual') &&
      s.contracted_hours_per_week != null
    ) {
      const projected = s.weekly_hours_so_far + todayHours
      if (projected > s.contracted_hours_per_week) {
        hours_warnings.push({
          staff_id: s.id,
          staff_name: s.name,
          assigned_hours_today: todayHours,
          daily_limit: config.max_hours_per_day,
          weekly_hours_so_far: s.weekly_hours_so_far,
          weekly_hours_projected: projected,
          weekly_cap: s.contracted_hours_per_week,
          type: 'weekly',
        })
      }
    }
  }

  // Weighted average score
  const totalAssigned = assignments.length
  const overall = totalAssigned > 0
    ? shift_scores.reduce((sum, ss) => {
        const count = assignments.filter(a => a.shift_id === ss.shift_id).length
        return sum + ss.score * count
      }, 0) / totalAssigned
    : 0

  return {
    assignments,
    shift_scores,
    vic_coverage,
    fatigue_flags,
    hours_warnings,
    overall_score: Math.round(overall * 10) / 10,
    solver_used: 'greedy-db',
  }
}

function scoreShift(
  shift: SolverShift,
  assigned: SolverStaff[],
  vicClients: SolverVICClient[],
  weights: SolverConfig['weights'],
): SolverResult['shift_scores'][number] {
  if (!assigned.length) {
    return {
      shift_id: shift.id, shift_name: shift.name,
      score: 0, skill_ok: false, vic_ok: false,
      gender_pct_female: 0, languages: [], seniority_ok: false,
    }
  }

  // 1. Skill coverage: check minimum counts by primary skill
  const skillCounts = new Map<string, number>()
  for (const s of assigned) {
    const primary = s.skills.find(sk => sk.is_primary)
    if (primary) skillCounts.set(primary.skill_type_id, (skillCounts.get(primary.skill_type_id) ?? 0) + 1)
  }
  const skillOk = shift.requirements.every(r => (skillCounts.get(r.skill_type_id) ?? 0) >= r.min_count)
  const skillScore = skillOk ? 1 : shift.requirements.reduce((a, r) => {
    return a + Math.min((skillCounts.get(r.skill_type_id) ?? 0) / r.min_count, 1)
  }, 0) / Math.max(shift.requirements.length, 1)

  // 2. VIC affiliation
  const assignedIds = new Set(assigned.map(s => s.id))
  const vicCovered = vicClients.filter(v => v.advisor_staff_ids.some(id => assignedIds.has(id))).length
  const vicScore = vicClients.length === 0 ? 1 : vicCovered / vicClients.length
  const vicOk = vicCovered === vicClients.length

  // 3. Gender balance (30–70% female is ideal)
  const pctF = assigned.filter(s => s.gender === 'F').length / assigned.length
  const genderScore = pctF >= 0.3 && pctF <= 0.7 ? 1 : 0.5

  // 4. Seniority
  const hasSenior = assigned.some(s => s.skills.some(sk => sk.is_senior_equivalent))
  const seniorityScore = hasSenior ? 1 : 0

  // 5. Language coverage (score at 5 languages)
  const langs = new Set(assigned.flatMap(s => s.languages))
  const langScore = Math.min(langs.size / 5, 1)

  const score = (
    weights.skill_coverage    * skillScore +
    weights.vic_affiliation   * vicScore +
    weights.gender_balance    * genderScore +
    weights.seniority         * seniorityScore +
    weights.language_coverage * langScore
  ) * 100

  return {
    shift_id: shift.id,
    shift_name: shift.name,
    score: Math.round(score * 10) / 10,
    skill_ok: skillOk,
    vic_ok: vicOk,
    gender_pct_female: Math.round(pctF * 100) / 100,
    languages: [...langs].sort(),
    seniority_ok: hasSenior,
  }
}
