import { createContext, useContext, useEffect, type ReactNode } from 'react'
import type { ClientTheme } from './themes/types'
import { getTheme } from './themes'

const ThemeCtx = createContext<ClientTheme>(null!)
export const useTheme = () => useContext(ThemeCtx)

function hexRgb(hex: string): string {
  const h = hex.replace('#', '')
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`
}

export function ThemeProvider({ themeId, children }: { themeId: string; children: ReactNode }) {
  const theme = getTheme(themeId)

  useEffect(() => {
    const r = document.documentElement
    const c = theme.colors
    r.style.setProperty('--navy',        c.primary)
    r.style.setProperty('--navy-deep',   c.primaryDeep)
    r.style.setProperty('--navy-mid',    c.primaryMid)
    r.style.setProperty('--gold',        c.accent)
    r.style.setProperty('--gold-light',  c.accentLight)
    r.style.setProperty('--gold-lt',     c.accentLight)
    r.style.setProperty('--gold-dim',    `rgba(${hexRgb(c.accent)},0.15)`)
    r.style.setProperty('--gold-a40',   `rgba(${hexRgb(c.accent)},0.4)`)
    r.style.setProperty('--gold-a60',   `rgba(${hexRgb(c.accent)},0.6)`)
    r.style.setProperty('--cream',       c.background)
    r.style.setProperty('--surface',     c.surface)
    r.style.setProperty('--surface2',    c.surface2)
    r.style.setProperty('--ink',         c.ink)
    r.style.setProperty('--muted',       c.muted)
    r.style.setProperty('--rule',        c.rule)
    r.style.setProperty('--warn-bg',     c.warnBg)
    r.style.setProperty('--warn-border', c.warnBorder)
    r.style.setProperty('--green-bg',    c.greenBg)
    r.style.setProperty('--green-text',  c.greenText)
    r.style.setProperty('--vic-bg',      c.vicBg)
    r.style.setProperty('--vic-border',  c.vicBorder)
  }, [theme])

  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>
}
