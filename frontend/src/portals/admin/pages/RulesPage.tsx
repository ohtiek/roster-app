import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader'
import { Toggle } from '../../../components/ui/Toggle'
import { Button } from '../../../components/ui/Button'
import type { SessionContext, RuleKey, RuleSeverity, RuleConfig, EngineConfig, ScoringWeights } from '../../../lib/types'
import { supabase } from '../../../lib/supabase'
import styles from './RulesPage.module.css'

interface Props { session: SessionContext }

// ── Static rule definitions ───────────────────────────────────────────────────

interface RuleDef {
  label: string
  description: string
  group: string
  defaultSeverity: RuleSeverity
}

const RULE_DEFS: Record<RuleKey, RuleDef> = {
  max_hours_per_day: {
    label: 'Max hours per day',
    description: 'Flag or block staff assigned shifts that exceed the daily hours ceiling.',
    group: 'Hours',
    defaultSeverity: 'warning',
  },
  weekly_hours_cap: {
    label: 'Weekly hours cap',
    description: 'Cap part-time and casual staff at their contracted weekly hours target.',
    group: 'Hours',
    defaultSeverity: 'warning',
  },
  min_rest_hours: {
    label: 'Minimum rest between shifts',
    description: 'Require a minimum gap between the end of one shift and the start of the next.',
    group: 'Fatigue',
    defaultSeverity: 'warning',
  },
  max_consecutive_shifts: {
    label: 'Max consecutive shifts',
    description: 'Flag or block staff scheduled for more shifts in a row than the configured maximum.',
    group: 'Fatigue',
    defaultSeverity: 'warning',
  },
  certification_expiry: {
    label: 'Certification expiry',
    description: 'Exclude staff whose skill certification has lapsed before the roster date.',
    group: 'Compliance',
    defaultSeverity: 'hard_block',
  },
  vic_coverage: {
    label: 'VIC client coverage',
    description: 'Flag shifts where a VIC client appointment has no assigned advisor.',
    group: 'Quality',
    defaultSeverity: 'warning',
  },
  gender_balance: {
    label: 'Gender balance',
    description: 'Flag shifts that fall outside the 30–70 % female target band.',
    group: 'Quality',
    defaultSeverity: 'warning',
  },
  day_of_week_availability: {
    label: 'Day-of-week availability',
    description: 'Exclude staff not contracted to work on the target weekday (requires availability rows to be configured).',
    group: 'Availability',
    defaultSeverity: 'hard_block',
  },
}

const RULE_ORDER: RuleKey[] = [
  'max_hours_per_day', 'weekly_hours_cap',
  'min_rest_hours', 'max_consecutive_shifts',
  'certification_expiry',
  'vic_coverage', 'gender_balance',
  'day_of_week_availability',
]

