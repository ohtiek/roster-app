/**
 * PublishTab.tsx
 *
 * Two sections:
 *   1. Pending queue  — rosters in `pending_review` waiting for approval
 *   2. History list   — all rosters ordered by date with status badges
 *
 * State machine:  pending_review → approved → published
 *                 pending_review → rejected
 *
 * Every state transition writes to Supabase and updates local UI optimistically.
 */

import { useState, useEffect, useCallback } from 'react'
import type { ShiftName } from '../types'
import { AVATAR_STYLE } from '../types'
import {
  fetchPendingRosters,
  fetchRosterHistory,
  fetchRosterById,
  approveRoster,
  rejectRoster,
  publishRoster,
  type RosterHistoryRow,
  type RosterStatus,
} from '../supabaseClient'

// ── Types from roster payload ─────────────────────────────────────────────────

interface PayloadAssignment {
  staffId: string
  shift: ShiftName
  isOverride: boolean
  overrideNote?: string
}

interface PayloadScore {
  shift: ShiftName
  score: number
  skill_ok: boolean
  vic_ok: boolean
  languages: string[]
}

interface RosterPayload {
  assignments: PayloadAssignment[]
  scores: PayloadScore[]
  date: string
  overrideIds?: string[]
}

// ── Seed name lookup (mirrors engine data — replace with live staff fetch if needed) ─

const STAFF_NAMES: Record<string, string> = {
  's-01':'Sophie Lam','s-02':'James Okafor','s-03':'Mei Lin','s-04':'Clara Moreau',
  's-05':'David Chen','s-06':'Ana Pereira','s-07':'Tom Ashby','s-08':'Layla Hassan',
  's-09':'Emma Dubois','s-10':'Ryan Ng','s-11':'Isabelle Roy','s-12':'Kenji Mori',
  's-13':'Lucas Park','s-14':'Nina Wolff','s-15':'Sasha Kim','s-16':'Omar Farouk',
  's-17':'Priya Shah','s-18':'Marc Leroy','s-19':'Celine Blanc','s-20':'Hiroshi Tanaka',
  's-21':'Fatima Al-Nur','s-22':'Louis Petit','s-23':'Amara Diallo',
  's-24':'Wei Zhang','s-25':'Charlotte Moore',
}

const AVC_COLORS: Record<string,[string,string]> = {
  'av-b':['#DDEAF8','#1E4D8C'],'av-p':['#EEEDFE','#3C3489'],'av-t':['#D8EEE8','#085041'],
  'av-c':['#FAECE7','#712B13'],'av-k':['#FBEAF0','#72243E'],'av-m':['#FAEEDA','#633806'],
  'av-g':['#EAF3DE','#27500A'],
}

