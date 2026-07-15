import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Translates known roster_history constraint violations into a message an
 * admin/approver can actually act on, instead of surfacing the raw
 * Postgres error text.
 */
export function friendlyRosterUpdateError(err: PostgrestError): string {
  if (err.code === '23505' && err.message.includes('roster_one_published_per_boutique_date')) {
    return 'A roster is already published for this boutique on this date. ' +
      'Only one published roster per date is allowed — archive or unpublish the existing one first.'
  }
  return err.message
}
