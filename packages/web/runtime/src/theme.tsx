import {
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { sharedContext } from './shared-context.ts'

// Light, dark, or whatever the machine prefers - the third is the default,
// because a product that ignores the system setting is a product that glows
// white at midnight. The choice lives in localStorage; nothing about it
// reaches the server.
//
// The resolved scheme is told to the document root three ways at once, and
// always together: `data-mode`, which the first frame's own style and the
// tokens read; the `dark` class, which the tokens read as well; and
// `color-scheme`, which the browser reads. The boot script in index.html
// sets the same three before any script of ours runs, and this provider
// takes its first answer from what the boot script left rather than
// resolving the question a second time - two resolutions of one question
// once disagreed for one frame in a fresh browser, and the page painted
// light under a dark chrome.

export type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'qualy.theme'

interface ThemeState {
  /** what the person chose, including "follow the system" */
  choice: ThemeChoice
  /** what that resolves to right now, for a component that must know */
  resolved: 'light' | 'dark'
  setChoice: (choice: ThemeChoice) => void
}

const ThemeContext = sharedContext<ThemeState | null>('theme', null)

const systemPrefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

const storedChoice = (): ThemeChoice => {
  if (typeof window === 'undefined') return 'system'
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // a browser that refuses storage still gets a theme: the system's
  }
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

/** what the boot script resolved before any script of ours ran, if it did */
const bootResolved = (): 'light' | 'dark' | null => {
  if (typeof document === 'undefined') return null
  const mode = document.documentElement.dataset['mode']
  return mode === 'light' || mode === 'dark' ? mode : null
}

/** the three things on the root that say which scheme the page is in */
const applyMode = (mode: 'light' | 'dark') => {
  const root = document.documentElement
  root.dataset['mode'] = mode
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice)
  const [systemDark, setSystemDark] = useState(() => {
    // the boot script already answered the system's preference for this
    // page; a choice of one's own does not tell us what the system prefers
    const boot = choice === 'system' ? bootResolved() : null
    return boot === null ? systemPrefersDark() : boot === 'dark'
  })

  // following the system means following it as it changes, not only at boot
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  // before the browser paints, and all three at once: a root that says
  // dark one way and light another paints a light page under a dark chrome
  useLayoutEffect(() => {
    const root = document.documentElement
    applyMode(resolved)
    // the browser's own chrome - Safari's tab bar, iOS's status bar - takes
    // the page's colour from here; it follows the ground token, whichever
    // scheme is on, so a switch made in the page reaches the chrome too
    const ground = getComputedStyle(root).getPropertyValue('--q-background').trim()
    if (ground !== '') {
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.setAttribute('content', ground)
      }
    }
  }, [resolved])

  // A change of theme as one crossfade of the whole page rather than every
  // colour snapping at once: the browser pictures the page before, the new
  // scheme goes on the root inside the update - synchronously, because the
  // page does not render while the browser waits, so a frame awaited there
  // never comes and the transition times out with the page frozen - and the
  // browser fades between the two. Where it cannot, or where motion is not
  // wanted, the colours simply change.
  const setChoice = useCallback(
    (next: ThemeChoice) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // the choice still applies to this page; it will not be remembered
      }
      const start = (
        document as Document & { startViewTransition?: (update: () => void) => unknown }
      ).startViewTransition
      if (start === undefined || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setChoiceState(next)
        return
      }
      start.call(document, () => {
        applyMode(next === 'system' ? (systemDark ? 'dark' : 'light') : next)
        setChoiceState(next)
      })
    },
    [systemDark],
  )

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