const SHIFT_META: Record<ShiftName,{label:string;color:string}> = {
  morning:   { label:'Morning',   color:'#1E4D8C' },
  afternoon: { label:'Afternoon', color:'#4A3280' },
  closing:   { label:'Closing',   color:'#0F6E56' },
}
const SHIFTS: ShiftName[] = ['morning','afternoon','closing']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtDateTime(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function initials(id?: string) {
  if (!id) return '?'
  const name = STAFF_NAMES[id] ?? id
  return name.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase()
}

function avatarStyle(id?: string): { bg: string; fg: string } {
  if (!id) return { bg: '#D3D1C7', fg: '#444441' }
  const num = parseInt(id.replace(/\D/g, '') || '0')
  const idx = (isNaN(num) ? 0 : num) % Object.keys(AVC_COLORS).length
  const key = Object.keys(AVC_COLORS)[idx] ?? 'av-b'
  const pair = AVC_COLORS[key] ?? ['#D3D1C7', '#444441']
  return { bg: pair[0], fg: pair[1] }
}

function scoreColor(s?: number | null) {
  if (s == null || isNaN(s)) return 'var(--color-text-secondary)'
  return s >= 90 ? '#27500A' : s >= 70 ? '#633806' : '#791F1F'
}

function safeScore(s?: number | null): string {
  if (s == null || isNaN(s)) return '—'
  return Math.round(s).toString()
}

function safeSolver(s?: string | null): string {
  return s ?? 'unknown'
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<RosterStatus, { bg: string; color: string; label: string }> = {
  pending_review: { bg:'#FAEEDA', color:'#633806', label:'Awaiting review' },
  approved:       { bg:'#EAF3DE', color:'#27500A', label:'Approved'        },
  published:      { bg:'#E1F5EE', color:'#085041', label:'Published'       },
  rejected:       { bg:'#FCEBEB', color:'#791F1F', label:'Rejected'        },
}

function StatusBadge({ status }: { status: RosterStatus }) {
  const s = STATUS_STYLE[status] ?? { bg:'#D3D1C7', color:'#444441', label: status ?? 'Unknown' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: '3px 10px',
      borderRadius: 10, background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

// ── State progress bar ────────────────────────────────────────────────────────

function StateBar({ status }: { status: RosterStatus }) {
  const steps: { key: RosterStatus | 'generated'; label: string }[] = [
    { key:'generated',      label:'Generated'  },
    { key:'pending_review', label:'Review'     },
    { key:'approved',       label:'Approved'   },
    { key:'published',      label:'Published'  },
  ]
  const activeIdx = status === 'rejected'
    ? 1  // show stuck at review
    : steps.findIndex(s => s.key === status)

  return (
    <div style={{ display:'flex', marginBottom:14, background:'var(--color-background-primary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', overflow:'hidden' }}>
      {steps.map((step, i) => {
        const done = i < activeIdx
        const act  = i === activeIdx
        const pub  = step.key === 'published' && status === 'published'
        const rej  = status === 'rejected' && step.key === 'pending_review' && act
        return (
          <div key={step.key} style={{
            flex:1, padding:'9px 6px', textAlign:'center',
            fontSize:11, fontWeight:500,
            borderRight: i < steps.length-1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
            background: rej ? '#FCEBEB' : pub ? '#E1F5EE' : act ? '#FAEEDA' : done ? '#EAF3DE' : 'transparent',
            color: rej ? '#791F1F' : pub ? '#085041' : act ? '#633806' : done ? '#27500A' : 'var(--color-text-secondary)',
            display:'flex', flexDirection:'column', alignItems:'center', gap:3,
          }}>
            <div style={{
              width:7, height:7, borderRadius:'50%',
              background: rej ? '#E24B4A' : pub ? '#0F6E56' : act ? '#BA7517' : done ? '#27500A' : 'var(--color-border-tertiary)',
            }}/>
            {rej ? 'Rejected' : step.label}
          </div>
        )
      })}
    </div>
  )
}

// ── Shift preview (compact 3-column grid) ─────────────────────────────────────

function ShiftPreview({ payload }: { payload: RosterPayload }) {
  const [expanded, setExpanded] = useState<Set<ShiftName>>(new Set())
  const PREVIEW_LIMIT = 5

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:8, marginBottom:12 }}>
      {SHIFTS.map(shift => {
        const assigned = payload.assignments.filter(a => a.shift === shift)
        const score = payload.scores?.find(s => s.shift === shift)
        const meta = SHIFT_META[shift]
        const isExpanded = expanded.has(shift)
        const visible = isExpanded ? assigned : assigned.slice(0, PREVIEW_LIMIT)
        const hiddenCount = assigned.length - PREVIEW_LIMIT
        return (
          <div key={shift} style={{ borderRadius:'var(--border-radius-md)', overflow:'hidden', border:'0.5px solid var(--color-border-tertiary)' }}>
            <div style={{ background:meta.color, padding:'6px 9px', color:'white', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:12, fontWeight:500 }}>{meta.label}</span>
              <span style={{ fontSize:11, opacity:.75 }}>{assigned.length} staff {score ? `· ${Math.round(score.score)}` : ''}</span>
            </div>
            <div style={{ background:'var(--color-background-secondary)', padding:'6px 8px', minHeight:60 }}>
              {(visible ?? []).filter(a => a?.staffId).map((a,i) => {
                const av = avatarStyle(a.staffId)
                const name = STAFF_NAMES[a.staffId] ?? a.staffId ?? '?'
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
                    <div style={{ width:18, height:18, borderRadius:'50%', background:av.bg, color:av.fg, fontSize:8, fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {initials(a.staffId)}
                    </div>
                    <span style={{ fontSize:11, color:'var(--color-text-primary)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:1 }}>{name}</span>
                    {a.isOverride && (
                      <span style={{ fontSize:9, padding:'1px 4px', borderRadius:3, background:'#FAEEDA', color:'#633806', flexShrink:0 }}>
                        {a.overrideNote?.startsWith('Moved') ? 'Moved' : 'Added'}
                      </span>
                    )}
                  </div>
                )
              })}
              {hiddenCount > 0 && !isExpanded && (
                <button
                  onClick={() => setExpanded(prev => { const s = new Set(prev); s.add(shift); return s })}
                  style={{ fontSize:11, color:'var(--color-text-secondary)', marginTop:2, background:'none', border:'none', cursor:'pointer', padding:'2px 0', fontFamily:'inherit', textDecoration:'underline' }}
                >
                  +{hiddenCount} more
                </button>
              )}
              {isExpanded && assigned.length > PREVIEW_LIMIT && (
                <button
                  onClick={() => setExpanded(prev => { const s = new Set(prev); s.delete(shift); return s })}
                  style={{ fontSize:11, color:'var(--color-text-secondary)', marginTop:2, background:'none', border:'none', cursor:'pointer', padding:'2px 0', fontFamily:'inherit', textDecoration:'underline' }}
                >
                  Show less
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Reject modal ──────────────────────────────────────────────────────────────

function RejectModal({ onConfirm, onClose }: {
  onConfirm: (notes: string) => void
  onClose: () => void
}) {
  const [notes, setNotes] = useState('')
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(20,29,74,0.55)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background:'var(--color-background-primary)',
        border:'0.5px solid var(--color-border-tertiary)',
        borderRadius:'var(--border-radius-lg)',
        padding:20, width:'min(340px, calc(100vw - 32px))',
      }}>
        <div style={{ fontSize:15, fontWeight:500, color:'var(--color-text-primary)', marginBottom:6 }}>Reject roster</div>
        <div style={{ fontSize:13, color:'var(--color-text-secondary)', marginBottom:12, lineHeight:1.5 }}>
          This returns the plan to the planner. Optionally add a note for the planner.
        </div>
        <textarea
          autoFocus
          placeholder="e.g. Closing shift needs a VIC advisor. Please add Lucas Park."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{
            width:'100%', height:80, fontSize:13, fontFamily:'inherit',
            border:'0.5px solid var(--color-border-secondary)',
            borderRadius:'var(--border-radius-md)', padding:'8px 10px',
            resize:'none', outline:'none',
            background:'var(--color-background-secondary)',
            color:'var(--color-text-primary)',
          }}
        />
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
          <button onClick={onClose} style={{ padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-secondary)', background:'transparent', fontSize:13, cursor:'pointer', fontFamily:'inherit', color:'var(--color-text-primary)' }}>Cancel</button>
          <button onClick={() => onConfirm(notes)} style={{ padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'none', background:'#E24B4A', color:'white', fontSize:13, fontWeight:500, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:5 }}>
            <i className="ti ti-x" aria-hidden="true" style={{ fontSize:13 }} /> Reject
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Approve modal ─────────────────────────────────────────────────────────────

function ApproveModal({
  roster, checks, onConfirm, onClose,
}: {
  roster: RosterHistoryRow
  checks: { label: string; ok: boolean }[]
  onConfirm: (approvedBy: string, notes: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const hasError = checks.some(c => !c.ok)
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(20,29,74,0.55)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background:'var(--color-background-primary)',
        border:'0.5px solid var(--color-border-tertiary)',
        borderRadius:'var(--border-radius-lg)',
        padding:20, width:'min(380px, calc(100vw - 32px))',
      }}>
        <div style={{ fontSize:15, fontWeight:500, color:'var(--color-text-primary)', marginBottom:6 }}>Approve roster</div>
        <div style={{ fontSize:13, color:'var(--color-text-secondary)', marginBottom:12, lineHeight:1.5 }}>
          Approving enables publishing. Check all items below before proceeding.
        </div>

        <div style={{ marginBottom:14, display:'flex', flexDirection:'column', gap:6 }}>
          {checks.map((c,i) => (
            <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.4 }}>
              <i className={`ti ${c.ok ? 'ti-check' : 'ti-alert-triangle'}`} aria-hidden="true" style={{ fontSize:14, color: c.ok ? '#27500A' : '#BA7517', flexShrink:0, marginTop:1 }} />
              {c.label}
            </div>
          ))}
        </div>

        <div style={{ marginBottom:10 }}>
          <label style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--color-text-secondary)', display:'block', marginBottom:4 }}>Your name</label>
          <input
            autoFocus
            placeholder="e.g. Sophie Lam"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width:'100%', height:32, fontSize:13, fontFamily:'inherit', border:'0.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', padding:'0 10px', outline:'none', background:'var(--color-background-secondary)', color:'var(--color-text-primary)' }}
          />
        </div>

        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--color-text-secondary)', display:'block', marginBottom:4 }}>Note (optional)</label>
          <input
            placeholder="e.g. Confirmed fatigue exemption for Lucas"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ width:'100%', height:32, fontSize:13, fontFamily:'inherit', border:'0.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', padding:'0 10px', outline:'none', background:'var(--color-background-secondary)', color:'var(--color-text-primary)' }}
          />
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-secondary)', background:'transparent', fontSize:13, cursor:'pointer', fontFamily:'inherit', color:'var(--color-text-primary)' }}>Cancel</button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim(), notes)}
            disabled={!name.trim()}
            style={{ padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'none', background: name.trim() ? '#1E2761' : 'var(--color-border-tertiary)', color:'white', fontSize:13, fontWeight:500, cursor: name.trim() ? 'pointer' : 'default', fontFamily:'inherit', display:'flex', alignItems:'center', gap:5 }}
          >
            <i className="ti ti-check" aria-hidden="true" style={{ fontSize:13 }} /> Approve plan
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Publish confirm modal ─────────────────────────────────────────────────────

function PublishModal({
  roster, onConfirm, onClose,
}: {
  roster: RosterHistoryRow
  onConfirm: (publishedBy: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(20,29,74,0.55)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:200,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background:'var(--color-background-primary)',
        border:'0.5px solid #C9A84C',
        borderRadius:'var(--border-radius-lg)',
        padding:20, width:'min(360px, calc(100vw - 32px))',
      }}>
        <div style={{ fontSize:15, fontWeight:500, color:'var(--color-text-primary)', marginBottom:6 }}>
          <i className="ti ti-send" aria-hidden="true" style={{ marginRight:6, color:'#C9A84C' }} />
          Publish roster
        </div>
        <div style={{ fontSize:13, color:'var(--color-text-secondary)', marginBottom:12, lineHeight:1.5 }}>
          This makes the roster live on the store front-end. This action cannot be undone.
        </div>

        <div style={{ background:'#F5F0E8', border:'0.5px solid #C9A84C', borderRadius:'var(--border-radius-md)', padding:'10px 12px', marginBottom:14 }}>
          <div style={{ fontSize:12, color:'#7A5C1E', marginBottom:6, fontWeight:500 }}>
            {fmtDate(roster.roster_date)}
          </div>
          <div style={{ fontSize:12, color:'#7A5C1E' }}>
            Score {safeScore(roster.overall_score)}/100 · {roster.override_count ?? 0} override{(roster.override_count ?? 0) !== 1 ? 's' : ''}
          </div>
          {roster.notes && (
            <div style={{ fontSize:12, color:'#7A5C1E', marginTop:4, fontStyle:'italic' }}>"{roster.notes}"</div>
          )}
        </div>

        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--color-text-secondary)', display:'block', marginBottom:4 }}>Published by</label>
          <input
            autoFocus
            placeholder="e.g. Sophie Lam"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width:'100%', height:32, fontSize:13, fontFamily:'inherit', border:'0.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', padding:'0 10px', outline:'none', background:'var(--color-background-secondary)', color:'var(--color-text-primary)' }}
          />
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-secondary)', background:'transparent', fontSize:13, cursor:'pointer', fontFamily:'inherit', color:'var(--color-text-primary)' }}>Cancel</button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            style={{ padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'none', background: name.trim() ? '#0F6E56' : 'var(--color-border-tertiary)', color:'white', fontSize:13, fontWeight:500, cursor: name.trim() ? 'pointer' : 'default', fontFamily:'inherit', display:'flex', alignItems:'center', gap:5 }}
          >
            <i className="ti ti-send" aria-hidden="true" style={{ fontSize:13 }} /> Publish now
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pending roster card ───────────────────────────────────────────────────────

