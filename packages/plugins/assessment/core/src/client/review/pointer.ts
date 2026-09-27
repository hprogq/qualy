import { useEffect, useLayoutEffect, useState } from 'react'

// Which kind of pointer is reading this screen, and how much room a part of
// it was given. The workbench, the queue and the decision sheets all branch
// on them, so the answers live in one place.

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

/** whether the workbench columns stand beside each other: the same line css draws at */
export function useBeside(): boolean {
  return useMedia('(min-width: 64rem)', true)
}

/**
 * How wide an element is, read before the first paint and after every
 * change of its size.
 *
 * The window is the wrong measure for anything inside the shell: the rail
 * beside a page takes a quarter of a laptop's width, and a layout that
 * asked the window whether two columns fit put them side by side in room
 * for one. Null until the element has been laid out once.
 */
export function useWidthOf<Element extends HTMLElement>(): readonly [
  (node: Element | null) => void,
  number | null,
] {
  const [node, setNode] = useState<Element | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (node === null) return
    const read = () => setWidth(Math.round(node.getBoundingClientRect().width))
    read()
    const watch = new ResizeObserver(read)
    watch.observe(node)
    return () => watch.disconnect()
  }, [node])
  return [setNode, width] as const
}

/** how a scroll the reader did not ask for moves: at once, where they asked for less motion */
export const scrollMotion = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
