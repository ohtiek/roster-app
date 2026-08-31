/**
 * Pure greedy roster solver — no DB, no Deno APIs.
 * Ported from frontend/src/engine.ts and extended with DB-driven config
 * and per-boutique rule config (enable/disable, hard_block vs warning).
 */

import { scoreShiftStaff, overallScore, type ScoringStaff } from '../_shared/scoring.ts'

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
    area_id: string | null    // null = shift-wide requirement (pre-area behaviour)
    area_name: string | null
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

// ── Rule configuration ──────────────────────────────────────────────────────

export type RuleKey =
  | 'max_hours_per_day'       // daily hours ceiling
  | 'weekly_hours_cap'        // weekly contracted cap for part-time/casual
  | 'min_rest_hours'          // inter-day rest check (between days)
  | 'max_consecutive_shifts'  // fatigue: max shifts in one day
  | 'certification_expiry'    // applied in index.ts before solver runs
  | 'vic_coverage'            // flag uncovered VIC clients
  | 'gender_balance'          // flag out-of-band gender ratio
  | 'day_of_week_availability' // applied in index.ts before solver runs

export interface RuleEntry {
  is_enabled: boolean
  severity: 'hard_block' | 'warning'
}

export type RuleConfigMap = Partial<Record<RuleKey, RuleEntry>>

// Convenience: check if a rule is active as a hard block
function isHardBlock(rules: RuleConfigMap, key: RuleKey): boolean {
  const r = rules[key]
  return !!r?.is_enabled && r.severity === 'hard_block'
}

// Convenience: check if a rule is active at all (hard_block or warning)
function isActive(rules: RuleConfigMap, key: RuleKey): boolean {
  return !!(rules[key]?.is_enabled)
}

// ── Solver input / output ──────────────────────────────────────────────────

export interface SolverInput {
  roster_date: string
  shifts: SolverShift[]
  staff: SolverStaff[]
  vic_clients: SolverVICClient[]
  config: SolverConfig
  rules: RuleConfigMap
}

export interface SolverResult {
  assignments: Array<{
    shift_id: string
    shift_name: string
    staff_id: string
    staff_name: string
    is_vic_active: boolean
    shift_duration_hours: number
    area_id: string | null    // the area this assignment fills, if any
    area_name: string | null
  }>
  shift_scores: Array<{
    shift_id: string
    shift_name: string
    score: number
    headcount: number
    skill_ok: boolean
    unmet_requirements: Array<{ skill_name: string; area_name: string | null; min_count: number; assigned: number }>
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
    rule_key: RuleKey
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
    rule_key: RuleKey
    severity: 'hard_block' | 'warning'
  }>
  overall_score: number
  solver_used: string
  target_headcount_per_shift: number
}

// ── Main solver ─────────────────────────────────────────────────────────────

