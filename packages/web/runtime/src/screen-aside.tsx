import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { Portal } from '@qualy/ui/portal'
import { sharedContext } from './shared-context.ts'

// The shell's side column, lent to the screen that is open.
//
// A workspace shell keeps a rail of the workspace's sections beside every
// screen. A screen that opens one thing inside the workspace - one person on
// a roster - has more to say beside its work than the rail does: who this
// is, which part of them is showing, the way to the next one. So the screen
// may ask for the column, and for as long as it holds it the shell draws the
// screen's content there instead of its rail. The way back to the sections
// is the screen's own way out.
//
// Lent, never taken: a shell with no such column to spare - a narrow window,
// a layout without one - lends none, and the screen draws the same things in
// its own flow instead. Claims are counted rather than flagged, like the
// foot's: two screens overlap for the length of a route change, and the one
// leaving must not take the column back from the one arriving.

interface AsideScope {
  /** whether the shell has a column to lend at all right now */
  readonly offered: boolean
  /** where the lent column is drawn, once the shell has drawn it */
  readonly seat: HTMLElement | null
  readonly holders: number
  readonly claim: (holding: boolean) => void
  readonly setSeat: (node: HTMLElement | null) => void
}

const Scope = sharedContext<AsideScope | null>('screen-aside', null)

/**
 * Mounted by a shell around whatever it renders screens into, saying whether
 * it has a side column to lend.
 */
export function ScreenAsideScope({ offered, children }: { offered: boolean; children: ReactNode }) {
  const [holders, setHolders] = useState(0)
  const [seat, setSeat] = useState<HTMLElement | null>(null)
  // stable, so a claim never re-arms the claimant's own effect
  const claim = useCallback(
    (holding: boolean) => setHolders((count) => Math.max(0, count + (holding ? 1 : -1))),
    [],
  )
  const value = useMemo<AsideScope>(
    () => ({ offered, seat, holders, claim, setSeat }),
    [offered, seat, holders, claim],
  )
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/**
 * For the shell: whether a screen holds the column, and where to seat what
 * it puts there. The shell draws an element with `seat` as its ref in place
 * of its rail while `claimed`.
 */
export function useScreenAsideSeat(): {
  readonly claimed: boolean
  readonly seat: (node: HTMLElement | null) => void
} {
  const scope = useContext(Scope)
  return {
    claimed: scope !== null && scope.offered && scope.holders > 0,
    seat: scope?.setSeat ?? noSeat,
  }
}

const noSeat = () => {}

/** For a screen: whether the shell lends it a side column right now. */
export function useScreenAsideOffered(): boolean {
  return useContext(Scope)?.offered ?? false
}

/**
 * What a screen puts beside its work, drawn in the shell's side column while
 * one is lent, and nowhere otherwise: a screen that is not lent one draws the
 * same things in its own flow, which `useScreenAsideOffered` tells it to.
 *
 * Claimed before the browser paints, so the rail never shows for a frame
 * before the screen's column takes its place.
 */
export function ScreenAside({ children }: { children: ReactNode }) {
  const scope = useContext(Scope)
  const offered = scope?.offered ?? false
  const claim = scope?.claim
  useLayoutEffect(() => {
    if (claim === undefined || !offered) return
    claim(true)
    return () => claim(false)
  }, [claim, offered])
  if (scope === null || !offered) return null
  return <Portal into={scope.seat}>{children}</Portal>
}
