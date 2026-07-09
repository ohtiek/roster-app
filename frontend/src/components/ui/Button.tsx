import styles from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  disabled,
  children,
  className = '',
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${styles.btn} ${styles[variant]} ${styles[size]} ${className}`}
      aria-busy={loading}
    >
      {loading ? <span className={styles.spinner} aria-hidden /> : null}
      {children}
    </button>
  )
}
