import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { SessionContext, Portal, UserBoutiqueRole, BoutiqueOption } from '../lib/types'

export type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; session: SessionContext }

const ACTIVE_BOUTIQUE_STORAGE_KEY = 'roster_active_boutique_id'

type ResolvedSession = Omit<SessionContext, 'setActiveBoutiqueId'>

async function resolveSession(user: User): Promise<ResolvedSession> {
  // Fetch boutique roles
  const { data: roles } = await supabase
    .from('user_boutique_roles')
    .select('boutique_id, role, boutiques(name)')
    .eq('user_id', user.id)

  // Check if user is regional admin
  const { data: profile } = await supabase
    .from('user_boutique_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('role', 'regional_admin')
    .maybeSingle()

  const isRegionalAdmin = !!profile

  // Check if user has a staff record linked to their auth uid
  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id, staff_boutiques(boutique_id)')
    .eq('user_id', user.id)
    .maybeSingle()

  if (staffError) {
    // Swallowing this silently would misroute a staff login to the reader
    // portal with no diagnostic trail, since staffRow just ends up null.
    console.error('Failed to resolve staff record for session:', staffError)
  }

  const boutiqueRoles: UserBoutiqueRole[] = (roles ?? []).map((r: any) => ({
    boutique_id: r.boutique_id,
    role: r.role,
    boutique_name: r.boutiques?.name ?? null,
  }))

  // Determine portal by highest privilege
  let portal: Portal = 'reader'
  if (isRegionalAdmin || boutiqueRoles.some(r => r.role === 'admin')) {
    portal = 'admin'
  } else if (boutiqueRoles.some(r => r.role === 'approver')) {
    portal = 'approver'
  } else if (staffRow) {
    portal = 'staff'
  }

  // Boutiques the user can switch between:
  // - regional_admin sees every active boutique
  // - admin/approver see only the boutique(s) they hold that role at
  let availableBoutiques: BoutiqueOption[] = []
  if (isRegionalAdmin) {
    const { data: allBoutiques } = await supabase
      .from('boutiques')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
    availableBoutiques = allBoutiques ?? []
  } else {
    const seen = new Set<string>()
    for (const r of boutiqueRoles) {
      if ((r.role === 'admin' || r.role === 'approver') && r.boutique_id && !seen.has(r.boutique_id)) {
        seen.add(r.boutique_id)
        availableBoutiques.push({ id: r.boutique_id, name: r.boutique_name ?? 'Boutique' })
      }
    }
  }

  const adminBoutique = boutiqueRoles.find(r => r.role === 'admin')

  const storedBoutiqueId = localStorage.getItem(ACTIVE_BOUTIQUE_STORAGE_KEY)
  const storedIsValid = !!storedBoutiqueId && availableBoutiques.some(b => b.id === storedBoutiqueId)

  const activeBoutiqueId =
    (storedIsValid ? storedBoutiqueId : null) ??
    adminBoutique?.boutique_id ??
    availableBoutiques[0]?.id ??
    (staffRow as any)?.staff_boutiques?.[0]?.boutique_id ??
    null

  return {
    userId: user.id,
    email: user.email ?? '',
    portal,
    boutiqueRoles,
    staffId: staffRow?.id,
    staffBoutiqueId: (staffRow as any)?.staff_boutiques?.[0]?.boutique_id,
    isRegionalAdmin,
    activeBoutiqueId,
    availableBoutiques,
  }
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  function setActiveBoutiqueId(boutiqueId: string) {
    localStorage.setItem(ACTIVE_BOUTIQUE_STORAGE_KEY, boutiqueId)
    setState(prev =>
      prev.status === 'authenticated'
        ? { status: 'authenticated', session: { ...prev.session, activeBoutiqueId: boutiqueId } }
        : prev
    )
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setState({ status: 'unauthenticated' })
        return
      }
      const ctx = await resolveSession(session.user)
      setState({ status: 'authenticated', session: { ...ctx, setActiveBoutiqueId } })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          setState({ status: 'unauthenticated' })
          return
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          const ctx = await resolveSession(session.user)
          setState({ status: 'authenticated', session: { ...ctx, setActiveBoutiqueId } })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return state
}
