import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import type {
  SessionContext, StaffRow, SkillType, EmploymentType,
} from '../../../lib/types'
import { supabase } from '../../../lib/supabase'
import styles from './StaffPage.module.css'

interface Props { session: SessionContext }

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  casual: 'Casual',
  contractor: 'Contractor',
}

// ── Blank form state ──────────────────────────────────────────────────────────

interface StaffForm {
  id: string | null
  name: string
  external_hr_id: string
  employment_type: EmploymentType
  contracted_hours_per_week: string
  gender: 'M' | 'F' | 'NB'
  seniority: 'junior' | 'senior' | 'manager'
  languages: string
  primary_skill_id: string
  availability_days: number[]
}

function blankForm(): StaffForm {
  return {
    id: null,
    name: '',
    external_hr_id: '',
    employment_type: 'full_time',
    contracted_hours_per_week: '',
    gender: 'F',
    seniority: 'junior',
    languages: '',
    primary_skill_id: '',
    availability_days: [],
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StaffPage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [staff, setStaff] = useState<StaffRow[]>([])
  const [skillTypes, setSkillTypes] = useState<SkillType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<StaffForm>(blankForm())
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true)
    setError(null)

    const [sbRes, skillRes] = await Promise.all([
      supabase
        .from('staff_boutiques')
        .select('staff_id')
        .eq('boutique_id', boutiqueId)
        .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString().slice(0, 10)),
      supabase.from('skill_types').select('*').order('engine_priority', { ascending: false }),
    ])

    if (sbRes.error) { setError(sbRes.error.message); setLoading(false); return }
    if (skillRes.data) setSkillTypes(skillRes.data)

    const staffIds = sbRes.data?.map((r: { staff_id: string }) => r.staff_id) ?? []
    if (!staffIds.length) { setStaff([]); setLoading(false); return }

    const [staffRes, skillsRes, availRes] = await Promise.all([
      supabase
        .from('staff')
        .select('id, name, employment_type, contracted_hours_per_week, gender, languages, seniority, external_hr_id, avatar_color')
        .in('id', staffIds)
        .order('name'),
      supabase
        .from('staff_skills')
        .select('staff_id, skill_type_id, is_primary, proficiency_level, expires_at, skill_types(name)')
        .in('staff_id', staffIds),
      supabase
        .from('staff_availability_days')
        .select('staff_id, day_of_week')
        .eq('boutique_id', boutiqueId)
        .in('staff_id', staffIds),
    ])

    if (staffRes.error) { setError(staffRes.error.message); setLoading(false); return }

    const skillsByStaff: Record<string, StaffRow['skills']> = {}
    for (const sk of skillsRes.data ?? []) {
      const entry = {
        staff_id: sk.staff_id,
        skill_type_id: sk.skill_type_id,
        skill_type_name: (sk.skill_types as any)?.name ?? '',
        is_primary: sk.is_primary,
        proficiency_level: sk.proficiency_level,
        expires_at: sk.expires_at,
      }
      skillsByStaff[sk.staff_id] = [...(skillsByStaff[sk.staff_id] ?? []), entry]
    }

    const availByStaff: Record<string, number[]> = {}
    for (const a of availRes.data ?? []) {
      availByStaff[a.staff_id] = [...(availByStaff[a.staff_id] ?? []), a.day_of_week]
    }

    const rows: StaffRow[] = (staffRes.data ?? []).map(s => ({
      ...s,
      skills: skillsByStaff[s.id] ?? [],
      availability_days: availByStaff[s.id] ?? [],
    }))

    setStaff(rows)
    setLoading(false)
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  // ── Filtered list ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return staff
    return staff.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.external_hr_id?.toLowerCase().includes(q) ||
      s.skills.some(sk => sk.skill_type_name.toLowerCase().includes(q))
    )
  }, [staff, search])

  // ── Open modal ──────────────────────────────────────────────────────────────

  const openAdd = () => {
    setForm(blankForm())
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (row: StaffRow) => {
    const primary = row.skills.find(sk => sk.is_primary)
    setForm({
      id: row.id,
      name: row.name,
      external_hr_id: row.external_hr_id ?? '',
      employment_type: row.employment_type,
      contracted_hours_per_week: row.contracted_hours_per_week?.toString() ?? '',
      gender: row.gender,
      seniority: row.seniority,
      languages: row.languages.join(', '),
      primary_skill_id: primary?.skill_type_id ?? '',
      availability_days: [...row.availability_days],
    })
    setFormError(null)
    setModalOpen(true)
  }

  // ── Save form ───────────────────────────────────────────────────────────────

  const saveForm = useCallback(async () => {
    if (!boutiqueId) return
    if (!form.name.trim()) { setFormError('Name is required.'); return }

    setFormSaving(true)
    setFormError(null)

    const hours = form.contracted_hours_per_week
      ? parseFloat(form.contracted_hours_per_week)
      : null

    const primarySkill = skillTypes.find(st => st.id === form.primary_skill_id)
    const legacyRole = primarySkill?.name ?? 'Jr. Stylist'

    try {
      let staffId = form.id

      if (staffId) {
        // Update existing staff record
        const { error } = await supabase.from('staff').update({
          name: form.name.trim(),
          external_hr_id: form.external_hr_id.trim() || null,
          employment_type: form.employment_type,
          contracted_hours_per_week: hours,
          gender: form.gender,
          seniority: form.seniority,
          languages: form.languages.split(',').map(l => l.trim()).filter(Boolean),
          role: legacyRole,
        }).eq('id', staffId)
        if (error) throw error
      } else {
        // Insert new staff record
        const { data, error } = await supabase.from('staff').insert({
          name: form.name.trim(),
          external_hr_id: form.external_hr_id.trim() || null,
          employment_type: form.employment_type,
          contracted_hours_per_week: hours,
          gender: form.gender,
          seniority: form.seniority,
          languages: form.languages.split(',').map(l => l.trim()).filter(Boolean),
          role: legacyRole,
        }).select('id').single()
        if (error) throw error
        staffId = data.id

        // Link to boutique
        await supabase.from('staff_boutiques').insert({
          staff_id: staffId,
          boutique_id: boutiqueId,
          valid_from: new Date().toISOString().slice(0, 10),
        })
      }

      // Upsert primary skill
      if (staffId && form.primary_skill_id) {
        // Remove existing primary flag
        await supabase.from('staff_skills').update({ is_primary: false }).eq('staff_id', staffId)
        // Upsert this skill as primary
        await supabase.from('staff_skills').upsert({
          staff_id: staffId,
          skill_type_id: form.primary_skill_id,
          is_primary: true,
        })
      }

      // Replace availability days for this boutique
      if (staffId) {
        await supabase.from('staff_availability_days')
          .delete()
          .eq('staff_id', staffId)
          .eq('boutique_id', boutiqueId)

        if (form.availability_days.length > 0) {
          await supabase.from('staff_availability_days').insert(
            form.availability_days.map(d => ({
              staff_id: staffId,
              boutique_id: boutiqueId,
              day_of_week: d,
            }))
          )
        }
      }

      setModalOpen(false)
      await load()
    } catch (err: any) {
      setFormError(err.message)
    } finally {
      setFormSaving(false)
    }
  }, [boutiqueId, form, skillTypes, load])

  // ── Render ──────────────────────────────────────────────────────────────────

  const toggleDay = (day: number) => {
    setForm(f => ({
      ...f,
      availability_days: f.availability_days.includes(day)
        ? f.availability_days.filter(d => d !== day)
        : [...f.availability_days, day],
    }))
  }

  if (!boutiqueId) {
    return (
      <div>
        <PageHeader title="Staff" subtitle="Manage staff records and assignments" />
        <p className={styles.empty}>No boutique selected.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Staff" subtitle="Manage staff records, boutique assignments and day-of-week availability" />

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by name, HR ID or skill…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Button variant="primary" size="sm" onClick={openAdd}>+ Add staff</Button>
      </div>

      {loading && <p className={styles.statusMsg}>Loading…</p>}
      {error && <p className={styles.errorMsg}>{error}</p>}

      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <p className={styles.statusMsg}>
              {search ? 'No staff match your search.' : 'No staff assigned to this boutique.'}
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Hrs/wk</th>
                    <th>Primary skill</th>
                    <th>Languages</th>
                    <th>Availability</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => {
                    const primary = row.skills.find(sk => sk.is_primary)
                    const availLabel = row.availability_days.length === 0
                      ? <span className={styles.availAll}>All days</span>
                      : row.availability_days.sort().map(d => (
                          <span key={d} className={styles.dayChip}>{DAY_LABELS[d]}</span>
                        ))
                    return (
                      <tr key={row.id} className={styles.row}>
                        <td>
                          <span className={styles.avatar} style={{ background: row.avatar_color ?? '#B8973A' }}>
                            {row.name.charAt(0).toUpperCase()}
                          </span>
                          <span className={styles.nameCell}>
                            <span className={styles.staffName}>{row.name}</span>
                            {row.external_hr_id && (
                              <span className={styles.hrId}>{row.external_hr_id}</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.typeBadge} ${styles[row.employment_type]}`}>
                            {EMPLOYMENT_LABELS[row.employment_type]}
                          </span>
                        </td>
                        <td className={styles.numeric}>
                          {row.contracted_hours_per_week ?? '—'}
                        </td>
                        <td>{primary?.skill_type_name ?? <span className={styles.muted}>—</span>}</td>
                        <td>
                          {row.languages.length > 0
                            ? row.languages.join(', ')
                            : <span className={styles.muted}>—</span>}
                        </td>
                        <td>
                          <span className={styles.availCell}>{availLabel}</span>
                        </td>
                        <td>
                          <button className={styles.editBtn} onClick={() => openEdit(row)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.count}>{filtered.length} staff member{filtered.length !== 1 ? 's' : ''}</p>
        </>
      )}

      {/* ── Add / Edit modal ── */}
      {modalOpen && (
        <Modal
          title={form.id ? 'Edit staff member' : 'Add staff member'}
          onClose={() => setModalOpen(false)}
          maxWidth={580}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={formSaving} onClick={saveForm}>
                {form.id ? 'Save changes' : 'Add staff'}
              </Button>
            </>
          }
        >
          <div className={styles.formGrid}>
            <FormField label="Full name" required>
              <input className={styles.input} value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </FormField>

            <FormField label="HR ID">
              <input className={styles.input} value={form.external_hr_id}
                placeholder="From HR system"
                onChange={e => setForm(f => ({ ...f, external_hr_id: e.target.value }))} />
            </FormField>

            <FormField label="Employment type" required>
              <select className={styles.input} value={form.employment_type}
                onChange={e => setForm(f => ({ ...f, employment_type: e.target.value as EmploymentType }))}>
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
                <option value="casual">Casual</option>
                <option value="contractor">Contractor</option>
              </select>
            </FormField>

            <FormField label="Contracted hrs/week">
              <input type="number" className={styles.input} value={form.contracted_hours_per_week}
                min={0} max={60} step={0.5} placeholder="e.g. 38"
                onChange={e => setForm(f => ({ ...f, contracted_hours_per_week: e.target.value }))} />
            </FormField>

            <FormField label="Gender">
              <select className={styles.input} value={form.gender}
                onChange={e => setForm(f => ({ ...f, gender: e.target.value as 'M' | 'F' | 'NB' }))}>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="NB">Non-binary</option>
              </select>
            </FormField>

            <FormField label="Seniority">
              <select className={styles.input} value={form.seniority}
                onChange={e => setForm(f => ({ ...f, seniority: e.target.value as 'junior' | 'senior' | 'manager' }))}>
                <option value="junior">Junior</option>
                <option value="senior">Senior</option>
                <option value="manager">Manager</option>
              </select>
            </FormField>

            <FormField label="Primary skill">
              <select className={styles.input} value={form.primary_skill_id}
                onChange={e => setForm(f => ({ ...f, primary_skill_id: e.target.value }))}>
                <option value="">— select —</option>
                {skillTypes.map(st => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </FormField>

            <FormField label="Languages" hint="Comma-separated, e.g. English, Mandarin">
              <input className={styles.input} value={form.languages}
                placeholder="English, Mandarin"
                onChange={e => setForm(f => ({ ...f, languages: e.target.value }))} />
            </FormField>

            <FormField label="Available days" hint="Leave unchecked for 'all days'" span>
              <div className={styles.dayRow}>
                {DAY_LABELS.map((label, i) => (
                  <label key={i} className={`${styles.dayToggle} ${form.availability_days.includes(i) ? styles.dayOn : ''}`}>
                    <input type="checkbox" style={{ display: 'none' }}
                      checked={form.availability_days.includes(i)}
                      onChange={() => toggleDay(i)} />
                    {label}
                  </label>
                ))}
              </div>
            </FormField>

            {formError && <p className={styles.formError}>{formError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── FormField helper ──────────────────────────────────────────────────────────

function FormField({
  label, hint, required, children, span,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode; span?: boolean
}) {
  return (
    <div className={`${styles.formField} ${span ? styles.span : ''}`}>
      <label className={styles.formLabel}>
        {label}{required && <span className={styles.req}> *</span>}
      </label>
      {children}
      {hint && <span className={styles.formHint}>{hint}</span>}
    </div>
  )
}
