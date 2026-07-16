import { useState, useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/Button'
import { RosterDetail } from '../admin/pages/RostersPage'
import type { SessionContext, RosterHistoryRow, RosterPayload } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { rosterToCsv, downloadCsv, printRoster } from '../../lib/rosterExport'
import styles from './ReaderPortal.module.css'

interface Props { session: SessionContext }

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function scoreColor(score: number | null) {
  if (score == null) return ''
  if (score >= 80) return styles.scoreGood
  if (score >= 60) return styles.scoreMid
  return styles.scoreLow
}

// Fetches the full payload on demand (export needs it even for a collapsed
// row, so this is shared by both the expand toggle and the export buttons).
async function fetchPayload(id: string): Promise<RosterPayload | null> {
  const { data } = await supabase.from('roster_history').select('payload').eq('id', id).single()
  return data?.payload ?? null
}

function PublishedRosters({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId
  const boutiqueName = session.availableBoutiques.find(b => b.id === boutiqueId)?.name ?? 'Boutique'

  const [rosters, setRosters] = useState<RosterHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedPayload, setExpandedPayload] = useState<RosterPayload | null>(null)
  const [payloadLoading, setPayloadLoading] = useState(false)

  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const { data, error: err } = await supabase
      .from('roster_history')
      .select('id, roster_date, status, overall_score, override_count, submit_deadline, approve_deadline, submitted_at, created_at')
      .eq('boutique_id', boutiqueId)
      .eq('status', 'published')
      .order('roster_date', { ascending: false })
      .limit(60)

    setLoading(false)
    if (err) { setError(err.message); return }
    setRosters(data ?? [])
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); setExpandedPayload(null); return }
    setExpandedId(id); setExpandedPayload(null); setPayloadLoading(true)
    setExpandedPayload(await fetchPayload(id))
    setPayloadLoading(false)
  }, [expandedId])

  const exportCsv = useCallback(async (roster: RosterHistoryRow) => {
    setExportingId(roster.id); setExportError(null)
    const payload = expandedId === roster.id ? expandedPayload : await fetchPayload(roster.id)
    setExportingId(null)
    if (!payload) { setExportError('No roster data stored for this date.'); return }
    downloadCsv(`roster-${boutiqueName.replace(/\s+/g, '-').toLowerCase()}-${roster.roster_date}.csv`,
      rosterToCsv(payload, roster.roster_date, boutiqueName))
  }, [expandedId, expandedPayload, boutiqueName])

  const exportPdf = useCallback(async (roster: RosterHistoryRow) => {
    setExportingId(roster.id); setExportError(null)
    const payload = expandedId === roster.id ? expandedPayload : await fetchPayload(roster.id)
    setExportingId(null)
    if (!payload) { setExportError('No roster data stored for this date.'); return }
    printRoster(payload, roster.roster_date, boutiqueName)
  }, [expandedId, expandedPayload, boutiqueName])

  if (!boutiqueId) return (
    <div>
      <PageHeader title="Published Rosters" subtitle="Browse published rosters for your boutique" />
      <p className={styles.statusMsg}>No boutique selected.</p>
    </div>
  )

  return (
    <div>
      <PageHeader title="Published Rosters" subtitle="Browse published rosters for your boutique" />
      <div className={styles.page}>
        {loading && <p className={styles.statusMsg}>Loading…</p>}
        {error && <p className={styles.errorMsg}>{error}</p>}
        {exportError && <p className={styles.errorMsg}>{exportError}</p>}

        {!loading && !error && (
          <>
            {rosters.length === 0 ? (
              <p className={styles.statusMsg}>No published rosters yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Date</th>
                      <th>Score</th>
                      <th>Overrides</th>
                      <th>Export</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rosters.map(roster => {
                      const isExp = expandedId === roster.id
                      const exporting = exportingId === roster.id
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
                            <td>
                              <div className={styles.actionGroup}>
                                <Button variant="secondary" size="sm" loading={exporting} onClick={() => exportCsv(roster)}>
                                  CSV
                                </Button>
                                <Button variant="secondary" size="sm" loading={exporting} onClick={() => exportPdf(roster)}>
                                  PDF
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {isExp && (
                            <tr key={`${roster.id}-detail`} className={styles.detailRow}>
                              <td colSpan={5}>
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
            <p className={styles.count}>{rosters.length} published roster{rosters.length !== 1 ? 's' : ''}</p>
          </>
        )}
      </div>
    </div>
  )
}

export function ReaderPortal({ session }: Props) {
  return (
    <Routes>
      <Route index element={<PublishedRosters session={session} />} />
    </Routes>
  )
}
