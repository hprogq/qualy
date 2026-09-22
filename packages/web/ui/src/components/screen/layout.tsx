import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'

// Two pieces of page geometry a tree-beside-a-list screen needs and CSS alone
// does not give: a side column the reader sets the width of, and a box in it
// that always ends at the bottom of the window however far the page has
// scrolled.

const GAP = 20
const FOOT = 16

const styles = stylex.create({
  split: {
    display: 'grid',
    alignItems: 'stretch',
    columnGap: GAP,
    rowGap: GAP,
    gridTemplateColumns: 'minmax(0, 1fr)',
  },
  side: { position: 'relative', minWidth: 0 },
  main: { minWidth: 0 },
  // the strip between the two, wide enough to catch and drawn only on hover
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: -(GAP / 2) - 6,
    zIndex: 5,
    display: { default: 'flex', [breakpoints.phone]: 'none', [breakpoints.tablet]: 'none' },
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'col-resize',
    touchAction: 'none',
  },
  // A pill standing in the middle of the boundary, always drawn: a boundary
  // that shows itself only under the pointer is one nobody knows can move.
  // The line the full height of it is the hover's, to say how far it reaches.
  rule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
  },
  ruleLit: { backgroundColor: tokens.border },
  grip: {
    position: 'sticky',
    top: '45vh',
    alignSelf: 'flex-start',
    marginTop: '30vh',
    width: 5,
    height: 36,
    borderRadius: 9999,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
  },
  gripLit: { backgroundColor: `color-mix(in oklab, ${tokens.foreground} 55%, transparent)` },
  fill: { position: 'sticky', display: 'flex', minHeight: 0, flexDirection: 'column' },
})

const DESKTOP = '(min-width: 1024px)'

/**
 * A side column and what it opens, with the boundary between them the
 * reader's to move.
 *
 * The width is kept in this browser and nowhere else: it is how one person
 * likes their window, not a fact about the page. It is clamped on the way in
 * as well as while dragging, because what was stored came from some other
 * window size. Below the desktop width the two stack and nothing is resizable.
 */
export function ResizableSplit({
  storageKey,
  initial = 300,
  min = 240,
  max = 520,
  from = 1024,
  handleLabel,
  side,
  children,
}: {
  storageKey: string
  initial?: number
  min?: number
  max?: number
  /**
   * The width from which the two stand side by side.
   *
   * The default is where two columns first fit at all. A page whose main
   * side needs more than that says so: below it the two stack, which is the
   * only way a side that has folded to one line stops taking a column the
   * other side needed.
   */
  from?: number
  /** spoken name of the boundary */
  handleLabel: string
  side: ReactNode
  children: ReactNode
}) {
  const beside = `(min-width: ${String(from)}px)`
  const clamp = useCallback((width: number) => Math.min(max, Math.max(min, width)), [min, max])
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey))
      return Number.isFinite(stored) && stored > 0 ? clamp(stored) : initial
    } catch {
      return initial
    }
  })
  const [wide, setWide] = useState(() => window.matchMedia(beside).matches)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const origin = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    const media = window.matchMedia(beside)
    const listen = () => setWide(media.matches)
    listen()
    media.addEventListener('change', listen)
    return () => media.removeEventListener('change', listen)
  }, [beside])

  const keep = (next: number) => {
    try {
      window.localStorage.setItem(storageKey, String(next))
    } catch {
      // a window that cannot remember simply starts from the default again
    }
  }

  return (
    <div
      {...stylex.props(styles.split)}
      style={wide ? { gridTemplateColumns: `${String(width)}px minmax(0, 1fr)` } : undefined}
      data-split-width={width}
    >
      {/* A side that is not there keeps no row: the grid's own row gap then
          stood above the first thing in the other column, which reads as the
          page starting an inch down. */}
      {side !== null && side !== false && side !== undefined && (
        <div {...stylex.props(styles.side)}>
          {side}
          <button
            type="button"
            role="separator"
            aria-orientation="vertical"
            aria-label={handleLabel}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={width}
            data-testid="split-handle"
            {...stylex.props(styles.handle)}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
            onPointerDown={(event) => {
              origin.current = { x: event.clientX, width }
              setDragging(true)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (origin.current === null) return
              setWidth(clamp(origin.current.width + event.clientX - origin.current.x))
            }}
            onPointerUp={(event) => {
              if (origin.current === null) return
              origin.current = null
              setDragging(false)
              event.currentTarget.releasePointerCapture(event.pointerId)
              keep(width)
            }}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
              if (step === 0) return
              event.preventDefault()
              const next = clamp(width + step)
              setWidth(next)
              keep(next)
            }}
          >
            <span
              aria-hidden
              {...stylex.props(styles.rule, (hover || dragging) && styles.ruleLit)}
            />
            <span
              aria-hidden
              {...stylex.props(styles.grip, (hover || dragging) && styles.gripLit)}
            />
          </button>
        </div>
      )}
      <div {...stylex.props(styles.main)}>{children}</div>
    </div>
  )
}

/**
 * A box that starts where the page puts it and always ends at the bottom of
 * the window.
 *
 * At the top of the page it is as tall as the room under the page's heading;
 * as the heading scrolls away it sticks under the bars and grows into the
 * room that frees, so its own scrolling content never runs off the screen
 * and never leaves a gap under itself. The height cannot be said in CSS - it
 * depends on where the box currently is - so it is measured, once per frame
 * at most, from the scroll of whatever scrolls the page.
 */
export function StickyFill({
  children,
  minHeight = 320,
}: {
  children: ReactNode
  minHeight?: number
}) {
  const mark = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  // stacked under one another there is no side column to fill: the box is
  // then as tall as the caller lets its content be
  const [wide, setWide] = useState(() => window.matchMedia(DESKTOP).matches)
  useEffect(() => {
    const media = window.matchMedia(DESKTOP)
    const listen = () => setWide(media.matches)
    media.addEventListener('change', listen)
    return () => media.removeEventListener('change', listen)
  }, [])

  useLayoutEffect(() => {
    const node = mark.current
    if (node === null || !wide) return
    let scroller: HTMLElement | null = node.parentElement
    while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    let frame = 0
    const measure = () => {
      frame = 0
      // where the bars end: the scroller says so for everything that scrolls
      // into view, and this is the same question
      const under =
        (scroller === null ? 0 : parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0) + 12
      const natural = node.getBoundingClientRect().top
      const top = Math.max(under, natural)
      const height = Math.max(minHeight, window.innerHeight - top - FOOT)
      setBox((held) =>
        held !== null && held.top === under && Math.abs(held.height - height) < 1
          ? held
          : { top: under, height },
      )
    }
    const ask = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    measure()
    const target: HTMLElement | Window = scroller ?? window
    target.addEventListener('scroll', ask, { passive: true })
    window.addEventListener('resize', ask)
    const watch = new ResizeObserver(ask)
    if (scroller !== null) watch.observe(scroller)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      target.removeEventListener('scroll', ask)
      window.removeEventListener('resize', ask)
      watch.disconnect()
    }
  }, [minHeight, wide])

  return (
    <>
      {/* where the box would stand if nothing stuck: what the height is measured from */}
      <div ref={mark} aria-hidden />
      <div
        {...stylex.props(styles.fill)}
        style={box === null || !wide ? undefined : { top: box.top, height: box.height }}
        data-testid="sticky-fill"
        data-filling={wide}
      >
        {children}
      </div>
    </>
  )
}
