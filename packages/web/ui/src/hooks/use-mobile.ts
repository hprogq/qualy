import { useEffect, useState } from 'react'

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
 */
export function useIsBelow(breakpoint: number): boolean {
  const [below, setBelow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  )
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${String(breakpoint - 1)}px)`)
    const onChange = () => setBelow(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [breakpoint])
  return below
}

export const useIsMobile = (): boolean => useIsBelow(MOBILE_BREAKPOINT)
