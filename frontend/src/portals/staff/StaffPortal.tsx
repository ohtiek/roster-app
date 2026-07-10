import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import type { SessionContext } from '../../lib/types'

interface Props { session: SessionContext }

function MySchedule({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="My Schedule" subtitle="Your upcoming shifts from published rosters" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>
          Upcoming shifts and VIC advisor assignments — coming in Phase 4.
        </p>
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
