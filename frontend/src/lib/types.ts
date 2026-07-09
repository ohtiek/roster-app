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
