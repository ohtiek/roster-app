/**
 * sync-staff — HR staff data sync.
 *
 * Accepts a JSON payload directly in the request body, OR fetches from a
 * pre-signed URL configured via HR_STAFF_EXPORT_URL env var.
 *
 * Expected payload shape:
 *   { "staff": [ StaffRecord, ... ] }
 *
 * StaffRecord:
 *   external_hr_id      string  (required — idempotent upsert key)
 *   name                string
 *   employment_type     "full_time" | "part_time" | "casual" | "contractor"
 *   contracted_hours    number | null   (weekly cap for part_time/casual)
 *   gender              "M" | "F" | "NB"
 *   languages           string[]
 *   seniority           "junior" | "senior" | "manager"
 *   boutique_codes      string[]   (store_code values to link boutiques)
 *   skills              Array<{ skill_name: string; is_primary: boolean }>
 *
 * Uses external_hr_id as the upsert key.
 * Boutique links use boutiques.store_code → staff_boutiques.
 * Skill links use skill_types.name → staff_skills.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HR_STAFF_EXPORT_URL = Deno.env.get('HR_STAFF_EXPORT_URL')

interface StaffRecord {
  external_hr_id: string
  name: string
  employment_type?: string
  contracted_hours?: number | null
  gender?: string
  languages?: string[]
  seniority?: string
  boutique_codes?: string[]
  skills?: Array<{ skill_name: string; is_primary?: boolean }>
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  try {
    let payload: { staff: StaffRecord[] }

    if (HR_STAFF_EXPORT_URL) {
      // Pull mode: fetch from staging location (pre-signed S3 / Azure Blob URL)
      const exportResp = await fetch(HR_STAFF_EXPORT_URL)
      if (!exportResp.ok) {
        return jsonResp({ error: `failed to fetch staff export: ${exportResp.status} ${exportResp.statusText}` }, 502)
      }
      payload = await exportResp.json()
    } else {
      // Push mode: data in request body
      payload = await req.json()
    }

    const records: StaffRecord[] = payload?.staff ?? []
    if (!records.length) {
      return jsonResp({ success: true, synced: 0, skipped: 0, errors: [] })
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

    // Pre-load lookup tables once
    const [{ data: boutiquesRows }, { data: skillTypeRows }] = await Promise.all([
      db.from('boutiques').select('id, store_code').not('store_code', 'is', null),
      db.from('skill_types').select('id, name'),
    ])

    const boutiqueByCode = new Map<string, string>()
    for (const b of boutiquesRows ?? []) boutiqueByCode.set(b.store_code!, b.id)

    const skillTypeByName = new Map<string, string>()
    for (const st of skillTypeRows ?? []) skillTypeByName.set(st.name.toLowerCase(), st.id)

    let synced = 0
    const errors: string[] = []

    for (const rec of records) {
      if (!rec.external_hr_id || !rec.name) {
        errors.push(`skipping record: missing external_hr_id or name`)
        continue
      }

      try {
        // Upsert core staff record
        const { data: staffRow, error: upsertErr } = await db
          .from('staff')
          .upsert({
            external_hr_id: rec.external_hr_id,
            name: rec.name,
            employment_type: rec.employment_type ?? 'full_time',
            contracted_hours_per_week: rec.contracted_hours ?? null,
            gender: rec.gender ?? 'M',
            languages: rec.languages ?? [],
            seniority: rec.seniority ?? 'junior',
            // role is kept for legacy compatibility; set to primary skill or placeholder
            role: rec.skills?.find(s => s.is_primary)?.skill_name ?? 'Jr. Stylist',
          }, { onConflict: 'external_hr_id' })
          .select('id')
          .single()

        if (upsertErr || !staffRow) {
          errors.push(`${rec.external_hr_id}: staff upsert failed — ${upsertErr?.message}`)
          continue
        }

        const staffId = staffRow.id

        // Sync boutique links
        if (rec.boutique_codes?.length) {
          const boutiqueIds = rec.boutique_codes
            .map(code => boutiqueByCode.get(code))
            .filter(Boolean) as string[]

          if (boutiqueIds.length) {
            // Upsert links (idempotent — PRIMARY KEY prevents duplicates)
            await db.from('staff_boutiques').upsert(
              boutiqueIds.map(boutique_id => ({ staff_id: staffId, boutique_id, valid_from: '2000-01-01' })),
              { onConflict: 'staff_id,boutique_id', ignoreDuplicates: true },
            )
          }
        }

        // Sync skills
        if (rec.skills?.length) {
          const skillUpserts: Array<{ staff_id: string; skill_type_id: string; is_primary: boolean }> = []

          for (const sk of rec.skills) {
            const skillTypeId = skillTypeByName.get(sk.skill_name.toLowerCase())
            if (!skillTypeId) {
              errors.push(`${rec.external_hr_id}: unknown skill '${sk.skill_name}' — skipped`)
              continue
            }
            skillUpserts.push({ staff_id: staffId, skill_type_id: skillTypeId, is_primary: sk.is_primary ?? false })
          }

          if (skillUpserts.length) {
            // Ensure exactly one is_primary = true
            const primaryCount = skillUpserts.filter(s => s.is_primary).length
            if (primaryCount === 0 && skillUpserts.length > 0) skillUpserts[0].is_primary = true

            await db.from('staff_skills').upsert(skillUpserts, { onConflict: 'staff_id,skill_type_id' })
          }
        }

        synced++
      } catch (recordErr: any) {
        errors.push(`${rec.external_hr_id}: ${recordErr.message}`)
      }
    }

    return jsonResp({ success: true, synced, skipped: records.length - synced - errors.length, errors })
  } catch (err: any) {
    console.error('sync-staff error:', err)
    return jsonResp({ error: err.message }, 500)
  }
})
