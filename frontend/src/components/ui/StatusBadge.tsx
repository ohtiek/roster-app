import type { RosterStatus } from '../../lib/types'
import styles from './StatusBadge.module.css'

const CONFIG: Record<RosterStatus, { label: string; cls: string }> = {
  draft:             { label: 'Draft',     cls: 'neutral'  },
  submitted:         { label: 'Submitted', cls: 'blue'     },
  pending_review:    { label: 'Pending',   cls: 'blue'     },
  approved:          { label: 'Approved',  cls: 'green'    },
  published:         { label: 'Published', cls: 'green'    },
  published_amended: { label: 'Amended',   cls: 'amber'    },
  rejected:          { label: 'Rejected',  cls: 'red'      },
  archived:          { label: 'Archived',  cls: 'neutral'  },
}

interface Props {
  status: RosterStatus
}

export function StatusBadge({ status }: Props) {
  const { label, cls } = CONFIG[status] ?? { label: status, cls: 'neutral' }
  return <span className={`${styles.badge} ${styles[cls]}`}>{label}</span>
}
