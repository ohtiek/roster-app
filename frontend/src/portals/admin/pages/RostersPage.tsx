import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type {
  SessionContext, RosterHistoryRow, RosterPayload, RosterStatus,
  RosterAssignment, RosterShiftScore, RosterVicCoverage,
} from '../../../lib/types'
import { supabase } from '../../../lib/supabase'
import { loadShiftOrder, loadScoringRefData, recomputeRoster, type ScoringRefData, type ShiftOrderEntry } from '../../../lib/rosterScoring'
import styles from './RostersPage.module.css'

interface Props { session: SessionContext }

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RosterStatus, string> = {
  draft: 'Draft', submitted: 'Submitted', pending_review: 'Pending review',
  approved: 'Approved', published: 'Published',
  rejected: 'Rejected', archived: 'Archived', published_amended: 'Amended',
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDatetimeShort(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function scoreColor(score: number | null) {
  if (score == null) return ''
  if (score >= 80) return styles.scoreGood
  if (score >= 60) return styles.scoreMid
  return styles.scoreLow
}

// ── Component ─────────────────────────────────────────────────────────────────

type FilterStatus = 'all' | RosterStatus

export function RostersPage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [rosters, setRosters] = useState<RosterHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  // expanded row payload
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedPayload, setExpandedPayload] = useState<RosterPayload | null>(null)
  const [payloadLoading, setPayloadLoading] = useState(false)

  // generate modal
  const [genModal, setGenModal] = useState(false)
  const [genDate, setGenDate] = useState(new Date().toISOString().slice(0, 10))
  const [genRunning, setGenRunning] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genResult, setGenResult] = useState<string | null>(null)

  // status action
  const [actionSaving, setActionSaving] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const { data, error: err } = await supabase
      .from('roster_history')
      .select('id, roster_date, status, overall_score, override_count, submit_deadline, approve_deadline, created_at')
      .eq('boutique_id', boutiqueId)
      .order('roster_date', { ascending: false })
      .limit(60)

    setLoading(false)
    if (err) { setError(err.message); return }
    setRosters(data ?? [])
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  // ── Expand row ──────────────────────────────────────────────────────────────

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); setExpandedPayload(null); return }
    setExpandedId(id); setExpandedPayload(null); setPayloadLoading(true)

    const { data } = await supabase
      .from('roster_history')
      .select('payload')
      .eq('id', id)
      .single()

    setPayloadLoading(false)
    setExpandedPayload(data?.payload ?? null)
  }, [expandedId])

  // ── Generate ─────────────────────────────────────────────────────────────────

  const generateRoster = useCallback(async () => {
    if (!boutiqueId || !genDate) return
    setGenRunning(true); setGenError(null); setGenResult(null)

    const { data, error: err } = await supabase.functions.invoke('generate-roster', {
      body: { boutique_id: boutiqueId, roster_date: genDate },
    })

    setGenRunning(false)
    if (err || data?.error) {
      let message = data?.error ?? err?.message ?? 'Generation failed'
      const context = (err as { context?: Response })?.context
      if (context) {
        try {
          const body = await context.clone().json()
          if (body?.error) message = body.error
        } catch {
          // response body wasn't JSON — fall back to the generic message
        }
      }
      setGenError(message)
      return
    }

    const score = data?.overall_score != null ? ` (score: ${Math.round(data.overall_score)})` : ''
    setGenResult(`Roster generated${score}. Reload to see the new draft.`)
    await load()
  }, [boutiqueId, genDate, load])

  // ── Status actions ──────────────────────────────────────────────────────────

  const setStatus = useCallback(async (id: string, status: RosterStatus) => {
    setActionSaving(id); setActionError(null)
    const patch: Record<string, unknown> = { status }
    if (status === 'submitted') patch.submitted_at = new Date().toISOString()
    if (status === 'draft') patch.submitted_at = null   // withdraw: no longer submitted

    const { data, error: err } = await supabase
      .from('roster_history').update(patch).eq('id', id).select('id')

    setActionSaving(null)
    if (err) {
      setActionError(err.message)
      return
    }
    if (!data || data.length === 0) {
      setActionError('Update did not apply — you may not have permission to change this roster.')
      return
    }
    await load()
  }, [load])

  // ── Filtered list ───────────────────────────────────────────────────────────

  const visible = filterStatus === 'all'
    ? rosters
    : rosters.filter(r => r.status === filterStatus)

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!boutiqueId) return (
    <div><PageHeader title="Rosters" subtitle="Review and generate rosters" />
      <p className={styles.statusMsg}>No boutique selected.</p></div>
  )

  return (
    <div className={styles.page}>
      <PageHeader title="Rosters" subtitle="Generate drafts, review assignments, and submit for approval" />

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {(['all', 'draft', 'submitted', 'approved', 'published', 'rejected'] as FilterStatus[]).map(s => (
            <button
              key={s}
              className={`${styles.filterPill} ${filterStatus === s ? styles.active : ''}`}
              onClick={() => setFilterStatus(s)}
            >
              {s === 'all' ? 'All' : STATUS_LABEL[s as RosterStatus]}
              {s !== 'all' && (
                <span className={styles.filterCount}>
                  {rosters.filter(r => r.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={() => { setGenModal(true); setGenError(null); setGenResult(null) }}>
          Generate roster
        </Button>
      </div>

      {/* ── Table ── */}
      {loading && <p className={styles.statusMsg}>Loading…</p>}
      {error && <p className={styles.errorMsg}>{error}</p>}
      {actionError && <p className={styles.errorMsg}>{actionError}</p>}

      {!loading && !error && (
        <>
          {visible.length === 0 ? (
            <p className={styles.statusMsg}>
              {filterStatus === 'all' ? 'No rosters yet. Click "Generate roster" to create one.' : `No ${STATUS_LABEL[filterStatus as RosterStatus].toLowerCase()} rosters.`}
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th></th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Overrides</th>
                    <th>Submit by</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(roster => {
                    const isExp = expandedId === roster.id
                    const saving = actionSaving === roster.id
                    return (
                      <>
                        <tr key={roster.id} className={`${styles.row} ${isExp ? styles.rowExpanded : ''}`}>
                          <td className={styles.expandCell}>
                            <button className={styles.expandBtn} onClick={() => toggleExpand(roster.id)} aria-expanded={isExp}>
                              <span className={`${styles.chevron} ${isExp ? styles.open : ''}`}>›</span>
                            </button>
                          </td>
                          <td className={styles.dateCell}>{fmtDate(roster.roster_date)}</td>
                          <td>
                            <span className={`${styles.statusBadge} ${styles[roster.status]}`}>
                              {STATUS_LABEL[roster.status]}
                            </span>
                          </td>
                          <td>
                            {roster.overall_score != null
                              ? <span className={`${styles.score} ${scoreColor(roster.overall_score)}`}>
                                  {Math.round(roster.overall_score)}
                                </span>
                              : <span className={styles.muted}>—</span>}
                          </td>
                          <td className={styles.muted}>
                            {roster.override_count > 0
                              ? <span className={styles.overrideCount}>{roster.override_count}</span>
                              : '—'}
                          </td>
                          <td className={styles.muted}>
                            {roster.submit_deadline ? fmtDatetimeShort(roster.submit_deadline) : '—'}
                          </td>
                          <td>
                            <div className={styles.actionGroup}>
                              {roster.status === 'draft' && (
                                <Button variant="secondary" size="sm" loading={saving}
                                  onClick={() => setStatus(roster.id, 'submitted')}>
                                  Submit
                                </Button>
                              )}
                              {roster.status === 'submitted' && (
                                <Button variant="ghost" size="sm" loading={saving}
                                  onClick={() => setStatus(roster.id, 'draft')}>
                                  Withdraw
                                </Button>
                              )}
                              {roster.status === 'submitted' && session.isRegionalAdmin && (
                                <>
                                  <Button variant="primary" size="sm" loading={saving}
                                    onClick={() => setStatus(roster.id, 'approved')}>Approve</Button>
                                  <Button variant="danger" size="sm" loading={saving}
                                    onClick={() => setStatus(roster.id, 'rejected')}>Reject</Button>
                                </>
                              )}
                              {roster.status === 'approved' && session.isRegionalAdmin && (
                                <Button variant="primary" size="sm" loading={saving}
                                  onClick={() => setStatus(roster.id, 'published')}>Publish</Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* ── Expanded detail row ── */}
                        {isExp && (
                          <tr key={`${roster.id}-detail`} className={styles.detailRow}>
                            <td colSpan={7}>
                              <div className={styles.detailPanel}>
                                {payloadLoading && <p className={styles.loadingSmall}>Loading…</p>}
                                {!payloadLoading && !expandedPayload && (
                                  <p className={styles.loadingSmall}>No roster data stored.</p>
                                )}
                                {!payloadLoading && expandedPayload && (
                                  <RosterDetail
                                    payload={expandedPayload}
                                    rosterId={roster.id}
                                    boutiqueId={boutiqueId}
                                    canEdit={roster.status === 'draft'}
                                    onSaved={load}
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.count}>{visible.length} roster{visible.length !== 1 ? 's' : ''}</p>
        </>
      )}

      {/* ── Generate modal ── */}
      {genModal && (
        <Modal
          title="Generate roster"
          onClose={() => setGenModal(false)}
          maxWidth={400}
          footer={
            !genResult ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setGenModal(false)}>Cancel</Button>
                <Button variant="primary" size="sm" loading={genRunning} onClick={generateRoster}>
                  Generate
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setGenModal(false)}>Close</Button>
            )
          }
        >
          {!genResult ? (
            <div className={styles.genForm}>
              <label className={styles.formLabel}>Roster date</label>
              <input type="date" className={styles.dateInput} value={genDate}
                onChange={e => setGenDate(e.target.value)} />
              <p className={styles.genHint}>
                The engine will load active shifts, staff, leave data, and rules for this date.
                A draft roster will be saved to the roster history.
              </p>
              {genError && <p className={styles.genError}>{genError}</p>}
            </div>
          ) : (
            <div className={styles.genSuccess}>
              <span className={styles.successIcon}>✓</span>
              <p>{genResult}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

// ── Roster detail component ───────────────────────────────────────────────────

const RULE_LABEL: Record<string, string> = {
  max_hours_per_day: 'Max hours/day', weekly_hours_cap: 'Weekly hours cap',
  min_rest_hours: 'Min rest hours', max_consecutive_shifts: 'Max consecutive shifts',
  certification_expiry: 'Certification expiry', vic_coverage: 'VIC coverage',
  gender_balance: 'Gender balance', day_of_week_availability: 'Day availability',
}

interface RosterDetailProps {
  payload: RosterPayload
  rosterId: string
  boutiqueId: string
  canEdit: boolean
  onSaved: () => void
}

function RosterDetail({ payload, rosterId, boutiqueId, canEdit, onSaved }: RosterDetailProps) {
  const hoursWarnings = payload.hours_warnings ?? []
  const fatigueFlags = payload.fatigue_flags ?? []

  // ── Editable working copy ────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [assignments, setAssignments] = useState<RosterAssignment[]>(payload.assignments ?? [])
  const [shiftScores, setShiftScores] = useState<RosterShiftScore[]>(payload.shift_scores ?? [])
  const [overallScoreState, setOverallScoreState] = useState(payload.overall_score)
  const [vicCoverage, setVicCoverage] = useState<RosterVicCoverage[]>(payload.vic_coverage ?? [])

  const [refData, setRefData] = useState<ScoringRefData | null>(null)
  const [shiftOrder, setShiftOrder] = useState<ShiftOrderEntry[]>([])
  const [refLoading, setRefLoading] = useState(false)
  const [refError, setRefError] = useState<string | null>(null)

  const [addingToShift, setAddingToShift] = useState<string | null>(null)
  const [addSelection, setAddSelection] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const unmet = shiftScores.flatMap(s => s.unmet_requirements ?? []).length
  const totalFlags = hoursWarnings.length + fatigueFlags.length

  const assignmentsByShift = new Map<string, RosterAssignment[]>()
  for (const a of assignments) {
    if (!assignmentsByShift.has(a.shift_id)) assignmentsByShift.set(a.shift_id, [])
    assignmentsByShift.get(a.shift_id)!.push(a)
  }

  async function startEditing() {
    if (refData) { setEditing(true); return }
    setRefLoading(true); setRefError(null)
    try {
      const shiftIds = (payload.shift_scores ?? []).map(s => s.shift_id)
      const [order, ref] = await Promise.all([
        loadShiftOrder(shiftIds),
        loadScoringRefData(boutiqueId, shiftIds),
      ])
      setShiftOrder(order)
      setRefData(ref)
      setEditing(true)
    } catch (e) {
      setRefError(e instanceof Error ? e.message : 'Failed to load staff reference data')
    }
    setRefLoading(false)
  }

  function applyAssignments(next: RosterAssignment[]) {
    setAssignments(next)
    if (!refData || !shiftOrder.length) return
    const result = recomputeRoster(next, shiftOrder, refData)
    setShiftScores(result.shiftScores)
    setOverallScoreState(result.overallScore)
    setVicCoverage(result.vicCoverage)
  }

  function addStaff(shiftId: string) {
    if (!addSelection || !refData) return
    const staff = refData.staffById.get(addSelection)
    const shift = shiftOrder.find(s => s.shift_id === shiftId)
    if (!staff || !shift) return
    applyAssignments([...assignments, {
      shift_id: shiftId,
      shift_name: shift.shift_name,
      staff_id: staff.id,
      staff_name: staff.name,
      is_vic_active: refData.vicClients.some(vc => vc.advisor_staff_ids.includes(staff.id)),
      shift_duration_hours: shift.duration_hours,
    }])
    setAddingToShift(null); setAddSelection('')
  }

  function removeStaff(shiftId: string, staffId: string) {
    applyAssignments(assignments.filter(a => !(a.shift_id === shiftId && a.staff_id === staffId)))
  }

  function cancelEditing() {
    setAssignments(payload.assignments ?? [])
    setShiftScores(payload.shift_scores ?? [])
    setOverallScoreState(payload.overall_score)
    setVicCoverage(payload.vic_coverage ?? [])
    setEditing(false); setSaveError(null)
  }

  async function saveEdits() {
    setSaving(true); setSaveError(null)

    const { data: existing } = await supabase
      .from('roster_history').select('override_ids').eq('id', rosterId).single()

    const originalStaffIds = new Set((payload.assignments ?? []).map(a => a.staff_id))
    const currentStaffIds = new Set(assignments.map(a => a.staff_id))
    const touched = new Set<string>()
    for (const id of originalStaffIds) if (!currentStaffIds.has(id)) touched.add(id)
    for (const id of currentStaffIds) if (!originalStaffIds.has(id)) touched.add(id)
    const overrideIds = Array.from(new Set([...(existing?.override_ids ?? []), ...touched]))

    const newPayload: RosterPayload = {
      ...payload,
      assignments,
      shift_scores: shiftScores,
      overall_score: overallScoreState,
      vic_coverage: vicCoverage,
    }

    const { data, error: err } = await supabase
      .from('roster_history')
      .update({
        payload: newPayload,
        overall_score: overallScoreState,
        override_count: overrideIds.length,
        override_ids: overrideIds,
      })
      .eq('id', rosterId)
      .select('id')

    setSaving(false)
    if (err) { setSaveError(err.message); return }
    if (!data || data.length === 0) {
      setSaveError('Save did not apply — you may not have permission to change this roster.')
      return
    }
    setEditing(false)
    onSaved()
  }

  return (
    <div className={styles.detail}>
      <div className={styles.detailMeta}>
        <span className={styles.metaItem}>Score: <strong>{Math.round(overallScoreState)}</strong></span>
        {canEdit && (
          <span className={styles.editActions}>
            {!editing ? (
              <Button variant="secondary" size="sm" loading={refLoading} onClick={startEditing}>
                &#x270E; Edit assignments
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEditing}>Cancel</Button>
                <Button variant="primary" size="sm" loading={saving} onClick={saveEdits}>Save changes</Button>
              </>
            )}
          </span>
        )}
        {unmet > 0 && <span className={`${styles.metaItem} ${styles.warn}`}>{unmet} unmet requirement{unmet !== 1 ? 's' : ''}</span>}
        {totalFlags > 0 && <span className={`${styles.metaItem} ${styles.warn}`}>{totalFlags} rule flag{totalFlags !== 1 ? 's' : ''}</span>}
        <span className={styles.metaItem} style={{ marginLeft: 'auto', color: 'var(--dash-muted)' }}>
          Generated {new Date(payload.generated_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {refError && <p className={styles.errorMsg} style={{ padding: 0 }}>{refError}</p>}
      {saveError && <p className={styles.errorMsg} style={{ padding: 0 }}>{saveError}</p>}
      {editing && (
        <p className={styles.editHint}>
          Editing assignments recalculates the score live. Fatigue/hours-limit flags below still reflect the last
          full generation — regenerate to re-check them against your changes.
        </p>
      )}

      {/* ── Staff mix by shift ── */}
      <div className={styles.shiftGrid}>
        {shiftScores.map(shift => {
          const assigned = assignmentsByShift.get(shift.shift_id) ?? []
          const pctFemale = Math.round(shift.gender_pct_female * 100)
          return (
            <div key={shift.shift_id} className={styles.shiftBlock}>
              <div className={styles.shiftBlockHeader}>
                <span className={styles.shiftBlockName}>{shift.shift_name}</span>
                {payload.target_headcount_per_shift != null && (
                  <span className={`${styles.headcount} ${(shift.headcount ?? 0) < payload.target_headcount_per_shift ? styles.warn : ''}`}>
                    {shift.headcount ?? assigned.length}/{payload.target_headcount_per_shift}
                  </span>
                )}
              </div>

              <div className={styles.assignList}>
                {assigned.length === 0
                  ? <span className={styles.noAssign}>No staff assigned</span>
                  : assigned.map(a => (
                      <span key={a.staff_id} className={styles.assignChip}>
                        <span className={styles.assignName}>{a.staff_name}</span>
                        {a.is_vic_active && <span className={styles.vicBadge}>VIC</span>}
                        {editing && (
                          <button
                            className={styles.removeStaffBtn}
                            onClick={() => removeStaff(shift.shift_id, a.staff_id)}
                            aria-label={`Remove ${a.staff_name}`}
                          >
                            &#x2715;
                          </button>
                        )}
                      </span>
                    ))}
              </div>

              {editing && refData && (
                addingToShift === shift.shift_id ? (
                  <div className={styles.addStaffRow}>
                    <select
                      className={styles.addStaffSelect}
                      value={addSelection}
                      onChange={e => setAddSelection(e.target.value)}
                    >
                      <option value="">— select staff —</option>
                      {refData.allStaff
                        .filter(s => !assigned.some(a => a.staff_id === s.id))
                        .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <Button variant="primary" size="sm" disabled={!addSelection}
                      onClick={() => addStaff(shift.shift_id)}>Add</Button>
                    <Button variant="ghost" size="sm"
                      onClick={() => { setAddingToShift(null); setAddSelection('') }}>Cancel</Button>
                  </div>
                ) : (
                  <button className={styles.addStaffTrigger} onClick={() => setAddingToShift(shift.shift_id)}>
                    + Add staff
                  </button>
                )
              )}

              {/* Staff mix analysis */}
              <div className={styles.mixRow}>
                <span className={`${styles.mixChip} ${shift.skill_ok ? styles.mixOk : styles.mixBad}`}>
                  Skill {shift.skill_ok ? '✓' : '✗'}
                </span>
                <span className={`${styles.mixChip} ${shift.seniority_ok ? styles.mixOk : styles.mixBad}`}>
                  Senior {shift.seniority_ok ? '✓' : '✗'}
                </span>
                {vicCoverage.length > 0 && (
                  <span className={`${styles.mixChip} ${shift.vic_ok ? styles.mixOk : styles.mixBad}`}>
                    VIC {shift.vic_ok ? '✓' : '✗'}
                  </span>
                )}
                <span className={styles.mixChip}>{pctFemale}% F / {100 - pctFemale}% M</span>
              </div>
              {(shift.languages ?? []).length > 0 && (
                <div className={styles.langRow}>Languages: {shift.languages.join(', ')}</div>
              )}

              {(shift.unmet_requirements ?? []).length > 0 && (
                <div className={styles.unmetList}>
                  {shift.unmet_requirements.map((u, i) => (
                    <span key={i} className={styles.unmetChip}>
                      {u.skill_name}: need {u.min_count}, have {u.assigned}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Rule flag analysis ── */}
      {totalFlags > 0 && (
        <div className={styles.flagsSection}>
          <h4 className={styles.flagsTitle}>Rule flags</h4>
          <div className={styles.flagsList}>
            {fatigueFlags.map((f, i) => (
              <div key={`fatigue-${i}`} className={styles.flagRow}>
                <span className={`${styles.flagSeverity} ${f.level === 'blocked' ? styles.flagHard : styles.flagWarn}`}>
                  {f.level === 'blocked' ? 'Blocked' : 'Caution'}
                </span>
                <span className={styles.flagRule}>{RULE_LABEL[f.rule_key] ?? f.rule_key}</span>
                <span className={styles.flagStaff}>{f.staff_name}</span>
                <span className={styles.flagDetail}>{f.note}</span>
              </div>
            ))}
            {hoursWarnings.map((w, i) => (
              <div key={`hours-${i}`} className={styles.flagRow}>
                <span className={`${styles.flagSeverity} ${w.severity === 'hard_block' ? styles.flagHard : styles.flagWarn}`}>
                  {w.severity === 'hard_block' ? 'Blocked' : 'Warning'}
                </span>
                <span className={styles.flagRule}>{RULE_LABEL[w.rule_key] ?? w.rule_key}</span>
                <span className={styles.flagStaff}>{w.staff_name}</span>
                <span className={styles.flagDetail}>
                  {w.type === 'daily'
                    ? `${w.assigned_hours_today}h assigned today (limit ${w.daily_limit}h)`
                    : `${w.weekly_hours_projected}h projected this week (cap ${w.weekly_cap}h)`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── VIC coverage ── */}
      {vicCoverage.length > 0 && (
        <div className={styles.flagsSection}>
          <h4 className={styles.flagsTitle}>VIC coverage</h4>
          <div className={styles.vicList}>
            {vicCoverage.map(vc => (
              <span key={vc.client_id} className={`${styles.vicChip} ${vc.fully_covered ? styles.vicOk : styles.vicBad}`}>
                {vc.client_name} — {Object.keys(vc.shifts_covered).length}/{shiftScores.length} shifts
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
