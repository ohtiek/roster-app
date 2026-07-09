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
  created_at: string
}

export interface RosterPayload {
  date: string
  boutique_id: string
  overall_score: number
  generated_at: string
  engine_version?: number
  shifts: RosterShiftResult[]
  hours_warnings: RosterWarning[]
  fatigue_flags: RosterWarning[]
}

export interface RosterShiftResult {
  shift_id: string
  shift_name: string
  start_time: string
  end_time: string
  assigned: RosterAssignment[]
  score: number
  headcount: number
  target_headcount: number
  unmet_requirements: { skill: string; min_count: number; assigned: number }[]
}

export interface RosterAssignment {
  staff_id: string
  name: string
  skill: string
  score?: number
}

export interface RosterWarning {
  staff_id: string
  staff_name?: string
  rule_key: string
  severity: 'warning' | 'hard_block'
  detail: string
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
