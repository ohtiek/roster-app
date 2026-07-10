import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type { SessionContext, StaffLeaveRow, LeaveType, LeaveSource } from '../../../lib/types'
import { supabase } from '../../../lib/supabase'
import styles from './LeavePage.module.css'

interface Props { session: SessionContext }

const LEAVE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual', sick: 'Sick', toil: 'TOIL',
  parental: 'Parental', public_holiday: 'Public holiday',
  unpaid: 'Unpaid', other: 'Other',
}

const SOURCE_LABEL: Record<LeaveSource, string> = {
  leave_system: 'HR system', ad_hoc: 'Ad-hoc', manual: 'Manual',
}

function fmtDateRange(starts: string, ends: string) {
  const s = new Date(starts)
  const e = new Date(ends)
  const sd = s.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  const ed = e.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  if (sd === ed) {
    const st = s.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
    const et = e.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
    return `${sd}, ${st} – ${et}`
  }
  return `${sd} – ${ed}`
}

interface LeaveForm {
  staff_id: string
  starts_at: string
  ends_at: string
  leave_type: LeaveType
  reason: string
}

function blankLeave(): LeaveForm {
  const today = new Date().toISOString().slice(0, 10)
  return { staff_id: '', starts_at: today, ends_at: today, leave_type: 'annual', reason: '' }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LeavePage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [rows, setRows] = useState<StaffLeaveRow[]>([])
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [filterStaff, setFilterStaff] = useState('')
  const [filterType, setFilterType] = useState<LeaveType | ''>('')
  const [filterSource, setFilterSource] = useState<LeaveSource | ''>('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  // add leave modal
  const [leaveModal, setLeaveModal] = useState(false)
  const [leaveForm, setLeaveForm] = useState<LeaveForm>(blankLeave())
  const [leaveSaving, setLeaveSaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  // bulk holiday modal
  const [holidayModal, setHolidayModal] = useState(false)
  const [holidayDate, setHolidayDate] = useState(new Date().toISOString().slice(0, 10))
  const [holidayReason, setHolidayReason] = useState('')
  const [holidaySaving, setHolidaySaving] = useState(false)
  const [holidayError, setHolidayError] = useState<string | null>(null)
  const [holidayResult, setHolidayResult] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const { data: sbRows } = await supabase
      .from('staff_boutiques').select('staff_id').eq('boutique_id', boutiqueId)
    const staffIds = sbRows?.map(r => r.staff_id) ?? []

    if (!staffIds.length) {
      setRows([]); setStaff([]); setLoading(false); return
    }

    const [staffRes, leaveRes] = await Promise.all([
      supabase.from('staff').select('id, name').in('id', staffIds).order('name'),
      supabase.from('staff_unavailability')
        .select('id, staff_id, starts_at, ends_at, source, source_ref, leave_type, reason, created_at, staff:staff_id(name)')
        .in('staff_id', staffIds)
        .order('starts_at', { ascending: false })
        .limit(200),
    ])

    if (leaveRes.error) { setError(leaveRes.error.message); setLoading(false); return }

    setStaff(staffRes.data ?? [])
    const mapped: StaffLeaveRow[] = (leaveRes.data ?? []).map(r => ({
      id: r.id,
      staff_id: r.staff_id,
      staff_name: (r.staff as any)?.name ?? 'Unknown',
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      source: r.source,
      source_ref: r.source_ref,
      leave_type: r.leave_type,
      reason: r.reason,
      created_at: r.created_at,
    }))
    setRows(mapped)
    setLoading(false)
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  // ── Filtered rows ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterStaff && r.staff_id !== filterStaff) return false
      if (filterType && r.leave_type !== filterType) return false
      if (filterSource && r.source !== filterSource) return false
      if (filterFrom && r.starts_at.slice(0, 10) < filterFrom) return false
      if (filterTo && r.ends_at.slice(0, 10) > filterTo) return false
      return true
    })
  }, [rows, filterStaff, filterType, filterSource, filterFrom, filterTo])

  // ── Add leave ────────────────────────────────────────────────────────────────

  const openAddLeave = () => { setLeaveForm(blankLeave()); setLeaveError(null); setLeaveModal(true) }

  const saveLeave = useCallback(async () => {
    if (!leaveForm.staff_id) { setLeaveError('Staff member is required.'); return }
    if (!leaveForm.starts_at || !leaveForm.ends_at) { setLeaveError('Start and end dates are required.'); return }
    if (leaveForm.starts_at > leaveForm.ends_at) { setLeaveError('End date must be on or after start date.'); return }
    setLeaveSaving(true); setLeaveError(null)

    const { error } = await supabase.from('staff_unavailability').insert({
      staff_id: leaveForm.staff_id,
      starts_at: leaveForm.starts_at + 'T00:00:00',
      ends_at: leaveForm.ends_at + 'T23:59:59',
      source: 'ad_hoc' as LeaveSource,
      leave_type: leaveForm.leave_type,
      reason: leaveForm.reason.trim() || null,
    })

    setLeaveSaving(false)
    if (error) { setLeaveError(error.message); return }
    setLeaveModal(false); await load()
  }, [leaveForm, load])

  // ── Bulk public holiday ──────────────────────────────────────────────────────

  const openHolidayModal = () => {
    setHolidayDate(new Date().toISOString().slice(0, 10))
    setHolidayReason('')
    setHolidayError(null); setHolidayResult(null); setHolidayModal(true)
  }

  const saveBulkHoliday = useCallback(async () => {
    if (!boutiqueId || !holidayDate) { setHolidayError('Date is required.'); return }
    setHolidaySaving(true); setHolidayError(null)

    const { data: sbRows } = await supabase
      .from('staff_boutiques').select('staff_id').eq('boutique_id', boutiqueId)
    const staffIds = sbRows?.map(r => r.staff_id) ?? []

    if (!staffIds.length) {
      setHolidaySaving(false); setHolidayError('No staff found in this boutique.'); return
    }

    const records = staffIds.map(sid => ({
      staff_id: sid,
      starts_at: holidayDate + 'T00:00:00',
      ends_at: holidayDate + 'T23:59:59',
      source: 'manual' as LeaveSource,
      leave_type: 'public_holiday' as LeaveType,
      reason: holidayReason.trim() || null,
    }))

    const { error } = await supabase.from('staff_unavailability').insert(records)
    setHolidaySaving(false)
    if (error) { setHolidayError(error.message); return }
    setHolidayResult(`Public holiday added for ${staffIds.length} staff member${staffIds.length !== 1 ? 's' : ''}.`)
    await load()
  }, [boutiqueId, holidayDate, holidayReason, load])

  // ── Delete ────────────────────────────────────────────────────────────────────

  const deleteRow = useCallback(async (row: StaffLeaveRow) => {
    if (row.source === 'leave_system') return
    setDeletingId(row.id)
    await supabase.from('staff_unavailability').delete().eq('id', row.id)
    setDeletingId(null)
    await load()
  }, [load])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!boutiqueId) return (
    <div><PageHeader title="Leave" subtitle="Staff unavailability and leave records" />
      <p className={styles.statusMsg}>No boutique selected.</p></div>
  )

  const hasFilters = !!(filterStaff || filterType || filterSource || filterFrom || filterTo)

  return (
    <div className={styles.page}>
      <PageHeader title="Leave" subtitle="Staff unavailability, ad-hoc leave and public holidays" />

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <select className={styles.filterSelect} value={filterStaff}
            onChange={e => setFilterStaff(e.target.value)}>
            <option value="">All staff</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={styles.filterSelect} value={filterType}
            onChange={e => setFilterType(e.target.value as LeaveType | '')}>
            <option value="">All types</option>
            {(Object.entries(LEAVE_LABEL) as [LeaveType, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className={styles.filterSelect} value={filterSource}
            onChange={e => setFilterSource(e.target.value as LeaveSource | '')}>
            <option value="">All sources</option>
            {(Object.entries(SOURCE_LABEL) as [LeaveSource, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input type="date" className={styles.filterDate} value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)} title="From date" />
          <span className={styles.dateSep}>–</span>
          <input type="date" className={styles.filterDate} value={filterTo}
            onChange={e => setFilterTo(e.target.value)} title="To date" />
          {hasFilters && (
            <button className={styles.clearBtn}
              onClick={() => { setFilterStaff(''); setFilterType(''); setFilterSource(''); setFilterFrom(''); setFilterTo('') }}>
              Clear
            </button>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <Button variant="secondary" size="sm" onClick={openHolidayModal}>Public holiday</Button>
          <Button variant="primary" size="sm" onClick={openAddLeave}>+ Add leave</Button>
        </div>
      </div>

      {/* ── Table ── */}
      {loading && <p className={styles.statusMsg}>Loading…</p>}
      {error   && <p className={styles.errorMsg}>{error}</p>}

      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <p className={styles.statusMsg}>No leave records found.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Period</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Reason</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr key={row.id} className={styles.row}>
                      <td className={styles.staffName}>{row.staff_name}</td>
                      <td className={styles.period}>{fmtDateRange(row.starts_at, row.ends_at)}</td>
                      <td>
                        {row.leave_type ? (
                          <span className={`${styles.typeBadge} ${styles[row.leave_type]}`}>
                            {LEAVE_LABEL[row.leave_type]}
                          </span>
                        ) : <span className={styles.muted}>—</span>}
                      </td>
                      <td>
                        <span className={`${styles.sourceBadge} ${styles[`src_${row.source}` as keyof typeof styles]}`}>
                          {SOURCE_LABEL[row.source]}
                        </span>
                      </td>
                      <td className={styles.reason}>{row.reason ?? <span className={styles.muted}>—</span>}</td>
                      <td className={styles.deleteCell}>
                        {row.source !== 'leave_system' && (
                          <button
                            className={styles.deleteBtn}
                            onClick={() => deleteRow(row)}
                            disabled={deletingId === row.id}
                            aria-label="Delete">
                            {deletingId === row.id ? '…' : '×'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.count}>
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
            {filtered.length !== rows.length ? ` of ${rows.length}` : ''}
          </p>
        </>
      )}

      {/* ── Add leave modal ── */}
      {leaveModal && (
        <Modal title="Add leave" onClose={() => setLeaveModal(false)} maxWidth={460}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setLeaveModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={leaveSaving} onClick={saveLeave}>Add leave</Button>
            </>
          }>
          <div className={styles.formGrid}>
            <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
              <label className={styles.formLabel}>Staff member <span className={styles.req}>*</span></label>
              <select className={styles.input} value={leaveForm.staff_id}
                onChange={e => setLeaveForm(f => ({ ...f, staff_id: e.target.value }))}>
                <option value="">— select staff —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Start date <span className={styles.req}>*</span></label>
              <input type="date" className={styles.input} value={leaveForm.starts_at}
                onChange={e => setLeaveForm(f => ({ ...f, starts_at: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>End date <span className={styles.req}>*</span></label>
              <input type="date" className={styles.input} value={leaveForm.ends_at}
                onChange={e => setLeaveForm(f => ({ ...f, ends_at: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Leave type</label>
              <select className={styles.input} value={leaveForm.leave_type}
                onChange={e => setLeaveForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}>
                {(Object.entries(LEAVE_LABEL) as [LeaveType, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Reason</label>
              <input className={styles.input} value={leaveForm.reason}
                onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
            {leaveError && <p className={styles.formError}>{leaveError}</p>}
          </div>
        </Modal>
      )}

      {/* ── Public holiday modal ── */}
      {holidayModal && (
        <Modal title="Add public holiday" onClose={() => setHolidayModal(false)} maxWidth={420}
          footer={
            !holidayResult ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setHolidayModal(false)}>Cancel</Button>
                <Button variant="primary" size="sm" loading={holidaySaving} onClick={saveBulkHoliday}>Add for all staff</Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setHolidayModal(false)}>Close</Button>
            )
          }>
          {!holidayResult ? (
            <div className={styles.formGrid}>
              <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
                <label className={styles.formLabel}>Date <span className={styles.req}>*</span></label>
                <input type="date" className={styles.input} value={holidayDate}
                  onChange={e => setHolidayDate(e.target.value)} />
              </div>
              <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
                <label className={styles.formLabel}>Holiday name</label>
                <input className={styles.input} placeholder="e.g. Australia Day"
                  value={holidayReason}
                  onChange={e => setHolidayReason(e.target.value)} />
              </div>
              <p className={styles.hint}>
                This will add a public holiday record for every staff member currently in this boutique.
              </p>
              {holidayError && <p className={styles.formError}>{holidayError}</p>}
            </div>
          ) : (
            <div className={styles.successRow}>
              <span className={styles.successIcon}>✓</span>
              <p className={styles.successText}>{holidayResult}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
