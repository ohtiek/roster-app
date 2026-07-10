import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { PageHeader } from '../../../components/layout/PageHeader'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import type { SessionContext, RosterSummary } from '../../../lib/types'
import styles from './AdminDashboard.module.css'

interface Props { session: SessionContext }

export function AdminDashboard({ session }: Props) {
  const [drafts, setDrafts] = useState<RosterSummary[]>([])
  const [submitted, setSubmitted] = useState<RosterSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session.activeBoutiqueId) return
    async function load() {
      const { data } = await supabase
        .from('roster_history')
        .select('id, boutique_id, boutique_name, roster_date, status, overall_score, override_count, submit_deadline, approve_deadline, created_at')
        .eq('boutique_id', session.activeBoutiqueId)
        .in('status', ['draft', 'submitted', 'pending_review'])
        .order('roster_date', { ascending: false })
        .limit(20)
      setDrafts((data ?? []).filter((r: RosterSummary) => r.status === 'draft'))
      setSubmitted((data ?? []).filter((r: RosterSummary) => r.status !== 'draft'))
      setLoading(false)
    }
    load()
  }, [session.activeBoutiqueId])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={session.boutiqueRoles.find(r => r.boutique_id === session.activeBoutiqueId)?.boutique_name ?? ''}
      />
      <div className={styles.content}>
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : (
          <>
            <section>
              <h2 className={styles.sectionTitle}>Draft rosters</h2>
              {drafts.length === 0 ? (
                <p className={styles.empty}>No drafts waiting. The overnight batch will generate them.</p>
              ) : (
                <div className={styles.list}>
                  {drafts.map(r => (
                    <Link key={r.id} to={`/admin/rosters/${r.id}`} className={styles.card}>
                      <div className={styles.cardMain}>
                        <span className={styles.date}>{r.roster_date}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className={styles.cardMeta}>
                        Score: {r.overall_score != null ? `${r.overall_score}%` : '—'}
                        {r.override_count > 0 && ` · ${r.override_count} override${r.override_count > 1 ? 's' : ''}`}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className={styles.sectionTitle}>Awaiting approval</h2>
              {submitted.length === 0 ? (
                <p className={styles.empty}>No rosters pending approval.</p>
              ) : (
                <div className={styles.list}>
                  {submitted.map(r => (
                    <Link key={r.id} to={`/admin/rosters/${r.id}`} className={styles.card}>
                      <div className={styles.cardMain}>
                        <span className={styles.date}>{r.roster_date}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      {r.approve_deadline && (
                        <div className={styles.cardMeta}>
                          Deadline: {new Date(r.approve_deadline).toLocaleDateString()}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
