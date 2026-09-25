import { useEffect, useState, useSyncExternalStore } from 'react'

// The three shapes the entries workspace takes, and the room it is given.
//
// The shape decides more than widths: on a phone the structure and one
// question are two screens a reader walks between, on a tablet the question's
// requirements live in a sheet, and at a desk they stand in a column of their
// own. CSS alone cannot say which screen is showing or which element scrolls,
// so the shape is asked in javascript too - from one store, so every part of
// the workspace changes shape in the same commit.

export type WorkspaceMode = 'phone' | 'tablet' | 'desk'

/** where the two columns start standing side by side, and where the third joins */
export const TABLET_UP = '(min-width: 768px)'
export const DESK_UP = '(min-width: 1280px)'

let watched: { tablet: MediaQueryList; desk: MediaQueryList } | null = null
const lists = () =>
  (watched ??= { tablet: window.matchMedia(TABLET_UP), desk: window.matchMedia(DESK_UP) })

const subscribe = (onChange: () => void) => {
  const { tablet, desk } = lists()
  tablet.addEventListener('change', onChange)
  desk.addEventListener('change', onChange)
  return () => {
    tablet.removeEventListener('change', onChange)
    desk.removeEventListener('change', onChange)
  }
}

const snapshot = (): WorkspaceMode => {
  const { tablet, desk } = lists()
  return desk.matches ? 'desk' : tablet.matches ? 'tablet' : 'phone'
}

/** which shape the workspace is in right now */
export function useWorkspaceMode(): WorkspaceMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'desk')
}

/** the nearest ancestor that scrolls, or null when that is the page itself */
export const scrollerAbove = (node: HTMLElement): HTMLElement | null => {
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    const how = getComputedStyle(at).overflowY
    if (how === 'auto' || how === 'scroll' || how === 'overlay') return at
  }
  return null
}

/**
 * The room from where a node lands to the foot of the pane that scrolls it,
 * for a workspace set into a page that does not bound its height.
 *
 * Measured against the scroller rather than the window, and from where the
 * node sits with the scroller at its top, so a page scrolled when the window
 * changes size does not read its own offset as extra room. Re-measured when
 * the scroller or the node's parent changes size, because a heading above
 * that wraps to a second line takes room without the window moving. Off
 * (null) while `enabled` is false: stacked on a phone, the workspace is part
 * of the page.
 */
export function useRoomBelow(
  enabled: boolean,
  floor = 480,
): [(node: HTMLDivElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (node === null || !enabled) {
      setHeight(null)
      return
    }
    const scroller = scrollerAbove(node)
    const measure = () => {
      const bottom =
        scroller === null ? window.innerHeight : scroller.getBoundingClientRect().bottom
      const scrolled = scroller === null ? window.scrollY : scroller.scrollTop
      const room = bottom - (node.getBoundingClientRect().top + scrolled)
      setHeight(Math.max(floor, Math.floor(room)))
    }
    measure()
    const watch = new ResizeObserver(measure)
    if (scroller !== null) watch.observe(scroller)
    if (node.parentElement !== null) watch.observe(node.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [node, enabled, floor])

  return [setNode, height]
}

/**
 * How wide an element is drawn, for a part that lays itself out by the room
 * it is given rather than by the window: the same pane is the whole middle
 * of a wide screen on one page and a third of a narrower container on another.
 * Null until it has been measured once.
 */
export function useWidthOf(): [(node: HTMLElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (node === null) return
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width))
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(node)
    return () => watch.disconnect()
  }, [node])
  return [setNode, width]
}
