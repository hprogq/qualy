import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { sharedContext } from './shared-context.ts'

// Whether the screen currently open fills the room under the shell's bars.
//
// Most screens are a page: they grow with what they hold, the shell scrolls
// them, and the shell's own foot follows the last row. A workbench is not -
// an editor with a source pane, a side column and a panel under both scrolls
// each of those in its own place, and a page scroll around it is a second
// scrollbar that moves the whole tool and the foot into view for nothing.
// So the screen says so, and the shell gives it exactly the height left
// under its bars, stops scrolling itself, and leaves its foot out.
//
// Counted rather than a flag, like the screen foot: two screens overlap for
// the length of a route change, and the one leaving must not take the room
// back from the one arriving.

interface FillScope {
  readonly claimed: boolean
  readonly claim: (holding: boolean) => void
}

const Scope = sharedContext<FillScope | null>('screen-fill', null)

/** mounted by a shell, around whatever it renders screens into */
export function ScreenFillScope({ children }: { children: ReactNode }) {
  const [holders, setHolders] = useState(0)
  // stable, so a claim never re-arms the claimant's own effect
  const claim = useCallback(
    (holding: boolean) => setHolders((count) => Math.max(0, count + (holding ? 1 : -1))),
    [],
  )
  const value = useMemo<FillScope>(() => ({ claimed: holders > 0, claim }), [holders, claim])
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/** whether some screen fills the room; false wherever no shell offers one */
export function useScreenFillClaimed(): boolean {
  return useContext(Scope)?.claimed ?? false
}

/**
 * Fills the room under the shell's bars while `holding`, and gives it back on
 * the way out. A screen that claims it lays itself out to the height it is
 * given and scrolls inside; usually only at the widths where it is a
 * workbench rather than a page.
 */
export function useClaimScreenFill(holding: boolean): void {
  const claim = useContext(Scope)?.claim
  useEffect(() => {
    if (claim === undefined || !holding) return
    claim(true)
    return () => claim(false)
  }, [claim, holding])
}
