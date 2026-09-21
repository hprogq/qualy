import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import {
  PageTitleScope,
  ScreenFillScope,
  usePageTitleClaim,
  useScreenFillClaimed,
} from '@qualy/web-runtime'
import { SectionChips, TopBar } from './TopBar.tsx'
import { AppsBar } from './BottomBar.tsx'
import { AppFooter } from './AppFooter.tsx'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { useI18n } from '@qualy/web-i18n'
import { SideNav } from './SideNav.tsx'
import { BandFootScope } from '@qualy/ui/screen'
import { layoutMessages as m } from './i18n.ts'
import { useAppNavigation } from './useAppNavigation.ts'
import { shell } from './shell.stylex.ts'

// app-shell/v1 provider: applications across the top, the sections of the
// open one under them, the page below.
//
// The sections stand down the side of a window wide enough to spare the
// column, under the headings their plugins file them by, and only while the
// open application has more than one: a student reading their own result
// carries no empty column of pages they cannot open. A narrow window keeps
// them as a row under the top bar instead.
//
// The bars live INSIDE the scrolling element, stuck to its top, rather than
// above it: the page scrolls in <main>, not in the window, and a bar that
// turns to glass must have the page passing underneath it. Whether the page
// has moved is read from a sentinel just under the bars - it leaves the
// scrollport's visible band once the page has scrolled its own height, and
// an observer says so - never from a scroll listener.

/** how far the page must have moved before the bars turn to glass */
const SCROLLED_AFTER = 12

/** below this the sections fold back into a row under the top bar */
const SIDE_BREAKPOINT = 1024

/** above every sticky element a page keeps (10, 40), below every dialog and sheet (200) */
const HEAD_LAYER = 50

