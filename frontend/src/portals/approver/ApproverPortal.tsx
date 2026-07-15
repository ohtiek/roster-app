import { useState, useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { RosterDetail } from '../admin/pages/RostersPage'
import type { SessionContext, RosterHistoryRow, RosterPayload, RosterStatus } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { friendlyRosterUpdateError } from '../../lib/rosterErrors'
import styles from './ApproverPortal.module.css'

interface Props { session: SessionContext }

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

// ── Shared roster table (used by both Inbox and History) ───────────────────────

interface RosterTableProps {
  session: SessionContext
  statuses: RosterStatus[]
  emptyMessage: string
  showActions: boolean
}

function RosterTable({ session, statuses, emptyMessage, showActions }: RosterTableProps) {
  const boutiqueId = session.activeBoutiqueId

  const [rosters, setRosters] = useState<RosterHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedPayload, setExpandedPayload] = useState<RosterPayload | null>(null)
  const [payloadLoading, setPayloadLoading] = useState(false)

  const [actionSaving, setActionSaving] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [rejectTarget, setRejectTarget] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const { data, error: err } = await supabase
      .from('roster_history')
      .select('id, roster_date, status, overall_score, override_count, submit_deadline, approve_deadline, submitted_at, created_at')
      .eq('boutique_id', boutiqueId)
      .in('status', statuses)
      .order('roster_date', { ascending: false })
      .limit(60)

    setLoading(false)
    if (err) { setError(err.message); return }
    setRosters(data ?? [])
  }, [boutiqueId, statuses.join(',')])

  useEffect(() => { load() }, [load])

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); setExpandedPayload(null); return }
    setExpandedId(id); setExpandedPayload(null); setPayloadLoading(true)

    const { data } = await supabase.from('roster_history').select('payload').eq('id', id).single()

    setPayloadLoading(false)
    setExpandedPayload(data?.payload ?? null)
  }, [expandedId])

  const setStatus = useCallback(async (id: string, status: RosterStatus, notes?: string) => {
    setActionSaving(id); setActionError(null)
    const patch: Record<string, unknown> = { status }
    if (notes != null) patch.notes = notes

    const { data, error: err } = await supabase
      .from('roster_history').update(patch).eq('id', id).select('id')

    setActionSaving(null)
    if (err) { setActionError(friendlyRosterUpdateError(err)); return }
    if (!data || data.length === 0) {
      setActionError('Update did not apply — you may not have permission to change this roster.')
      return
    }
    await load()
  }, [load])

  const submitReject = useCallback(async () => {
    if (!rejectTarget) return
    await setStatus(rejectTarget, 'rejected', rejectNote.trim() || undefined)
    setRejectTarget(null); setRejectNote('')
  }, [rejectTarget, rejectNote, setStatus])

  if (!boutiqueId) return <p className={styles.statusMsg}>No boutique selected.</p>

  return (
    <div className={styles.page}>
      {loading && <p className={styles.statusMsg}>Loading…</p>}
      {error && <p className={styles.errorMsg}>{error}</p>}
      {actionError && <p className={styles.errorMsg}>{actionError}</p>}

      {!loading && !error && (
        <>
          {rosters.length === 0 ? (
            <p className={styles.statusMsg}>{emptyMessage}</p>
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
                    <th>Submitted</th>
                    {showActions && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rosters.map(roster => {
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
                            {roster.submitted_at ? fmtDatetimeShort(roster.submitted_at) : '—'}
                          </td>
                          {showActions && (
                            <td>
                              <div className={styles.actionGroup}>
                                {(roster.status === 'submitted' || roster.status === 'pending_review') && (
                                  <>
                                    <Button variant="primary" size="sm" loading={saving}
                                      onClick={() => setStatus(roster.id, 'approved')}>Approve</Button>
                                    <Button variant="danger" size="sm" loading={saving}
                                      onClick={() => { setRejectTarget(roster.id); setRejectNote('') }}>Reject</Button>
                                  </>
                                )}
                                {roster.status === 'approved' && (
                                  <>
                                    <Button variant="primary" size="sm" loading={saving}
                                      onClick={() => setStatus(roster.id, 'published')}>Publish</Button>
                                    <Button variant="danger" size="sm" loading={saving}
                                      onClick={() => { setRejectTarget(roster.id); setRejectNote('') }}>Reject</Button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>

                        {isExp && (
                          <tr key={`${roster.id}-detail`} className={styles.detailRow}>
                            <td colSpan={showActions ? 7 : 6}>
                              <div className={styles.detailPanel}>
                                {payloadLoading && <p className={styles.loadingSmall}>Loading…</p>}
                                {!payloadLoading && !expandedPayload && (
                                  <p className={styles.loadingSmall}>No roster data stored.</p>
                                )}
                                {!payloadLoading && expandedPayload && boutiqueId && (
                                  <RosterDetail
                                    payload={expandedPayload}
                                    rosterId={roster.id}
                                    boutiqueId={boutiqueId}
                                    canEdit={false}
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
          <p className={styles.count}>{rosters.length} roster{rosters.length !== 1 ? 's' : ''}</p>
        </>
      )}

      {rejectTarget && (
        <Modal
          title="Reject roster"
          onClose={() => setRejectTarget(null)}
          maxWidth={440}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button variant="danger" size="sm" loading={actionSaving === rejectTarget} onClick={submitReject}>
                Reject roster
              </Button>
            </>
          }
        >
          <div className={styles.rejectForm}>
            <label className={styles.formLabel}>Reason (optional)</label>
            <textarea
              className={styles.textarea}
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="Let the admin know what needs to change before resubmitting…"
            />
            <p className={styles.formHint}>The admin can withdraw and resubmit once this is addressed.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Pages ────────────────────────────────────────────────────────────────────

function ApprovalInbox({ session }: Props) {
  return (
    <div>
      <PageHeader title="Approval Inbox" subtitle="Rosters submitted for your review" />
      <RosterTable
        session={session}
        statuses={['submitted', 'pending_review', 'approved']}
        emptyMessage="Nothing waiting on you right now."
        showActions
      />
    </div>
  )
}

function ApprovalHistory({ session }: Props) {
  return (
    <div>
      <PageHeader title="Approval History" subtitle="All rejected, published and archived rosters" />
      <RosterTable
        session={session}
        statuses={['rejected', 'published', 'archived', 'published_amended']}
        emptyMessage="No decided rosters yet."
        showActions={false}
      />
    </div>
  )
}

export function ApproverPortal({ session }: Props) {
  return (
    <Routes>
      <Route index element={<ApprovalInbox session={session} />} />
      <Route path="history" element={<ApprovalHistory session={session} />} />
    </Routes>
  )
}
