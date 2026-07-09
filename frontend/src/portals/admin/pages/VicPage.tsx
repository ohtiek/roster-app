import { PageHeader } from '../../../components/layout/PageHeader'
import type { SessionContext } from '../../../lib/types'
interface Props { session: SessionContext }
export function VicPage({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="VIC Clients" subtitle="VIC client list, appointments and advisor assignments" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>Coming in Phase 3.</p>
      </div>
    </div>
  )
}
