import { themes } from './themes'
import { useTheme } from './ThemeProvider'

// Only visible when ?demo=true is in the URL — meant for live client presentations.
export function ClientSwitcher() {
  const current = useTheme()
  const isDemo = new URLSearchParams(window.location.search).has('demo')
  if (!isDemo) return null

  function switchTo(id: string) {
    const params = new URLSearchParams(window.location.search)
    params.set('client', id)
    window.location.search = params.toString()
  }

  return (
    <div className="client-switcher" role="navigation" aria-label="Client theme switcher">
      <span className="cs-label">Demo</span>
      {Object.values(themes).map(t => (
        <button
          key={t.id}
          className={`cs-btn ${t.id === current.id ? 'cs-active' : ''}`}
          onClick={() => switchTo(t.id)}
        >
          {t.storeName}
        </button>
      ))}
    </div>
  )
}
