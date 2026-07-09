import { PageHeader } from '../../../components/layout/PageHeader'
import type { SessionContext } from '../../../lib/types'
interface Props { session: SessionContext }
export function LeavePage({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Leave Management" subtitle="Staff unavailability, leave requests and public holidays" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>Coming in Phase 3.</p>
      </div>
    </div>
  )
}
