import { Routes, Route } from 'react-router-dom'
import { PageHeader } from '../../components/layout/PageHeader'
import type { SessionContext } from '../../lib/types'

interface Props { session: SessionContext }

function ApprovalInbox({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Approval Inbox" subtitle="Rosters submitted for your review" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>
          Submitted roster queue with approve / reject / publish actions — coming in Phase 4.
        </p>
      </div>
    </div>
  )
}

function ApprovalHistory({ session: _session }: Props) {
  return (
    <div>
      <PageHeader title="Approval History" subtitle="All approved, rejected and published rosters" />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--ph-muted, #6B7280)', fontSize: '14px' }}>Coming in Phase 4.</p>
      </div>
    </div>
  )
}

export function ApproverPortal({ session }: Props) {
  return (
    <Routes>
      <Route index element={<ApprovalInbox session={session} />} />
      <Route path="history" element={<ApprovalHistory session={session} />} />
    </Routes>
  )
}
