import { supabase } from './supabase'

/**
 * Publishes an approved roster via the publish_roster() DB function, which
 * atomically supersedes any roster currently published for the same
 * boutique+date (moving it to 'published_amended') before publishing this
 * one — see migration 025.
 */
export async function publishRoster(rosterId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('publish_roster', { target_roster_id: rosterId })
  return { error: error?.message ?? null }
}
