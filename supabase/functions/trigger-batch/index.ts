/**
 * trigger-batch — ETL webhook receiver and nightly batch orchestrator.
 *
 * Called by:
 *   - ETL system (POST with X-Batch-Signature HMAC header)
 *   - pg_cron schedule (POST with X-Batch-Source: pg_cron header)
 *   - Admin manual trigger (POST with service role Bearer token)
 *
 * Orchestration order:
 *   1. sync-staff  (optional, only when ETL includes a staff export)
 *   2. sync-leave  (optional, skip if no leave export available)
 *   3. generate-roster for each active boutique in parallel
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BATCH_WEBHOOK_SECRET = Deno.env.get('BATCH_WEBHOOK_SECRET')

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  // HMAC verification for external ETL webhooks
  const batchSource = req.headers.get('x-batch-source') ?? 'webhook'
  if (BATCH_WEBHOOK_SECRET && batchSource !== 'pg_cron' && batchSource !== 'manual') {
    const rawBody = await req.clone().text()
    const sigHeader = req.headers.get('x-batch-signature') ?? ''
    const valid = await verifyHmac(rawBody, sigHeader, BATCH_WEBHOOK_SECRET)
    if (!valid) return jsonResp({ error: 'invalid signature' }, 401)
  }

  let body: Record<string, any> = {}
  try { body = await req.json() } catch { /* pg_cron may send empty body */ }

  const {
    source = batchSource,
    boutique_ids,           // optional string[]: limit to specific boutiques
    roster_date,            // optional: defaults to tomorrow
    run_sync_staff = false, // trigger staff sync before generation
    run_sync_leave = true,  // trigger leave sync before generation
  } = body

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Target date: tomorrow by default
  const targetDate: string = roster_date ?? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().substring(0, 10)
  })()

  // Log batch run start
  const { data: runLog } = await db
    .from('batch_run_log')
    .insert({ source, target_date: targetDate, boutique_ids: boutique_ids ?? null, status: 'running' })
    .select('id')
    .single()

  const runId = runLog?.id
  const errors: string[] = []

  try {
    // Resolve boutiques to process
    let boutiqueIds: string[] = boutique_ids ?? []
    if (!boutiqueIds.length) {
      const { data: active } = await db
        .from('boutiques')
        .select('id')
        .eq('is_active', true)
      boutiqueIds = (active ?? []).map((b: any) => b.id)
    }

    if (!boutiqueIds.length) {
      await updateRunLog(db, runId, 'completed', 0, ['no active boutiques found'])
      return jsonResp({ success: true, boutiques_processed: 0, target_date: targetDate })
    }

    // Step 1: staff sync
    if (run_sync_staff) {
      const r = await callFunction('sync-staff', { source }).catch(e => ({ success: false, error: e.message }))
      if (!r.success) errors.push(`sync-staff: ${r.error}`)
    }

    // Step 2: leave sync
    if (run_sync_leave) {
      const r = await callFunction('sync-leave', { source }).catch(e => ({ success: false, error: e.message }))
      if (!r.success) errors.push(`sync-leave: ${r.error}`)
    }

    // Step 3: generate rosters (parallel, one per boutique)
    const rosterResults = await Promise.allSettled(
      boutiqueIds.map(boutique_id =>
        callFunction('generate-roster', { boutique_id, roster_date: targetDate })
      )
    )

    let succeeded = 0
    for (let i = 0; i < rosterResults.length; i++) {
      const r = rosterResults[i]
      if (r.status === 'fulfilled' && r.value?.success) {
        succeeded++
      } else {
        const reason = r.status === 'rejected'
          ? r.reason?.message ?? 'unknown error'
          : r.value?.error ?? 'unknown error'
        errors.push(`boutique ${boutiqueIds[i]}: ${reason}`)
      }
    }

    const finalStatus = errors.length
      ? (succeeded > 0 ? 'completed_with_errors' : 'failed')
      : 'completed'

    await updateRunLog(db, runId, finalStatus, succeeded, errors.length ? errors : null)

    return jsonResp({
      success: finalStatus !== 'failed',
      target_date: targetDate,
      boutiques_processed: succeeded,
      boutiques_total: boutiqueIds.length,
      errors: errors.length ? errors : undefined,
    })
  } catch (err: any) {
    console.error('trigger-batch error:', err)
    await updateRunLog(db, runId, 'failed', 0, [err.message])
    return jsonResp({ error: err.message }, 500)
  }
})

async function callFunction(name: string, body: unknown): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'X-Batch-Source': 'internal',
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`${name} returned ${resp.status}: ${text}`)
  }
  return resp.json()
}

async function updateRunLog(
  db: ReturnType<typeof createClient>,
  runId: string | undefined,
  status: string,
  boutiques_processed: number,
  errors: string[] | null,
) {
  if (!runId) return
  await db.from('batch_run_log').update({
    status,
    boutiques_processed,
    errors,
    completed_at: new Date().toISOString(),
  }).eq('id', runId)
}

async function verifyHmac(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify'],
    )
    const hex = sigHeader.startsWith('sha256=') ? sigHeader.slice(7) : sigHeader
    const sigBytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body))
  } catch {
    return false
  }
}