function PendingCard({
  roster,
  onApprove,
  onReject,
  onPublish,
}: {
  roster: RosterHistoryRow
  onApprove: (id: string, by: string, notes: string) => Promise<void>
  onReject:  (id: string, notes: string) => Promise<void>
  onPublish: (id: string, by: string) => Promise<void>
}) {
  const [localStatus, setLocalStatus] = useState<RosterStatus>(roster.status)
  const [showApprove, setShowApprove]  = useState(false)
  const [showReject, setShowReject]    = useState(false)
  const [showPublish, setShowPublish]  = useState(false)
  const [working, setWorking]          = useState(false)
  const [localNotes, setLocalNotes]    = useState(roster.notes ?? '')

  // Supabase may return payload as a JSON string or object depending on client version
  const payload: RosterPayload | null = (() => {
    if (!roster.payload) return null
    if (typeof roster.payload === 'string') {
      try { return JSON.parse(roster.payload) } catch { return null }
    }
    return roster.payload as RosterPayload
  })()

  const overrideCount = roster.override_count ?? 0
  const hasWarnings   = overrideCount > 0

  const checks = [
    { label: `Score ${safeScore(roster.overall_score)}/100 — ${(roster.overall_score ?? 0) >= 90 ? 'all constraints met' : 'some constraints marginal'}`, ok: (roster.overall_score ?? 0) >= 80 },
    ...(overrideCount > 0 ? [{ label: `${overrideCount} manual override${overrideCount > 1 ? 's' : ''} — review shift assignments above`, ok: true }] : []),
  ]

  async function doApprove(by: string, notes: string) {
    setWorking(true)
    try {
      await onApprove(roster.id, by, notes)
      setLocalStatus('approved')
      setLocalNotes(notes)
      setShowApprove(false)
    } finally { setWorking(false) }
  }

  async function doReject(notes: string) {
    setWorking(true)
    try {
      await onReject(roster.id, notes)
      setLocalStatus('rejected')
      setLocalNotes(notes)
      setShowReject(false)
    } finally { setWorking(false) }
  }

  async function doPublish(by: string) {
    setWorking(true)
    try {
      await onPublish(roster.id, by)
      setLocalStatus('published')
      setShowPublish(false)
    } finally { setWorking(false) }
  }

  return (
    <div style={{ position:'relative', background:'var(--color-background-primary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', overflow:'hidden', marginBottom:14 }}>

      {/* Modals */}
      {showApprove && <ApproveModal roster={roster} checks={checks} onConfirm={doApprove} onClose={() => setShowApprove(false)} />}
      {showReject  && <RejectModal  onConfirm={doReject}  onClose={() => setShowReject(false)} />}
      {showPublish && localStatus === 'approved' && <PublishModal roster={roster} onConfirm={doPublish} onClose={() => setShowPublish(false)} />}

      {/* Card header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'0.5px solid var(--color-border-tertiary)' }}>
        <div>
          <div style={{ fontSize:15, fontWeight:500, color:'var(--color-text-primary)' }}>{fmtDate(roster.roster_date)}</div>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginTop:2 }}>
            Generated {fmtDateTime(roster.created_at)}
            {overrideCount > 0 && ` · ${overrideCount} override${overrideCount > 1 ? 's' : ''}`}
          </div>
        </div>
        <StatusBadge status={localStatus} />
      </div>

      {/* State progress bar */}
      <div style={{ padding:'12px 16px 0' }}>
        <StateBar status={localStatus} />
      </div>

      {/* Score summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,minmax(0,1fr))', gap:8, padding:'0 16px 12px' }}>
        {[
          { label:'Overall score', value:safeScore(roster.overall_score), suffix:'', color: scoreColor(roster.overall_score) },
          { label:'Overrides',     value:overrideCount,                    suffix:'', color:'var(--color-text-primary)' },
          { label:'Status',        value:STATUS_STYLE[localStatus].label,  suffix:'', color:STATUS_STYLE[localStatus].color },
          { label:'Date',          value:fmtDate(roster.roster_date),      suffix:'', color:'var(--color-text-primary)' },
        ].map(({ label, value, suffix, color }) => (
          <div key={label} style={{ background:'var(--color-background-secondary)', borderRadius:'var(--border-radius-md)', padding:'8px 10px' }}>
            <div style={{ fontSize:10, color:'var(--color-text-secondary)', marginBottom:2 }}>{label}</div>
            <div style={{ fontSize: typeof value === 'number' ? 20 : 12, fontWeight:500, color }}>{value}{suffix}</div>
          </div>
        ))}
      </div>

      {/* Shift preview */}
      {payload && (
        <div style={{ padding:'0 16px 12px' }}>
          <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--color-text-secondary)', marginBottom:8 }}>Shift assignments</div>
          <ShiftPreview payload={payload} />
        </div>
      )}

      {/* Override & notes strip */}
      {(overrideCount > 0 || localNotes) && (
        <div style={{ margin:'0 16px 12px', background:'#FEF9F0', border:'0.5px solid #D97706', borderRadius:'var(--border-radius-md)', padding:'9px 12px', fontSize:12, color:'#633806', lineHeight:1.5 }}>
          {overrideCount > 0 && (
            <div style={{ display:'flex', gap:6, alignItems:'flex-start' }}>
              <i className="ti ti-edit" aria-hidden="true" style={{ fontSize:13, flexShrink:0, marginTop:1 }} />
              <span><strong>{overrideCount} manual override{overrideCount > 1 ? 's' : ''}</strong> — review shift assignments to confirm changes are intentional.</span>
            </div>
          )}
          {localNotes && (
            <div style={{ marginTop: overrideCount > 0 ? 6 : 0, display:'flex', gap:6, alignItems:'flex-start' }}>
              <i className="ti ti-message" aria-hidden="true" style={{ fontSize:13, flexShrink:0, marginTop:1 }} />
              <span><strong>Note:</strong> {localNotes}</span>
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      {localStatus !== 'published' && localStatus !== 'rejected' && (
        <div style={{ padding:'12px 16px', borderTop:'0.5px solid var(--color-border-tertiary)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)', flex:1 }}>
            {localStatus === 'pending_review'
              ? 'Review the plan above. Approve to enable publishing, or reject to return to the planner.'
              : 'Plan approved. Click Publish to make it live on the roster dashboard.'}
          </div>
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            {localStatus === 'pending_review' && (
              <>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={working}
                  style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 12px', borderRadius:'var(--border-radius-md)', border:'0.5px solid #F09595', background:'transparent', color:'#791F1F', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}
                >
                  <i className="ti ti-x" aria-hidden="true" style={{ fontSize:13 }} /> Reject
                </button>
                <button
                  onClick={() => setShowApprove(true)}
                  disabled={working}
                  style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'none', background:'#1E2761', color:'white', fontSize:13, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}
                >
                  <i className="ti ti-check" aria-hidden="true" style={{ fontSize:13 }} /> Approve
                </button>
              </>
            )}
            {localStatus === 'approved' && (
              <>
                <button
                  onClick={() => setShowReject(true)}
                  disabled={working}
                  style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 12px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-secondary)', background:'transparent', color:'var(--color-text-secondary)', fontSize:13, cursor:'pointer', fontFamily:'inherit' }}
                >
                  <i className="ti ti-rotate-left" aria-hidden="true" style={{ fontSize:13 }} /> Revoke approval
                </button>
                <button
                  onClick={() => setShowPublish(true)}
                  disabled={working}
                  style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 14px', borderRadius:'var(--border-radius-md)', border:'none', background:'#0F6E56', color:'white', fontSize:13, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}
                >
                  <i className="ti ti-send" aria-hidden="true" style={{ fontSize:13 }} /> Publish roster
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {localStatus === 'published' && (
        <div style={{ padding:'10px 16px', borderTop:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-success)', display:'flex', alignItems:'center', gap:8, fontSize:13, color:'var(--color-text-success)', fontWeight:500 }}>
          <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize:16 }} />
          Published and live on the roster dashboard
          <button onClick={() => window.print()} style={{ marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-success)', background:'transparent', color:'var(--color-text-success)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
            <i className="ti ti-printer" aria-hidden="true" style={{ fontSize:12 }} /> Print
          </button>
        </div>
      )}

      {localStatus === 'rejected' && (
        <div style={{ padding:'10px 16px', borderTop:'0.5px solid var(--color-border-tertiary)', background:'var(--color-background-danger)', display:'flex', alignItems:'center', gap:8, fontSize:13, color:'var(--color-text-danger)' }}>
          <i className="ti ti-x" aria-hidden="true" style={{ fontSize:16 }} />
          Rejected — return to the Roster Planner to make changes
        </div>
      )}
    </div>
  )
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({
  row, onPreview,
}: {
  row: RosterHistoryRow
  onPreview: (id: string) => void
}) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, background:'var(--color-background-primary)', border:'0.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:'10px 14px' }}>
      <div style={{ width:110, flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)' }}>{fmtDate(row.roster_date)}</div>
      </div>
      <div style={{ flex:1, fontSize:12, color:'var(--color-text-secondary)' }}>
        {row.override_count ?? 0} override{(row.override_count ?? 0) !== 1 ? 's' : ''}
        {row.published_at && ` · Published ${fmtDateTime(row.published_at)}`}
        {row.approved_by  && ` · Approved by ${row.approved_by}`}
        {row.notes        && <span style={{ fontStyle:'italic' }}> · "{row.notes}"</span>}
      </div>
      <div style={{ fontSize:18, fontWeight:500, color: scoreColor(row.overall_score), width:32, textAlign:'right', flexShrink:0 }}>
        {safeScore(row.overall_score)}
      </div>
      <StatusBadge status={row.status} />
      <button
        onClick={() => onPreview(row.id)}
        style={{ fontSize:11, padding:'4px 10px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-secondary)', background:'transparent', color:'var(--color-text-secondary)', cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap' }}
      >
        View ↗
      </button>
    </div>
  )
}

// ── Preview modal (read-only roster view) ─────────────────────────────────────

function PreviewModal({ rosterId, onClose }: { rosterId: string; onClose: () => void }) {
  const [row, setRow] = useState<RosterHistoryRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRosterById(rosterId).then(setRow).finally(() => setLoading(false))
  }, [rosterId])

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(20,29,74,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:20 }}>
      <div style={{ background:'var(--color-background-primary)', borderRadius:'var(--border-radius-lg)', border:'0.5px solid var(--color-border-tertiary)', width:'100%', maxWidth:560, maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'0.5px solid var(--color-border-tertiary)', flexShrink:0 }}>
          <span style={{ fontSize:15, fontWeight:500, color:'var(--color-text-primary)' }}>
            {row ? fmtDate(row.roster_date) : 'Loading…'}
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--color-text-secondary)' }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div style={{ overflowY:'auto', flex:1, padding:18 }}>
          {loading && <div style={{ color:'var(--color-text-secondary)', fontSize:14 }}>Loading…</div>}
          {row && !loading && (
            <>
              <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                <StatusBadge status={row.status} />
                <span style={{ fontSize:12, color:'var(--color-text-secondary)' }}>Score {safeScore(row.overall_score)}/100</span>
                {row.override_count ? <span style={{ fontSize:12, color:'var(--color-text-secondary)' }}>{row.override_count} overrides</span> : null}
              </div>
              {row.payload && <ShiftPreview payload={
                typeof row.payload === 'string'
                  ? (() => { try { return JSON.parse(row.payload as string) } catch { return null } })()
                  : row.payload as RosterPayload
              } />}
              {row.notes && (
                <div style={{ fontSize:12, color:'var(--color-text-secondary)', fontStyle:'italic', borderTop:'0.5px solid var(--color-border-tertiary)', paddingTop:10 }}>
                  Note: "{row.notes}"
                </div>
              )}
              {row.approved_at && <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginTop:6 }}>Approved {fmtDateTime(row.approved_at)}{row.approved_by ? ` by ${row.approved_by}` : ''}</div>}
              {row.published_at && <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginTop:4 }}>Published {fmtDateTime(row.published_at)}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function PublishTab() {
  const [pending, setPending]       = useState<RosterHistoryRow[]>([])
  const [history, setHistory]       = useState<RosterHistoryRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [toast, setToast]           = useState<string | null>(null)
  const [previewId, setPreviewId]   = useState<string | null>(null)

  function showToast(msg: string, dur = 2500) {
    setToast(msg)
    setTimeout(() => setToast(null), dur)
  }

  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [p, h] = await Promise.all([fetchPendingRosters(), fetchRosterHistory()])
      setPending(p); setHistory(h)
    } catch (e: any) {
      setError('Failed to load: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function handleApprove(id: string, by: string, notes: string) {
    await approveRoster(id, by, notes)
    showToast(`Roster approved by ${by} ✓`)
    reload()
  }

  async function handleReject(id: string, notes: string) {
    await rejectRoster(id, 'Admin', notes)
    showToast('Roster rejected — returned to planner')
    reload()
  }

  async function handlePublish(id: string, by: string) {
    await publishRoster(id, by)
    showToast(`Roster published by ${by} ✓`, 3500)
    reload()
  }

  const pendingCount = pending.length

  return (
    <div style={{ padding:'16px 20px', flex:1, position:'relative' }}>

      {toast && (
        <div style={{ position:'absolute', top:10, right:14, zIndex:100, background:'#1E2761', color:'white', padding:'8px 14px', borderRadius:'var(--border-radius-md)', fontSize:13, fontWeight:500 }}>
          {toast}
        </div>
      )}

      {previewId && <PreviewModal rosterId={previewId} onClose={() => setPreviewId(null)} />}

      {/* ── Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ fontSize:13, color:'var(--color-text-secondary)' }}>
          {pendingCount > 0
            ? <span style={{ fontWeight:500, color:'#633806' }}>{pendingCount} roster{pendingCount > 1 ? 's' : ''} awaiting review</span>
            : <span>No rosters pending review</span>}
        </div>
        <button
          onClick={reload}
          disabled={loading}
          style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:'var(--border-radius-md)', border:'0.5px solid var(--color-border-secondary)', background:'transparent', fontSize:12, cursor:'pointer', color:'var(--color-text-secondary)', fontFamily:'inherit' }}
        >
          <i className="ti ti-refresh" aria-hidden="true" style={{ fontSize:13 }} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background:'var(--color-background-danger)', border:'0.5px solid var(--color-border-danger)', borderRadius:'var(--border-radius-md)', padding:'10px 14px', fontSize:13, color:'var(--color-text-danger)', marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
          <i className="ti ti-alert-circle" aria-hidden="true" />
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'var(--color-text-danger)' }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Pending queue ── */}
      {!loading && pending.length === 0 && (
        <div style={{ textAlign:'center', padding:'36px 24px', border:'0.5px dashed var(--color-border-secondary)', borderRadius:'var(--border-radius-lg)', background:'var(--color-background-primary)', marginBottom:14 }}>
          <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize:32, opacity:.3, display:'block', marginBottom:10 }} />
          <div style={{ fontWeight:500, color:'var(--color-text-primary)', marginBottom:4 }}>All clear</div>
          <div style={{ fontSize:13, color:'var(--color-text-secondary)' }}>No rosters waiting for review. Generate and send a plan from the Roster Planner tab.</div>
        </div>
      )}

      {pending.map(r => (
        <PendingCard
          key={r.id}
          roster={r}
          onApprove={handleApprove}
          onReject={handleReject}
          onPublish={handlePublish}
        />
      ))}

      {/* ── History ── */}
      <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--color-text-secondary)', marginBottom:10 }}>
        Publish history
      </div>
      {!loading && history.length === 0 && (
        <div style={{ fontSize:13, color:'var(--color-text-secondary)', padding:'16px 0' }}>No history yet.</div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {history.filter(r => r.status !== 'pending_review').map(r => (
          <HistoryRow key={r.id} row={r} onPreview={setPreviewId} />
        ))}
      </div>

    </div>
  )
}
