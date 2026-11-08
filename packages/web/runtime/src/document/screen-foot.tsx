import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { sharedContext } from '../shared-context.ts'

// Whether the screen currently open has taken the foot of the window for
// itself.
//
// A narrow shell floats one control down there. A screen that ends in a bar
// of its own - a workbench whose decision belongs at the bottom edge, where
// a thumb is - would have that control sitting on top of it, and two things
// competing for the same corner is a screen nobody can act on. So the screen
// says so, and the shell stands its own control down for as long as the
// claim holds.
//
// Counted rather than a flag: two screens overlap for the length of a route
// change, and the one leaving must not take the foot back from the one
// arriving.

interface FootScope {
  readonly claimed: boolean
  readonly claim: (holding: boolean) => void
}

const Scope = sharedContext<FootScope | null>('screen-foot', null)

/** mounted by the shell, around whatever it renders screens into */
export function ScreenFootScope({ children }: { children: ReactNode }) {
  const [holders, setHolders] = useState(0)
  // stable, so a claim never re-arms the claimant's own effect
  const claim = useCallback(
    (holding: boolean) => setHolders((count) => Math.max(0, count + (holding ? 1 : -1))),
    [],
  )
  const value = useMemo<FootScope>(() => ({ claimed: holders > 0, claim }), [holders, claim])
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/** whether some screen has the foot; false wherever no shell offers one */
export function useScreenFootClaimed(): boolean {
  return useContext(Scope)?.claimed ?? false
}

/** the attribute a screen's mark on the foot carries, and the widths it names */
export const SCREEN_FOOT = 'data-screen-foot'
export type ScreenFootAt = 'always' | 'phone'

/**
 * Takes the foot of the window while `holding` - wherever the shell draws
 * a bar there, or (`at="phone"`) on a phone only - and gives it back on the
 * way out. Said in the screen's html, so the shell's stylesheet stands its
 * own bar down from the first frame (`:has([data-screen-foot])`), and
 * counted for whatever has to know it in javascript.
 */
export function ScreenFoot({ holding, at = 'always' }: { holding: boolean; at?: ScreenFootAt }) {
  useClaimScreenFoot(holding)
  return holding ? <span hidden {...{ [SCREEN_FOOT]: at }} /> : null
}

/**
 * Claims the foot of the window while `holding`, and gives it back on the
 * way out. Called by a screen that draws its own bar at the bottom edge,
 * usually only at the widths where it does.
 */
export function useClaimScreenFoot(holding: boolean): void {
  const claim = useContext(Scope)?.claim
  // before the browser may paint the screen, so the shell's own control is
  // never drawn for a frame on top of the bar that claims its place
  useLayoutEffect(() => {
    if (claim === undefined || !holding) return
    claim(true)
    return () => claim(false)
  }, [claim, holding])
}
