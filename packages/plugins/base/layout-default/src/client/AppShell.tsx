import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { PageTitleScope, usePageTitleClaim } from '@qualy/web-runtime'
import { SectionBar, TopBar } from './TopBar.tsx'
import { BottomBar } from './BottomBar.tsx'
import { AppFooter } from './AppFooter.tsx'
import { useAppNavigation } from './useAppNavigation.ts'
import { shell } from './shell.stylex.ts'

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
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    // No rubber band here. The bars are inside this scroller rather than
    // above it - that is what lets the page pass under their glass - so a
    // bounce at either end carries them with it, and a navigation bar that
    // slides away from the top of the window reads as the shell coming
    // loose. Taking the bars out into an overlay would let the content
    // alone bounce, at the cost of the shell measuring their height before
    // it can lay the page out; not worth it for the last twenty pixels of
    // a gesture. This also stops a flick at the end of the list from
    // chaining out to the window.
    overscrollBehavior: 'none',
  },
  head: {
    position: 'sticky',
    top: 0,
    zIndex: HEAD_LAYER,
  },
  // occupies the band the page scrolls out of first, and no room in the flow
  sentinel: {
    flexShrink: 0,
    height: SCROLLED_AFTER,
    marginBottom: -SCROLLED_AFTER,
    pointerEvents: 'none',
  },
  // the page takes whatever height the bars and the foot leave, so a short
  // page still puts the foot at the bottom of the viewport
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 0,
  },
  // Room under everything for the bar at the foot of a narrow window. On a
  // window with no such bar the page still keeps the device's own gesture
  // area clear, and nothing more: a strip of empty page under the last row
  // would read as the list having ended early.
  footRoom: {
    paddingBottom: {
      default: null,
      [breakpoints.phone]: `calc(${shell.bottomBarHeight} + env(safe-area-inset-bottom))`,
    },
  },
  safeRoom: {
    paddingBottom: { default: null, [breakpoints.phone]: 'env(safe-area-inset-bottom)' },
  },
})

/**
 * The shell, and the page inside it.
 *
 * Split from the shell proper so the page's own claim on the title - made
 * while it renders, inside the scope below - is read by a component that
 * renders after it, rather than by the one that provides the scope.
 */
function Shell() {
  const { apps, activeApp, sections } = useAppNavigation()
  const main = useRef<HTMLElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  // the open page's own heading, and whether it has gone under the bar
  const { title, node: heading } = usePageTitleClaim()
  const [titleShown, setTitleShown] = useState(false)
  const bottomBar = apps.length >= 2
  // The band both observers watch starts where the bars end, so their
  // margin is the bars' measured height - which moves with the section bar
  // and again with the width, since a phone's bar is shorter. Measured
  // rather than assumed: a height read once was right until the first
  // rotation, and then quietly wrong by eight pixels.
  const [barHeight, setBarHeight] = useState(0)
  const withSections = sections.length >= 2
  useEffect(() => {
    const bars = head.current
    if (bars === null) return
    const measure = new ResizeObserver(() => setBarHeight(bars.offsetHeight))
    measure.observe(bars)
    setBarHeight(bars.offsetHeight)
    return () => measure.disconnect()
  }, [withSections])

  useEffect(() => {
    const root = main.current
    const mark = sentinel.current
    if (root === null || mark === null || barHeight === 0) return
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(entry !== undefined && !entry.isIntersecting),
      { root, rootMargin: `-${String(barHeight)}px 0px 0px 0px`, threshold: 0 },
    )
    observer.observe(mark)
    return () => observer.disconnect()
  }, [barHeight])

  // The page's own heading, watched the same way: once it has passed under
  // the bars the bar says the page's name instead. An observer rather than
  // a scroll listener, for the same reason the glass is one - the browser
  // answers "are these two boxes still overlapping" without waking the page
  // on every frame of a flick.
  useEffect(() => {
    const root = main.current
    if (root === null || heading === null || barHeight === 0) {
      setTitleShown(false)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setTitleShown(entry !== undefined && !entry.isIntersecting),
      { root, rootMargin: `-${String(barHeight)}px 0px 0px 0px`, threshold: 0 },
    )
    observer.observe(heading)
    return () => observer.disconnect()
  }, [heading, barHeight])

  return (
    <div {...stylex.props(styles.root)}>
      {/* auto, so a page that fits shows nothing. The width this once
          protected only moves where scrollbars take space, and there a track
          with no thumb is its own defect; a reserved gutter is worse still,
          being a blank strip a full-width band cannot paint into. */}
      <main
        ref={main}
        {...stylex.props(styles.main, bottomBar ? styles.footRoom : styles.safeRoom)}
      >
        <div
          ref={head}
          data-shell-head=""
          data-scrolled={scrolled ? '' : undefined}
          {...stylex.props(styles.head)}
        >
          <TopBar
            apps={apps}
            activeApp={activeApp}
            scrolled={scrolled}
            title={title}
            titleShown={titleShown}
          />
          <SectionBar items={sections} />
        </div>
        <div ref={sentinel} aria-hidden {...stylex.props(styles.sentinel)} />
        <div {...stylex.props(styles.page)}>
          <Outlet />
        </div>
        <AppFooter />
      </main>
      <BottomBar apps={apps} activeApp={activeApp} />
    </div>
  )
}

export default function AppShell() {
  return (
    <PageTitleScope>
      <Shell />
    </PageTitleScope>
  )
}
