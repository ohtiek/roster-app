import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import type { RosterResponse, ShiftName, ShiftAssignment } from './types'
import { fetchStaff, fetchVICClients, fetchWeights, saveRosterHistory } from './supabaseClient'
import { generateRoster } from './engine'
import AdminPanel from './admin/AdminPanel'
import './App.css'

const SHIFT_LABELS: Record<ShiftName, string> = { morning:'Morning', afternoon:'Afternoon', closing:'Closing' }
const SHIFT_TIMES:  Record<ShiftName, string> = { morning:'09:00–14:00', afternoon:'13:00–19:00', closing:'17:00–21:00' }
const SHIFT_COLOR:  Record<ShiftName, string> = { morning:'#1E4D8C', afternoon:'#4A3280', closing:'#0F6E56' }
const SHIFT_DOT:    Record<ShiftName, string> = { morning:'#5B8FCC', afternoon:'#9B85D4', closing:'#3DB88A' }
const SHIFTS: ShiftName[] = ['morning', 'afternoon', 'closing']
const AVC: Record<string,[string,string]> = {
  'av-b':['#DDEAF8','#1E4D8C'],'av-p':['#EEEDFE','#3C3489'],'av-t':['#D8EEE8','#085041'],
  'av-c':['#FAECE7','#712B13'],'av-k':['#FBEAF0','#72243E'],'av-m':['#FAEEDA','#633806'],'av-g':['#EAF3DE','#27500A'],
}

function Avatar({ code, name, size=40 }: { code?:string; name:string; size?:number }) {
  const [bg,fg] = AVC[code??'av-b'] ?? AVC['av-b']
  const ini = name.split(' ').map(w=>w[0]).join('').slice(0,2)
  return <div style={{width:size,height:size,borderRadius:'50%',background:bg,color:fg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:size*.28,fontWeight:500,flexShrink:0}}>{ini}</div>
}

type TabId = ShiftName | 'summary'

