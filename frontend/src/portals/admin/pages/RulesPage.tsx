import { PageHeader } from '../../../components/layout/PageHeader'
import type { SessionContext } from '../../../lib/types'
interface Props { session: SessionContext }
export function RulesPage({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Rules & Configuration" subtitle="Engine settings, scoring weights, shift requirements and skill types" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>Coming in Phase 3.</p>
      </div>
    </div>
  )
}
