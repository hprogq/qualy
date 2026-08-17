import { useEffect, useState } from 'react'

/**
 * However much room is left below wherever this lands, so a screen can fill
 * what it is given and scroll inside its own panes.
 *
 * Measured against the pane that scrolls, not against the window. The two
 * agree only while that pane is scrolled to the top: `innerHeight - top` of a
 * node inside a scrolled container reads however far it has been pushed up as
 * extra room, and the screen is then taller than the space it was given -
 * which the container answers with a scrollbar the screen was built not to
 * need. Both figures here are viewport-relative, so the scroll position falls
 * out of the subtraction.
 *
 * Re-measured when that pane changes size, not only when the window does: a
 * heading band above it wraps to a second line at some widths, and a side
 * rail opening changes the room without the window moving at all.
 *
 * Only where the layout puts panes side by side. Stacked, the screen is a
 * section of the page like any other and a fixed height would just crop it.
 */
export function useRestOfTheScroller(
  /** space to stop short of, where the page carries its own bottom padding */
  gutter = 0,
  /** never smaller than this, however little is left */
  floor = 240,
): [(node: HTMLDivElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (node === null) return
    const beside = window.matchMedia('(min-width: 64rem)')
    const scroller = scrollerAbove(node)

    const measure = () => {
      if (!beside.matches) {
        setHeight(null)
        return
      }
      const bottom =
        scroller === null ? window.innerHeight : scroller.getBoundingClientRect().bottom
      const room = bottom - node.getBoundingClientRect().top - gutter
      setHeight(Math.max(floor, Math.round(room)))
    }

    measure()
    const watch = new ResizeObserver(measure)
    if (scroller !== null) watch.observe(scroller)
    if (node.parentElement !== null) watch.observe(node.parentElement)
    window.addEventListener('resize', measure)
    beside.addEventListener('change', measure)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', measure)
      beside.removeEventListener('change', measure)
    }
  }, [node, gutter, floor])

  return [setNode, height]
}

/** the nearest ancestor that scrolls, or null when that is the page itself */
function scrollerAbove(node: HTMLElement): HTMLElement | null {
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    const how = getComputedStyle(at).overflowY
    if (how === 'auto' || how === 'scroll' || how === 'overlay') return at
  }
  return null
}
