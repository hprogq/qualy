import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { SectionBar, TopBar } from './TopBar.tsx'
import { useAppNavigation } from './useAppNavigation.ts'

// app-shell/v1 provider: applications across the top, the sections of the
// open one under them, the page below.
//
// There is no permanent rail. Most of this product's screens are one of three
// or four pages in an application, and a column standing beside them all day
// costs more room than it navigates - a student reading their own result was
// carrying an empty sidebar of pages they cannot open. What needs a rail is
// working inside one thing for a while, and that has a shell of its own.
//
// The bars live INSIDE the scrolling element, stuck to its top, rather than
// above it: the page scrolls in <main>, not in the window, and a bar that
// turns to glass must have the page passing underneath it. Whether the page
// has moved is read from a sentinel just under the bars - it leaves the
// scrollport's visible band once the page has scrolled its own height, and
// an observer says so - never from a scroll listener.

/** how far the page must have moved before the bars turn to glass */
const SCROLLED_AFTER = 12

/** above every sticky element a page keeps (10, 40), below every dialog and sheet (200) */
const HEAD_LAYER = 50

const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100dvh',
    width: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  main: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
  },
  head: {
    position: 'sticky',
    top: 0,
    zIndex: HEAD_LAYER,
  },
  // occupies the band the page scrolls out of first, and no room in the flow
  sentinel: {
    height: SCROLLED_AFTER,
    marginBottom: -SCROLLED_AFTER,
    pointerEvents: 'none',
  },
})

export default function AppShell() {
  const { apps, activeApp, sections } = useAppNavigation()
  const main = useRef<HTMLElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  // the bars' height changes with the section bar, and the band the sentinel
  // is watched in starts where the bars end
  const withSections = sections.length >= 2

  useEffect(() => {
    const root = main.current
    const mark = sentinel.current
    const bars = head.current
    if (root === null || mark === null || bars === null) return
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(entry !== undefined && !entry.isIntersecting),
      { root, rootMargin: `-${String(bars.offsetHeight)}px 0px 0px 0px`, threshold: 0 },
    )
    observer.observe(mark)
    return () => observer.disconnect()
  }, [withSections])

  return (
    <div {...stylex.props(styles.root)}>
      {/* auto, so a page that fits shows nothing. The width this once
          protected only moves where scrollbars take space, and there a track
          with no thumb is its own defect; a reserved gutter is worse still,
          being a blank strip a full-width band cannot paint into. */}
      <main ref={main} {...stylex.props(styles.main)}>
        <div
          ref={head}
          data-shell-head=""
          data-scrolled={scrolled ? '' : undefined}
          {...stylex.props(styles.head)}
        >
          <TopBar apps={apps} activeApp={activeApp} scrolled={scrolled} />
          <SectionBar items={sections} />
        </div>
        <div ref={sentinel} aria-hidden {...stylex.props(styles.sentinel)} />
        <Outlet />
      </main>
    </div>
  )
}