const styles = stylex.create({
  root: {
    // the bars float against this, so they are not part of what scrolls
    position: 'relative',
    display: 'flex',
    height: '100dvh',
    width: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
    // what a rubber band pulls the page away from: the page's own ground,
    // not whatever the browser would paint behind an empty box
    backgroundColor: tokens.background,
  },
  main: {
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    // The page bounces at its ends and the bars do not, which is what a
    // phone has always done and what the bars being an overlay is for.
    // `contain` keeps the bounce and stops only the chaining - a flick at
    // the end of the list does not go on to pull the browser's own
    // furniture about. `none` would take the bounce with it. The axis is
    // named because nothing here wants a say in a sideways edge swipe.
    overscrollBehaviorY: 'contain',
  },
  // a screen that fills the room scrolls inside itself; the shell does not
  // scroll around it
  mainFilled: {
    overflowY: 'hidden',
  },
  head: {
    position: 'absolute',
    insetInline: 0,
    top: 0,
    zIndex: HEAD_LAYER,
  },
  // beside a column the bar is ruled from the start: the column's own line
  // has to meet something, and a bar that earns its rule only once the page
  // moves leaves that line ending in mid air
  headRuled: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  // The room the bars float over, inside the scroller so the page scrolls
  // up through it. Its height is the bars' own, declared in CSS so the
  // first frame is already right; the measurement below only corrects it
  // where a rotation or a text setting has made them taller.
  headRoom: {
    flexShrink: 0,
    height: { default: shell.topBarHeight, [breakpoints.phone]: shell.phoneTopBarHeight },
  },
  // occupies the band the page scrolls out of first, and no room in the flow
  sentinel: {
    flexShrink: 0,
    height: SCROLLED_AFTER,
    marginBottom: -SCROLLED_AFTER,
    pointerEvents: 'none',
  },
  // the side navigation and the page beside it; alone, the page's own column
  frame: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 0,
  },
  frameFilled: { minHeight: 0, flexShrink: 1 },
  // Stuck under the bars for the height they leave, so a long page scrolls
  // past it and a long list of sections scrolls inside it. It has no ground
  // of its own: the page's ground runs under it, ruled off by one line.
  side: {
    position: 'sticky',
    alignSelf: 'flex-start',
    width: 220,
    flexShrink: 0,
    overflowY: 'auto',
    overscrollBehaviorY: 'contain',
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  column: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  // the page takes whatever height the bars and the foot leave, so a short
  // page still puts the foot at the bottom of the viewport
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 0,
  },
  // A page with no band of its own still needs its sections: they stand
  // above its content, in the flow, rather than in a bar of chrome.
  looseSections: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingTop: 16,
  },
  // exactly the height the bars leave, and no more however much it holds
  pageFilled: {
    minHeight: 0,
    flexShrink: 1,
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
  const { apps, activeApp, sections, sectionGroups } = useAppNavigation()
  const { format } = useI18n()
  const narrow = useIsBelow(SIDE_BREAKPOINT)
  // a workbench fills the room under the bars and has no foot under it
  const filled = useScreenFillClaimed()
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
  // how much of the scroller's width its own scrollbar takes, so the bars
  // floating over it stop short of it
  const [gutter, setGutter] = useState(0)
  // whether the page's own band has taken the sections; a page with no band
  // leaves them here, above its content
  const [sectionsTaken, setSectionsTaken] = useState(false)
  const sectioned = sections.length >= 2
  // one or the other carries the sections, never both - and a workbench that
  // fills the room takes the column's room too: the way out of it is the top
  // bar, and a list of sibling pages beside an editor is width it needs
  const beside = sectioned && !narrow && !filled
  const withSections = sectioned && narrow
  useEffect(() => {
    const bars = head.current
    if (bars === null) return
    const measure = new ResizeObserver(() => setBarHeight(bars.offsetHeight))
    measure.observe(bars)
    setBarHeight(bars.offsetHeight)
    return () => measure.disconnect()
  }, [])

  // The bars float over the page, which is what lets the page pass under
  // them - but they floated over its scrollbar too, and the top of the thumb
  // was behind them. The bar ends where the scrollbar begins. Where the
  // browser draws its scrollbars as an overlay this is zero and nothing
  // moves.
  useEffect(() => {
    const root = main.current
    if (root === null) return
    const measure = () => setGutter(root.offsetWidth - root.clientWidth)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(root)
    return () => watch.disconnect()
  }, [])

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
      <div
        ref={head}
        data-shell-head=""
        data-scrolled={scrolled ? '' : undefined}
        style={gutter === 0 ? undefined : { right: gutter }}
        {...stylex.props(styles.head, beside && styles.headRuled)}
      >
        <TopBar
          apps={apps}
          activeApp={activeApp}
          scrolled={scrolled}
          title={title}
          titleShown={titleShown}
        />
      </div>
      {/* auto, so a page that fits shows nothing. The width this once
          protected only moves where scrollbars take space, and there a track
          with no thumb is its own defect; a reserved gutter is worse still,
          being a blank strip a full-width band cannot paint into.
          `scrollPaddingTop` is where the scrollport's top really is, for
          everything that scrolls something into view - a focused control,
          an anchor, `scrollIntoView` - which would otherwise park it under
          the bars. */}
      <main
        ref={main}
        style={barHeight === 0 ? undefined : { scrollPaddingTop: barHeight }}
        {...stylex.props(
          styles.main,
          bottomBar ? styles.footRoom : styles.safeRoom,
          filled && styles.mainFilled,
        )}
      >
        <div
          aria-hidden
          style={barHeight === 0 ? undefined : { height: barHeight }}
          {...stylex.props(styles.headRoom)}
        />
        <div ref={sentinel} aria-hidden {...stylex.props(styles.sentinel)} />
        <div {...stylex.props(styles.frame, filled && styles.frameFilled)}>
          {beside && (
            <aside
              style={{ top: barHeight, height: `calc(100dvh - ${String(barHeight)}px)` }}
              {...stylex.props(styles.side)}
            >
              <SideNav groups={sectionGroups} label={format(m.sideNav)} />
            </aside>
          )}
          <div {...stylex.props(styles.column)}>
            <div {...stylex.props(styles.page, filled && styles.pageFilled)}>
              {/* The sections hang under the page's own words rather than
                  standing in a bar above them: a second band of chrome is
                  one more thing to look past on a screen that has little
                  enough room for what the reader came for. */}
              <BandFootScope
                value={withSections ? <SectionChips items={sections} /> : null}
                onClaim={setSectionsTaken}
              >
                {withSections && !sectionsTaken && (
                  <div {...stylex.props(styles.looseSections)}>
                    <SectionChips items={sections} />
                  </div>
                )}
                <Outlet />
              </BandFootScope>
            </div>
            {filled ? null : <AppFooter />}
          </div>
        </div>
      </main>
      <AppsBar apps={apps} activeApp={activeApp} />
    </div>
  )
}

export default function AppShell() {
  return (
    <PageTitleScope>
      <ScreenFillScope>
        <Shell />
      </ScreenFillScope>
    </PageTitleScope>
  )
}
