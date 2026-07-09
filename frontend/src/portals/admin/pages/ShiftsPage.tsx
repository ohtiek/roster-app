import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type { SessionContext, BoutiqueShift, ShiftRequirement, BoutiqueClosure, SkillType } from '../../../lib/types'
import { supabase } from '../../../lib/supabase'
import styles from './ShiftsPage.module.css'

interface Props { session: SessionContext }

// ── Shift form ────────────────────────────────────────────────────────────────

interface ShiftForm {
  id: string | null
  name: string
  start_time: string
  end_time: string
  sort_order: string
  valid_from: string
  valid_until: string
}

function blankShiftForm(): ShiftForm {
  return { id: null, name: '', start_time: '09:00', end_time: '17:00', sort_order: '0', valid_from: new Date().toISOString().slice(0, 10), valid_until: '' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(t: string) { return t.slice(0, 5) }  // "HH:MM:SS" → "HH:MM"

function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftsPage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [shifts, setShifts] = useState<BoutiqueShift[]>([])
  const [requirements, setRequirements] = useState<Record<string, ShiftRequirement[]>>({})
  const [closures, setClosures] = useState<BoutiqueClosure[]>([])
  const [skillTypes, setSkillTypes] = useState<SkillType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // shift modal
  const [shiftModal, setShiftModal] = useState(false)
  const [shiftForm, setShiftForm] = useState<ShiftForm>(blankShiftForm())
  const [shiftSaving, setShiftSaving] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)

  // expanded shift (shows requirements)
  const [expanded, setExpanded] = useState<string | null>(null)

  // inline req editing: key = `${shiftId}:${skillTypeId}`
  const [reqDraft, setReqDraft] = useState<Record<string, { min: string; max: string }>>({})
  const [reqSaving, setReqSaving] = useState<Record<string, boolean>>({})
  const [addReqShift, setAddReqShift] = useState<string | null>(null)
  const [addReqSkill, setAddReqSkill] = useState('')
  const [addReqMin, setAddReqMin] = useState('1')

  // closures
  const [closureDate, setClosureDate] = useState('')
  const [closureReason, setClosureReason] = useState('')
  const [closureSaving, setClosureSaving] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const [shiftRes, skillRes, closureRes] = await Promise.all([
      supabase.from('boutique_shifts').select('*').eq('boutique_id', boutiqueId).order('sort_order'),
      supabase.from('skill_types').select('*').order('engine_priority', { ascending: false }),
      supabase.from('boutique_closures').select('id, closure_date, reason').eq('boutique_id', boutiqueId).order('closure_date'),
    ])

    if (shiftRes.error) { setError(shiftRes.error.message); setLoading(false); return }

    setShifts(shiftRes.data ?? [])
    if (skillRes.data) setSkillTypes(skillRes.data)
    if (closureRes.data) setClosures(closureRes.data)

    const shiftIds = (shiftRes.data ?? []).map(s => s.id)
    if (shiftIds.length) {
      const { data: reqRows } = await supabase
        .from('boutique_shift_requirements')
        .select('shift_id, skill_type_id, min_count, max_count, skill_types(name)')
        .in('shift_id', shiftIds)

      const byShift: Record<string, ShiftRequirement[]> = {}
      for (const r of reqRows ?? []) {
        const entry: ShiftRequirement = {
          shift_id: r.shift_id,
          skill_type_id: r.skill_type_id,
          skill_type_name: (r.skill_types as any)?.name ?? '',
          min_count: r.min_count,
          max_count: r.max_count,
        }
        byShift[r.shift_id] = [...(byShift[r.shift_id] ?? []), entry]
      }
      setRequirements(byShift)
    }

    setLoading(false)
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  // ── Shift CRUD ──────────────────────────────────────────────────────────────

  const openAddShift = () => { setShiftForm(blankShiftForm()); setShiftError(null); setShiftModal(true) }
  const openEditShift = (s: BoutiqueShift) => {
    setShiftForm({
      id: s.id, name: s.name,
      start_time: fmtTime(s.start_time), end_time: fmtTime(s.end_time),
      sort_order: String(s.sort_order),
      valid_from: s.valid_from, valid_until: s.valid_until ?? '',
    })
    setShiftError(null); setShiftModal(true)
  }

  const saveShift = useCallback(async () => {
    if (!boutiqueId) return
    if (!shiftForm.name.trim()) { setShiftError('Name is required.'); return }
    if (!shiftForm.start_time || !shiftForm.end_time) { setShiftError('Start and end times are required.'); return }
    if (shiftForm.end_time <= shiftForm.start_time) { setShiftError('End time must be after start time.'); return }

    setShiftSaving(true); setShiftError(null)
    const payload = {
      boutique_id: boutiqueId,
      name: shiftForm.name.trim(),
      start_time: shiftForm.start_time,
      end_time: shiftForm.end_time,
      sort_order: parseInt(shiftForm.sort_order) || 0,
      valid_from: shiftForm.valid_from,
      valid_until: shiftForm.valid_until || null,
    }

    const { error } = shiftForm.id
      ? await supabase.from('boutique_shifts').update(payload).eq('id', shiftForm.id)
      : await supabase.from('boutique_shifts').insert(payload)

    setShiftSaving(false)
    if (error) { setShiftError(error.message); return }
    setShiftModal(false)
    await load()
  }, [boutiqueId, shiftForm, load])

  const deleteShift = useCallback(async (id: string) => {
    if (!confirm('Delete this shift? Associated requirements will also be removed.')) return
    await supabase.from('boutique_shifts').delete().eq('id', id)
    await load()
  }, [load])

  // ── Requirements ────────────────────────────────────────────────────────────

  const reqKey = (shiftId: string, skillTypeId: string) => `${shiftId}:${skillTypeId}`

  const saveReq = useCallback(async (shiftId: string, skillTypeId: string) => {
    const key = reqKey(shiftId, skillTypeId)
    const draft = reqDraft[key]
    if (!draft) return
    setReqSaving(prev => ({ ...prev, [key]: true }))

    await supabase.from('boutique_shift_requirements').upsert({
      shift_id: shiftId, skill_type_id: skillTypeId,
      min_count: parseInt(draft.min) || 1,
      max_count: draft.max ? parseInt(draft.max) : null,
    })

    setReqSaving(prev => ({ ...prev, [key]: false }))
    setReqDraft(prev => { const n = { ...prev }; delete n[key]; return n })
    await load()
  }, [reqDraft, load])

  const deleteReq = useCallback(async (shiftId: string, skillTypeId: string) => {
    await supabase.from('boutique_shift_requirements')
      .delete().eq('shift_id', shiftId).eq('skill_type_id', skillTypeId)
    await load()
  }, [load])

  const addReq = useCallback(async (shiftId: string) => {
    if (!addReqSkill) return
    const { error } = await supabase.from('boutique_shift_requirements').insert({
      shift_id: shiftId, skill_type_id: addReqSkill,
      min_count: parseInt(addReqMin) || 1,
    })
    if (error) return
    setAddReqShift(null); setAddReqSkill(''); setAddReqMin('1')
    await load()
  }, [addReqSkill, addReqMin, load])

  // ── Closures ─────────────────────────────────────────────────────────────────

  const addClosure = useCallback(async () => {
    if (!boutiqueId || !closureDate) return
    setClosureSaving(true)
    await supabase.from('boutique_closures').insert({
      boutique_id: boutiqueId, closure_date: closureDate,
      reason: closureReason.trim() || null,
    })
    setClosureSaving(false); setClosureDate(''); setClosureReason('')
    await load()
  }, [boutiqueId, closureDate, closureReason, load])

  const deleteClosure = useCallback(async (id: string) => {
    await supabase.from('boutique_closures').delete().eq('id', id)
    await load()
  }, [load])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!boutiqueId) return (
    <div><PageHeader title="Shifts" subtitle="Boutique shift definitions and closures" />
      <p className={styles.empty}>No boutique selected.</p></div>
  )

  if (loading) return (
    <div><PageHeader title="Shifts" subtitle="Boutique shift definitions and closures" />
      <p className={styles.statusMsg}>Loading…</p></div>
  )

  if (error) return (
    <div><PageHeader title="Shifts" subtitle="Boutique shift definitions and closures" />
      <p className={styles.errorMsg}>{error}</p></div>
  )

  return (
    <div className={styles.page}>
      <PageHeader title="Shifts" subtitle="Boutique shift definitions, requirements and closure dates" />

      <div className={styles.content}>

        {/* ── Shift definitions ── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Shift Definitions</h2>
              <p className={styles.cardDesc}>Define the shift slots available at this boutique. Expand a shift to configure skill requirements.</p>
            </div>
            <Button variant="primary" size="sm" onClick={openAddShift}>+ Add shift</Button>
          </div>

          {shifts.length === 0 ? (
            <p className={styles.empty}>No shifts defined yet.</p>
          ) : (
            <div className={styles.shiftList}>
              {shifts.map(shift => {
                const reqs = requirements[shift.id] ?? []
                const isOpen = expanded === shift.id
                return (
                  <div key={shift.id} className={styles.shiftCard}>
                    <div className={styles.shiftRow}>
                      <button
                        className={styles.shiftToggle}
                        onClick={() => setExpanded(isOpen ? null : shift.id)}
                        aria-expanded={isOpen}
                      >
                        <span className={`${styles.chevron} ${isOpen ? styles.open : ''}`}>›</span>
                      </button>
                      <div className={styles.shiftInfo}>
                        <span className={styles.shiftName}>{shift.name}</span>
                        <span className={styles.shiftTime}>
                          {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                        </span>
                        {shift.valid_until && (
                          <span className={styles.validity}>until {fmtDate(shift.valid_until)}</span>
                        )}
                      </div>
                      <div className={styles.reqSummary}>
                        {reqs.length > 0
                          ? reqs.map(r => (
                              <span key={r.skill_type_id} className={styles.reqChip}>
                                {r.skill_type_name} ×{r.min_count}
                              </span>
                            ))
                          : <span className={styles.noReqs}>No requirements</span>}
                      </div>
                      <div className={styles.shiftActions}>
                        <button className={styles.actionBtn} onClick={() => openEditShift(shift)}>Edit</button>
                        <button className={`${styles.actionBtn} ${styles.danger}`} onClick={() => deleteShift(shift.id)}>Delete</button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className={styles.reqPanel}>
                        <table className={styles.reqTable}>
                          <thead>
                            <tr>
                              <th>Skill</th>
                              <th>Min</th>
                              <th>Max</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {reqs.map(req => {
                              const key = reqKey(shift.id, req.skill_type_id)
                              const draft = reqDraft[key]
                              const saving = reqSaving[key]
                              const minVal = draft?.min ?? String(req.min_count)
                              const maxVal = draft?.max ?? (req.max_count != null ? String(req.max_count) : '')
                              return (
                                <tr key={req.skill_type_id}>
                                  <td>{req.skill_type_name}</td>
                                  <td>
                                    <input type="number" className={styles.reqInput} value={minVal} min={1}
                                      onChange={e => setReqDraft(p => ({ ...p, [key]: { min: e.target.value, max: maxVal } }))} />
                                  </td>
                                  <td>
                                    <input type="number" className={styles.reqInput} value={maxVal} min={1}
                                      placeholder="—"
                                      onChange={e => setReqDraft(p => ({ ...p, [key]: { min: minVal, max: e.target.value } }))} />
                                  </td>
                                  <td className={styles.reqRowActions}>
                                    {draft && (
                                      <button className={styles.saveReqBtn} disabled={saving} onClick={() => saveReq(shift.id, req.skill_type_id)}>
                                        {saving ? '…' : 'Save'}
                                      </button>
                                    )}
                                    <button className={`${styles.actionBtn} ${styles.danger}`}
                                      onClick={() => deleteReq(shift.id, req.skill_type_id)}>×</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>

                        {/* Add requirement row */}
                        {addReqShift === shift.id ? (
                          <div className={styles.addReqRow}>
                            <select className={styles.addReqSelect} value={addReqSkill}
                              onChange={e => setAddReqSkill(e.target.value)}>
                              <option value="">— skill —</option>
                              {skillTypes
                                .filter(st => !reqs.find(r => r.skill_type_id === st.id))
                                .map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                            </select>
                            <input type="number" className={styles.reqInput} value={addReqMin} min={1}
                              placeholder="min" onChange={e => setAddReqMin(e.target.value)} />
                            <Button variant="primary" size="sm" onClick={() => addReq(shift.id)}>Add</Button>
                            <Button variant="ghost" size="sm" onClick={() => setAddReqShift(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <button className={styles.addReqTrigger}
                            onClick={() => { setAddReqShift(shift.id); setAddReqSkill(''); setAddReqMin('1') }}>
                            + Add requirement
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Closure dates ── */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Closure Dates</h2>
              <p className={styles.cardDesc}>Dates the boutique is closed. The engine will refuse to generate a roster on these dates.</p>
            </div>
          </div>

          <div className={styles.closureList}>
            {closures.length === 0 && <p className={styles.empty}>No closures on record.</p>}
            {closures.map(c => (
              <div key={c.id} className={styles.closureRow}>
                <span className={styles.closureDate}>{fmtDate(c.closure_date)}</span>
                <span className={styles.closureReason}>{c.reason ?? <em>No reason given</em>}</span>
                <button className={`${styles.actionBtn} ${styles.danger}`}
                  onClick={() => deleteClosure(c.id)}>×</button>
              </div>
            ))}
          </div>

          <div className={styles.addClosureRow}>
            <input type="date" className={styles.closureDateInput} value={closureDate}
              onChange={e => setClosureDate(e.target.value)} />
            <input type="text" className={styles.closureReasonInput}
              placeholder="Reason (optional)"
              value={closureReason} onChange={e => setClosureReason(e.target.value)} />
            <Button variant="secondary" size="sm" loading={closureSaving}
              disabled={!closureDate} onClick={addClosure}>
              Add closure
            </Button>
          </div>
        </section>
      </div>

      {/* ── Shift add/edit modal ── */}
      {shiftModal && (
        <Modal
          title={shiftForm.id ? 'Edit shift' : 'Add shift'}
          onClose={() => setShiftModal(false)}
          maxWidth={460}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setShiftModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={shiftSaving} onClick={saveShift}>
                {shiftForm.id ? 'Save changes' : 'Add shift'}
              </Button>
            </>
          }
        >
          <div className={styles.shiftFormGrid}>
            <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
              <label className={styles.formLabel}>Shift name <span className={styles.req}>*</span></label>
              <input className={styles.input} value={shiftForm.name} placeholder="e.g. Morning"
                onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Start time <span className={styles.req}>*</span></label>
              <input type="time" className={styles.input} value={shiftForm.start_time}
                onChange={e => setShiftForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>End time <span className={styles.req}>*</span></label>
              <input type="time" className={styles.input} value={shiftForm.end_time}
                onChange={e => setShiftForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Valid from</label>
              <input type="date" className={styles.input} value={shiftForm.valid_from}
                onChange={e => setShiftForm(f => ({ ...f, valid_from: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Valid until <span className={styles.hint}>(leave blank = open-ended)</span></label>
              <input type="date" className={styles.input} value={shiftForm.valid_until}
                onChange={e => setShiftForm(f => ({ ...f, valid_until: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Sort order</label>
              <input type="number" className={styles.input} value={shiftForm.sort_order} min={0}
                onChange={e => setShiftForm(f => ({ ...f, sort_order: e.target.value }))} />
            </div>
            {shiftError && <p className={styles.formError}>{shiftError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
