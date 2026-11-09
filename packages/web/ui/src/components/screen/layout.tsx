import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import * as stylex from '@stylexjs/stylex'
import { layoutPreferenceRoot } from '../../theme/layout-preference.stylex.ts'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'
import { useIsBelow } from '../../hooks/use-mobile.ts'
import { useHydrating } from '../../hooks/use-hydrating.ts'
import {
  layoutPreferenceSpec,
  setLayoutPreference,
  useLayoutPreference,
  type LayoutWidth,
} from '../layout-preferences.tsx'

// Two pieces of page geometry a tree-beside-a-list screen needs and CSS alone
// does not give: a side column the reader sets the width of, and a box in it
// that always ends at the bottom of the window however far the page has
// scrolled.

const GAP = 20
const FOOT = 16
// how far under the top of its scroller a stuck box stands
const UNDER = 12
const CLIP_ROOM = 4
const splitWidth = 'var(--q-split-drag-width, var(--q-split-width))'

const styles = stylex.create({
  split: {
    position: 'relative',
    display: 'grid',
    alignItems: 'stretch',
    columnGap: GAP,
    rowGap: GAP,
    gridTemplateColumns: 'minmax(0, 1fr)',
    transitionProperty: 'grid-template-columns, column-gap',
    transitionDuration: { default: '220ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: 'ease-in-out',
  },
  splitDragging: { transitionDuration: '0ms' },
  grow: { flexGrow: 1, minHeight: 0 },
  defaultWidth: (width: number) => ({ '--q-split-width-fallback': `${width}px` }),
  roster: {
    '--q-split-width': 'var(--q-assessment-roster-tree-width, var(--q-split-width-fallback))',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoints.wide]: `${splitWidth} minmax(0, 1fr)`,
      [stylex.when.ancestor(
        '[data-ui-folded~="assessment-roster-tree-folded"]',
        layoutPreferenceRoot,
      )]: {
        default: null,
        [breakpoints.wide]: '0px minmax(0, 1fr)',
      },
    },
    columnGap: {
      default: GAP,
      [stylex.when.ancestor(
        '[data-ui-folded~="assessment-roster-tree-folded"]',
        layoutPreferenceRoot,
      )]: {
        default: null,
        [breakpoints.wide]: 0,
      },
    },
  },
  users: {
    '--q-split-width': 'var(--q-users-tree-width, var(--q-split-width-fallback))',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoints.wide]: `${splitWidth} minmax(0, 1fr)`,
    },
  },
  side: {
    minWidth: 0,
    // clipped a little outside its box, so a card's ring drawn outside the
    // card still shows while a folding side stays out of the list
    clipPath: `inset(-${String(CLIP_ROOM)}px)`,
    opacity: 1,
    visibility: 'visible',
    transitionProperty: 'opacity, visibility',
    transitionDuration: { default: '220ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  // a side that stands only beside the main part, never stacked over it
  sideBesideOnly: { display: { default: 'none', [breakpoints.wide]: 'block' } },
  rosterSide: {
    opacity: {
      default: null,
      [stylex.when.ancestor(
        '[data-ui-folded~="assessment-roster-tree-folded"]',
        layoutPreferenceRoot,
      )]: 0,
    },
    visibility: {
      default: null,
      [stylex.when.ancestor(
        '[data-ui-folded~="assessment-roster-tree-folded"]',
        layoutPreferenceRoot,
      )]: 'hidden',
    },
  },
  sideContent: { height: '100%' },
  sideWidth: { width: { default: null, [breakpoints.wide]: splitWidth } },
  main: { minWidth: 0 },
  fillMain: { minHeight: 0, display: 'flex', flexDirection: 'column' },
  // the strip between the two, wide enough to catch and drawn only on hover
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 5,
    display: { default: 'none', [breakpoints.wide]: 'flex' },
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'col-resize',
    touchAction: 'none',
  },
  handleAt: { left: `calc(${splitWidth} + ${GAP / 2 - 6}px)` },
  rosterHandle: {
    visibility: {
      default: null,
      [stylex.when.ancestor(
        '[data-ui-folded~="assessment-roster-tree-folded"]',
        layoutPreferenceRoot,
      )]: 'hidden',
    },
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
  // Until the box is measured - in the html, before any script has run - it
  // stands as tall as it is once stuck: the page's room, which the shell's
  // scroller gives as its container, less the gap above and the foot. At the
  // page's top that reaches a little under the window's edge, by what stands
  // above it; measured, it ends at the edge.
  fillDrawn: {
    top: { default: null, [breakpoints.desktop]: UNDER },
    height: { default: null, [breakpoints.desktop]: `calc(100cqh - ${String(UNDER + FOOT)}px)` },
  },
})

