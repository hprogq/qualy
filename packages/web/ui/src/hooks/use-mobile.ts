import { useEffect, useState } from 'react'

/** the width below which the shell stops being a two-column layout */
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
