// ─── Role types ───────────────────────────────────────────────────────────────

export type BoutiqueRole = 'admin' | 'approver' | 'reader'
export type AppRole = 'regional_admin' | BoutiqueRole | 'staff'

// Portal a user is routed to (priority order: regional_admin > admin > approver > staff > reader)
export type Portal = 'admin' | 'approver' | 'staff' | 'reader'

export interface UserBoutiqueRole {
  boutique_id: string
  role: BoutiqueRole
  boutique_name?: string
}

export interface BoutiqueOption {
  id: string
  name: string
}

export interface SessionContext {
  userId: string
  email: string
  portal: Portal
  boutiqueRoles: UserBoutiqueRole[]
  // Set when user is a staff member (staff.user_id = auth.uid())
  staffId?: string
  staffBoutiqueId?: string
  // Set for regional_admin
  isRegionalAdmin: boolean
  // Active boutique for the current session (admin/approver may switch)
  activeBoutiqueId: string | null
  // Boutiques the user can switch between — all boutiques for regional_admin,
  // or the boutiques where they hold an admin/approver role otherwise
  availableBoutiques: BoutiqueOption[]
  setActiveBoutiqueId: (boutiqueId: string) => void
}

// ─── Staff ────────────────────────────────────────────────────────────────────

export type EmploymentType = 'full_time' | 'part_time' | 'casual' | 'contractor'

export interface Staff {
  id: string
  name: string
  external_hr_id: string | null
  user_id: string | null
  employment_type: EmploymentType
  contracted_hours_per_week: number | null
  gender: 'M' | 'F' | 'NB'
  languages: string[]
  avatar_color: string
  created_at: string
  updated_at: string
}

// ─── Boutique ─────────────────────────────────────────────────────────────────

export interface Boutique {
  id: string
  name: string
  address: string | null
  store_code: string | null
  region_id: string | null
}

// ─── Roster ───────────────────────────────────────────────────────────────────

export type RosterStatus =
  | 'draft'
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'archived'
  | 'published_amended'

export interface RosterSummary {
  id: string
  boutique_id: string
  boutique_name: string | null
  roster_date: string
  status: RosterStatus
  overall_score: number | null
  override_count: number
  submit_deadline: string | null
  approve_deadline: string | null
  created_at: string
}

// ─── Engine config ────────────────────────────────────────────────────────────

export interface EngineConfig {
  boutique_id: string
  target_headcount_per_shift: number
  max_consecutive_shifts: number
  min_rest_hours: number
  vic_priority_boost: number
  max_hours_per_day: number
}

export interface ScoringWeights {
  boutique_id: string
  skill_coverage: number
  vic_affiliation: number
  gender_balance: number
  seniority: number
  language_coverage: number
}

// ─── Rule config ──────────────────────────────────────────────────────────────

export type RuleKey =
  | 'max_hours_per_day'
  | 'weekly_hours_cap'
  | 'min_rest_hours'
  | 'max_consecutive_shifts'
  | 'certification_expiry'
  | 'vic_coverage'
  | 'gender_balance'
  | 'day_of_week_availability'

export type RuleSeverity = 'hard_block' | 'warning'

export interface RuleConfig {
  boutique_id: string
  rule_key: RuleKey
  is_enabled: boolean
  severity: RuleSeverity
  updated_at: string
}

// ─── Skills ───────────────────────────────────────────────────────────────────

export interface SkillType {
  id: string
  name: string
  category: string | null
  is_vic_eligible: boolean
  is_senior_equivalent: boolean
  engine_priority: number
}

export interface StaffSkill {
  staff_id: string
  skill_type_id: string
  skill_type_name: string
  is_primary: boolean
  proficiency_level: string | null
  expires_at: string | null
}

// ─── Staff (with boutique details) ───────────────────────────────────────────

export interface StaffRow {
  id: string
  name: string
  external_hr_id: string | null
  employment_type: EmploymentType
  contracted_hours_per_week: number | null
  gender: 'M' | 'F' | 'NB'
  languages: string[]
  seniority: 'junior' | 'senior' | 'manager'
  avatar_color: string | null
  skills: StaffSkill[]
  availability_days: number[]   // 0=Sun … 6=Sat; empty = all days
}

