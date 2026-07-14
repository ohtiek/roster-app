import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { solve, type SolverStaff, type RuleConfigMap } from './solver.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function shiftDurationHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return (eh * 60 + em - sh * 60 - sm) / 60
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { boutique_id, roster_date, shift_id } = body as {
      boutique_id: string
      roster_date: string   // YYYY-MM-DD
      shift_id?: string     // optional: re-solve this shift only
    }

    if (!boutique_id || !roster_date) {
      return json({ error: 'boutique_id and roster_date are required' }, 400)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(roster_date)) {
      return json({ error: 'roster_date must be YYYY-MM-DD' }, 400)
    }

    // Identify the caller so roster_history.created_by is set — RLS's
    // roster_update_admin policy requires created_by = auth.uid() before an
    // admin can submit their own draft, and this function writes via the
    // service role (which bypasses RLS and would otherwise leave it null).
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: callerData } = await callerClient.auth.getUser()
    const callerId = callerData?.user?.id ?? null

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    // ── Check closure ────────────────────────────────────────────────────────
    const { data: closure } = await db
      .from('boutique_closures')
      .select('reason')
      .eq('boutique_id', boutique_id)
      .eq('closure_date', roster_date)
      .maybeSingle()

    if (closure) {
      return json({ error: `boutique is closed on ${roster_date}: ${closure.reason ?? 'planned closure'}` }, 409)
    }

    // ── Engine config + rule config + scoring weights (parallel) ────────────
    const [
      { data: engCfg, error: engErr },
      { data: ruleRows },
      { data: swRow },
    ] = await Promise.all([
      db.from('boutique_engine_config').select('*').eq('boutique_id', boutique_id).single(),
      db.from('boutique_rule_config').select('rule_key, is_enabled, severity').eq('boutique_id', boutique_id),
      db.from('scoring_weights')
        .select('skill_coverage, vic_affiliation, gender_balance, seniority, language_coverage')
        .eq('boutique_id', boutique_id)
        .maybeSingle(),
    ])

    if (engErr || !engCfg) return json({ error: 'engine config not found for boutique' }, 404)

    // Build rule config map — missing rules default to enabled + warning
    const rules: RuleConfigMap = {}
    for (const r of ruleRows ?? []) {
      rules[r.rule_key as keyof RuleConfigMap] = { is_enabled: r.is_enabled, severity: r.severity }
    }

    const weights = swRow ?? {
      skill_coverage: 0.35, vic_affiliation: 0.25,
      gender_balance: 0.15, seniority: 0.15, language_coverage: 0.10,
    }

    // ── Active shifts for the date ───────────────────────────────────────────
    let shiftsQ = db
      .from('boutique_shifts')
      .select('id, name, start_time, end_time, sort_order')
      .eq('boutique_id', boutique_id)
      .lte('valid_from', roster_date)
      .or(`valid_until.is.null,valid_until.gte.${roster_date}`)
      .order('sort_order')

    if (shift_id) shiftsQ = shiftsQ.eq('id', shift_id)

    const { data: shiftsRaw, error: shiftsErr } = await shiftsQ
    if (shiftsErr || !shiftsRaw?.length) {
      return json({ error: 'no active shifts found for this boutique on this date' }, 404)
    }

    const shiftIds = shiftsRaw.map((s: any) => s.id)
    const rosterDow = new Date(roster_date + 'T12:00:00Z').getUTCDay() // 0=Sun..6=Sat

    // ── Shift requirements with day-of-week overrides ────────────────────────
    const [{ data: baseReqs }, { data: dowOverrides }] = await Promise.all([
      db.from('boutique_shift_requirements')
        .select('shift_id, min_count, max_count, skill_types(id, name, is_vic_eligible, is_senior_equivalent, engine_priority)')
        .in('shift_id', shiftIds),
      db.from('boutique_shift_day_overrides')
        .select('shift_id, skill_type_id, min_count, max_count')
        .in('shift_id', shiftIds)
        .eq('day_of_week', rosterDow),
    ])

    const overrideKey = (shiftId: string, skillTypeId: string) => `${shiftId}:${skillTypeId}`
    const overrideMap = new Map<string, { min_count: number; max_count: number | null }>()
    for (const o of dowOverrides ?? []) {
      overrideMap.set(overrideKey(o.shift_id, o.skill_type_id), { min_count: o.min_count, max_count: o.max_count })
    }

    const requirements = (baseReqs ?? []).map((r: any) => {
      const st = r.skill_types
      const ov = overrideMap.get(overrideKey(r.shift_id, st.id))
      return {
        shift_id: r.shift_id,
        skill_type_id: st.id,
        skill_name: st.name,
        is_vic_eligible: st.is_vic_eligible,
        is_senior_equivalent: st.is_senior_equivalent,
        engine_priority: st.engine_priority,
        min_count: ov?.min_count ?? r.min_count,
        max_count: ov?.max_count ?? r.max_count ?? null,
      }
    })

    // ── Staff for this boutique ──────────────────────────────────────────────
    const { data: staffBoutiques } = await db
      .from('staff_boutiques')
      .select('staff_id')
      .eq('boutique_id', boutique_id)
      .lte('valid_from', roster_date)
      .or(`valid_until.is.null,valid_until.gte.${roster_date}`)

    let staffIds = (staffBoutiques ?? []).map((sb: any) => sb.staff_id)
    if (!staffIds.length) return json({ error: 'no staff found for this boutique' }, 404)

    // ── Pre-filter: day-of-week availability (if rule is enabled as hard_block) ─
    const dowRule = rules['day_of_week_availability']
    if (dowRule?.is_enabled && dowRule.severity === 'hard_block') {
      const { data: availDayRows } = await db
        .from('staff_availability_days')
        .select('staff_id')
        .eq('boutique_id', boutique_id)
        .eq('day_of_week', rosterDow)
        .in('staff_id', staffIds)

      // Staff with no rows in staff_availability_days are treated as available on all days
      const { data: hasAnyDayRow } = await db
        .from('staff_availability_days')
        .select('staff_id')
        .eq('boutique_id', boutique_id)
        .in('staff_id', staffIds)

      const staffWithDayConfig = new Set((hasAnyDayRow ?? []).map((r: any) => r.staff_id))
      const staffAvailableToday = new Set((availDayRows ?? []).map((r: any) => r.staff_id))

      staffIds = staffIds.filter((id: string) =>
        !staffWithDayConfig.has(id) || staffAvailableToday.has(id)
      )
    }

    const [
      { data: staffRows },
      { data: staffSkillsRaw },
      { data: shiftAvail },
      { data: unavailRows },
      { data: reqWorkRows },
    ] = await Promise.all([
      db.from('staff')
        .select('id, name, gender, languages, seniority, employment_type, contracted_hours_per_week')
        .in('id', staffIds),
      db.from('staff_skills')
        .select('staff_id, is_primary, expires_at, skill_types(id, name, is_vic_eligible, is_senior_equivalent, engine_priority)')
        .in('staff_id', staffIds),
      db.from('staff_shift_availability')
        .select('staff_id, shift_id')
        .in('shift_id', shiftIds)
        .in('staff_id', staffIds),
      db.from('staff_unavailability')
        .select('staff_id, starts_at, ends_at')
        .in('staff_id', staffIds)
        .lt('starts_at', `${roster_date}T23:59:59Z`)
        .gt('ends_at', `${roster_date}T00:00:00Z`),
      db.from('staff_required_work')
        .select('staff_id')
        .in('staff_id', staffIds)
        .eq('work_date', roster_date),
    ])

    // ── Pre-filter: certification expiry (if rule is enabled) ────────────────
    const certRule = rules['certification_expiry']
    const staffSkills = certRule?.is_enabled
      ? (staffSkillsRaw ?? []).filter((ss: any) =>
          ss.expires_at == null || ss.expires_at >= roster_date
        )
      : (staffSkillsRaw ?? [])

    const requiredTodayIds = new Set((reqWorkRows ?? []).map((r: any) => r.staff_id))

    // ── Weekly hours this week from published/approved rosters ───────────────
    const rosterDt = new Date(roster_date + 'T12:00:00Z')
    const daysFromMonday = rosterDt.getUTCDay() === 0 ? 6 : rosterDt.getUTCDay() - 1
    const weekStart = new Date(rosterDt)
    weekStart.setUTCDate(rosterDt.getUTCDate() - daysFromMonday)
    const weekStartStr = weekStart.toISOString().substring(0, 10)

    const { data: weekRosters } = await db
      .from('roster_history')
      .select('payload')
      .eq('boutique_id', boutique_id)
      .in('status', ['published', 'approved'])
      .gte('roster_date', weekStartStr)
      .lt('roster_date', roster_date)

    const weeklyHoursMap = new Map<string, number>()
    for (const rh of weekRosters ?? []) {
      for (const a of rh.payload?.assignments ?? []) {
        weeklyHoursMap.set(a.staff_id, (weeklyHoursMap.get(a.staff_id) ?? 0) + (a.shift_duration_hours ?? 0))
      }
    }

    // ── VIC clients for this boutique ────────────────────────────────────────
    const { data: vicClientBoutiques } = await db
      .from('vic_client_boutiques')
      .select('vic_client_id')
      .eq('boutique_id', boutique_id)

    const vicClientIds = (vicClientBoutiques ?? []).map((v: any) => v.vic_client_id)
    let vicClients: Array<{ id: string; name: string; advisor_staff_ids: string[] }> = []

    if (vicClientIds.length) {
      const [{ data: vicClientRows }, { data: vicAdvisorRows }] = await Promise.all([
        db.from('vic_clients').select('id, name').in('id', vicClientIds),
        db.from('vic_advisors')
          .select('vic_client_id, staff_id')
          .eq('boutique_id', boutique_id)
          .in('vic_client_id', vicClientIds)
          .in('staff_id', staffIds),
      ])

      const advisorsByClient = new Map<string, string[]>()
      for (const va of vicAdvisorRows ?? []) {
        if (!advisorsByClient.has(va.vic_client_id)) advisorsByClient.set(va.vic_client_id, [])
        advisorsByClient.get(va.vic_client_id)!.push(va.staff_id)
      }
      vicClients = (vicClientRows ?? []).map((vc: any) => ({
        id: vc.id,
        name: vc.name,
        advisor_staff_ids: advisorsByClient.get(vc.id) ?? [],
      }))
    }

    // ── Assemble solver inputs ───────────────────────────────────────────────
    const skillsByStaff = new Map<string, any[]>()
    for (const ss of staffSkills ?? []) {
      if (!skillsByStaff.has(ss.staff_id)) skillsByStaff.set(ss.staff_id, [])
      skillsByStaff.get(ss.staff_id)!.push({
        skill_type_id: (ss.skill_types as any).id,
        skill_name: (ss.skill_types as any).name,
        is_vic_eligible: (ss.skill_types as any).is_vic_eligible,
        is_senior_equivalent: (ss.skill_types as any).is_senior_equivalent,
        engine_priority: (ss.skill_types as any).engine_priority,
        is_primary: ss.is_primary,
      })
    }

    // No rows for a staff member = available for every active shift today,
    // matching the same convention used by staff_availability_days — this
    // table has no admin UI to configure it, so an empty set must not mean
    // "available for nothing."
    const allShiftIds = new Set(shiftIds)
    const availShiftsByStaff = new Map<string, Set<string>>()
    for (const a of shiftAvail ?? []) {
      if (!availShiftsByStaff.has(a.staff_id)) availShiftsByStaff.set(a.staff_id, new Set())
      availShiftsByStaff.get(a.staff_id)!.add(a.shift_id)
    }

    // Build per-staff set of shift IDs blocked by unavailability
    const unavailByStaff = new Map<string, Set<string>>()
    for (const u of unavailRows ?? []) {
      const uStart = new Date(u.starts_at).getTime()
      const uEnd = new Date(u.ends_at).getTime()
      for (const s of shiftsRaw) {
        const shiftStart = new Date(`${roster_date}T${s.start_time}:00Z`).getTime()
        const shiftEnd = new Date(`${roster_date}T${s.end_time}:00Z`).getTime()
        if (uStart < shiftEnd && uEnd > shiftStart) {
          if (!unavailByStaff.has(u.staff_id)) unavailByStaff.set(u.staff_id, new Set())
          unavailByStaff.get(u.staff_id)!.add(s.id)
        }
      }
    }

    const solverStaff: SolverStaff[] = (staffRows ?? []).map((s: any) => ({
      id: s.id,
      name: s.name,
      gender: s.gender,
      languages: s.languages ?? [],
      seniority: s.seniority,
      employment_type: s.employment_type,
      contracted_hours_per_week: s.contracted_hours_per_week,
      skills: skillsByStaff.get(s.id) ?? [],
      available_shift_ids: availShiftsByStaff.get(s.id) ?? allShiftIds,
      unavailable_shift_ids: unavailByStaff.get(s.id) ?? new Set(),
      required_today: requiredTodayIds.has(s.id),
      weekly_hours_so_far: weeklyHoursMap.get(s.id) ?? 0,
    }))

    const solverShifts = shiftsRaw.map((s: any) => ({
      id: s.id,
      name: s.name,
      start_time: s.start_time,
      end_time: s.end_time,
      sort_order: s.sort_order,
      duration_hours: shiftDurationHours(s.start_time, s.end_time),
      requirements: requirements.filter((r: any) => r.shift_id === s.id),
    }))

    // ── Solve ────────────────────────────────────────────────────────────────
    const result = solve({
      roster_date,
      shifts: solverShifts,
      staff: solverStaff,
      vic_clients: vicClients,
      rules,
      config: {
        target_headcount_per_shift: engCfg.target_headcount_per_shift,
        max_consecutive_shifts: engCfg.max_consecutive_shifts,
        min_rest_hours: engCfg.min_rest_hours,
        vic_priority_boost: Number(engCfg.vic_priority_boost),
        max_hours_per_day: engCfg.max_hours_per_day,
        weights: {
          skill_coverage: weights.skill_coverage,
          vic_affiliation: weights.vic_affiliation,
          gender_balance: weights.gender_balance,
          seniority: weights.seniority,
          language_coverage: weights.language_coverage,
        },
      },
    })

    // ── Persist to roster_history ────────────────────────────────────────────
    const payload = {
      overall_score: result.overall_score,
      assignments: result.assignments,
      shift_scores: result.shift_scores,
      vic_coverage: result.vic_coverage,
      fatigue_flags: result.fatigue_flags,
      hours_warnings: result.hours_warnings,
      solver_used: result.solver_used,
      target_headcount_per_shift: result.target_headcount_per_shift,
      generated_at: new Date().toISOString(),
    }

    if (shift_id) {
      // Per-shift re-run: merge into existing draft
      const { data: existing } = await db
        .from('roster_history')
        .select('id, payload, created_by')
        .eq('boutique_id', boutique_id)
        .eq('roster_date', roster_date)
        .eq('status', 'draft')
        .maybeSingle()

      if (existing) {
        const merged = mergeShiftIntoPayload(existing.payload, shift_id, result, shiftsRaw)
        await db
          .from('roster_history')
          .update({
            payload: merged, overall_score: merged.overall_score, solver_used: result.solver_used,
            created_by: existing.created_by ?? callerId,
          })
          .eq('id', existing.id)
      } else {
        await db.from('roster_history').insert({
          boutique_id, roster_date, status: 'draft', created_by: callerId,
          overall_score: result.overall_score, solver_used: result.solver_used, payload,
        })
      }
    } else {
      const { data: existing } = await db
        .from('roster_history')
        .select('id, created_by')
        .eq('boutique_id', boutique_id)
        .eq('roster_date', roster_date)
        .eq('status', 'draft')
        .maybeSingle()

      if (existing) {
        await db.from('roster_history')
          .update({
            payload, overall_score: result.overall_score, solver_used: result.solver_used,
            created_by: existing.created_by ?? callerId,
          })
          .eq('id', existing.id)
      } else {
        await db.from('roster_history').insert({
          boutique_id, roster_date, status: 'draft', created_by: callerId,
          overall_score: result.overall_score, solver_used: result.solver_used, payload,
        })
      }
    }

    return json({ success: true, data: { roster_date, boutique_id, overall_score: result.overall_score, shift_scores: result.shift_scores } })
  } catch (err) {
    console.error('generate-roster error:', err)
    return json({ error: err instanceof Error ? err.message : 'internal error' }, 500)
  }
})

