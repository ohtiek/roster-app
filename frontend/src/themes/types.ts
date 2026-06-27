export interface ClientTheme {
  id: string
  storeName: string
  eyebrow: string

  colors: {
    primary: string
    primaryDeep: string
    primaryMid: string
    accent: string
    accentLight: string
    background: string
    surface: string
    surface2: string
    ink: string
    muted: string
    rule: string
    warnBg: string
    warnBorder: string
    greenBg: string
    greenText: string
    vicBg: string
    vicBorder: string
    vicText: string
  }

  shifts: {
    morning:   { bg: string; dot: string }
    afternoon: { bg: string; dot: string }
    closing:   { bg: string; dot: string }
  }

  fonts: {
    display: string
    body: string
  }
}