// ─── Shifts ───────────────────────────────────────────────────────────────────

export interface BoutiqueShift {
  id: string
  boutique_id: string
  name: string
  start_time: string   // "HH:MM:SS"
  end_time: string
  sort_order: number
  valid_from: string   // "YYYY-MM-DD"
  valid_until: string | null
}

export interface ShiftRequirement {
  shift_id: string
  skill_type_id: string
  skill_type_name: string
  min_count: number
  max_count: number | null
}

export interface BoutiqueClosure {
  id: string
  closure_date: string   // "YYYY-MM-DD"
  reason: string | null
}

// ─── Roster history ───────────────────────────────────────────────────────────

export interface RosterHistoryRow {
  id: string
  roster_date: string
  status: RosterStatus
  overall_score: number | null
  override_count: number
  submit_deadline: string | null
  approve_deadline: string | null
  submitted_at: string | null
  created_at: string
}

export interface RosterPayload {
  overall_score: number
  generated_at: string
  solver_used: string
  target_headcount_per_shift: number
  assignments: RosterAssignment[]
  shift_scores: RosterShiftScore[]
  vic_coverage: RosterVicCoverage[]
  fatigue_flags: RosterFatigueFlag[]
  hours_warnings: RosterHoursWarning[]
}

export interface RosterAssignment {
  shift_id: string
  shift_name: string
  staff_id: string
  staff_name: string
  is_vic_active: boolean
  shift_duration_hours: number
}

export interface RosterShiftScore {
  shift_id: string
  shift_name: string
  score: number
  headcount: number
  skill_ok: boolean
  unmet_requirements: { skill_name: string; min_count: number; assigned: number }[]
  vic_ok: boolean
  gender_pct_female: number
  languages: string[]
  seniority_ok: boolean
}

export interface RosterVicCoverage {
  client_id: string
  client_name: string
  shifts_covered: Record<string, string>   // shift_name -> advisor_name
  fully_covered: boolean
}

export interface RosterFatigueFlag {
  staff_id: string
  staff_name: string
  shifts: string[]
  level: string
  note: string
  rule_key: RuleKey
}

export interface RosterHoursWarning {
  staff_id: string
  staff_name: string
  assigned_hours_today: number
  daily_limit: number
  weekly_hours_so_far: number
  weekly_hours_projected: number
  weekly_cap: number | null
  type: 'daily' | 'weekly'
  rule_key: RuleKey
  severity: RuleSeverity
}

// ─── VIC ──────────────────────────────────────────────────────────────────────

export type VicTier = 'platinum' | 'gold' | 'silver'
export type VicApptStatus = 'confirmed' | 'tentative' | 'cancelled' | 'no_show' | 'visited'

export interface VicClient {
  id: string
  name: string
  tier: VicTier | null
  preferred_languages: string[] | null
}

export interface VicAdvisorRow {
  vic_client_id: string
  staff_id: string
  staff_name: string
}

export interface VicAppointment {
  id: string
  vic_client_id: string
  appointment_date: string
  shift_id: string | null
  shift_name?: string
  assigned_advisor_id: string | null
  assigned_advisor_name?: string
  status: VicApptStatus
  notes: string | null
}

// ─── Leave ────────────────────────────────────────────────────────────────────

export type LeaveSource = 'leave_system' | 'ad_hoc' | 'manual'
export type LeaveType = 'annual' | 'sick' | 'toil' | 'parental' | 'public_holiday' | 'unpaid' | 'other'

export interface StaffLeaveRow {
  id: string
  staff_id: string
  staff_name: string
  starts_at: string
  ends_at: string
  source: LeaveSource
  source_ref: string | null
  leave_type: LeaveType | null
  reason: string | null
  created_at: string
}

// ─── Constraint violation ─────────────────────────────────────────────────────

export type ViolationSeverity = 'warning' | 'error'

export interface ConstraintViolation {
  rule: string
  severity: ViolationSeverity
  staff_id?: string
  staff_name?: string
  shift_id?: string
  detail: string
}
