import { useEffect, useState } from 'react'

// Which kind of pointer is reading this screen. The workbench and the
// decision sheets both branch on it, so the answer lives in one place.

/** a media query, read before the first paint and watched after it */
export function useMedia(query: string, initial: boolean): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? initial : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const read = () => setMatches(media.matches)
    read()
    media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [query])
  return matches
}

/**
 * Whether this is a pointer that can hover and click precisely.
 *
 * Coarse pointers get the touch shape of every control: a decision is
 * chosen with a tap and sent with a press held down, because a thumb lands
 * where it did not mean to and a submission cannot be taken back except in
 * the five seconds after it. Fine pointers keep the keyboard - a tablet
 * with a keyboard attached still reports fine, which is the answer we want.
 */
export function useFinePointer(): boolean {
  return useMedia('(pointer: fine)', true)
}
