import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { SessionContext } from '../../lib/types'
import styles from './AppShell.module.css'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV: Record<string, NavItem[]> = {
  admin: [
    { to: '/admin',          label: 'Dashboard',   icon: '⊞' },
    { to: '/admin/rosters',  label: 'Rosters',     icon: '📋' },
    { to: '/admin/staff',    label: 'Staff',        icon: '👥' },
    { to: '/admin/vic',      label: 'VIC Clients',  icon: '⭐' },
    { to: '/admin/shifts',   label: 'Shifts',       icon: '🕐' },
    { to: '/admin/rules',    label: 'Rules',        icon: '⚙️' },
    { to: '/admin/leave',    label: 'Leave',        icon: '📅' },
  ],
  approver: [
    { to: '/approvals',         label: 'Inbox',    icon: '📥' },
    { to: '/approvals/history', label: 'History',  icon: '🗂️' },
  ],
  staff: [
    { to: '/staff',        label: 'My Schedule',  icon: '📆' },
    { to: '/staff/leave',  label: 'Leave',        icon: '🏖️' },
    { to: '/staff/team',   label: 'Team',         icon: '👥' },
  ],
  reader: [
    { to: '/view', label: 'Published Rosters', icon: '👁️' },
  ],
}

const PORTAL_LABEL: Record<string, string> = {
  admin: 'Admin',
  approver: 'Approver',
  staff: 'My Portal',
  reader: 'View',
}

interface Props {
  session: SessionContext
  children: React.ReactNode
}

export function AppShell({ session, children }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const navItems = NAV[session.portal] ?? []

  // If user has both admin + approver roles, show a switcher
  const availablePortals: string[] = []
  if (session.isRegionalAdmin || session.boutiqueRoles.some(r => r.role === 'admin')) availablePortals.push('admin')
  if (session.boutiqueRoles.some(r => r.role === 'approver')) availablePortals.push('approver')
  if (session.staffId) availablePortals.push('staff')
  if (availablePortals.length === 0) availablePortals.push('reader')

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className={styles.shell} data-collapsed={collapsed}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>R</span>
          {!collapsed && <span className={styles.brandName}>Roster</span>}
        </div>

        {!collapsed && (
          <div className={styles.portalBadge}>
            <span>{PORTAL_LABEL[session.portal]}</span>
            {session.availableBoutiques.length > 1 ? (
              <select
                className={styles.boutiqueSelect}
                value={session.activeBoutiqueId ?? ''}
                onChange={e => session.setActiveBoutiqueId(e.target.value)}
                aria-label="Active boutique"
              >
                {session.availableBoutiques.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : session.availableBoutiques[0] ? (
              <span className={styles.boutiqueName}> · {session.availableBoutiques[0].name}</span>
            ) : null}
          </div>
        )}

        <nav className={styles.nav}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin' || item.to === '/approvals' || item.to === '/staff' || item.to === '/view'}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          {!collapsed && (
            <span className={styles.userEmail} title={session.email}>
              {session.email}
            </span>
          )}
          <button onClick={signOut} className={styles.signOutBtn} title="Sign out">
            ↩
          </button>
        </div>

        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </aside>

      <main className={styles.main}>
        {children}
      </main>
    </div>
  )
}
