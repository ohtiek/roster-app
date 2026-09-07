import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type { SessionContext, BoutiqueEvent } from '../../../lib/types'
import { EVENT_COLORS } from '../../../lib/types'
import { supabase } from '../../../lib/supabase'
import styles from './EventsPage.module.css'

interface Props { session: SessionContext }

function fmtDateRange(starts: string, ends: string) {
  const s = new Date(starts + 'T00:00:00')
  const e = new Date(ends + 'T00:00:00')
  const sd = s.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  const ed = e.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return sd === ed ? sd : `${sd} – ${ed}`
}

interface EventForm {
  title: string
  starts_on: string
  ends_on: string
  color: string
}

function blankForm(): EventForm {
  const today = new Date().toISOString().slice(0, 10)
  return { title: '', starts_on: today, ends_on: today, color: EVENT_COLORS[0].value }
}

export function EventsPage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [events, setEvents] = useState<BoutiqueEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<EventForm>(blankForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const { data, error: err } = await supabase
      .from('boutique_events')
      .select('id, boutique_id, title, starts_on, ends_on, color, created_at')
      .eq('boutique_id', boutiqueId)
      .order('starts_on', { ascending: false })
      .limit(200)

    setLoading(false)
    if (err) { setError(err.message); return }
    setEvents(data ?? [])
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  const openAdd = () => { setForm(blankForm()); setFormError(null); setModalOpen(true) }

  const save = useCallback(async () => {
    if (!boutiqueId) return
    if (!form.title.trim()) { setFormError('Title is required.'); return }
    if (!form.starts_on || !form.ends_on) { setFormError('Start and end dates are required.'); return }
    if (form.starts_on > form.ends_on) { setFormError('End date must be on or after start date.'); return }

    setSaving(true); setFormError(null)
    const { data: userData } = await supabase.auth.getUser()

    const { error: err } = await supabase.from('boutique_events').insert({
      boutique_id: boutiqueId,
      title: form.title.trim(),
      starts_on: form.starts_on,
      ends_on: form.ends_on,
      color: form.color,
      created_by: userData?.user?.id,
    })

    setSaving(false)
    if (err) { setFormError(err.message); return }
    setModalOpen(false)
    await load()
  }, [boutiqueId, form, load])

  const deleteEvent = useCallback(async (id: string) => {
    setDeletingId(id)
    await supabase.from('boutique_events').delete().eq('id', id)
    setDeletingId(null)
    await load()
  }, [load])

  if (!boutiqueId) return (
    <div><PageHeader title="Events" subtitle="Marketing and store events shown on the roster calendar" />
      <p className={styles.statusMsg}>No boutique selected.</p></div>
  )

  return (
    <div className={styles.page}>
      <PageHeader
        title="Events"
        subtitle="Marketing launches, previews, meetings and other store events — shown as banners on the roster and staff calendars"
      />

      <div className={styles.toolbar}>
        <span />
        <div className={styles.toolbarActions}>
          <Button variant="primary" size="sm" onClick={openAdd}>+ Add event</Button>
        </div>
      </div>

      {loading && <p className={styles.statusMsg}>Loading…</p>}
      {error && <p className={styles.errorMsg}>{error}</p>}

      {!loading && !error && (
        <>
          {events.length === 0 ? (
            <p className={styles.statusMsg}>No events yet. Click &ldquo;Add event&rdquo; to create one.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Event</th><th>Dates</th><th></th></tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className={styles.row}>
                      <td>
                        <div className={styles.titleCell}>
                          <span className={styles.swatch} style={{ background: ev.color }} />
                          {ev.title}
                        </div>
                      </td>
                      <td className={styles.period}>{fmtDateRange(ev.starts_on, ev.ends_on)}</td>
                      <td className={styles.deleteCell}>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => deleteEvent(ev.id)}
                          disabled={deletingId === ev.id}
                          aria-label="Delete event">
                          {deletingId === ev.id ? '…' : '×'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.count}>{events.length} event{events.length !== 1 ? 's' : ''}</p>
        </>
      )}

      {modalOpen && (
        <Modal title="Add event" onClose={() => setModalOpen(false)} maxWidth={440}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={save}>Add event</Button>
            </>
          }>
          <div className={styles.formGrid}>
            <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
              <label className={styles.formLabel}>Title <span className={styles.req}>*</span></label>
              <input className={styles.input} placeholder="e.g. WRTW Launch" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Start date <span className={styles.req}>*</span></label>
              <input type="date" className={styles.input} value={form.starts_on}
                onChange={e => setForm(f => ({ ...f, starts_on: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>End date <span className={styles.req}>*</span></label>
              <input type="date" className={styles.input} value={form.ends_on}
                onChange={e => setForm(f => ({ ...f, ends_on: e.target.value }))} />
            </div>
            <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
              <label className={styles.formLabel}>Color</label>
              <div className={styles.colorPicker}>
                {EVENT_COLORS.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    aria-label={c.label}
                    className={`${styles.colorSwatchBtn} ${form.color === c.value ? styles.selected : ''}`}
                    style={{ background: c.value }}
                    onClick={() => setForm(f => ({ ...f, color: c.value }))}
                  />
                ))}
              </div>
            </div>
            {formError && <p className={styles.formError}>{formError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