function RosterApp() {
  const [tab,setTab]         = useState<TabId>('morning')
  const [vicMode,setVicMode] = useState(false)
  const [roster,setRoster]   = useState<RosterResponse|null>(null)
  const [loading,setLoading] = useState(false)
  const [error,setError]     = useState<string|null>(null)
  const [expanded,setExpanded] = useState<Set<string>>(new Set())

  const VIC_NAMES: Record<string,string> = { 'vic-1':'Mme Fontaine','vic-2':'Ms Park','vic-3':'Mr Al Rashid' }

  const SEED_INFO: Record<string,{role:string;gender:string;languages:string[];vic_client_ids:string[];avatar_color:string;seniority:string}> = {
    's-01':{role:'Floor Manager',gender:'F',languages:['EN','CN','YUE'],vic_client_ids:['vic-1'],avatar_color:'av-p',seniority:'manager'},
    's-02':{role:'Sr. Stylist',gender:'M',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-b',seniority:'senior'},
    's-03':{role:'VIC Advisor',gender:'F',languages:['EN','CN','AR'],vic_client_ids:['vic-3'],avatar_color:'av-t',seniority:'senior'},
    's-04':{role:'Jr. Stylist',gender:'F',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-k',seniority:'junior'},
    's-05':{role:'Sr. Stylist',gender:'M',languages:['EN','CN'],vic_client_ids:['vic-2'],avatar_color:'av-m',seniority:'senior'},
    's-06':{role:'Cashier',gender:'F',languages:['EN'],vic_client_ids:[],avatar_color:'av-c',seniority:'junior'},
    's-07':{role:'Stock Associate',gender:'M',languages:['EN'],vic_client_ids:[],avatar_color:'av-p',seniority:'junior'},
    's-08':{role:'Floor Manager',gender:'F',languages:['EN','AR','FR'],vic_client_ids:['vic-1'],avatar_color:'av-t',seniority:'manager'},
    's-09':{role:'Sr. Stylist',gender:'F',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-k',seniority:'senior'},
    's-10':{role:'VIC Advisor',gender:'M',languages:['EN','CN','YUE'],vic_client_ids:['vic-2'],avatar_color:'av-b',seniority:'senior'},
    's-11':{role:'Jr. Stylist',gender:'F',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-m',seniority:'junior'},
    's-12':{role:'Jr. Stylist',gender:'M',languages:['EN'],vic_client_ids:[],avatar_color:'av-g',seniority:'junior'},
    's-13':{role:'Sr. Stylist',gender:'M',languages:['EN','CN'],vic_client_ids:['vic-2','vic-3'],avatar_color:'av-b',seniority:'senior'},
    's-14':{role:'Floor Manager',gender:'F',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-c',seniority:'manager'},
    's-15':{role:'Jr. Stylist',gender:'F',languages:['EN'],vic_client_ids:[],avatar_color:'av-m',seniority:'junior'},
    's-16':{role:'Cashier',gender:'M',languages:['EN','AR'],vic_client_ids:[],avatar_color:'av-p',seniority:'junior'},
    's-17':{role:'Cashier',gender:'F',languages:['EN'],vic_client_ids:[],avatar_color:'av-c',seniority:'junior'},
    's-18':{role:'Stock Associate',gender:'M',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-t',seniority:'junior'},
    's-19':{role:'Sr. Stylist',gender:'F',languages:['EN','FR','YUE'],vic_client_ids:[],avatar_color:'av-k',seniority:'senior'},
    's-20':{role:'Jr. Stylist',gender:'M',languages:['EN'],vic_client_ids:[],avatar_color:'av-g',seniority:'junior'},
    's-21':{role:'VIC Advisor',gender:'F',languages:['EN','AR','FR'],vic_client_ids:[],avatar_color:'av-t',seniority:'senior'},
    's-22':{role:'Cashier',gender:'M',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-b',seniority:'junior'},
    's-23':{role:'Jr. Stylist',gender:'F',languages:['EN','FR'],vic_client_ids:[],avatar_color:'av-p',seniority:'junior'},
    's-24':{role:'Stock Associate',gender:'M',languages:['EN','CN','YUE'],vic_client_ids:[],avatar_color:'av-m',seniority:'junior'},
    's-25':{role:'Sr. Stylist',gender:'F',languages:['EN'],vic_client_ids:[],avatar_color:'av-k',seniority:'senior'},
  }

  const run = useCallback(async (vic: boolean) => {
    setLoading(true); setError(null)
    try {
      const [staff, vics, weights] = await Promise.all([fetchStaff(), fetchVICClients(), fetchWeights()])
      const result = generateRoster(new Date().toISOString().slice(0,10), staff, vics, weights, vic)
      setRoster(result)
      saveRosterHistory(result.date, result.overall_score, result.solver_used, result).catch(()=>{})
    } catch(e:any) { setError(e.message ?? 'Failed to load data') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { run(false) }, [run])

  const shiftStaff: Record<ShiftName, ShiftAssignment[]> = { morning:[], afternoon:[], closing:[] }
  roster?.assignments.forEach(a => shiftStaff[a.shift].push(a))

  function scoreColor(s:number){ return s>=90?'#27500A':s>=70?'#633806':'#791F1F' }
  function getScore(sh:ShiftName){ return roster?.shift_scores.find(s=>s.shift===sh)?.score??0 }
  function toggle(id:string){ setExpanded(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n}) }

  return (
    <div className="app">
      <div className="sticky-hdr">
        <div className="hdr-top">
          <div><div className="eyebrow">Daily Roster</div><div className="store-name">Maison Aurore</div></div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
            {roster && <div className="score-pill" style={{color:scoreColor(roster.overall_score)}}>{roster.overall_score} / 100</div>}
            <div style={{display:'flex',gap:6}}>
              <button className={`vic-toggle ${vicMode?'active':''}`} onClick={()=>{const n=!vicMode;setVicMode(n);run(n)}} disabled={loading}>
                {vicMode?'★ VIC Max ON':'☆ VIC Max'}
              </button>
              <Link to="/admin" className="admin-link">Admin ↗</Link>
            </div>
          </div>
        </div>
        <div className="gold-rule"/>
        <div className="tab-bar">
          {SHIFTS.map(s=>(
            <button key={s} className={`tab-btn ${tab===s?'active':''}`} onClick={()=>setTab(s)}>
              <span className="tab-dot" style={{background:SHIFT_DOT[s]}}/>
              {SHIFT_LABELS[s]}
            </button>
          ))}
          <button className={`tab-btn ${tab==='summary'?'active':''}`} onClick={()=>setTab('summary')}>
            <span className="tab-dot" style={{background:'#C9A84C'}}/>Summary
          </button>
        </div>
      </div>

      <div className="date-bar">
        <div className="date-str">{roster?new Date(roster.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'—'}</div>
        <div className="meta-chips">
          <span className="chip"><strong>{roster?.assignments.length??'—'}</strong> staff</span>
          <span className="chip">{loading?'Loading…':'Live · Supabase'}</span>
        </div>
      </div>

      {loading && <div className="loading-bar"/>}
      {error && <div className="error-banner">⚠ {error} — check your .env Supabase credentials</div>}

      {roster?.fatigue_flags && roster.fatigue_flags.length>0 && (
        <div className="fatigue-notice">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span><strong>Fatigue:</strong> {roster.fatigue_flags[0].note}</span>
        </div>
      )}

      {roster?.vic_coverage && (
        <div className="vic-section">
          <div className="vic-hdr">★ VIC Client Coverage</div>
          {roster.vic_coverage.map(v=>(
            <div key={v.client_id} className="vic-row">
              <div className="vic-client">{v.client_name}</div>
              <div className="vic-segs">
                {v.morning_advisor   && <span className="cs-m">Morning · {v.morning_advisor.split(' ').slice(0,2).join(' ')}</span>}
                {v.afternoon_advisor && <span className="cs-a">Afternoon · {v.afternoon_advisor.split(' ').slice(0,2).join(' ')}</span>}
                {v.closing_advisor   && <span className="cs-c">Closing · {v.closing_advisor.split(' ').slice(0,2).join(' ')}</span>}
                {!v.fully_covered && <span className="cs-gap">Gap!</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {SHIFTS.map(shift => tab===shift && roster && (
        <div key={shift} className="panel">
          <div className="shift-hdr" style={{background:SHIFT_COLOR[shift]}}>
            <div className="score-ring" style={{color:scoreColor(getScore(shift))}}>{getScore(shift)}</div>
            <div><div className="sh-title">{SHIFT_LABELS[shift]} Shift</div><div className="sh-time">{SHIFT_TIMES[shift]}</div></div>
            <div className="sh-count">{shiftStaff[shift].length} STAFF</div>
          </div>
          <div className="staff-list">
            {shiftStaff[shift].map(a=>{
              const sd = SEED_INFO[a.staff_id]
              if(!sd) return null
              const name = roster.assignments.find(x=>x.staff_id===a.staff_id)
                ? Object.entries(SEED_INFO).find(([id])=>id===a.staff_id)?.[1] ?? sd : sd
              const staffName = (['s-01','s-02','s-03','s-04','s-05','s-06','s-07','s-08','s-09','s-10','s-11','s-12','s-13','s-14','s-15','s-16','s-17','s-18','s-19','s-20','s-21','s-22','s-23','s-24','s-25'] as const).includes(a.staff_id as any)
                ? ['Sophie Lam','James Okafor','Mei Lin','Clara Moreau','David Chen','Ana Pereira','Tom Ashby','Layla Hassan','Emma Dubois','Ryan Ng','Isabelle Roy','Kenji Mori','Lucas Park','Nina Wolff','Sasha Kim','Omar Farouk','Priya Shah','Marc Leroy','Celine Blanc','Hiroshi Tanaka','Fatima Al-Nur','Louis Petit','Amara Diallo','Wei Zhang','Charlotte Moore'][parseInt(a.staff_id.replace('s-',''))-1] ?? a.staff_id
                : a.staff_id
              const cardId = `${shift}-${a.staff_id}`
              const isExpanded = expanded.has(cardId)
              const vicNames = sd.vic_client_ids.map(id=>VIC_NAMES[id]).filter(Boolean)
              return (
                <div key={cardId} className={`staff-card ${a.is_vic_active?'vic-card':''} ${a.change_note?'changed-card':''}`}
                  onClick={()=>toggle(cardId)} role="button" tabIndex={0}
                  onKeyDown={e=>e.key==='Enter'&&toggle(cardId)}>
                  <Avatar code={sd.avatar_color} name={staffName}/>
                  <div className="sc-body">
                    <div className="sc-name">{staffName}</div>
                    <div className="sc-role">{sd.role}</div>
                    <div className="sc-tags">
                      {sd.seniority==='manager'&&<span className="tag t-mgr">Manager</span>}
                      {a.is_vic_active&&<span className="tag t-vic">VIC</span>}
                      {a.change_note&&<span className="tag t-new">{a.change_note}</span>}
                      {sd.languages.map(l=><span key={l} className="tag t-lang">{l}</span>)}
                    </div>
                    {isExpanded&&(
                      <div className="sc-detail">
                        {vicNames.length>0&&<div className="detail-row"><span className="detail-lbl">VIC client</span><span className="detail-val vic-badge">★ {vicNames.join(', ')}</span></div>}
                        <div className="detail-row"><span className="detail-lbl">Gender</span><span className="detail-val">{sd.gender==='F'?'Female':sd.gender==='M'?'Male':'Non-binary'}</span></div>
                        <div className="detail-row"><span className="detail-lbl">Seniority</span><span className="detail-val" style={{textTransform:'capitalize'}}>{sd.seniority}</span></div>
                        <div className="detail-row"><span className="detail-lbl">Shift</span><span className="detail-val">{SHIFT_TIMES[shift]}</span></div>
                      </div>
                    )}
                  </div>
                  <div className="chevron" style={{transform:isExpanded?'rotate(90deg)':'none'}}>›</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {tab==='summary'&&roster&&(
        <div className="panel">
          <div style={{padding:'12px 16px 0',fontSize:10,fontWeight:500,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--color-text-secondary)'}}>Constraint scores</div>
          <div className="summary-grid">
            {roster.shift_scores.map(ss=>(
              <div key={ss.shift} className="sg-card">
                <div className="sg-label">{SHIFT_LABELS[ss.shift]}</div>
                <div className="sg-val" style={{color:scoreColor(ss.score)}}>{ss.score}</div>
                <div className="sg-sub">{ss.skill_ok?'✓ Skills':'✗ Skills'} · {ss.vic_ok?'✓ VIC':'✗ VIC'}</div>
                <div className="sg-sub">{ss.languages.join(' · ')}</div>
              </div>
            ))}
            <div className="sg-card" style={{gridColumn:'span 2'}}>
              <div className="sg-label">Overall score</div>
              <div className="sg-val" style={{color:scoreColor(roster.overall_score),fontSize:28}}>{roster.overall_score} / 100</div>
              <div className="sg-sub">Engine: {roster.solver_used} · Supabase + Vercel</div>
            </div>
          </div>
        </div>
      )}

      <button className="fab" onClick={()=>window.print()}>🖨 Print</button>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<AdminPanel/>}/>
        <Route path="/*"       element={<RosterApp/>}/>
      </Routes>
    </BrowserRouter>
  )
}
