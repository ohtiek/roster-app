import type { ClientTheme } from './types'

// Black, warm champagne gold, and ecru — the LV tonal register.
// Shift headers stay semantically colour-coded but in deeper, more muted tones
// that sit comfortably inside a predominantly noir palette.
export const louisVuittonTheme: ClientTheme = {
  id: 'louis-vuitton',
  storeName: 'Louis Vuitton',
  eyebrow: 'Daily Roster · Elements',

  colors: {
    primary:     '#1A1A1A',
    primaryDeep: '#000000',
    primaryMid:  '#2C2C2C',
    accent:      '#B08B51',
    accentLight: '#D4B07A',
    background:  '#F5F0E8',
    surface:     '#FFFFFF',
    surface2:    '#EDE8DE',
    ink:         '#0D0D0D',
    muted:       '#6B6360',
    rule:        '#DDD6CC',
    warnBg:      '#FEF3E2',
    warnBorder:  '#B08B51',
    greenBg:     '#E8F0E4',
    greenText:   '#1A3A18',
    vicBg:       '#F0E8D8',
    vicBorder:   '#B08B51',
    vicText:     '#7A5820',
  },

  shifts: {
    morning:   { bg: '#1A2640', dot: '#7AAED4' },
    afternoon: { bg: '#28183A', dot: '#9B85C8' },
    closing:   { bg: '#0D2820', dot: '#5AAD82' },
  },

  fonts: {
    display: "'Cormorant Garamond', serif",
    body:    "'DM Sans', sans-serif",
  },
}
