import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type {
  SessionContext, VicClient, VicTier, VicAdvisorRow,
  VicAppointment, VicApptStatus,
} from '../../../lib/types'

interface ShiftOption { id: string; name: string; start_time: string; end_time: string }
import { supabase } from '../../../lib/supabase'
import styles from './VicPage.module.css'

interface Props { session: SessionContext }

const TIER_LABEL: Record<VicTier, string> = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver' }
const APPT_LABEL: Record<VicApptStatus, string> = {
  confirmed: 'Confirmed', tentative: 'Tentative',
  cancelled: 'Cancelled', no_show: 'No-show', visited: 'Visited',
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Client form ───────────────────────────────────────────────────────────────

interface ClientForm { id: string | null; name: string; tier: string; languages: string }
function blankClient(): ClientForm { return { id: null, name: '', tier: '', languages: '' } }

// ── Appointment form ──────────────────────────────────────────────────────────

interface ApptForm {
  id: string | null; vic_client_id: string
  appointment_date: string; shift_id: string
  assigned_advisor_id: string; status: VicApptStatus; notes: string
}
function blankAppt(clientId: string): ApptForm {
  return {
    id: null, vic_client_id: clientId,
    appointment_date: new Date().toISOString().slice(0, 10),
    shift_id: '', assigned_advisor_id: '', status: 'confirmed', notes: '',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VicPage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [clients, setClients] = useState<VicClient[]>([])
  const [advisors, setAdvisors] = useState<VicAdvisorRow[]>([])
  const [appointments, setAppointments] = useState<VicAppointment[]>([])
  const [shifts, setShifts] = useState<ShiftOption[]>([])
  const [vicStaff, setVicStaff] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // modals
  const [clientModal, setClientModal] = useState(false)
  const [clientForm, setClientForm] = useState<ClientForm>(blankClient())
  const [clientSaving, setClientSaving] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)

  const [apptModal, setApptModal] = useState(false)
  const [apptForm, setApptForm] = useState<ApptForm>(blankAppt(''))
  const [apptSaving, setApptSaving] = useState(false)
  const [apptError, setApptError] = useState<string | null>(null)

  // detail panel
  const [detailId, setDetailId] = useState<string | null>(null)
  const [addingAdvisor, setAddingAdvisor] = useState(false)
  const [newAdvisorId, setNewAdvisorId] = useState('')
  const [advisorSaving, setAdvisorSaving] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true); setError(null)

    const today = new Date().toISOString().slice(0, 10)

    const [vcbRes, advisorRes, apptRes, shiftRes] = await Promise.all([
      supabase.from('vic_client_boutiques').select('vic_client_id').eq('boutique_id', boutiqueId),
      supabase.from('vic_advisors').select('vic_client_id, staff_id, staff:staff_id(name)').eq('boutique_id', boutiqueId),
      supabase.from('vic_appointments')
        .select('id, vic_client_id, appointment_date, shift_id, assigned_advisor_id, status, notes, boutique_shifts:shift_id(name), staff:assigned_advisor_id(name)')
        .eq('boutique_id', boutiqueId)
        .gte('appointment_date', today)
        .order('appointment_date'),
      supabase.from('boutique_shifts').select('id, name, start_time, end_time').eq('boutique_id', boutiqueId).order('sort_order'),
    ])

    if (vcbRes.error) { setError(vcbRes.error.message); setLoading(false); return }

    const clientIds = vcbRes.data?.map(r => r.vic_client_id) ?? []
    if (clientIds.length) {
      const { data: clientRows } = await supabase
        .from('vic_clients').select('id, name, tier, preferred_languages').in('id', clientIds).order('name')
      setClients(clientRows ?? [])
    } else {
      setClients([])
    }

    const advisorRows: VicAdvisorRow[] = (advisorRes.data ?? []).map(r => ({
      vic_client_id: r.vic_client_id,
      staff_id: r.staff_id,
      staff_name: (r.staff as any)?.name ?? 'Unknown',
    }))
    setAdvisors(advisorRows)

    const apptRows: VicAppointment[] = (apptRes.data ?? []).map(r => ({
      id: r.id,
      vic_client_id: r.vic_client_id,
      appointment_date: r.appointment_date,
      shift_id: r.shift_id,
      shift_name: (r.boutique_shifts as any)?.name,
      assigned_advisor_id: r.assigned_advisor_id,
      assigned_advisor_name: (r.staff as any)?.name,
      status: r.status,
      notes: r.notes,
    }))
    setAppointments(apptRows)
    setShifts(shiftRes.data ?? [])

    // Load VIC-eligible staff for advisor assignment
    const { data: eligibleSkills } = await supabase
      .from('skill_types').select('id').eq('is_vic_eligible', true)
    const eligibleSkillIds = eligibleSkills?.map(s => s.id) ?? []

    if (eligibleSkillIds.length) {
      const { data: staffSkillRows } = await supabase
        .from('staff_skills').select('staff_id').in('skill_type_id', eligibleSkillIds)
      const eligibleStaffIds = [...new Set(staffSkillRows?.map(r => r.staff_id) ?? [])]

      if (eligibleStaffIds.length) {
        const { data: staffRows } = await supabase
          .from('staff').select('id, name').in('id', eligibleStaffIds).order('name')
        setVicStaff(staffRows ?? [])
      }
    }

    setLoading(false)
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  // ── Client CRUD ─────────────────────────────────────────────────────────────

  const openAddClient = () => { setClientForm(blankClient()); setClientError(null); setClientModal(true) }
  const openEditClient = (c: VicClient) => {
    setClientForm({ id: c.id, name: c.name, tier: c.tier ?? '', languages: (c.preferred_languages ?? []).join(', ') })
    setClientError(null); setClientModal(true)
  }

  const saveClient = useCallback(async () => {
    if (!boutiqueId) return
    if (!clientForm.name.trim()) { setClientError('Name is required.'); return }
    setClientSaving(true); setClientError(null)

    const payload = {
      name: clientForm.name.trim(),
      tier: clientForm.tier || null,
      preferred_languages: clientForm.languages.split(',').map(l => l.trim()).filter(Boolean),
    }

    let clientId = clientForm.id
    if (clientId) {
      const { error } = await supabase.from('vic_clients').update(payload).eq('id', clientId)
      if (error) { setClientSaving(false); setClientError(error.message); return }
    } else {
      const { data, error } = await supabase.from('vic_clients').insert(payload).select('id').single()
      if (error) { setClientSaving(false); setClientError(error.message); return }
      clientId = data.id
      // Link to boutique
      await supabase.from('vic_client_boutiques').insert({ vic_client_id: clientId, boutique_id: boutiqueId })
    }

    setClientSaving(false); setClientModal(false); await load()
  }, [boutiqueId, clientForm, load])

  // ── Advisor management ──────────────────────────────────────────────────────

  const addAdvisor = useCallback(async (vicClientId: string) => {
    if (!boutiqueId || !newAdvisorId) return
    setAdvisorSaving(true)
    await supabase.from('vic_advisors').upsert({
      vic_client_id: vicClientId, boutique_id: boutiqueId, staff_id: newAdvisorId,
    })
    setAdvisorSaving(false); setAddingAdvisor(false); setNewAdvisorId('')
    await load()
  }, [boutiqueId, newAdvisorId, load])

  const removeAdvisor = useCallback(async (vicClientId: string, staffId: string) => {
    if (!boutiqueId) return
    await supabase.from('vic_advisors')
      .delete().eq('vic_client_id', vicClientId).eq('boutique_id', boutiqueId).eq('staff_id', staffId)
    await load()
  }, [boutiqueId, load])

  // ── Appointment CRUD ────────────────────────────────────────────────────────

  const openAddAppt = (vicClientId: string) => {
    setApptForm(blankAppt(vicClientId)); setApptError(null); setApptModal(true)
  }

  const saveAppt = useCallback(async () => {
    if (!boutiqueId || !apptForm.appointment_date) { setApptError('Date is required.'); return }
    setApptSaving(true); setApptError(null)

    const payload = {
      boutique_id: boutiqueId,
      vic_client_id: apptForm.vic_client_id,
      appointment_date: apptForm.appointment_date,
      shift_id: apptForm.shift_id || null,
      assigned_advisor_id: apptForm.assigned_advisor_id || null,
      status: apptForm.status,
      notes: apptForm.notes.trim() || null,
    }

    const { error } = apptForm.id
      ? await supabase.from('vic_appointments').update(payload).eq('id', apptForm.id)
      : await supabase.from('vic_appointments').insert(payload)

    setApptSaving(false)
    if (error) { setApptError(error.message); return }
    setApptModal(false); await load()
  }, [boutiqueId, apptForm, load])

  const deleteAppt = useCallback(async (id: string) => {
    await supabase.from('vic_appointments').delete().eq('id', id)
    await load()
  }, [load])

  // ── Filtered clients ─────────────────────────────────────────────────────────

  const filteredClients = useMemo(() => {
    const q = search.toLowerCase()
    return q ? clients.filter(c => c.name.toLowerCase().includes(q)) : clients
  }, [clients, search])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!boutiqueId) return (
    <div><PageHeader title="VIC Clients" subtitle="Client list, appointments and advisor assignments" />
      <p className={styles.empty}>No boutique selected.</p></div>
  )

  return (
    <div className={styles.page}>
      <PageHeader title="VIC Clients" subtitle="Manage VIC client profiles, advisor assignments and upcoming appointments" />

      <div className={styles.toolbar}>
        <input className={styles.search} type="search" placeholder="Search clients…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <Button variant="primary" size="sm" onClick={openAddClient}>+ Add client</Button>
      </div>

      {loading && <p className={styles.statusMsg}>Loading…</p>}
      {error && <p className={styles.errorMsg}>{error}</p>}

      {!loading && !error && (
        <div className={styles.content}>
          {filteredClients.length === 0 ? (
            <p className={styles.statusMsg}>{search ? 'No clients match.' : 'No VIC clients linked to this boutique.'}</p>
          ) : (
            filteredClients.map(client => {
              const clientAdvisors = advisors.filter(a => a.vic_client_id === client.id)
              const clientAppts = appointments.filter(a => a.vic_client_id === client.id)
              const isOpen = detailId === client.id
              const unassignedAdvisors = vicStaff.filter(s => !clientAdvisors.find(a => a.staff_id === s.id))

              return (
                <div key={client.id} className={styles.clientCard}>
                  {/* ── Client header row ── */}
                  <div className={styles.clientRow}>
                    <button className={styles.expandBtn}
                      onClick={() => setDetailId(isOpen ? null : client.id)} aria-expanded={isOpen}>
                      <span className={`${styles.chevron} ${isOpen ? styles.open : ''}`}>›</span>
                    </button>

                    <div className={styles.clientInfo}>
                      <span className={styles.clientName}>{client.name}</span>
                      {client.tier && (
                        <span className={`${styles.tierBadge} ${styles[client.tier]}`}>
                          {TIER_LABEL[client.tier]}
                        </span>
                      )}
                      {(client.preferred_languages ?? []).length > 0 && (
                        <span className={styles.langList}>{client.preferred_languages!.join(', ')}</span>
                      )}
                    </div>

                    <div className={styles.advisorPills}>
                      {clientAdvisors.length === 0
                        ? <span className={styles.noAdvisor}>No advisor assigned</span>
                        : clientAdvisors.map(a => (
                            <span key={a.staff_id} className={styles.advisorPill}>{a.staff_name}</span>
                          ))}
                    </div>

                    <div className={styles.apptCount}>
                      {clientAppts.length > 0 && (
                        <span className={styles.apptBadge}>{clientAppts.length} upcoming</span>
                      )}
                    </div>

                    <div className={styles.rowActions}>
                      <button className={styles.actionBtn} onClick={() => openEditClient(client)}>Edit</button>
                    </div>
                  </div>

                  {/* ── Detail panel ── */}
                  {isOpen && (
                    <div className={styles.detailPanel}>

                      {/* Advisors section */}
                      <div className={styles.detailSection}>
                        <h4 className={styles.detailLabel}>Advisors</h4>
                        <div className={styles.advisorList}>
                          {clientAdvisors.map(a => (
                            <span key={a.staff_id} className={styles.advisorTag}>
                              {a.staff_name}
                              <button className={styles.removeBtn}
                                onClick={() => removeAdvisor(client.id, a.staff_id)}
                                aria-label={`Remove ${a.staff_name}`}>×</button>
                            </span>
                          ))}
                          {addingAdvisor ? (
                            <span className={styles.addAdvisorRow}>
                              <select className={styles.smallSelect} value={newAdvisorId}
                                onChange={e => setNewAdvisorId(e.target.value)}>
                                <option value="">— select staff —</option>
                                {unassignedAdvisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                              <Button variant="primary" size="sm" loading={advisorSaving}
                                disabled={!newAdvisorId} onClick={() => addAdvisor(client.id)}>Assign</Button>
                              <Button variant="ghost" size="sm" onClick={() => { setAddingAdvisor(false); setNewAdvisorId('') }}>Cancel</Button>
                            </span>
                          ) : (
                            <button className={styles.addAdvisorBtn}
                              onClick={() => { setAddingAdvisor(true); setNewAdvisorId('') }}>
                              + Assign advisor
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Appointments section */}
                      <div className={styles.detailSection}>
                        <div className={styles.detailLabelRow}>
                          <h4 className={styles.detailLabel}>Upcoming appointments</h4>
                          <button className={styles.addApptBtn} onClick={() => openAddAppt(client.id)}>
                            + Add appointment
                          </button>
                        </div>
                        {clientAppts.length === 0 ? (
                          <p className={styles.noAppt}>No upcoming appointments.</p>
                        ) : (
                          <table className={styles.apptTable}>
                            <thead><tr><th>Date</th><th>Shift</th><th>Advisor</th><th>Status</th><th></th></tr></thead>
                            <tbody>
                              {clientAppts.map(appt => (
                                <tr key={appt.id}>
                                  <td>{fmtDate(appt.appointment_date)}</td>
                                  <td>{appt.shift_name ?? <span className={styles.muted}>—</span>}</td>
                                  <td>{appt.assigned_advisor_name ?? <span className={styles.muted}>Unassigned</span>}</td>
                                  <td>
                                    <span className={`${styles.apptStatus} ${styles[appt.status]}`}>
                                      {APPT_LABEL[appt.status]}
                                    </span>
                                  </td>
                                  <td>
                                    <button className={`${styles.actionBtn} ${styles.danger}`}
                                      onClick={() => deleteAppt(appt.id)}>×</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
          <p className={styles.count}>{filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}</p>
        </div>
      )}

      {/* ── Add/Edit client modal ── */}
      {clientModal && (
        <Modal title={clientForm.id ? 'Edit VIC client' : 'Add VIC client'} onClose={() => setClientModal(false)}
          maxWidth={440}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setClientModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={clientSaving} onClick={saveClient}>
                {clientForm.id ? 'Save changes' : 'Add client'}
              </Button>
            </>
          }>
          <div className={styles.formGrid}>
            <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
              <label className={styles.formLabel}>Client name <span className={styles.req}>*</span></label>
              <input className={styles.input} value={clientForm.name}
                onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Tier</label>
              <select className={styles.input} value={clientForm.tier}
                onChange={e => setClientForm(f => ({ ...f, tier: e.target.value }))}>
                <option value="">— none —</option>
                <option value="platinum">Platinum</option>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Preferred languages</label>
              <input className={styles.input} placeholder="e.g. Mandarin, English"
                value={clientForm.languages}
                onChange={e => setClientForm(f => ({ ...f, languages: e.target.value }))} />
            </div>
            {clientError && <p className={styles.formError}>{clientError}</p>}
          </div>
        </Modal>
      )}

      {/* ── Add appointment modal ── */}
      {apptModal && (
        <Modal title="Add appointment" onClose={() => setApptModal(false)}
          maxWidth={460}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setApptModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={apptSaving} onClick={saveAppt}>Add appointment</Button>
            </>
          }>
          <div className={styles.formGrid}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Date <span className={styles.req}>*</span></label>
              <input type="date" className={styles.input} value={apptForm.appointment_date}
                onChange={e => setApptForm(f => ({ ...f, appointment_date: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Status</label>
              <select className={styles.input} value={apptForm.status}
                onChange={e => setApptForm(f => ({ ...f, status: e.target.value as VicApptStatus }))}>
                <option value="confirmed">Confirmed</option>
                <option value="tentative">Tentative</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Shift</label>
              <select className={styles.input} value={apptForm.shift_id}
                onChange={e => setApptForm(f => ({ ...f, shift_id: e.target.value }))}>
                <option value="">— any shift —</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Assigned advisor</label>
              <select className={styles.input} value={apptForm.assigned_advisor_id}
                onChange={e => setApptForm(f => ({ ...f, assigned_advisor_id: e.target.value }))}>
                <option value="">— unassigned —</option>
                {vicStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.formField} style={{ gridColumn: '1/-1' }}>
              <label className={styles.formLabel}>Notes</label>
              <input className={styles.input} value={apptForm.notes}
                onChange={e => setApptForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            {apptError && <p className={styles.formError}>{apptError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
