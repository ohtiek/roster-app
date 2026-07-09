/**
 * sync-leave — HR leave / unavailability sync.
 *
 * Accepts a JSON payload directly, OR fetches from HR_LEAVE_EXPORT_URL env var.
 *
 * Expected payload shape:
 *   { "leave": [ LeaveRecord, ... ] }
 *
 * LeaveRecord:
 *   external_hr_id  string   (links to staff.external_hr_id)
 *   source_ref      string   (HR system leave request ID — idempotent key)
 *   starts_at       string   (ISO 8601 datetime, UTC)
 *   ends_at         string   (ISO 8601 datetime, UTC)
 *   leave_type      "annual" | "sick" | "toil" | "parental" | "public_holiday" | "unpaid" | "other"
 *   reason          string?
 *
 * Upsert key: (staff_id, source_ref)
 * Resolves staff_id from external_hr_id before upsert.
 * Records with source = 'leave_system' cannot be modified (skip if present with matching source_ref).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HR_LEAVE_EXPORT_URL = Deno.env.get('HR_LEAVE_EXPORT_URL')

const VALID_LEAVE_TYPES = new Set([
  'annual', 'sick', 'toil', 'parental', 'public_holiday', 'unpaid', 'other',
])

interface LeaveRecord {
  external_hr_id: string
  source_ref: string
  starts_at: string
  ends_at: string
  leave_type?: string
  reason?: string
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  try {
    let payload: { leave: LeaveRecord[] }

    if (HR_LEAVE_EXPORT_URL) {
      const exportResp = await fetch(HR_LEAVE_EXPORT_URL)
      if (!exportResp.ok) {
        return jsonResp({ error: `failed to fetch leave export: ${exportResp.status} ${exportResp.statusText}` }, 502)
      }
      payload = await exportResp.json()
    } else {
      payload = await req.json()
    }

    const records: LeaveRecord[] = payload?.leave ?? []
    if (!records.length) {
      return jsonResp({ success: true, synced: 0, skipped: 0, errors: [] })
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

    // Build external_hr_id → staff_id map for all records in this batch
    const externalIds = [...new Set(records.map(r => r.external_hr_id).filter(Boolean))]
    const { data: staffRows } = await db
      .from('staff')
      .select('id, external_hr_id')
      .in('external_hr_id', externalIds)

    const staffByHrId = new Map<string, string>()
    for (const s of staffRows ?? []) {
      if (s.external_hr_id) staffByHrId.set(s.external_hr_id, s.id)
    }

    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for (const rec of records) {
      if (!rec.external_hr_id || !rec.source_ref || !rec.starts_at || !rec.ends_at) {
        errors.push(`skipping record: missing required fields (external_hr_id, source_ref, starts_at, ends_at)`)
        continue
      }

      const staffId = staffByHrId.get(rec.external_hr_id)
      if (!staffId) {
        errors.push(`${rec.source_ref}: staff not found for external_hr_id '${rec.external_hr_id}' — skipped`)
        skipped++
        continue
      }

      // Validate dates
      const startMs = Date.parse(rec.starts_at)
      const endMs = Date.parse(rec.ends_at)
      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        errors.push(`${rec.source_ref}: invalid time range — skipped`)
        skipped++
        continue
      }

      const leaveType = VALID_LEAVE_TYPES.has(rec.leave_type ?? '') ? rec.leave_type : 'other'

      try {
        // Check if this source_ref already exists — update if times/type changed, skip if identical
        const { data: existing } = await db
          .from('staff_unavailability')
          .select('id, starts_at, ends_at, leave_type')
          .eq('staff_id', staffId)
          .eq('source_ref', rec.source_ref)
          .eq('source', 'leave_system')
          .maybeSingle()

        if (existing) {
          const sameRecord =
            existing.starts_at === rec.starts_at &&
            existing.ends_at === rec.ends_at &&
            existing.leave_type === leaveType

          if (sameRecord) {
            skipped++
            continue
          }

          // Update changed record
          await db.from('staff_unavailability').update({
            starts_at: rec.starts_at,
            ends_at: rec.ends_at,
            leave_type: leaveType,
            reason: rec.reason ?? null,
          }).eq('id', existing.id)
        } else {
          await db.from('staff_unavailability').insert({
            staff_id: staffId,
            starts_at: rec.starts_at,
            ends_at: rec.ends_at,
            source: 'leave_system',
            source_ref: rec.source_ref,
            leave_type: leaveType,
            reason: rec.reason ?? null,
          })
        }

        synced++
      } catch (recErr: any) {
        errors.push(`${rec.source_ref}: ${recErr.message}`)
      }
    }

    return jsonResp({ success: true, synced, skipped, errors })
  } catch (err: any) {
    console.error('sync-leave error:', err)
    return jsonResp({ error: err.message }, 500)
  }
})
