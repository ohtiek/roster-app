import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import type { SessionContext, RosterPayload, BoutiqueEvent } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import styles from './StaffPortal.module.css'

interface Props { session: SessionContext }

interface DayShift {
  shift_name: string
  shift_duration_hours: number
  is_vic_active: boolean
  area_name: string | null
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function pad2(n: number) { return n.toString().padStart(2, '0') }
function isoDate(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}
function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}
// Weekday index with Monday=0 .. Sunday=6 (JS getDay() is Sunday=0)
function mondayFirstWeekday(year: number, month: number, day: number) {
  return (new Date(year, month, day).getDay() + 6) % 7
}

function MySchedule({ session }: Props) {
  const { staffId, staffBoutiqueId } = session
  const today = new Date()

  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())   // 0-indexed

  const [shiftsByDate, setShiftsByDate] = useState<Map<string, DayShift[]>>(new Map())
  const [events, setEvents] = useState<BoutiqueEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!staffId || !staffBoutiqueId) { setLoading(false); return }
    let cancelled = false

    async function load() {
      setLoading(true); setError(null)
      const monthStart = isoDate(viewYear, viewMonth, 1)
      const monthEnd = isoDate(viewYear, viewMonth, daysInMonth(viewYear, viewMonth))

      const [rosterRes, eventsRes] = await Promise.all([
        supabase
          .from('roster_history')
          .select('roster_date, payload')
          .eq('boutique_id', staffBoutiqueId)
          .eq('status', 'published')
          .gte('roster_date', monthStart)
          .lte('roster_date', monthEnd)
          .order('roster_date', { ascending: true }),
        supabase
          .from('boutique_events')
          .select('id, boutique_id, title, starts_on, ends_on, color')
          .eq('boutique_id', staffBoutiqueId)
          .lte('starts_on', monthEnd)
          .gte('ends_on', monthStart),
      ])

      if (cancelled) return
      setLoading(false)
      if (rosterRes.error) { setError(rosterRes.error.message); return }

      const byDate = new Map<string, DayShift[]>()
      for (const row of rosterRes.data ?? []) {
        const payload = row.payload as RosterPayload | null
        for (const a of payload?.assignments ?? []) {
          if (a.staff_id === staffId) {
            if (!byDate.has(row.roster_date)) byDate.set(row.roster_date, [])
            byDate.get(row.roster_date)!.push({
              shift_name: a.shift_name,
              shift_duration_hours: a.shift_duration_hours,
              is_vic_active: a.is_vic_active,
              area_name: a.area_name,
            })
          }
        }
      }
      setShiftsByDate(byDate)
      setEvents(eventsRes.error ? [] : (eventsRes.data ?? []))
    }
    load()
    return () => { cancelled = true }
  }, [staffId, staffBoutiqueId, viewYear, viewMonth])

  function changeMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y -= 1 }
    else if (m > 11) { m = 0; y += 1 }
    setViewMonth(m); setViewYear(y)
  }
  function goToday() { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()) }

  const totalDays = daysInMonth(viewYear, viewMonth)
  const leadingBlanks = mondayFirstWeekday(viewYear, viewMonth, 1)
  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate())

  function eventsForDay(iso: string) {
    return events.filter(e => e.starts_on <= iso && e.ends_on >= iso)
  }

  return (
    <div>
      <PageHeader
        title="My Schedule"
        subtitle="Your shifts and store events, month by month"
        actions={
          <div className={styles.calNav}>
            <button className={styles.calNavBtn} onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
            <span className={styles.calMonthLabel}>{monthLabel}</span>
            <button className={styles.calNavBtn} onClick={() => changeMonth(1)} aria-label="Next month">›</button>
            <button className={styles.calTodayBtn} onClick={goToday}>Today</button>
          </div>
        }
      />
      <div className={styles.content}>
        {!staffId || !staffBoutiqueId ? (
          <p className={styles.statusMsg}>Your account isn't linked to a boutique yet.</p>
        ) : loading ? (
          <p className={styles.statusMsg}>Loading…</p>
        ) : error ? (
          <p className={styles.errorMsg}>{error}</p>
        ) : (
          <div className={styles.calendar}>
            <div className={styles.calWeekHeader}>
              {WEEKDAY_LABELS.map(d => <div key={d} className={styles.calWeekday}>{d}</div>)}
            </div>
            <div className={styles.calGrid}>
              {cells.map((day, i) => {
                if (day == null) return <div key={i} className={`${styles.calCell} ${styles.calCellBlank}`} />
                const iso = isoDate(viewYear, viewMonth, day)
                const dayShifts = shiftsByDate.get(iso) ?? []
                const dayEvents = eventsForDay(iso)
                const isToday = iso === todayIso
                return (
                  <div key={iso} className={`${styles.calCell} ${isToday ? styles.calCellToday : ''}`}>
                    <span className={styles.calDayNum}>{day}</span>
                    {dayEvents.map(ev => (
                      <span
                        key={ev.id}
                        className={styles.calEventChip}
                        style={{ background: `${ev.color}22`, color: ev.color, borderColor: `${ev.color}55` }}
                        title={ev.title}
                      >
                        {ev.title}
                      </span>
                    ))}
                    {dayShifts.map((s, idx) => (
                      <div key={idx} className={styles.calShift}>
                        <span className={styles.calShiftName}>{s.shift_name}</span>
                        {s.area_name && <span className={styles.calShiftArea}>{s.area_name}</span>}
                        {s.is_vic_active && <span className={styles.vicBadge}>VIC</span>}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MyLeave({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Leave" subtitle="Submit unavailability and view your leave history" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>Coming in Phase 4.</p>
      </div>
    </div>
  )
}

function TeamView({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Team" subtitle="Published roster for your boutique" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>Coming in Phase 4.</p>
      </div>
    </div>
  )
}

export function StaffPortal({ session }: Props) {
  return (
    <Routes>
      <Route index element={<MySchedule session={session} />} />
      <Route path="leave" element={<MyLeave session={session} />} />
      <Route path="team"  element={<TeamView session={session} />} />
    </Routes>
  )
}