function mergeShiftIntoPayload(
  existing: any,
  shiftId: string,
  result: ReturnType<typeof solve>,
  allShifts: any[],
): any {
  const otherAssignments = (existing?.assignments ?? []).filter((a: any) => a.shift_id !== shiftId)
  const otherScores = (existing?.shift_scores ?? []).filter((s: any) => s.shift_id !== shiftId)
  const newAssignments = result.assignments.filter(a => a.shift_id === shiftId)
  const newScores = result.shift_scores.filter(s => s.shift_id === shiftId)

  const allAssignments = [...otherAssignments, ...newAssignments]
  const allScores = [...otherScores, ...newScores]

  const totalStaff = allAssignments.length
  const overallScore = totalStaff > 0
    ? allScores.reduce((sum, ss) => {
        const count = allAssignments.filter((a: any) => a.shift_id === ss.shift_id).length
        return sum + ss.score * count
      }, 0) / totalStaff
    : 0

  return {
    ...(existing ?? {}),
    overall_score: Math.round(overallScore * 10) / 10,
    assignments: allAssignments,
    shift_scores: allScores,
    vic_coverage: result.vic_coverage.length ? result.vic_coverage : (existing?.vic_coverage ?? []),
    fatigue_flags: result.fatigue_flags,
    hours_warnings: result.hours_warnings,
    solver_used: result.solver_used,
    generated_at: new Date().toISOString(),
  }
}
