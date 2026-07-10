import styles from './Toggle.module.css'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
}

export function Toggle({ checked, onChange, disabled, id }: Props) {
  return (
    <label className={`${styles.root} ${disabled ? styles.disabled : ''}`}>
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
    </label>
  )
}
