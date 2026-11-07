import { useCallback, useSyncExternalStore } from 'react'

/**
 * The width below which this is a phone.
 *
 * The same boundary `breakpoints.phone` draws in CSS, written once here for
 * the screens that have to change their tree rather than their rules - a
 * reordering across two subtrees is not something a media query can say.
 * Anything else passing a width to `useIsBelow` is naming its own layout's
 * limit, which is a different number and belongs at that call site.
 */
const MOBILE_BREAKPOINT = 768

/**
 * Whether the viewport is under a width, watched rather than measured once.
 *
 * The breakpoint is a parameter because a screen that folds something away
 * has to fold it at the width its own layout stops fitting - a panel beside a
 * table needs the room a table needs, which is not where the shell's own
 * columns give up.
 *
 * A server drawing the page has no viewport, and says no: the page is drawn
 * at its widest, and a browser taking that html over says the same in its
 * first frame before it answers for itself (docs/adr/0012-rsc-data-mode.md).
 * A layout that must be right in the html is the stylesheet's to draw; this
 * is for a tree that has to change.
 */
export const useIsBelow = (breakpoint: number): boolean =>
  useMediaQuery(`(max-width: ${String(breakpoint - 1)}px)`)

/** A deterministic first frame, followed by the browser's live media state. */
export function useMediaQuery(query: string, serverMatches = false): boolean {
  const subscribe = useCallback(
    (changed: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', changed)
      return () => media.removeEventListener('change', changed)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverMatches,
  )
}

export const useIsMobile = (): boolean => useIsBelow(MOBILE_BREAKPOINT)
