export type Role = 'Floor Manager' | 'Sr. Stylist' | 'Jr. Stylist' | 'VIC Advisor' | 'Cashier' | 'Stock Associate'
export type Gender = 'M' | 'F' | 'NB'
export type SkillLevel = 'junior' | 'senior' | 'manager'
export type ShiftName = 'morning' | 'afternoon' | 'closing'

export interface StaffMember {
  id: string
  name: string
  role: Role
  seniority: SkillLevel
  gender: Gender
  languages: string[]
  available_shifts: ShiftName[]
  must_work_dates: string[]
  cannot_work_dates: string[]
  avatar_color: string
  created_at?: string
  updated_at?: string
}

export interface VICClient {
  id: string
  name: string
  affiliated_advisor_ids: string[]   // derived from vic_advisors junction
  expected_visit_date?: string
  created_at?: string
  updated_at?: string
}

export interface VICAdvisorRow {
  vic_client_id: string
  staff_id: string
}

export interface ScoringWeights {
  skill_coverage: number
  vic_affiliation: number
  gender_balance: number
  seniority: number
  language_coverage: number
}

export type ShiftAssignment = {
  staff_id: string
  shift: ShiftName
  is_vic_active: boolean
  change_note?: string
}

export type ShiftScore = {
  shift: ShiftName
  score: number
  skill_ok: boolean
  vic_ok: boolean
  gender_pct_female: number
  languages: string[]
  seniority_ok: boolean
}

export type VICCoverage = {
  client_id: string
  client_name: string
  morning_advisor?: string
  afternoon_advisor?: string
  closing_advisor?: string
  fully_covered: boolean
}

export type RosterResponse = {
  date: string
  overall_score: number
  assignments: ShiftAssignment[]
  shift_scores: ShiftScore[]
  vic_coverage: VICCoverage[]
  changes_from_baseline: string[]
  fatigue_flags: Array<{ staff_id: string; name: string; shifts: string[]; level: string; note: string }>
  solver_used: string
}

export const ALL_ROLES: Role[] = ['Floor Manager', 'Sr. Stylist', 'Jr. Stylist', 'VIC Advisor', 'Cashier', 'Stock Associate']
export const ALL_SHIFTS: ShiftName[] = ['morning', 'afternoon', 'closing']
export const ALL_LANGUAGES = ['EN', 'CN', 'YUE', 'FR', 'AR', 'IT', 'ES', 'DE', 'JA', 'KO', 'RU']
export const ALL_GENDERS: { value: Gender; label: string }[] = [
  { value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'NB', label: 'Non-binary' },
]
export const AVATAR_COLORS = ['av-b', 'av-p', 'av-t', 'av-c', 'av-k', 'av-m', 'av-g']
export const AVATAR_STYLE: Record<string, { bg: string; fg: string }> = {
  'av-b': { bg: '#DDEAF8', fg: '#1E4D8C' }, 'av-p': { bg: '#EEEDFE', fg: '#3C3489' },
  'av-t': { bg: '#D8EEE8', fg: '#085041' }, 'av-c': { bg: '#FAECE7', fg: '#712B13' },
  'av-k': { bg: '#FBEAF0', fg: '#72243E' }, 'av-m': { bg: '#FAEEDA', fg: '#633806' },
  'av-g': { bg: '#EAF3DE', fg: '#27500A' },
}
export const WEIGHT_META: { key: keyof ScoringWeights; label: string; desc: string; color: string }[] = [
  { key: 'skill_coverage',    label: 'Skill coverage',    desc: 'All required roles filled per shift',             color: '#1E4D8C' },
  { key: 'vic_affiliation',   label: 'VIC affiliation',   desc: 'Affiliated advisor on shift for every VIC client', color: '#C9A84C' },
  { key: 'gender_balance',    label: 'Gender balance',    desc: 'No single gender exceeds 70% of a shift',         color: '#4A3280' },
  { key: 'seniority',         label: 'Seniority cover',   desc: 'At least one senior or manager per shift',        color: '#0F6E56' },
  { key: 'language_coverage', label: 'Language coverage', desc: 'Minimum language combinations per shift',         color: '#993C1D' },
]
export const DEFAULT_WEIGHTS: ScoringWeights = {
  skill_coverage: 0.35, vic_affiliation: 0.25,
  gender_balance: 0.15, seniority: 0.15, language_coverage: 0.10,
}
