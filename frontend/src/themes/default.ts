import type { ClientTheme } from './types'

export const defaultTheme: ClientTheme = {
  id: 'default',
  storeName: 'Maison Aurore',
  eyebrow: 'Daily Roster',

  colors: {
    primary:     '#1E2761',
    primaryDeep: '#141D4A',
    primaryMid:  '#243080',
    accent:      '#C9A84C',
    accentLight: '#E8D09A',
    background:  '#F7F5EF',
    surface:     '#ffffff',
    surface2:    '#F7F5EF',
    ink:         '#1a1a1a',
    muted:       '#6B6B6B',
    rule:        '#E0DDD4',
    warnBg:      '#FEF3E2',
    warnBorder:  '#D97706',
    greenBg:     '#EAF3DE',
    greenText:   '#27500A',
    vicBg:       '#F5F0E8',
    vicBorder:   '#C9A84C',
    vicText:     '#7A5C1E',
  },

  shifts: {
    morning:   { bg: '#1E4D8C', dot: '#5B8FCC' },
    afternoon: { bg: '#4A3280', dot: '#9B85D4' },
    closing:   { bg: '#0F6E56', dot: '#3DB88A' },
  },

  fonts: {
    display: "'Cormorant Garamond', serif",
    body:    "'DM Sans', sans-serif",
  },
}
