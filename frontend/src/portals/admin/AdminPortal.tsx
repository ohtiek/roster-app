import { Routes, Route } from 'react-router-dom'
import { AdminDashboard } from './pages/AdminDashboard'
import { RostersPage } from './pages/RostersPage'
import { StaffPage } from './pages/StaffPage'
import { VicPage } from './pages/VicPage'
import { ShiftsPage } from './pages/ShiftsPage'
import { RulesPage } from './pages/RulesPage'
import { LeavePage } from './pages/LeavePage'
import type { SessionContext } from '../../lib/types'

interface Props { session: SessionContext }

export function AdminPortal({ session }: Props) {
  return (
    <Routes>
      <Route index element={<AdminDashboard session={session} />} />
      <Route path="rosters/*" element={<RostersPage session={session} />} />
      <Route path="staff/*"   element={<StaffPage session={session} />} />
      <Route path="vic/*"     element={<VicPage session={session} />} />
      <Route path="shifts/*"  element={<ShiftsPage session={session} />} />
      <Route path="rules/*"   element={<RulesPage session={session} />} />
      <Route path="leave/*"   element={<LeavePage session={session} />} />
    </Routes>
  )
}
