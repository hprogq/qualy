import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

// Light, dark, or whatever the machine prefers - the third is the default,
// because a product that ignores the system setting is a product that glows
// white at midnight. The choice lives in localStorage and is applied as a
// class on the document root, which is where the theme's css variables
// switch; nothing about it reaches the server.

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'qualy.theme'

interface ThemeState {
  /** what the person chose, including "follow the system" */
  choice: ThemeChoice
  /** what that resolves to right now, for a component that must know */
  resolved: 'light' | 'dark'
  setChoice: (choice: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

const storedChoice = (): ThemeChoice => {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // following the system means following it as it changes, not only at boot
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }, [resolved])

  const setChoice = useCallback((next: ThemeChoice) => {
    window.localStorage.setItem(STORAGE_KEY, next)
    setChoiceState(next)
  }, [])

  const value = useMemo<ThemeState>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  )
  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeState {
  const context = use(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}
