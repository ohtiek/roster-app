/**
 * Admin panel — identical UX to the Azure version,
 * but all data operations go through Supabase instead of the FastAPI backend.
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { StaffMember, VICClient, ScoringWeights } from '../types'
import {
  fetchStaff, upsertStaff, deleteStaff,
  fetchVICClients, upsertVICClient, deleteVICClient,
  fetchWeights, saveWeights,
} from '../supabaseClient'
import {
  ALL_ROLES, ALL_GENDERS, ALL_SHIFTS, ALL_LANGUAGES,
  AVATAR_COLORS, AVATAR_STYLE, WEIGHT_META, DEFAULT_WEIGHTS,
  type Role, type Gender, type SkillLevel, type ShiftName,
} from '../types'
import '../admin/AdminPanel.css'
import RosterPlannerTab from './RosterPlannerTab'
import PublishTab from './PublishTab'

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string) { return name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() }

function Avatar({ staff, size=36 }: { staff: Pick<StaffMember,'name'|'avatar_color'>; size?: number }) {
  const s = AVATAR_STYLE[staff.avatar_color??'av-b'] ?? AVATAR_STYLE['av-b']
  return (
    <div className="av" style={{width:size,height:size,background:s.bg,color:s.fg,fontSize:size*.3}}>
      {initials(staff.name)}
    </div>
  )
}

function Tag({label,variant}:{label:string;variant:'role'|'lang'|'shift'|'vic'}) {
  return <span className={`tag tag-${variant}`}>{label}</span>
}

function DateConstraintField({label, dates, onChange}: {label: string; dates: string[]; onChange: (d: string[]) => void}) {
  const [input, setInput] = useState('')
  function add() {
    if (input && !dates.includes(input)) onChange([...dates, input].sort())
    setInput('')
  }
  function fmt(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})
  }
  return (
    <div className="form-row">
      <label>{label}</label>
      <div className="date-constraint-field">
        <div className="date-chip-row">
          {dates.length === 0 && <span className="date-empty">No dates set</span>}
          {dates.map(d => (
            <span key={d} className="date-chip">
              {fmt(d)}
              <button type="button" className="date-chip-rm" onClick={() => onChange(dates.filter(x => x !== d))}>×</button>
            </span>
          ))}
        </div>
        <div className="date-add-row">
          <input type="date" className="inp inp-date" value={input} onChange={e => setInput(e.target.value)}/>
          <button type="button" className="btn bp btn-sm" onClick={add} disabled={!input}>Add</button>
        </div>
      </div>
    </div>
  )
}

const EMPTY: Omit<StaffMember,'id'|'created_at'|'updated_at'> = {
  name:'', role:'Jr. Stylist', seniority:'junior', gender:'F',
  languages:['EN'], available_shifts:['morning','afternoon','closing'],
  must_work_dates:[], cannot_work_dates:[], avatar_color:'av-b',
}

function StaffForm({value, onChange, vicClients}:{
  value: Omit<StaffMember,'id'|'created_at'|'updated_at'>
  onChange: (v: typeof value)=>void
  vicClients: VICClient[]
}) {
  const set = <K extends keyof typeof value>(k:K, v:(typeof value)[K]) => onChange({...value,[k]:v})
  function toggleArr<T>(arr:T[], item:T): T[] { return arr.includes(item)?arr.filter(x=>x!==item):[...arr,item] }
  return (
    <div className="staff-form">
      <div className="form-row">
        <label>Full name</label>
        <input value={value.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Sophie Lam" className="inp"/>
      </div>
      <div className="form-row-2">
        <div className="form-row">
          <label>Role</label>
          <select className="inp" value={value.role} onChange={e=>set('role',e.target.value as Role)}>
            {ALL_ROLES.map(r=><option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Seniority</label>
          <select className="inp" value={value.seniority} onChange={e=>set('seniority',e.target.value as SkillLevel)}>
            <option value="junior">Junior</option><option value="senior">Senior</option><option value="manager">Manager</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <label>Gender</label>
        <div className="chip-group">
          {ALL_GENDERS.map(g=>(
            <button key={g.value} type="button" className={`chip-btn ${value.gender===g.value?'active':''}`}
              onClick={()=>set('gender',g.value as Gender)}>{g.label}</button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>Languages</label>
        <div className="chip-group wrap">
          {ALL_LANGUAGES.map(l=>(
            <button key={l} type="button" className={`chip-btn ${value.languages.includes(l)?'active':''}`}
              onClick={()=>set('languages',toggleArr(value.languages,l))}>{l}</button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>Available shifts</label>
        <div className="chip-group">
          {ALL_SHIFTS.map(s=>(
            <button key={s} type="button" className={`chip-btn ${value.available_shifts.includes(s)?'active':''}`}
              onClick={()=>set('available_shifts',toggleArr(value.available_shifts,s) as ShiftName[])}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>Avatar colour</label>
        <div className="chip-group">
          {AVATAR_COLORS.map(c=>{
            const s=AVATAR_STYLE[c]
            return (
              <button key={c} type="button" className={`color-dot ${value.avatar_color===c?'selected':''}`}
                style={{background:s.bg,border:`2px solid ${value.avatar_color===c?s.fg:'transparent'}`}}
                onClick={()=>set('avatar_color',c)} aria-label={c}>
                <span style={{color:s.fg,fontSize:10,fontWeight:500}}>{c.replace('av-','').toUpperCase()}</span>
              </button>
            )
          })}
        </div>
      </div>
      {vicClients.length>0&&(
        <div className="form-row">
          <label>VIC affiliations (managed in VIC clients tab)</label>
          <div style={{fontSize:12,color:'var(--muted)'}}>Assign advisors from the VIC Clients tab.</div>
        </div>
      )}
      <DateConstraintField label="Must work on dates" dates={value.must_work_dates ?? []} onChange={v=>set('must_work_dates',v)}/>
      <DateConstraintField label="Cannot work on dates" dates={value.cannot_work_dates ?? []} onChange={v=>set('cannot_work_dates',v)}/>
    </div>
  )
}

function Modal({title,onClose,children,actions}:{title:string;onClose:()=>void;children:React.ReactNode;actions?:React.ReactNode}) {
  return (
    <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal" role="dialog">
        <div className="modal-hdr"><span className="modal-title">{title}</span><button className="icon-btn" onClick={onClose}><i className="ti ti-x" aria-hidden="true"/></button></div>
        <div className="modal-body">{children}</div>
        {actions&&<div className="modal-footer">{actions}</div>}
      </div>
    </div>
  )
}

// ── Staff tab ─────────────────────────────────────────────────────────────────
function StaffTab({vicClients}:{vicClients:VICClient[]}) {
  const [staff,setStaff] = useState<StaffMember[]>([])
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [search,setSearch] = useState('')
  const [roleFilter,setRoleFilter] = useState<string>('All')
  const [editingId,setEditingId] = useState<string|null>(null)
  const [editForm,setEditForm] = useState<any>({...EMPTY})
  const [addOpen,setAddOpen] = useState(false)
  const [addForm,setAddForm] = useState<any>({...EMPTY})
  const [confirmDelete,setConfirmDelete] = useState<string|null>(null)
  const [toast,setToast] = useState<string|null>(null)

  useEffect(()=>{fetchStaff().then(setStaff).catch(e=>showToast('Error: '+e.message)).finally(()=>setLoading(false))},[])

  function showToast(msg:string){setToast(msg);setTimeout(()=>setToast(null),2500)}

  const filtered = staff.filter(s=>{
    const q=search.toLowerCase()
    return (!q||s.name.toLowerCase().includes(q)||s.role.toLowerCase().includes(q))
      &&(roleFilter==='All'||s.role===roleFilter)
  })

  async function saveEdit(id:string) {
    setSaving(true)
    try {
      const updated = await upsertStaff({id,...editForm})
      setStaff(staff.map(s=>s.id===id?updated:s))
      setEditingId(null)
      showToast('Saved ✓')
    } catch(e:any){showToast('Save failed: '+e.message)}
    finally{setSaving(false)}
  }

  async function doAdd() {
    if(!addForm.name.trim()) return
    setSaving(true)
    try {
      const created = await upsertStaff({...addForm} as StaffMember)
      setStaff([...staff,created])
      setAddOpen(false); setAddForm({...EMPTY})
      showToast('Added ✓')
    } catch(e:any){showToast('Add failed: '+e.message)}
    finally{setSaving(false)}
  }

  async function doDelete(id:string) {
    try {
      await deleteStaff(id)
      setStaff(staff.filter(s=>s.id!==id))
      setConfirmDelete(null)
      showToast('Deleted')
    } catch(e:any){showToast('Delete failed: '+e.message)}
  }

  if(loading) return <div className="tab-content"><div style={{padding:'2rem',color:'var(--muted)'}}>Loading from Supabase…</div></div>

  return (
    <div className="tab-content">
      {toast&&<div style={{position:'fixed',top:16,right:16,background:'var(--navy)',color:'white',padding:'8px 16px',borderRadius:6,fontSize:13,zIndex:2000}}>{toast}</div>}
      <div className="tab-toolbar">
        <div className="search-w"><i className="ti ti-search si" aria-hidden="true"/><input className="sinp" placeholder="Search staff…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="fpills">
          {['All',...ALL_ROLES].map(r=>(
            <button key={r} className={`fp ${roleFilter===(r==='All'?'All':r)?'act':''}`} onClick={()=>setRoleFilter(r==='All'?'All':r)}>
              {r==='All'?'All roles':r}
            </button>
          ))}
        </div>
        <button className="btn bp" onClick={()=>{setAddOpen(true);setAddForm({...EMPTY})}}><i className="ti ti-plus" aria-hidden="true"/> Add staff</button>
      </div>
      <div className="cnt">{filtered.length} of {staff.length} staff · Supabase live</div>
      <div className="tbl-w">
        <table className="staff-table">
          <thead><tr><th style={{width:200}}>Name</th><th style={{width:130}}>Role</th><th style={{width:75}}>Gender</th><th style={{width:120}}>Languages</th><th style={{width:80}}/></tr></thead>
          <tbody>
            {filtered.map(s=>(
              editingId===s.id?(
                <tr key={s.id} className="editing-row">
                  <td colSpan={5}>
                    <div className="inline-edit">
                      <div className="inline-edit-hdr">
                        <Avatar staff={s}/>
                        <span className="inline-edit-name">Editing {s.name}</span>
                        <div className="inline-edit-actions">
                          <button className="btn bg btn-sm" onClick={()=>setEditingId(null)}>Cancel</button>
                          <button className="btn bp btn-sm" onClick={()=>saveEdit(s.id)} disabled={saving}><i className="ti ti-check" aria-hidden="true"/> {saving?'Saving…':'Save to Supabase'}</button>
                        </div>
                      </div>
                      <StaffForm value={editForm} onChange={setEditForm} vicClients={vicClients}/>
                    </div>
                  </td>
                </tr>
              ):(
                <tr key={s.id}>
                  <td><div className="nc2"><Avatar staff={s}/><div><div className="sn">{s.name}</div><div className="sr">{s.seniority}</div></div></div></td>
                  <td><Tag label={s.role} variant="role"/></td>
                  <td><span className="gen">{s.gender==='F'?'Female':s.gender==='M'?'Male':'NB'}</span></td>
                  <td><div className="tag-row">{s.languages.map(l=><Tag key={l} label={l} variant="lang"/>)}</div></td>
                  <td><div className="ra">
                    <button className="ib" onClick={()=>{const {id,...rest}=s;setEditingId(id);setEditForm(rest)}} aria-label={`Edit ${s.name}`}><i className="ti ti-edit" aria-hidden="true"/></button>
                    <button className="ib d" onClick={()=>setConfirmDelete(s.id)} aria-label={`Delete ${s.name}`}><i className="ti ti-trash" aria-hidden="true"/></button>
                  </div></td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      {addOpen&&(
        <Modal title="Add staff member" onClose={()=>setAddOpen(false)}
          actions={<><button className="btn bg" onClick={()=>setAddOpen(false)}>Cancel</button><button className="btn bp" onClick={doAdd} disabled={!addForm.name.trim()||saving}><i className="ti ti-plus" aria-hidden="true"/> {saving?'Saving…':'Add to Supabase'}</button></>}>
          <StaffForm value={addForm} onChange={setAddForm} vicClients={vicClients}/>
        </Modal>
      )}
      {confirmDelete&&(
        <div className="modal-overlay">
          <div className="modal confirm-modal">
            <p className="confirm-msg">Delete {staff.find(s=>s.id===confirmDelete)?.name}? This cannot be undone.</p>
            <div className="confirm-actions">
              <button className="btn bg" onClick={()=>setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={()=>doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── VIC tab ────────────────────────────────────────────────────────────────────
function VICTab({staff}:{staff:StaffMember[]}) {
  const [vics,setVics] = useState<VICClient[]>([])
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [addOpen,setAddOpen] = useState(false)
  const [newName,setNewName] = useState('')
  const [newDate,setNewDate] = useState('')
  const [toast,setToast] = useState<string|null>(null)

  useEffect(()=>{fetchVICClients().then(setVics).catch(e=>showToast('Error: '+e.message)).finally(()=>setLoading(false))},[])
  function showToast(msg:string){setToast(msg);setTimeout(()=>setToast(null),2500)}

  async function toggleAdv(clientId:string, advId:string) {
    const v = vics.find(x=>x.id===clientId)!
    const updated = {...v, affiliated_advisor_ids: v.affiliated_advisor_ids.includes(advId)
      ? v.affiliated_advisor_ids.filter(x=>x!==advId)
      : [...v.affiliated_advisor_ids, advId]}
    try {
      const saved = await upsertVICClient(updated)
      setVics(vics.map(x=>x.id===clientId?saved:x))
    } catch(e:any){showToast('Save failed: '+e.message)}
  }

  async function addClient() {
    if(!newName.trim()) return
    setSaving(true)
    try {
      const created = await upsertVICClient({id:'',name:newName.trim(),affiliated_advisor_ids:[],expected_visit_date:newDate||undefined} as any)
      setVics([...vics,created]); setAddOpen(false); setNewName(''); setNewDate('')
      showToast('Added ✓')
    } catch(e:any){showToast('Add failed: '+e.message)}
    finally{setSaving(false)}
  }

  async function doDelete(id:string) {
    try{await deleteVICClient(id);setVics(vics.filter(v=>v.id!==id));showToast('Deleted')}
    catch(e:any){showToast('Delete failed: '+e.message)}
  }

  const eligible = staff.filter(s=>['Floor Manager','Sr. Stylist','VIC Advisor'].includes(s.role))

  if(loading) return <div className="tab-content"><div style={{padding:'2rem',color:'var(--muted)'}}>Loading…</div></div>

  return (
    <div className="tab-content">
      {toast&&<div style={{position:'fixed',top:16,right:16,background:'var(--navy)',color:'white',padding:'8px 16px',borderRadius:6,fontSize:13,zIndex:2000}}>{toast}</div>}
      <div className="tab-toolbar">
        <div style={{flex:1,fontSize:14,fontWeight:500,color:'var(--muted)'}}><i className="ti ti-star" aria-hidden="true"/> {vics.length} VIC clients</div>
        <button className="btn bp" onClick={()=>setAddOpen(true)}><i className="ti ti-plus" aria-hidden="true"/> Add VIC client</button>
      </div>
      <div className="vic-grid">
        {vics.map(v=>{
          const advisors = eligible.filter(s=>v.affiliated_advisor_ids.includes(s.id))
          const unaff    = eligible.filter(s=>!v.affiliated_advisor_ids.includes(s.id))
          return (
            <div key={v.id} className="vc">
              <div className="vch"><div className="vcs">★</div><div className="vcn">{v.name}</div>
                <button className="ib d" onClick={()=>doDelete(v.id)}><i className="ti ti-trash" aria-hidden="true"/></button></div>
              <div className="form-row" style={{marginBottom:12}}>
                <label style={{fontSize:10,fontWeight:500,textTransform:'uppercase',letterSpacing:'.07em',color:'var(--muted)',display:'block',marginBottom:4}}>Expected visit</label>
                <input type="date" className="inp" style={{height:30,fontSize:12}} defaultValue={v.expected_visit_date??''}/>
              </div>
              <div className="alvl">Affiliated advisors ({advisors.length})</div>
              <div className="allist">
                {advisors.map(s=>(
                  <div key={s.id} className="alrow on">
                    <Avatar staff={s} size={28}/>
                    <div style={{flex:1}}><div className="aln">{s.name}</div><div className="alr">{s.role}</div></div>
                    <button className="ib d sm" onClick={()=>toggleAdv(v.id,s.id)}><i className="ti ti-x" aria-hidden="true"/></button>
                  </div>
                ))}
                {advisors.length===0&&<p style={{fontSize:12,color:'var(--muted)',marginBottom:6}}>No advisors yet</p>}
              </div>
              <div className="alvl" style={{marginTop:10,opacity:.6}}>Add advisors</div>
              <div className="allist">
                {unaff.slice(0,5).map(s=>(
                  <div key={s.id} className="alrow">
                    <Avatar staff={s} size={28}/>
                    <div style={{flex:1}}><div className="aln">{s.name}</div><div className="alr">{s.role}</div></div>
                    <button className="ib sm" onClick={()=>toggleAdv(v.id,s.id)}><i className="ti ti-plus" aria-hidden="true"/></button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {addOpen&&(
        <Modal title="Add VIC client" onClose={()=>setAddOpen(false)}
          actions={<><button className="btn bg" onClick={()=>setAddOpen(false)}>Cancel</button><button className="btn bp" onClick={addClient} disabled={!newName.trim()||saving}>{saving?'Saving…':'Add client'}</button></>}>
          <div className="staff-form">
            <div className="form-row"><label>Client name</label><input className="inp" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Ms Kim" autoFocus/></div>
            <div className="form-row"><label>Expected visit date</label><input type="date" className="inp" value={newDate} onChange={e=>setNewDate(e.target.value)}/></div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Weights tab ────────────────────────────────────────────────────────────────
function WeightsTab() {
  const [weights,setWeights] = useState<ScoringWeights>(DEFAULT_WEIGHTS)
  const [loading,setLoading] = useState(true)
  const [saved,setSaved] = useState(false)
  const [toast,setToast] = useState<string|null>(null)

  useEffect(()=>{fetchWeights().then(setWeights).catch(e=>{}).finally(()=>setLoading(false))},[])

  function adjust(key:keyof ScoringWeights, raw:number) {
    const v = Math.max(0.05, Math.min(0.80, raw))
    const others = (Object.keys(weights) as (keyof ScoringWeights)[]).filter(k=>k!==key)
    const rem = Math.max(0, 1-v)
    const curSum = others.reduce((a,k)=>a+weights[k],0)
    const scale = curSum>0?rem/curSum:0
    const next = {...weights,[key]:v} as ScoringWeights
    others.forEach(k=>{next[k]=Math.max(0.01,+(weights[k]*scale).toFixed(3))})
    const fix = +(1-others.reduce((a,k)=>a+next[k],0)).toFixed(3)
    next[key]=fix
    setWeights(next)
  }

  async function doSave() {
    try{await saveWeights(weights);setSaved(true);setTimeout(()=>setSaved(false),2000);if(toast)setToast(null)}
    catch(e:any){setToast('Save failed: '+e.message);setTimeout(()=>setToast(null),2500)}
  }

  const total = Object.values(weights).reduce((a,b)=>a+b,0)
  const isValid = Math.abs(total-1)<0.005

  if(loading) return <div className="tab-content"><div style={{padding:'2rem',color:'var(--muted)'}}>Loading…</div></div>

  return (
    <div className="tab-content">
      {toast&&<div style={{position:'fixed',top:16,right:16,background:'#A32D2D',color:'white',padding:'8px 16px',borderRadius:6,fontSize:13,zIndex:2000}}>{toast}</div>}
      <div className="tab-toolbar">
        <div style={{flex:1,fontSize:14,fontWeight:500,color:'var(--muted)'}}><i className="ti ti-adjustments" aria-hidden="true"/> Scoring weights</div>
        <button className="btn bg" onClick={()=>setWeights(DEFAULT_WEIGHTS)}>Reset to default</button>
        <button className={`btn ${saved?'bsuc':'bp'}`} onClick={doSave}>{saved?<><i className="ti ti-check" aria-hidden="true"/> Saved to Supabase</>:'Save weights'}</button>
      </div>
      <div className="w-intro">Adjust how the optimiser scores each roster candidate. Weights must sum to 100% — moving one slider redistributes the others automatically. Changes save directly to Supabase.</div>
      <div className="w-card">
        <div className="w-total" style={{color:isValid?'var(--green-text)':'#A32D2D'}}>
          Total: {(total*100).toFixed(1)}% {isValid?'✓':'— adjust sliders to reach 100%'}
        </div>
        <div className="w-stack">
          {WEIGHT_META.map(({key,label,desc,color})=>{
            const pct = weights[key]
            return (
              <div key={key} className="wrow">
                <div className="wmeta"><div className="wlbl">{label}</div><div className="wdesc">{desc}</div></div>
                <div className="wctl">
                  <div className="wbw">
                    <div className="wbt"><div className="wbf" style={{width:`${pct*100}%`,background:color}}/></div>
                    <input type="range" className="wslider" min={5} max={80} step={1}
                      value={Math.round(pct*100)} onChange={e=>adjust(key,parseInt(e.target.value)/100)}
                      style={{'--thumb-color':color} as React.CSSProperties} aria-label={label}/>
                  </div>
                  <div className="wpct" style={{color}}>{Math.round(pct*100)}%</div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="wsum">{WEIGHT_META.map(({key,color})=><div key={key} className="wseg" style={{flex:weights[key],background:color}}/>)}</div>
        <div className="wleg">{WEIGHT_META.map(({key,label,color})=>(
          <div key={key} className="wli"><div className="wld" style={{background:color}}/><span>{label} {Math.round(weights[key]*100)}%</span></div>
        ))}</div>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
type TabId = 'staff'|'vic'|'weights'|'planner'|'publish'

export default function AdminPanel() {
  const [tab,setTab] = useState<TabId>('staff')
  const [staff,setStaffData] = useState<StaffMember[]>([])
  const [vicClients] = useState<VICClient[]>([])

  const tabs: {id:TabId;label:string;icon:string}[] = [
    {id:'staff',   label:'Staff',          icon:'ti-users'},
    {id:'vic',     label:'VIC clients',    icon:'ti-star'},
    {id:'weights', label:'Weights',        icon:'ti-adjustments'},
    {id:'planner', label:'Roster planner', icon:'ti-calendar-event'},
    {id:'publish', label:'Publish',        icon:'ti-send'},
  ]

  return (
    <div className="admin-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">MA</div>
          <div><div className="brand-name">Maison Aurore</div><div className="brand-sub">Admin · Supabase</div></div>
        </div>
        <nav className="sidebar-nav">
          {tabs.map(t=>(
            <button key={t.id} className={`nav-item ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}>
              <i className={`ti ${t.icon}`} aria-hidden="true"/>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{fontSize:11,color:'rgba(255,255,255,.35)',lineHeight:1.5}}>Data stored in<br/><strong style={{color:'rgba(255,255,255,.6)'}}>Supabase PostgreSQL</strong></div>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-header">
          <div className="header-title">
            <i className={`ti ${tabs.find(t=>t.id===tab)?.icon}`} aria-hidden="true"/>
            {tabs.find(t=>t.id===tab)?.label}
          </div>
          <Link to="/" className="back-link"><i className="ti ti-arrow-left" aria-hidden="true"/> Back to roster</Link>
        </header>
        {tab==='staff'   && <StaffTab vicClients={vicClients}/>}
        {tab==='vic'     && <VICTab staff={staff}/>}
        {tab==='weights' && <WeightsTab/>}
        {tab==='planner' && <RosterPlannerTab/>}
        {tab==='publish' && <PublishTab/>}
      </main>
    </div>
  )
}
