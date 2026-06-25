/**
 * RosterPlannerTab.tsx
 *
 * Four capabilities in one tab:
 *   1. Generate   — runs engine.ts against live Supabase data
 *   2. Review     — three-column shift board with constraint scorecards
 *   3. Adjust     — drag-and-drop between shifts, add from bench, remove
 *   4. Publish    — saves the final plan to roster_history in Supabase
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  StaffMember, VICClient, ScoringWeights,
  ShiftName, ShiftAssignment, ShiftScore, VICCoverage, RosterResponse,
} from '../types'
import { AVATAR_STYLE } from '../types'
import { fetchStaff, fetchVICClients, fetchWeights, saveRosterDraft } from '../supabaseClient'
import { generateRoster } from '../engine'

// ── Constants ─────────────────────────────────────────────────────────────────

const SHIFTS: ShiftName[] = ['morning', 'afternoon', 'closing']

const SHIFT_META: Record<ShiftName, { label: string; time: string; color: string; dot: string }> = {
  morning:   { label: 'Morning',   time: '09:00 – 14:00', color: '#1E4D8C', dot: '#5B8FCC' },
  afternoon: { label: 'Afternoon', time: '13:00 – 19:00', color: '#4A3280', dot: '#9B85D4' },
  closing:   { label: 'Closing',   time: '17:00 – 21:00', color: '#0F6E56', dot: '#3DB88A' },
}

// Role → minimum per shift
const SHIFT_MIN: Partial<Record<string, number>> = {
  'Floor Manager': 1, 'Sr. Stylist': 1, 'VIC Advisor': 1, 'Cashier': 1,
}

const VIC_ROLES = new Set(['Floor Manager', 'Sr. Stylist', 'VIC Advisor'])

// ── Local types ───────────────────────────────────────────────────────────────

interface PlanAssignment {
  staffId: string
  shift: ShiftName
  isOverride: boolean     // true if manager manually moved/added
  overrideNote?: string   // e.g. "Moved from morning"
}

interface ShiftViolation {
  shift: ShiftName
  message: string
  severity: 'warn' | 'error'
}

// ── Helper components ─────────────────────────────────────────────────────────

function Avatar({ staff, size = 32 }: { staff: StaffMember; size?: number }) {
  const s = AVATAR_STYLE[staff.avatar_color ?? 'av-b'] ?? AVATAR_STYLE['av-b']
  const ini = staff.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: s.bg, color: s.fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.31, fontWeight: 500, flexShrink: 0,
    }}>{ini}</div>
  )
}

function Tag({ label, variant }: {
  label: string
  variant: 'vic' | 'lang' | 'mgr' | 'override' | 'moved' | 'warn' | 'error'
}) {
  const styles: Record<string, React.CSSProperties> = {
    vic:      { background: '#EEEDFE', color: '#3C3489' },
    lang:     { background: '#E1F5EE', color: '#085041' },
    mgr:      { background: '#FAECE7', color: '#712B13' },
    override: { background: '#EAF3DE', color: '#27500A' },
    moved:    { background: '#FAEEDA', color: '#633806' },
    warn:     { background: '#FAEEDA', color: '#633806' },
    error:    { background: '#FCEBEB', color: '#791F1F' },
  }
  return (
    <span style={{
      ...styles[variant],
      fontSize: 10, padding: '1px 5px', borderRadius: 3,
      fontWeight: 500, display: 'inline-block', lineHeight: 1.4,
    }}>{label}</span>
  )
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', width: 90, flexShrink: 0 }}>{label}</span>
      <div style={{
        flex: 1, height: 7, background: 'var(--color-background-secondary)',
        borderRadius: 4, overflow: 'hidden', border: '0.5px solid var(--color-border-tertiary)',
      }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
      <span style={{
        fontSize: 12, fontWeight: 500, width: 28, textAlign: 'right',
        color: value >= 90 ? '#27500A' : value >= 70 ? '#633806' : '#791F1F',
      }}>{Math.round(value)}</span>
    </div>
  )
}

// ── Re-score helper (mirrors engine.ts logic but takes a PlanAssignment list) ─

function rescoreShift(
  assignments: PlanAssignment[],
  shift: ShiftName,
  staffMap: Record<string, StaffMember>,
  vicClients: VICClient[],
  weights: ScoringWeights,
): ShiftScore {
  const assigned = assignments
    .filter(a => a.shift === shift)
    .map(a => staffMap[a.staffId])
    .filter(Boolean) as StaffMember[]

  if (!assigned.length) return {
    shift, score: 0, skill_ok: false, vic_ok: false,
    gender_pct_female: 0, languages: [], seniority_ok: false,
  }

  const roleCounts: Record<string, number> = {}
  for (const s of assigned) roleCounts[s.role] = (roleCounts[s.role] ?? 0) + 1
  const skillOk = Object.entries(SHIFT_MIN).every(([r, n]) => (roleCounts[r] ?? 0) >= (n ?? 0))
  const skillScore = skillOk ? 1 : Object.entries(SHIFT_MIN)
    .reduce((a, [r, n]) => a + Math.min((roleCounts[r] ?? 0) / (n ?? 1), 1), 0) / Object.keys(SHIFT_MIN).length

  const advIds = new Set(assigned.filter(s => VIC_ROLES.has(s.role)).map(s => s.id))
  let vicCovered = 0
  for (const v of vicClients) {
    if (v.affiliated_advisor_ids.some(id => advIds.has(id))) vicCovered++
  }
  const vicScore = vicCovered / Math.max(vicClients.length, 1)
  const vicOk = vicCovered === vicClients.length

  const femaleCount = assigned.filter(s => s.gender === 'F').length
  const pctF = femaleCount / assigned.length
  const genderScore = pctF <= 0.7 && pctF >= 0.3 ? 1 : 0.5

  const hasSenior = assigned.some(s => VIC_ROLES.has(s.role))
  const langs = new Set(assigned.flatMap(s => s.languages))
  const langScore = Math.min(langs.size / 5, 1)

  const score = (
    weights.skill_coverage    * skillScore +
    weights.vic_affiliation   * vicScore +
    weights.gender_balance    * genderScore +
    weights.seniority         * (hasSenior ? 1 : 0) +
    weights.language_coverage * langScore
  ) * 100

  return {
    shift,
    score: Math.round(score * 10) / 10,
    skill_ok: skillOk,
    vic_ok: vicOk,
    gender_pct_female: Math.round(pctF * 100) / 100,
    languages: [...langs].sort(),
    seniority_ok: hasSenior,
  }
}

function detectViolations(
  assignments: PlanAssignment[],
  shift: ShiftName,
  staffMap: Record<string, StaffMember>,
  vicClients: VICClient[],
): ShiftViolation[] {
  const assigned = assignments.filter(a => a.shift === shift).map(a => staffMap[a.staffId]).filter(Boolean) as StaffMember[]
  const violations: ShiftViolation[] = []

  if (assigned.length === 0) return violations

  // Check required roles
  const roleCounts: Record<string, number> = {}
  for (const s of assigned) roleCounts[s.role] = (roleCounts[s.role] ?? 0) + 1
  for (const [role, min] of Object.entries(SHIFT_MIN)) {
    if ((roleCounts[role] ?? 0) < (min ?? 0)) {
      violations.push({
        shift, severity: 'error',
        message: `${shift.charAt(0).toUpperCase() + shift.slice(1)}: missing ${role} (need ${min}, have ${roleCounts[role] ?? 0})`,
      })
    }
  }

  // Check VIC coverage
  const advIds = new Set(assigned.filter(s => VIC_ROLES.has(s.role)).map(s => s.id))
  for (const v of vicClients) {
    if (!v.affiliated_advisor_ids.some(id => advIds.has(id))) {
      violations.push({
        shift, severity: 'warn',
        message: `${shift.charAt(0).toUpperCase() + shift.slice(1)}: no affiliated advisor for ${v.name}`,
      })
    }
  }

  // Gender balance
  const pctF = assigned.filter(s => s.gender === 'F').length / assigned.length
  if (pctF > 0.85 || pctF < 0.15) {
    violations.push({ shift, severity: 'warn', message: `${shift.charAt(0).toUpperCase() + shift.slice(1)}: gender imbalance (${Math.round(pctF * 100)}% female)` })
  }

  return violations
}

// ── Staff pill (draggable) ────────────────────────────────────────────────────

interface PillProps {
  assignment: PlanAssignment
  staff: StaffMember
  vicClients: VICClient[]
  onRemove: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}

function StaffPill({ assignment, staff, vicClients, onRemove, onDragStart, onDragEnd }: PillProps) {
  const isVIC = vicClients.some(v => v.affiliated_advisor_ids.includes(staff.id))
  const isMgr = staff.seniority === 'manager'

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 9px',
        borderRadius: 'var(--border-radius-md)',
        border: assignment.isOverride
          ? '1.5px dashed #D97706'
          : isVIC ? '1.5px solid #C9A84C' : '0.5px solid var(--color-border-tertiary)',
        background: assignment.isOverride ? '#FEF9F0'
          : isVIC ? '#FDFAF3' : 'var(--color-background-primary)',
        cursor: 'grab', marginBottom: 6,
        transition: 'opacity 0.15s',
      }}
    >
      <Avatar staff={staff} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {staff.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{staff.role}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
          {isMgr && <Tag label="Mgr" variant="mgr" />}
          {isVIC && <Tag label="VIC" variant="vic" />}
          {staff.languages.slice(0, 3).map(l => <Tag key={l} label={l} variant="lang" />)}
          {assignment.isOverride && (
            <Tag label={assignment.overrideNote ?? 'Override'} variant={assignment.overrideNote?.startsWith('Moved') ? 'moved' : 'override'} />
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        aria-label={`Remove ${staff.name}`}
        style={{
          width: 20, height: 20, borderRadius: 4, background: 'transparent',
          border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
          flexShrink: 0, marginTop: 1,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-background-danger)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-danger)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)' }}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  )
}

// ── Staff picker modal ────────────────────────────────────────────────────────

function StaffPicker({
  shift, date, allStaff, assignedIds, vicClients, onAdd, onClose,
}: {
  shift: ShiftName
  date: string
  allStaff: StaffMember[]
  assignedIds: Set<string>
  vicClients: VICClient[]
  onAdd: (staff: StaffMember) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const bench = allStaff.filter(s =>
    !assignedIds.has(s.id) &&
    s.available_shifts.includes(shift) &&
    !(s.cannot_work_dates ?? []).includes(date) &&
    (
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.role.toLowerCase().includes(search.toLowerCase())
    )
  )

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(20,29,74,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50, borderRadius: 'var(--border-radius-lg)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--color-background-primary)',
        borderRadius: 'var(--border-radius-lg)',
        border: '0.5px solid var(--color-border-tertiary)',
        width: 340, maxHeight: 480,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '0.5px solid var(--color-border-tertiary)',
        }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            Add to {SHIFT_META[shift].label} shift
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-secondary)', lineHeight: 1 }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={{ position: 'relative' }}>
            <i className="ti ti-search" aria-hidden="true" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
            <input
              autoFocus
              placeholder="Search by name or role…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', height: 32, paddingLeft: 30, paddingRight: 10,
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                fontSize: 13, fontFamily: 'inherit',
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)', outline: 'none',
              }}
            />
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '6px 10px' }}>
          {bench.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
              No available staff match
            </div>
          )}
          {bench.map(s => {
            const isVIC = vicClients.some(v => v.affiliated_advisor_ids.includes(s.id))
            return (
              <div
                key={s.id}
                onClick={() => { onAdd(s); onClose() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 'var(--border-radius-md)',
                  cursor: 'pointer', border: '0.5px solid transparent',
                  marginBottom: 4,
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.background = 'var(--color-background-secondary)'
                  el.style.borderColor = 'var(--color-border-tertiary)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.background = 'transparent'
                  el.style.borderColor = 'transparent'
                }}
              >
                <Avatar staff={s} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {s.role} · {s.seniority} · {s.languages.join(', ')}
                  </div>
                </div>
                {isVIC && <Tag label="VIC" variant="vic" />}
                <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 14, color: 'var(--color-text-secondary)' }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Shift column ──────────────────────────────────────────────────────────────

function ShiftColumn({
  shift, assignments, staffMap, vicClients, score,
  onRemove, onAdd, onDragStart, onDragOver, onDrop,
}: {
  shift: ShiftName
  assignments: PlanAssignment[]
  staffMap: Record<string, StaffMember>
  vicClients: VICClient[]
  score: ShiftScore | null
  onRemove: (staffId: string) => void
  onAdd: () => void
  onDragStart: (e: React.DragEvent, a: PlanAssignment) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}) {
  const meta = SHIFT_META[shift]
  const shiftAssignments = assignments.filter(a => a.shift === shift)
  const sc = score?.score ?? 0
  const scoreColor = sc >= 90 ? '#27500A' : sc >= 70 ? '#633806' : '#791F1F'

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        background: 'var(--color-background-primary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-lg)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 200,
      }}
    >
      <div style={{ background: meta.color, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: 'white', fontSize: 14, fontWeight: 500 }}>{meta.label}</div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11 }}>{meta.time}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{shiftAssignments.length} staff</span>
          {score && (
            <span style={{
              fontSize: 12, fontWeight: 500,
              background: 'rgba(255,255,255,0.18)',
              borderRadius: 10, padding: '2px 8px', color: 'white',
            }}>{Math.round(sc)}</span>
          )}
        </div>
      </div>

      <div style={{ padding: '8px', flex: 1 }}>
        {shiftAssignments.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 12 }}>
            Drop staff here
          </div>
        )}
        {shiftAssignments.map(a => {
          const staff = staffMap[a.staffId]
          if (!staff) return null
          return (
            <StaffPill
              key={`${a.staffId}-${a.shift}`}
              assignment={a}
              staff={staff}
              vicClients={vicClients}
              onRemove={() => onRemove(a.staffId)}
              onDragStart={e => onDragStart(e, a)}
              onDragEnd={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            />
          )
        })}
        <button
          onClick={onAdd}
          style={{
            width: '100%', padding: '6px', marginTop: 4,
            border: '0.5px dashed var(--color-border-secondary)',
            borderRadius: 'var(--border-radius-md)',
            background: 'transparent', fontSize: 12,
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--color-background-secondary)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
        >
          <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 13 }} />
          Add staff
        </button>
      </div>

      {score && (
        <div style={{ padding: '8px 10px', borderTop: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: score.skill_ok ? '#27500A' : '#791F1F' }}>
              <i className="ti ti-tools" aria-hidden="true" style={{ fontSize: 11 }} /> {score.skill_ok ? 'Roles ✓' : 'Roles ✗'}
            </span>
            <span style={{ fontSize: 10, color: score.vic_ok ? '#27500A' : '#791F1F' }}>
              <i className="ti ti-star" aria-hidden="true" style={{ fontSize: 11 }} /> {score.vic_ok ? 'VIC ✓' : 'VIC ✗'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
              <i className="ti ti-language" aria-hidden="true" style={{ fontSize: 11 }} /> {score.languages.slice(0, 4).join(' ')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RosterPlannerTab() {
  // Data
  const [allStaff, setAllStaff]       = useState<StaffMember[]>([])
  const [vicClients, setVicClients]   = useState<VICClient[]>([])
  const [weights, setWeights]         = useState<ScoringWeights | null>(null)

  // UI state
  const [loading, setLoading]         = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [toast, setToast]             = useState<string | null>(null)

  // Planner state
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [vicMode, setVicMode]           = useState(false)
  const [assignments, setAssignments]   = useState<PlanAssignment[]>([])
  const [scores, setScores]             = useState<ShiftScore[]>([])
  const [vicCoverage, setVicCoverage]   = useState<VICCoverage[]>([])
  const [violations, setViolations]     = useState<ShiftViolation[]>([])
  const [hasRoster, setHasRoster]       = useState(false)
  const [published, setPublished]       = useState(false)

  // Picker
  const [pickerShift, setPickerShift] = useState<ShiftName | null>(null)

  // Drag state
  const draggingRef = useRef<PlanAssignment | null>(null)

  // Build lookup map
  const staffMap: Record<string, StaffMember> = {}
  for (const s of allStaff) staffMap[s.id] = s

  function showToast(msg: string, duration = 2500) {
    setToast(msg)
    setTimeout(() => setToast(null), duration)
  }

  // Load data on mount
  useEffect(() => {
    Promise.all([fetchStaff(), fetchVICClients(), fetchWeights()])
      .then(([s, v, w]) => { setAllStaff(s); setVicClients(v); setWeights(w) })
      .catch(e => setError('Failed to load data: ' + e.message))
      .finally(() => setDataLoading(false))
  }, [])

  // Rescore whenever assignments change
  const rescore = useCallback((currentAssignments: PlanAssignment[], w: ScoringWeights) => {
    const newScores = SHIFTS.map(sh => rescoreShift(currentAssignments, sh, staffMap, vicClients, w))
    setScores(newScores)

    const allViolations = SHIFTS.flatMap(sh => detectViolations(currentAssignments, sh, staffMap, vicClients))
    setViolations(allViolations)

    // Rebuild VIC coverage
    const coverage: VICCoverage[] = vicClients.map(v => {
      const cov: VICCoverage = { client_id: v.id, client_name: v.name, fully_covered: false }
      for (const shift of SHIFTS) {
        const match = currentAssignments
          .filter(a => a.shift === shift)
          .find(a => v.affiliated_advisor_ids.includes(a.staffId))
        if (match) {
          const advisor = staffMap[match.staffId]
          if (advisor) {
            const key = `${shift}_advisor` as keyof VICCoverage
            ;(cov as any)[key] = advisor.name
          }
        }
      }
      cov.fully_covered = !!(cov.morning_advisor && cov.afternoon_advisor && cov.closing_advisor)
      return cov
    })
    setVicCoverage(coverage)
  }, [staffMap, vicClients])

  // Generate roster
  async function handleGenerate() {
    if (!weights) return
    setLoading(true); setError(null); setPublished(false)
    try {
      const result: RosterResponse = generateRoster(
        selectedDate, allStaff, vicClients, weights, vicMode
      )
      const newAssignments: PlanAssignment[] = result.assignments.map(a => ({
        staffId: a.staff_id,
        shift: a.shift,
        isOverride: false,
      }))
      setAssignments(newAssignments)
      setHasRoster(true)
      rescore(newAssignments, weights)
      showToast(`Roster generated · score ${result.overall_score}/100`)
    } catch (e: any) {
      setError('Generation failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // Remove a staff member from a shift
  function handleRemove(shift: ShiftName, staffId: string) {
    const next = assignments.filter(a => !(a.staffId === staffId && a.shift === shift))
    setAssignments(next)
    if (weights) rescore(next, weights)
  }

  // Add staff from picker
  function handleAdd(shift: ShiftName, staff: StaffMember) {
    const alreadyInShift = assignments.some(a => a.staffId === staff.id && a.shift === shift)
    if (alreadyInShift) { showToast(`${staff.name} is already in ${shift} shift`); return }
    const next: PlanAssignment[] = [
      ...assignments,
      { staffId: staff.id, shift, isOverride: true, overrideNote: 'Added' },
    ]
    setAssignments(next)
    if (weights) rescore(next, weights)
    showToast(`${staff.name} added to ${SHIFT_META[shift].label}`)
  }

  // Drag handlers
  function handleDragStart(e: React.DragEvent, assignment: PlanAssignment) {
    draggingRef.current = assignment
    ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(e: React.DragEvent, targetShift: ShiftName) {
    e.preventDefault()
    const a = draggingRef.current
    if (!a || a.shift === targetShift) return

    // Check target doesn't already have this person
    const alreadyThere = assignments.some(x => x.staffId === a.staffId && x.shift === targetShift)
    if (alreadyThere) {
      showToast(`${staffMap[a.staffId]?.name ?? 'Staff'} is already in ${targetShift} shift`)
      return
    }

    const fromLabel = SHIFT_META[a.shift].label
    const next = assignments.map(x =>
      x.staffId === a.staffId && x.shift === a.shift
        ? { ...x, shift: targetShift, isOverride: true, overrideNote: `Moved from ${fromLabel}` }
        : x
    )
    setAssignments(next)
    if (weights) rescore(next, weights)
    draggingRef.current = null
  }

  // Send for review (replaces direct publish)
  async function handlePublish() {
    if (!hasRoster) return
    setLoading(true)
    try {
      const overrideIds = [...new Set(assignments.filter(a => a.isOverride).map(a => a.staffId))]
      const avgScore = scores.length
        ? scores.reduce((a, s) => a + s.score, 0) / scores.length
        : 0
      await saveRosterDraft({
        date:        selectedDate,
        score:       avgScore,
        solver:      overrideIds.length > 0 ? 'greedy-ts+manual' : 'greedy-ts',
        overrideIds,
        payload:     { assignments, scores, vicCoverage, overrideIds, date: selectedDate },
      })
      setPublished(true)
      showToast('Sent for review — open the Publish tab to approve', 3500)
    } catch (e: any) {
      setError('Send for review failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  // Overall score
  const overallScore = scores.length
    ? Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length)
    : 0
  const scoreColor = overallScore >= 90 ? '#27500A' : overallScore >= 70 ? '#633806' : '#791F1F'

  // Ids already assigned (for picker)
  const assignedInShift = (shift: ShiftName) =>
    new Set(assignments.filter(a => a.shift === shift).map(a => a.staffId))

  const overrideCount = assignments.filter(a => a.isOverride).length

  if (dataLoading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-secondary)', fontSize: 14 }}>
        <i className="ti ti-loader" aria-hidden="true" style={{ marginRight: 8 }} />
        Loading staff and VIC data from Supabase…
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 20px', flex: 1, position: 'relative' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', top: 12, right: 16, zIndex: 100,
          background: '#1E2761', color: 'white', padding: '8px 14px',
          borderRadius: 'var(--border-radius-md)', fontSize: 13, fontWeight: 500,
          boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        }}>{toast}</div>
      )}

      {/* ── Generate bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: 'var(--color-background-primary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-lg)', padding: '12px 16px', marginBottom: 14,
      }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', flexShrink: 0 }}>
          Generate roster for
        </span>
        <input
          type="date"
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          style={{
            height: 32, border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--border-radius-md)', padding: '0 10px',
            fontSize: 13, fontFamily: 'inherit', color: 'var(--color-text-primary)',
            background: 'var(--color-background-primary)',
          }}
        />
        <button
          onClick={() => setVicMode(v => !v)}
          style={{
            height: 32, padding: '0 12px', borderRadius: 'var(--border-radius-md)',
            border: vicMode ? '1.5px solid #C9A84C' : '0.5px solid var(--color-border-secondary)',
            background: vicMode ? '#F5F0E8' : 'transparent',
            color: vicMode ? '#7A5C1E' : 'var(--color-text-secondary)',
            fontSize: 12, fontWeight: vicMode ? 500 : 400,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          <i className="ti ti-star" aria-hidden="true" style={{ fontSize: 13 }} />
          {vicMode ? 'VIC max ON' : 'VIC max'}
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {hasRoster && (
            <button
              onClick={() => { setAssignments([]); setScores([]); setVicCoverage([]); setViolations([]); setHasRoster(false); setPublished(false) }}
              style={{
                height: 32, padding: '0 12px', borderRadius: 'var(--border-radius-md)',
                border: '0.5px solid var(--color-border-secondary)',
                background: 'transparent', fontSize: 13, cursor: 'pointer',
                color: 'var(--color-text-secondary)', fontFamily: 'inherit',
              }}
            >Clear</button>
          )}
          <button
            onClick={handleGenerate}
            disabled={loading || dataLoading}
            style={{
              height: 32, padding: '0 16px', borderRadius: 'var(--border-radius-md)',
              background: '#1E2761', color: 'white', border: 'none',
              fontSize: 13, fontWeight: 500, cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: 14 }} />
            {loading ? 'Working…' : hasRoster ? 'Re-generate' : 'Generate plan'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'var(--color-background-danger)', border: '0.5px solid var(--color-border-danger)',
          borderRadius: 'var(--border-radius-md)', padding: '10px 14px',
          fontSize: 13, color: 'var(--color-text-danger)', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <i className="ti ti-alert-circle" aria-hidden="true" />
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-danger)' }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Empty state */}
      {!hasRoster && !loading && (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          color: 'var(--color-text-secondary)', fontSize: 14,
          border: '0.5px dashed var(--color-border-secondary)',
          borderRadius: 'var(--border-radius-lg)',
          background: 'var(--color-background-primary)',
        }}>
          <i className="ti ti-calendar-event" aria-hidden="true" style={{ fontSize: 36, opacity: 0.3, display: 'block', marginBottom: 12 }} />
          <div style={{ fontWeight: 500, marginBottom: 6, color: 'var(--color-text-primary)' }}>No roster generated yet</div>
          <div style={{ fontSize: 13 }}>Pick a date and click Generate plan to start</div>
        </div>
      )}

      {hasRoster && (
        <>
          {/* ── Score summary ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Overall score', value: `${overallScore}`, color: scoreColor, sub: `${overrideCount} override${overrideCount !== 1 ? 's' : ''}` },
              { label: 'VIC coverage', value: `${vicCoverage.filter(v => v.fully_covered).length}/${vicCoverage.length}`, color: vicCoverage.every(v => v.fully_covered) ? '#27500A' : '#633806', sub: 'clients covered' },
              { label: 'Staff assigned', value: String(new Set(assignments.map(a => a.staffId)).size), color: 'var(--color-text-primary)', sub: `${assignments.length} slots` },
              { label: 'Violations', value: String(violations.length), color: violations.some(v => v.severity === 'error') ? '#791F1F' : violations.length > 0 ? '#633806' : '#27500A', sub: violations.length === 0 ? 'All clear' : `${violations.filter(v => v.severity === 'error').length} errors` },
            ].map(({ label, value, color, sub }) => (
              <div key={label} style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)', padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Violations banner ── */}
          {violations.length > 0 && (
            <div style={{
              background: 'var(--color-background-warning)',
              border: '0.5px solid var(--color-border-warning)',
              borderRadius: 'var(--border-radius-md)', padding: '10px 14px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-warning)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 14 }} />
                {violations.length} constraint {violations.length === 1 ? 'issue' : 'issues'} — fix before publishing
              </div>
              {violations.map((v, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--color-text-warning)', display: 'flex', gap: 6, marginBottom: 3, alignItems: 'flex-start', lineHeight: 1.4 }}>
                  <i className={`ti ${v.severity === 'error' ? 'ti-circle-x' : 'ti-alert-circle'}`} aria-hidden="true" style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }} />
                  {v.message}
                </div>
              ))}
            </div>
          )}

          {/* ── VIC coverage strip ── */}
          {vicCoverage.length > 0 && (
            <div style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid #C9A84C',
              borderRadius: 'var(--border-radius-md)', padding: '10px 14px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7A5C1E', marginBottom: 8 }}>
                VIC client coverage
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8 }}>
                {vicCoverage.map(v => (
                  <div key={v.client_id} style={{
                    padding: '8px 10px', borderRadius: 'var(--border-radius-md)',
                    background: v.fully_covered ? '#FDFAF3' : 'var(--color-background-danger)',
                    border: `0.5px solid ${v.fully_covered ? '#C9A84C' : 'var(--color-border-danger)'}`,
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: v.fully_covered ? '#7A5C1E' : 'var(--color-text-danger)', marginBottom: 4 }}>
                      ★ {v.client_name} {v.fully_covered ? '✓' : '✗'}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(['morning', 'afternoon', 'closing'] as ShiftName[]).map(sh => {
                        const adv = (v as any)[`${sh}_advisor`] as string | undefined
                        const color = sh === 'morning' ? '#1E4D8C' : sh === 'afternoon' ? '#4A3280' : '#0F6E56'
                        const bg   = sh === 'morning' ? '#DDEAF8' : sh === 'afternoon' ? '#EAE4F8' : '#D8EEE8'
                        return (
                          <span key={sh} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: adv ? bg : '#FCEBEB', color: adv ? color : '#791F1F', fontWeight: 500 }}>
                            {sh.slice(0, 3)}: {adv ? adv.split(' ')[0] : '—'}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Per-shift score bars ── */}
          <div style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-md)', padding: '10px 14px', marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-text-secondary)', marginBottom: 10 }}>
              Per-shift scores
            </div>
            {scores.map(s => (
              <ScoreBar
                key={s.shift}
                label={`${SHIFT_META[s.shift].label} (${assignments.filter(a => a.shift === s.shift).length} staff)`}
                value={s.score}
                color={SHIFT_META[s.shift].color}
              />
            ))}
          </div>

          {/* ── Three-column shift board ── */}
          <div style={{ position: 'relative' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
              gap: 10, marginBottom: 14,
            }}>
              {SHIFTS.map(shift => (
                <ShiftColumn
                  key={shift}
                  shift={shift}
                  assignments={assignments}
                  staffMap={staffMap}
                  vicClients={vicClients}
                  score={scores.find(s => s.shift === shift) ?? null}
                  onRemove={staffId => handleRemove(shift, staffId)}
                  onAdd={() => setPickerShift(shift)}
                  onDragStart={(e, a) => handleDragStart(e, a)}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(e, shift)}
                />
              ))}
            </div>

            {/* Staff picker */}
            {pickerShift && (
              <StaffPicker
                shift={pickerShift}
                date={selectedDate}
                allStaff={allStaff}
                assignedIds={assignedInShift(pickerShift)}
                vicClients={vicClients}
                onAdd={staff => handleAdd(pickerShift, staff)}
                onClose={() => setPickerShift(null)}
              />
            )}
          </div>

          {/* ── Drag hint ── */}
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-drag-drop" aria-hidden="true" style={{ fontSize: 14 }} />
            Drag staff cards between shifts to override. Use + to add from bench. × to remove.
          </div>

          {/* ── Action row ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handlePublish}
              disabled={loading || published}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 'var(--border-radius-md)',
                background: published ? 'var(--color-background-success)' : '#1E2761',
                color: published ? 'var(--color-text-success)' : 'white',
                border: published ? '0.5px solid var(--color-border-success)' : 'none',
                fontSize: 13, fontWeight: 500, cursor: loading || published ? 'default' : 'pointer',
                opacity: loading ? 0.6 : 1, fontFamily: 'inherit',
              }}
            >
              <i className={`ti ${published ? 'ti-check' : 'ti-send'}`} aria-hidden="true" style={{ fontSize: 14 }} />
              {published ? 'Sent for review' : 'Send for review'}
            </button>

            <button
              onClick={() => weights && rescore(assignments, weights)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 'var(--border-radius-md)',
                border: '0.5px solid var(--color-border-secondary)',
                background: 'transparent', fontSize: 13, cursor: 'pointer',
                color: 'var(--color-text-primary)', fontFamily: 'inherit',
              }}
            >
              <i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 14 }} />
              Re-score
            </button>

            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 'var(--border-radius-md)',
                border: '0.5px solid var(--color-border-secondary)',
                background: 'transparent', fontSize: 13, cursor: 'pointer',
                color: 'var(--color-text-primary)', fontFamily: 'inherit',
              }}
            >
              <i className="ti ti-sparkles" aria-hidden="true" style={{ fontSize: 14 }} />
              Re-generate
            </button>

            <button
              onClick={() => window.print()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 'var(--border-radius-md)',
                border: '0.5px solid var(--color-border-secondary)',
                background: 'transparent', fontSize: 13, cursor: 'pointer',
                color: 'var(--color-text-primary)', fontFamily: 'inherit',
              }}
            >
              <i className="ti ti-printer" aria-hidden="true" style={{ fontSize: 14 }} />
              Print plan
            </button>
          </div>
        </>
      )}
    </div>
  )
}
