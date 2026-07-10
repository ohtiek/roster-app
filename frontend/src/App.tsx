import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSession } from './hooks/useSession'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './portals/LoginPage'
import { AdminPortal } from './portals/admin/AdminPortal'
import { ApproverPortal } from './portals/approver/ApproverPortal'
import { StaffPortal } from './portals/staff/StaffPortal'
import { ReaderPortal } from './portals/reader/ReaderPortal'

function AuthGate() {
  const state = useSession()

  if (state.status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#F5F3EF',
        color: '#6B7280', fontSize: '14px',
      }}>
        Loading…
      </div>
    )
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }

  const { session } = state
  const defaultPath = `/${session.portal === 'reader' ? 'view' : session.portal}`

  return (
    <AppShell session={session}>
      <Routes>
        <Route index element={<Navigate to={defaultPath} replace />} />
        <Route path="admin/*"     element={<AdminPortal session={session} />} />
        <Route path="approvals/*" element={<ApproverPortal session={session} />} />
        <Route path="staff/*"     element={<StaffPortal session={session} />} />
        <Route path="view/*"      element={<ReaderPortal session={session} />} />
        <Route path="*"           element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*"     element={<AuthGate />} />
      </Routes>
    </BrowserRouter>
  )
}
