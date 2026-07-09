import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import type { SessionContext } from '../../lib/types'

interface Props { session: SessionContext }

function PublishedRosters({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Published Rosters" subtitle="Browse published rosters for your boutique" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>
          Read-only roster browser with PDF/CSV export — coming in Phase 4.
        </p>
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
