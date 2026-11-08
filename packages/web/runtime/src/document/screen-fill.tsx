import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { sharedContext } from '../shared-context.ts'

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
// A shell that already gives every screen the height under its bars - the
// rail shells around a workspace or a person - has only one thing to give
// up for it: the strip it holds down the right for a scrollbar, which is
// there so pages do not shift sideways from one to the next, and beside a
// workbench is an empty band that can never fill.
//
// The screen says so in its html, with one element where it decides its own
// shape:
//
//   <ScreenFill from="tablet" />
//
// and the shell's stylesheet answers it (`:has([data-screen-fill])`), so a
// page a server drew is laid out the way it will stay from its first frame,
// before any script has run, at whatever width the window is. `from` names
// the widths where it scrolls inside itself; a skeleton says it too - claimed
// only once the data arrives, the whole screen would move sideways by a
// gutter at that moment.
//
// The same claim is also counted for whatever has to know it in javascript,
// like the screen foot: two screens overlap for the length of a route
// change, and the one leaving must not take the room back from the one
// arriving.

/** the attribute a filling screen's mark carries, and the widths it names */
export const SCREEN_FILL = 'data-screen-fill'
export type ScreenFillFrom = 'always' | 'tablet'

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
 * Fills the room under the shell's bars - at every width, or from a tablet
 * up - and gives it back on the way out. A screen that claims it lays itself
 * out to the height it is given and scrolls inside, at the widths where it
 * is a workbench rather than a page.
 */
export function ScreenFill({ from = 'always' }: { from?: ScreenFillFrom }) {
  const phone = useIsBelow(768)
  useClaimScreenFill(from === 'always' || !phone)
  return <span hidden {...{ [SCREEN_FILL]: from }} />
}

function useClaimScreenFill(holding: boolean): void {
  const claim = useContext(Scope)?.claim
  // before the browser may paint the screen: a route change is committed in
  // a transition, whose passive effects can run after the first frame is
  // drawn, and that frame would still hold the strip
  useLayoutEffect(() => {
    if (claim === undefined || !holding) return
    claim(true)
    return () => claim(false)
  }, [claim, holding])
}
