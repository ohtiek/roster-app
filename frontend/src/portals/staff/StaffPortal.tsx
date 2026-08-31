import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import type { SessionContext, RosterPayload } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import styles from './StaffPortal.module.css'

interface Props { session: SessionContext }

interface UpcomingShift {
  roster_date: string
  shift_name: string
  shift_duration_hours: number
  is_vic_active: boolean
  area_name: string | null
}

function fmtDayName(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long' })
}
function fmtDayDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function MySchedule({ session }: Props) {
  const { staffId, staffBoutiqueId } = session

  const [shifts, setShifts] = useState<UpcomingShift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!staffId || !staffBoutiqueId) { setLoading(false); return }

    async function load() {
      setLoading(true); setError(null)
      const today = new Date().toISOString().slice(0, 10)

      const { data, error: err } = await supabase
        .from('roster_history')
        .select('roster_date, payload')
        .eq('boutique_id', staffBoutiqueId)
        .eq('status', 'published')
        .gte('roster_date', today)
        .order('roster_date', { ascending: true })
        .limit(60)

      setLoading(false)
      if (err) { setError(err.message); return }

      const upcoming: UpcomingShift[] = []
      for (const row of data ?? []) {
        const payload = row.payload as RosterPayload | null
        for (const a of payload?.assignments ?? []) {
          if (a.staff_id === staffId) {
            upcoming.push({
              roster_date: row.roster_date,
              shift_name: a.shift_name,
              shift_duration_hours: a.shift_duration_hours,
              is_vic_active: a.is_vic_active,
              area_name: a.area_name,
            })
          }
        }
      }
      setShifts(upcoming)
    }
    load()
  }, [staffId, staffBoutiqueId])

  // Group into per-day blocks, preserving date order
  const byDay = new Map<string, UpcomingShift[]>()
  for (const s of shifts) {
    if (!byDay.has(s.roster_date)) byDay.set(s.roster_date, [])
    byDay.get(s.roster_date)!.push(s)
  }

  return (
    <div>
      <PageHeader title="My Schedule" subtitle="Your upcoming shifts from published rosters" />
      <div className={styles.content}>
        {!staffId || !staffBoutiqueId ? (
          <p className={styles.statusMsg}>Your account isn't linked to a boutique yet.</p>
        ) : loading ? (
          <p className={styles.statusMsg}>Loading…</p>
        ) : error ? (
          <p className={styles.errorMsg}>{error}</p>
        ) : byDay.size === 0 ? (
          <p className={styles.empty}>No upcoming shifts on the published roster yet.</p>
        ) : (
          [...byDay.entries()].map(([date, dayShifts]) => (
            <div key={date} className={styles.dayGroup}>
              <div className={styles.dayHeader}>
                <span className={styles.dayName}>{fmtDayName(date)}</span>
                <span className={styles.dayDate}>{fmtDayDate(date)}</span>
              </div>
              {dayShifts.map((s, i) => (
                <div key={i} className={styles.shiftRow}>
                  <span className={styles.shiftName}>{s.shift_name}</span>
                  {s.area_name && <span className={styles.shiftArea}>{s.area_name}</span>}
                  {s.is_vic_active && <span className={styles.vicBadge}>VIC</span>}
                  <span className={styles.shiftHours}>{s.shift_duration_hours}h</span>
                </div>
              ))}
            </div>
          ))
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
