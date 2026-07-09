import { PageHeader } from '../../../components/layout/PageHeader'
import type { SessionContext } from '../../../lib/types'

interface Props { session: SessionContext }

export function RostersPage({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Rosters" subtitle="Review and adjust draft rosters before submission" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>
          Roster review, draft adjustment, and per-shift re-run — coming in Phase 3.
        </p>
      </div>
    </div>
  )
}