/** Shared geometry for the streamed outline and the interactive split. */
export function SplitFrame({
  preference,
  side,
  children,
  frameRef,
  handle,
  dragging = false,
  grow = false,
  folded = false,
}: {
  preference: LayoutWidth
  side: ReactNode
  children: ReactNode
  frameRef?: Ref<HTMLDivElement>
  handle?: ReactNode
  dragging?: boolean
  grow?: boolean
  /** Interaction semantics only. CSS independently owns track size and visibility. */
  folded?: boolean
}) {
  const roster = preference === 'assessment-roster-tree-width'
  const hasSide = side !== null && side !== false && side !== undefined
  return (
    <div
      ref={frameRef}
      data-split={preference}
      {...stylex.props(
        styles.split,
        hasSide && styles.defaultWidth(layoutPreferenceSpec[preference].initial),
        hasSide && (roster ? styles.roster : styles.users),
        dragging && styles.splitDragging,
        grow && styles.grow,
      )}
    >
      {hasSide && (
        <div
          inert={folded}
          {...stylex.props(
            styles.side,
            roster && styles.sideBesideOnly,
            roster && styles.rosterSide,
          )}
          data-testid="split-side"
        >
          <div {...stylex.props(styles.sideContent, styles.sideWidth)}>{side}</div>
        </div>
      )}
      {hasSide && handle}
      <div {...stylex.props(styles.main, grow && styles.fillMain)}>{children}</div>
    </div>
  )
}

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
  preference,
  handleLabel,
  side,
  children,
}: {
  preference: LayoutWidth
  /** spoken name of the boundary */
  handleLabel: string
  side: ReactNode
  children: ReactNode
}) {
  const { min, max } = layoutPreferenceSpec[preference]
  const clamp = (width: number) => Math.min(max, Math.max(min, width))
  const width = useLayoutPreference(preference)
  const hydrating = useHydrating()
  const roster = preference === 'assessment-roster-tree-width'
  const folded = useLayoutPreference('assessment-roster-tree-folded') && roster
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const origin = useRef<{ x: number; width: number; draft: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const stopDrag = (commit: boolean) => {
    const drag = origin.current
    if (drag === null) return
    origin.current = null
    if (commit) setLayoutPreference(preference, drag.draft)
    frame.current?.style.removeProperty('--q-split-drag-width')
    setDragging(false)
  }

  return (
    <SplitFrame
      preference={preference}
      side={side}
      frameRef={frame}
      dragging={dragging}
      folded={folded}
      handle={
        <button
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label={handleLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={hydrating ? undefined : width}
          disabled={hydrating}
          data-testid="split-handle"
          {...stylex.props(styles.handle, styles.handleAt, roster && styles.rosterHandle)}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
          onPointerDown={(event) => {
            origin.current = { x: event.clientX, width, draft: width }
            setDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = origin.current
            if (drag === null) return
            drag.draft = clamp(Math.round(drag.width + event.clientX - drag.x))
            frame.current?.style.setProperty('--q-split-drag-width', `${drag.draft}px`)
          }}
          onPointerUp={() => stopDrag(true)}
          onPointerCancel={() => stopDrag(false)}
          onLostPointerCapture={() => stopDrag(false)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
            if (step === 0) return
            event.preventDefault()
            setLayoutPreference(preference, clamp(width + step))
          }}
        >
          <span aria-hidden {...stylex.props(styles.rule, (hover || dragging) && styles.ruleLit)} />
          <span aria-hidden {...stylex.props(styles.grip, (hover || dragging) && styles.gripLit)} />
        </button>
      }
    >
      {children}
    </SplitFrame>
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
  const wide = !useIsBelow(1024)

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
        (scroller === null ? 0 : parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0) +
        UNDER
      // CSS sticky's top is relative to the scrollport. The measured marker
      // and viewport edges are not: the shell's bars may put this scrollport
      // well below the window's top, or leave another panel below it.
      const scrollTop =
        scroller === null ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop
      const bottom =
        scroller === null
          ? window.innerHeight
          : Math.min(window.innerHeight, scrollTop + scroller.clientHeight)
      const natural = node.getBoundingClientRect().top
      const top = Math.max(scrollTop + under, natural)
      const height = Math.max(minHeight, bottom - top - FOOT)
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
        {...stylex.props(styles.fill, styles.fillDrawn)}
        style={box === null || !wide ? undefined : { top: box.top, height: box.height }}
        data-testid="sticky-fill"
        data-filling={wide}
      >
        {children}
      </div>
    </>
  )
}
