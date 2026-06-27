import type { ClientTheme } from './types'
import { defaultTheme } from './default'
import { louisVuittonTheme } from './louis-vuitton'

export const themes: Record<string, ClientTheme> = {
  'default':       defaultTheme,
  'louis-vuitton': louisVuittonTheme,
}

export function getTheme(id: string): ClientTheme {
  return themes[id] ?? defaultTheme
}

export type { ClientTheme }
