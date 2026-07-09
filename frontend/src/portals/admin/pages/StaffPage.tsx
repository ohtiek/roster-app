import { PageHeader } from '../../../components/layout/PageHeader'
import type { SessionContext } from '../../../lib/types'

interface Props { session: SessionContext }

export function StaffPage({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Staff" subtitle="Manage staff records, boutique assignments and skills" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>
          Staff list, CSV import, add/edit staff — coming in Phase 3.
        </p>
      </div>
    </div>
  )
}
