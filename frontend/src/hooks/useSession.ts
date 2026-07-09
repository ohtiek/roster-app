import { useState, useEffect } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { SessionContext, Portal, UserBoutiqueRole } from '../lib/types'

export type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; session: SessionContext }

async function resolveSession(user: User): Promise<SessionContext> {
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
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id, staff_boutiques(boutique_id)')
    .eq('user_id', user.id)
    .maybeSingle()

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

  const adminBoutique = boutiqueRoles.find(r => r.role === 'admin')
  const activeBoutiqueId =
    adminBoutique?.boutique_id ??
    boutiqueRoles[0]?.boutique_id ??
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
  }
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setState({ status: 'unauthenticated' })
        return
      }
      const ctx = await resolveSession(session.user)
      setState({ status: 'authenticated', session: ctx })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) {
          setState({ status: 'unauthenticated' })
          return
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          const ctx = await resolveSession(session.user)
          setState({ status: 'authenticated', session: ctx })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return state
}