export function solve(input: SolverInput): SolverResult {
  const { shifts, staff, vic_clients, config, rules } = input
  const sortedShifts = [...shifts].sort((a, b) => a.sort_order - b.sort_order)

  const vicAdvisorIds = new Set(vic_clients.flatMap(v => v.advisor_staff_ids))

  const shiftAssignments = new Map<string, SolverStaff[]>()
  for (const s of sortedShifts) shiftAssignments.set(s.id, [])

  // Per-shift staff→area attribution, keyed by shift id then staff id.
  const shiftStaffAreaId = new Map<string, Map<string, string | null>>()
  const shiftStaffAreaName = new Map<string, Map<string, string | null>>()

  // Accumulated hours and shift count per staff member for this roster day
  const dailyHours = new Map<string, number>()
  const dailyShiftCount = new Map<string, number>()

  // Non-VIC staff are locked to one shift after assignment
  const lockedStaffIds = new Set<string>()

  for (const shift of sortedShifts) {
    // Base eligibility: available for shift + not on leave + not locked (unless VIC)
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

    // Gate function: can this staff member take this additional shift?
    // Returns false only when a hard_block rule would be violated.
    function canAssign(s: SolverStaff): boolean {
      // max_consecutive_shifts hard_block
      if (isHardBlock(rules, 'max_consecutive_shifts')) {
        const shiftsSoFar = dailyShiftCount.get(s.id) ?? 0
        if (shiftsSoFar >= config.max_consecutive_shifts) return false
      }
      // max_hours_per_day hard_block
      if (isHardBlock(rules, 'max_hours_per_day')) {
        const hoursSoFar = dailyHours.get(s.id) ?? 0
        if (hoursSoFar + shift.duration_hours > config.max_hours_per_day) return false
      }
      // weekly_hours_cap hard_block (part_time / casual with a cap set)
      if (
        isHardBlock(rules, 'weekly_hours_cap') &&
        (s.employment_type === 'part_time' || s.employment_type === 'casual') &&
        s.contracted_hours_per_week != null
      ) {
        const hoursSoFar = dailyHours.get(s.id) ?? 0
        const projected = s.weekly_hours_so_far + hoursSoFar + shift.duration_hours
        if (projected > s.contracted_hours_per_week) return false
      }
      return true
    }

    const assigned: SolverStaff[] = []

    // Which area (if any) each staff member was picked to fill on this shift.
    // Populated during Pass 1 as area-scoped requirements are satisfied; a
    // staff member assigned via a shift-wide requirement, VIC coverage, or
    // headcount fill-up (passes 2/3) has no area (null = "floating").
    const staffAreaId = new Map<string, string | null>()
    const staffAreaName = new Map<string, string | null>()

    // Pass 1: fill minimum requirements per skill type, highest engine_priority
    // first. Area-scoped requirements go before shift-wide ones — they're the
    // tighter constraint (a specific zone needing a specific skill), so they
    // get first pick of the eligible pool; shift-wide requirements then fill
    // from whoever's left.
    const byPriorityDesc = (a: typeof shift.requirements[number], b: typeof shift.requirements[number]) =>
      b.engine_priority - a.engine_priority
    const areaReqs = shift.requirements.filter(r => r.area_id != null).sort(byPriorityDesc)
    const shiftWideReqs = shift.requirements.filter(r => r.area_id == null).sort(byPriorityDesc)
    const reqsByPriority = [...areaReqs, ...shiftWideReqs]
    for (const req of reqsByPriority) {
      let filled = 0
      for (const s of sorted) {
        if (filled >= req.min_count) break
        if (assigned.includes(s)) continue
        if (!canAssign(s)) continue
        if (s.skills.some(sk => sk.skill_type_id === req.skill_type_id)) {
          assigned.push(s)
          staffAreaId.set(s.id, req.area_id)
          staffAreaName.set(s.id, req.area_name)
          filled++
        }
      }
    }

    // Pass 2: ensure each VIC client has at least one advisor on shift
    for (const vic of vic_clients) {
      if (assigned.some(s => vic.advisor_staff_ids.includes(s.id))) continue
      const adv = sorted.find(s =>
        vic.advisor_staff_ids.includes(s.id) &&
        !assigned.includes(s) &&
        canAssign(s)
      )
      if (adv) assigned.push(adv)
    }

    // Pass 3: fill to target headcount
    for (const s of sorted) {
      if (assigned.length >= config.target_headcount_per_shift) break
      if (!assigned.includes(s) && canAssign(s)) assigned.push(s)
    }

    // Trim to max_count per skill type — scoped to the same area (or
    // shift-wide) the staff member was actually assigned to fill, so an
    // area's cap doesn't get consumed by another area's headcount.
    const finalAssigned: SolverStaff[] = []
    const skillUsed = new Map<string, number>()
    for (const s of assigned) {
      const primary = s.skills.find(sk => sk.is_primary)
      if (primary) {
        const areaId = staffAreaId.get(s.id) ?? null
        const req = shift.requirements.find(r => r.skill_type_id === primary.skill_type_id && r.area_id === areaId)
        const key = `${areaId ?? ''}:${primary.skill_type_id}`
        const used = skillUsed.get(key) ?? 0
        if (req?.max_count != null && used >= req.max_count) continue
        skillUsed.set(key, used + 1)
      }
      finalAssigned.push(s)
    }

    shiftAssignments.set(shift.id, finalAssigned)
    shiftStaffAreaId.set(shift.id, new Map(staffAreaId))
    shiftStaffAreaName.set(shift.id, new Map(staffAreaName))

    for (const s of finalAssigned) {
      dailyHours.set(s.id, (dailyHours.get(s.id) ?? 0) + shift.duration_hours)
      dailyShiftCount.set(s.id, (dailyShiftCount.get(s.id) ?? 0) + 1)
      if (!vicAdvisorIds.has(s.id)) lockedStaffIds.add(s.id)
    }
  }

  // ── Assignments output ───────────────────────────────────────────────────
  const assignments: SolverResult['assignments'] = []
  for (const shift of sortedShifts) {
    const areaIdByStaff = shiftStaffAreaId.get(shift.id)
    const areaNameByStaff = shiftStaffAreaName.get(shift.id)
    for (const s of shiftAssignments.get(shift.id) ?? []) {
      assignments.push({
        shift_id: shift.id,
        shift_name: shift.name,
        staff_id: s.id,
        staff_name: s.name,
        is_vic_active: vicAdvisorIds.has(s.id),
        shift_duration_hours: shift.duration_hours,
        area_id: areaIdByStaff?.get(s.id) ?? null,
        area_name: areaNameByStaff?.get(s.id) ?? null,
      })
    }
  }

  // ── Shift scores ─────────────────────────────────────────────────────────
  const shift_scores = sortedShifts.map(shift =>
    scoreShift(
      shift,
      shiftAssignments.get(shift.id) ?? [],
      shiftStaffAreaId.get(shift.id) ?? new Map(),
      vic_clients,
      config.weights,
      rules,
    )
  )

  // ── VIC coverage report ──────────────────────────────────────────────────
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

  // ── Fatigue flags (max_consecutive_shifts rule) ───────────────────────────
  const fatigue_flags: SolverResult['fatigue_flags'] = []
  if (isActive(rules, 'max_consecutive_shifts')) {
    const staffShiftNames = new Map<string, string[]>()
    for (const a of assignments) {
      if (!staffShiftNames.has(a.staff_id)) staffShiftNames.set(a.staff_id, [])
      staffShiftNames.get(a.staff_id)!.push(a.shift_name)
    }
    for (const [staffId, shiftNames] of staffShiftNames) {
      if (shiftNames.length >= config.max_consecutive_shifts) {
        const s = staff.find(x => x.id === staffId)!
        fatigue_flags.push({
          staff_id: staffId,
          staff_name: s.name,
          shifts: shiftNames,
          level: isHardBlock(rules, 'max_consecutive_shifts') ? 'blocked' : 'caution',
          note: `${s.name} is on ${shiftNames.length} shifts today — confirm rest day tomorrow.`,
          rule_key: 'max_consecutive_shifts',
        })
      }
    }
  }

  // ── Hours warnings ────────────────────────────────────────────────────────
  const hours_warnings: SolverResult['hours_warnings'] = []

  if (isActive(rules, 'max_hours_per_day')) {
    const severity = rules.max_hours_per_day?.severity ?? 'warning'
    for (const s of staff) {
      const todayHours = dailyHours.get(s.id) ?? 0
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
          rule_key: 'max_hours_per_day',
          severity,
        })
      }
    }
  }

  if (isActive(rules, 'weekly_hours_cap')) {
    const severity = rules.weekly_hours_cap?.severity ?? 'warning'
    for (const s of staff) {
      if (
        (s.employment_type !== 'part_time' && s.employment_type !== 'casual') ||
        s.contracted_hours_per_week == null
      ) continue
      const todayHours = dailyHours.get(s.id) ?? 0
      if (todayHours === 0) continue
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
          rule_key: 'weekly_hours_cap',
          severity,
        })
      }
    }
  }

  // ── Overall score ─────────────────────────────────────────────────────────
  const headcountByShift = new Map(shift_scores.map(ss => [ss.shift_id, ss.headcount]))

  return {
    assignments,
    shift_scores,
    vic_coverage,
    fatigue_flags,
    hours_warnings,
    overall_score: overallScore(shift_scores, headcountByShift),
    solver_used: 'greedy-db',
    target_headcount_per_shift: config.target_headcount_per_shift,
  }
}

function scoreShift(
  shift: SolverShift,
  assigned: SolverStaff[],
  staffAreaId: Map<string, string | null>,
  vicClients: SolverVICClient[],
  weights: SolverConfig['weights'],
  rules: RuleConfigMap,
): SolverResult['shift_scores'][number] {
  const scoringStaff: ScoringStaff[] = assigned.map(s => ({
    id: s.id,
    name: s.name,
    gender: s.gender,
    languages: s.languages,
    primary_skill_type_id: s.skills.find(sk => sk.is_primary)?.skill_type_id ?? null,
    is_senior_equivalent: s.skills.some(sk => sk.is_senior_equivalent),
    area_id: staffAreaId.get(s.id) ?? null,
  }))

  const result = scoreShiftStaff(
    shift.requirements,
    scoringStaff,
    vicClients,
    weights,
    isActive(rules, 'vic_coverage'),
    isActive(rules, 'gender_balance'),
  )

  return { shift_id: shift.id, shift_name: shift.name, ...result }
}