// ── Component ─────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function RulesPage({ session }: Props) {
  const boutiqueId = session.activeBoutiqueId

  const [rules, setRules] = useState<Record<RuleKey, RuleConfig>>({} as Record<RuleKey, RuleConfig>)
  const [engine, setEngine] = useState<EngineConfig | null>(null)
  const [weights, setWeights] = useState<ScoringWeights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ruleSaveStates, setRuleSaveStates] = useState<Record<string, SaveState>>({})
  const [engineSave, setEngineSave] = useState<SaveState>('idle')
  const [engineDraft, setEngineDraft] = useState<EngineConfig | null>(null)
  const [weightsSave, setWeightsSave] = useState<SaveState>('idle')
  const [weightsDraft, setWeightsDraft] = useState<ScoringWeights | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!boutiqueId) return
    setLoading(true)
    setError(null)

    const [ruleRes, engineRes, weightsRes] = await Promise.all([
      supabase.from('boutique_rule_config').select('*').eq('boutique_id', boutiqueId),
      supabase.from('boutique_engine_config').select('*').eq('boutique_id', boutiqueId).single(),
      supabase.from('scoring_weights').select('*').eq('boutique_id', boutiqueId).single(),
    ])

    if (ruleRes.error) { setError(ruleRes.error.message); setLoading(false); return }

    const ruleMap = {} as Record<RuleKey, RuleConfig>
    for (const key of RULE_ORDER) {
      const row = ruleRes.data?.find(r => r.rule_key === key)
      ruleMap[key] = row ?? {
        boutique_id: boutiqueId,
        rule_key: key,
        is_enabled: false,
        severity: RULE_DEFS[key].defaultSeverity,
        updated_at: '',
      }
    }
    setRules(ruleMap)

    if (engineRes.data) {
      setEngine(engineRes.data)
      setEngineDraft(engineRes.data)
    }

    if (weightsRes.data) {
      setWeights(weightsRes.data)
      setWeightsDraft(weightsRes.data)
    }

    setLoading(false)
  }, [boutiqueId])

  useEffect(() => { load() }, [load])

  // ── Rule save (auto on change) ────────────────────────────────────────────

  const updateRule = useCallback(async (
    key: RuleKey,
    patch: Partial<Pick<RuleConfig, 'is_enabled' | 'severity'>>,
  ) => {
    if (!boutiqueId) return
    const next = { ...rules[key], ...patch }
    setRules(prev => ({ ...prev, [key]: next }))
    setRuleSaveStates(prev => ({ ...prev, [key]: 'saving' }))

    const { error } = await supabase.from('boutique_rule_config').upsert({
      boutique_id: boutiqueId,
      rule_key: key,
      is_enabled: next.is_enabled,
      severity: next.severity,
    })

    setRuleSaveStates(prev => ({ ...prev, [key]: error ? 'error' : 'saved' }))
    if (!error) {
      setTimeout(() => setRuleSaveStates(prev => ({ ...prev, [key]: 'idle' })), 1500)
    }
  }, [boutiqueId, rules])

  // ── Engine config save ────────────────────────────────────────────────────

  const saveEngine = useCallback(async () => {
    if (!boutiqueId || !engineDraft) return
    setEngineSave('saving')
    const { error } = await supabase.from('boutique_engine_config').upsert({
      ...engineDraft,
      boutique_id: boutiqueId,
    })
    setEngineSave(error ? 'error' : 'saved')
    if (!error) {
      setEngine(engineDraft)
      setTimeout(() => setEngineSave('idle'), 2000)
    }
  }, [boutiqueId, engineDraft])

  // ── Scoring weights save ──────────────────────────────────────────────────

  const saveWeights = useCallback(async () => {
    if (!boutiqueId || !weightsDraft) return
    setWeightsSave('saving')
    const { error } = await supabase.from('scoring_weights').upsert({
      ...weightsDraft,
      boutique_id: boutiqueId,
    })
    setWeightsSave(error ? 'error' : 'saved')
    if (!error) {
      setWeights(weightsDraft)
      setTimeout(() => setWeightsSave('idle'), 2000)
    }
  }, [boutiqueId, weightsDraft])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!boutiqueId) {
    return (
      <div>
        <PageHeader title="Rules & Configuration" subtitle="Engine settings and rule toggles" />
        <p className={styles.empty}>No boutique selected.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Rules & Configuration" subtitle="Engine settings and rule toggles" />
        <p className={styles.loading}>Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Rules & Configuration" subtitle="Engine settings and rule toggles" />
        <p className={styles.errorMsg}>{error}</p>
      </div>
    )
  }

  const groups = ['Hours', 'Fatigue', 'Compliance', 'Quality', 'Availability']

  return (
    <div className={styles.page}>
      <PageHeader title="Rules & Configuration" subtitle="Toggle rules and tune engine thresholds per boutique" />

      <div className={styles.content}>

        {/* ── Rule toggles ── */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Constraint Rules</h2>
          <p className={styles.cardDesc}>
            Hard-block rules skip a staff member during assignment. Warning rules assign normally but surface flags in the roster review.
          </p>
          <div className={styles.ruleTable}>
            {groups.map(group => {
              const groupKeys = RULE_ORDER.filter(k => RULE_DEFS[k].group === group)
              return (
                <div key={group} className={styles.ruleGroup}>
                  <div className={styles.groupLabel}>{group}</div>
                  {groupKeys.map(key => {
                    const def = RULE_DEFS[key]
                    const rule = rules[key]
                    const saveState = ruleSaveStates[key] ?? 'idle'
                    return (
                      <div key={key} className={`${styles.ruleRow} ${rule.is_enabled ? styles.enabled : ''}`}>
                        <div className={styles.ruleInfo}>
                          <span className={styles.ruleName}>{def.label}</span>
                          <span className={styles.ruleDesc}>{def.description}</span>
                        </div>
                        <div className={styles.ruleControls}>
                          <select
                            className={`${styles.severitySelect} ${rule.severity === 'hard_block' ? styles.hard : styles.warn}`}
                            value={rule.severity}
                            disabled={!rule.is_enabled}
                            onChange={e => updateRule(key, { severity: e.target.value as RuleSeverity })}
                          >
                            <option value="warning">Warning</option>
                            <option value="hard_block">Hard block</option>
                          </select>
                          <Toggle
                            checked={rule.is_enabled}
                            onChange={enabled => updateRule(key, { is_enabled: enabled })}
                          />
                          <span className={`${styles.saveIndicator} ${styles[saveState]}`}>
                            {saveState === 'saving' && '…'}
                            {saveState === 'saved' && '✓'}
                            {saveState === 'error' && '!'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Engine thresholds ── */}
        {engineDraft && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Engine Thresholds</h2>
            <p className={styles.cardDesc}>
              Numeric limits used by the roster engine. These values are referenced by the rules above.
            </p>
            <div className={styles.thresholdGrid}>
              <ThresholdField
                label="Target headcount per shift"
                hint="Total staff the engine aims to assign to each shift"
                value={engineDraft.target_headcount_per_shift}
                min={1} max={30}
                onChange={v => setEngineDraft(d => d && { ...d, target_headcount_per_shift: v })}
              />
              <ThresholdField
                label="Max hours per day"
                hint="Used by the max_hours_per_day rule"
                value={engineDraft.max_hours_per_day}
                min={1} max={24}
                onChange={v => setEngineDraft(d => d && { ...d, max_hours_per_day: v })}
              />
              <ThresholdField
                label="Max consecutive shifts"
                hint="Used by the max_consecutive_shifts rule"
                value={engineDraft.max_consecutive_shifts}
                min={1} max={10}
                onChange={v => setEngineDraft(d => d && { ...d, max_consecutive_shifts: v })}
              />
              <ThresholdField
                label="Min rest hours"
                hint="Minimum gap between shift end and next shift start"
                value={engineDraft.min_rest_hours}
                min={0} max={24}
                onChange={v => setEngineDraft(d => d && { ...d, min_rest_hours: v })}
              />
              <ThresholdField
                label="VIC priority boost"
                hint="Scoring bonus applied to VIC advisor assignments"
                value={engineDraft.vic_priority_boost}
                min={0} max={100} step={0.5}
                onChange={v => setEngineDraft(d => d && { ...d, vic_priority_boost: v })}
              />
            </div>
            <div className={styles.saveRow}>
              <SaveStatus state={engineSave} />
              <Button
                variant="primary" size="sm"
                loading={engineSave === 'saving'}
                onClick={saveEngine}
              >
                Save thresholds
              </Button>
            </div>
          </section>
        )}

        {/* ── Scoring weights ── */}
        {weightsDraft && (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Scoring Weights</h2>
            <p className={styles.cardDesc}>
              Weights must sum to 1.0. They control how the engine scores each candidate assignment.
              Current total: <strong className={weightTotal(weightsDraft) === 1 ? styles.ok : styles.bad}>
                {weightTotal(weightsDraft).toFixed(2)}
              </strong>
            </p>
            <div className={styles.thresholdGrid}>
              <WeightField label="Skill coverage" value={weightsDraft.skill_coverage}
                onChange={v => setWeightsDraft(d => d && { ...d, skill_coverage: v })} />
              <WeightField label="VIC affiliation" value={weightsDraft.vic_affiliation}
                onChange={v => setWeightsDraft(d => d && { ...d, vic_affiliation: v })} />
              <WeightField label="Gender balance" value={weightsDraft.gender_balance}
                onChange={v => setWeightsDraft(d => d && { ...d, gender_balance: v })} />
              <WeightField label="Seniority" value={weightsDraft.seniority}
                onChange={v => setWeightsDraft(d => d && { ...d, seniority: v })} />
              <WeightField label="Language coverage" value={weightsDraft.language_coverage}
                onChange={v => setWeightsDraft(d => d && { ...d, language_coverage: v })} />
            </div>
            <div className={styles.saveRow}>
              <SaveStatus state={weightsSave} />
              <Button
                variant="primary" size="sm"
                loading={weightsSave === 'saving'}
                disabled={Math.abs(weightTotal(weightsDraft) - 1) > 0.001}
                onClick={saveWeights}
              >
                Save weights
              </Button>
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function weightTotal(w: ScoringWeights) {
  return +(w.skill_coverage + w.vic_affiliation + w.gender_balance + w.seniority + w.language_coverage).toFixed(4)
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  if (state === 'saving') return <span className={styles.saveMsg}>Saving…</span>
  if (state === 'saved') return <span className={`${styles.saveMsg} ${styles.ok}`}>Saved</span>
  return <span className={`${styles.saveMsg} ${styles.bad}`}>Save failed</span>
}

function ThresholdField({
  label, hint, value, min, max, step = 1, onChange,
}: {
  label: string; hint: string; value: number
  min: number; max: number; step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      <input
        type="number"
        className={styles.fieldInput}
        value={value}
        min={min} max={max} step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
      <span className={styles.fieldHint}>{hint}</span>
    </div>
  )
}

function WeightField({
  label, value, onChange,
}: {
  label: string; value: number; onChange: (v: number) => void
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      <input
        type="number"
        className={styles.fieldInput}
        value={value}
        min={0} max={1} step={0.01}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  )
}
