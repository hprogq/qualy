import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { Wordmark } from '@qualy/brand/wordmark'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { shell } from './shell.stylex.ts'
import {
  headerActions,
  sidebarUser,
  type NamespacedId,
  type ResolvedNavigationItem,
} from '@qualy/ui-contract'
import { UiSlot, usePagePrefetch, usePendingNavigation } from '@qualy/web-runtime'
import { LocalizedText } from '@qualy/web-i18n'

// The one bar that never changes: which applications there are, which one is
// open, and the account. Everything below it belongs to the application.
//
// An application is a top-level navigation group; its tab leads to its first
// section, because an application without a page to open is not an
// application the viewer has. Entries that name no group are applications of
// one page and stand beside them.
//
// At rest the bar paints the page's own ground under its words - the same
// colour as everything below, so nothing shows, but a colour of its own:
// Safari reads the colour of a surface at the top edge into its own chrome,
// and a surface with none to read is guessed at, and guessed again as the
// page arrives. Once the page has moved under it - the shell says so with
// `scrolled` - it turns to glass: the page's colour at 62%, blurred, with a hairline under it, so
// what passes beneath reads as a shadow of something while the words above
// stay sharp. Which entry is open is said by weight and by the ink under its
// word: as wide as the word, two pixels, square, six under the text box, and
// it does not move with the scroll. A pointed-at entry shows the same line
// in a lighter ink, grown from the centre.

const INK_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  bar: {
    // the centred title is positioned against this box, so the wordmark and
    // the account keep the places they hold when nothing is said there
    position: 'relative',
    display: 'flex',
    // a phone bar carries the brand and the account and nothing else, so it
    // needs no room for a row of words. The heights are the shell's, since
    // the page has to keep exactly this much room open above itself
    height: { default: shell.topBarHeight, [breakpoints.phone]: shell.phoneTopBarHeight },
    flexShrink: 0,
    alignItems: 'center',
    // the applications sit closer to the wordmark once the window stops
    // being wide enough for them to want the distance
    gap: { default: 32, [breakpoints.tablet]: 24 },
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    backgroundColor: tokens.background,
    transitionProperty: 'background-color, border-color',
    transitionDuration: '180ms',
    transitionTimingFunction: 'ease',
  },
  /**
   * The rule this bar draws where it cannot earn one.
   *
   * At rest the bar has no line because in the shell it was written for the
   * only thing under it is the page, and the page moving beneath is what
   * earns the hairline. A shell that stacks a second bar under this one
   * never has that moment - the bar below is in the flow and never moves -
   * so the rule is stated instead of earned.
   *
   * It is the lighter of the two weights on purpose. Two bars stacked like
   * that are two rows of ONE piece of chrome, not two pieces: the rule
   * between them is the same kind of rule as the one between two rows of a
   * table, and the heavier line belongs at the bottom of the pair, where
   * the chrome ends and the work begins.
   */
  barStacked: {
    borderBottomColor: tokens.divider,
  },
  barScrolled: {
    backgroundColor: `color-mix(in oklch, ${tokens.background} 62%, transparent)`,
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    borderBottomColor: `color-mix(in oklch, ${tokens.foreground} 8%, transparent)`,
  },
  /**
   * What the page is called, once its own heading has gone.
   *
   * Centred on the bar rather than set beside the wordmark: the bar is the
   * brand's line, and a title starting where the brand ends reads as a
   * second brand. It only ever appears where the applications are not
   * drawn, so it has the middle of the bar to itself.
   */
  barTitle: {
    // only where the applications are not in the way; a wide bar already
    // says where the reader is, in the word that carries the ink
    display: { default: 'none', [breakpoints.phone]: 'block' },
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '58%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: tokens.foreground,
    opacity: 0,
    transitionProperty: { default: 'opacity', [REDUCE]: 'none' },
    transitionDuration: { default: '120ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'ease',
    pointerEvents: 'none',
  },
  barTitleShown: { opacity: 1 },
  brand: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    color: tokens.foreground,
  },
  // the applications are a row of words on a wide window and a bar at the
  // foot of a narrow one, so on a phone this seat is simply not drawn
  tabsPhone: { display: { default: null, [breakpoints.phone]: 'none' } },
  tabsNav: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  tabsList: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    overflowX: 'auto',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingInline: 0,
    paddingBlock: 6,
    fontSize: 14,
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'ease',
  },
  tabActive: {
    fontWeight: 600,
    color: tokens.foreground,
  },
  tabIdle: {
    fontWeight: 450,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  // the word itself carries the ink, so the ink is exactly as wide as the word
  word: {
    position: 'relative',
    display: 'inline-block',
    '::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: -6,
      height: 2,
      backgroundColor: tokens.foreground,
      transformOrigin: 'center',
      transitionProperty: 'transform',
      transitionDuration: '180ms',
      transitionTimingFunction: INK_EASE,
    },
  },
  wordActive: {
    '::after': {
      transform: 'scaleX(1)',
    },
  },
  wordIdle: {
    '::after': {
      backgroundColor: `color-mix(in oklch, ${tokens.foreground} 26%, transparent)`,
      transform: {
        default: 'scaleX(0)',
        [stylex.when.ancestor(':hover')]: 'scaleX(1)',
      },
    },
  },
  end: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    // the row of applications is what holds this against the right edge on
    // a wide window; where that row is not drawn, the space does it
    marginInlineStart: { default: null, [breakpoints.phone]: 'auto' },
  },
  sectionBar: {
    display: 'flex',
    height: shell.sectionBarHeight,
    flexShrink: 0,
    alignItems: 'center',
    backgroundColor: tokens.background,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
  },
  // On a narrow window the sections run off the side rather than on to a
  // second line: a bar that grows a row pushes the page down by its own
  // height, and the reader loses the top of what they came to read. The
  // track scrolls; its bar is hidden, since a 40px band has no room for one
  // and the row's own overflow is the affordance.
  sectionScroller: {
    overflowX: { default: null, [breakpoints.phone]: 'auto' },
    scrollbarWidth: { default: null, [breakpoints.phone]: 'none' },
    '::-webkit-scrollbar': { display: { default: null, [breakpoints.phone]: 'none' } },
  },
  sectionList: { flexWrap: { default: null, [breakpoints.phone]: 'nowrap' } },
  sectionLink: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingInline: 0,
    paddingBlock: 4,
    fontSize: 13,
    lineHeight: '1.125rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'ease',
  },
  sectionActive: {
    fontWeight: 550,
    color: tokens.foreground,
  },
  sectionIdle: {
    fontWeight: 450,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  sectionWord: {
    '::after': {
      bottom: -4,
      height: 1.5,
    },
  },
  // The row runs past its own edge, said by fading what is under that edge.
  //
  // A row cut square at the screen's edge reads as a row that ends there -
  // the chip it cuts through looks like a chip drawn badly rather than like
  // more of them. The fade is only on the side there is more on.
  fadeStart: { maskImage: 'linear-gradient(to right, transparent, black 14px)' },
  fadeEnd: { maskImage: 'linear-gradient(to left, transparent, black 14px)' },
  fadeBoth: {
    maskImage:
      'linear-gradient(to right, transparent, black 14px, black calc(100% - 14px), transparent)',
  },
  // the row itself: what scrolls, and what remembers where it was
  chipRow: {
    display: 'flex',
    minWidth: 0,
    width: '100%',
    alignItems: 'center',
    gap: 6,
    overflowX: 'auto',
    scrollbarWidth: 'none',
  },
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingInline: 14,
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 13.5,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    color: tokens.mutedForeground,
  },
  chipOpen: {
    backgroundColor: tokens.primary,
    fontWeight: 500,
    color: tokens.primaryForeground,
  },
})

export interface AppEntry {
  id: string
  label: ResolvedNavigationItem['label']
  path: string
  items: readonly ResolvedNavigationItem[]
  /** the module's own mark, for surfaces that draw one; the top bar does not */
  icon?: string
}

// the wordmark, never live here: the loop belongs to the loading screen.
// Its title names the link, so nothing else has to
function Brand({ to }: { to?: string }) {
  // marked as the place the cold start's loading screen flies its wordmark to
  const mark = <Wordmark height={14} title="Qualy" data-brand-wordmark="" />
  return to === undefined ? (
    <span {...stylex.props(styles.brand)}>{mark}</span>
  ) : (
    <NavLink to={to} className={stylex.props(styles.brand).className}>
      {mark}
    </NavLink>
  )
}

/** the page an application's tab leads to, which is its first entry's */
const firstPageOf = (app: AppEntry): NamespacedId | undefined => {
  for (const item of app.items) {
    if (item.target.kind === 'page') return item.target.pageId
  }
  return undefined
}

/**
 * A link of the bars: lit from the press until the page it leads to has
 * arrived, and its page's code fetched as soon as it is pointed at. The
 * entry lighting is what says the press was heard; the ink under the word
 * says which entry is open.
 */
function BarLink({
  to,
  page,
  active,
  end,
  idle,
  lit,
  base,
  word,
  children,
}: {
  to: string
  page: NamespacedId | undefined
  /** the bar's own notion of which entry is open, when it has one */
  active?: boolean
  end?: boolean
  idle: stylex.StyleXStyles
  lit: stylex.StyleXStyles
  base: stylex.StyleXStyles
  word?: stylex.StyleXStyles
  children: ReactNode
}) {
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  const warm = page === undefined ? undefined : () => prefetch(page)
  const open = (isActive: boolean) => (active ?? isActive) || navigation.pending
  return (
    <NavLink
      to={to}
      end={end}
      onClick={navigation.onClick}
      onPointerEnter={warm}
      onFocus={warm}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      {...(active === undefined ? {} : { 'aria-current': active ? 'page' : undefined })}
      className={({ isActive }) =>
        stylex.props(base, open(isActive) ? lit : idle, stylex.defaultMarker()).className ?? ''
      }
    >
      {({ isActive }) => (
        <span
          {...stylex.props(styles.word, open(isActive) ? styles.wordActive : styles.wordIdle, word)}
        >
          {children}
        </span>
      )}
    </NavLink>
  )
}

export function TopBar({
  apps,
  activeApp,
  scrolled = false,
  stacked = false,
  title = null,
  titleShown = false,
}: {
  apps: readonly AppEntry[]
  activeApp?: string
  /** the page has moved under the bar: it turns to glass */
  scrolled?: boolean
  /**
   * There is more chrome under this bar, in the flow, that never moves.
   *
   * The caller states the fact; the bar decides what to draw for it. Said
   * by whoever stacked the bars, because only that shell knows - this one
   * has no way to look below itself, and guessing would be wrong in the
   * shell where the page is what lies underneath.
   */
  stacked?: boolean
  /**
   * The open page's name, shown once the page's own heading has scrolled
   * away. Only where the applications are not drawn beside it, which is
   * the one place the bar has a middle to spare.
   */
  title?: string | null
  titleShown?: boolean
}) {
  return (
    // glass last: once the page is under the bar, that state owns the line
    <div
      {...stylex.props(styles.bar, stacked && styles.barStacked, scrolled && styles.barScrolled)}
    >
      {/* the mark leads to the first application this viewer has, rather
          than to a literal origin: where "home" is depends on who is
          reading, and only the manifest knows */}
      <Brand to={apps[0]?.path} />
      {title !== null && (
        <span
          aria-hidden
          data-shell-title={titleShown ? '' : undefined}
          {...stylex.props(styles.barTitle, titleShown && styles.barTitleShown)}
        >
          {title}
        </span>
      )}
      <nav {...stylex.props(styles.tabsNav, styles.tabsPhone)}>
        <ul {...stylex.props(styles.tabsList)}>
          {apps.map((app) => (
            <li key={app.id}>
              <BarLink
                to={app.path}
                page={firstPageOf(app)}
                active={app.id === activeApp}
                base={styles.tab}
                lit={styles.tabActive}
                idle={styles.tabIdle}
              >
                <LocalizedText value={app.label} />
              </BarLink>
            </li>
          ))}
        </ul>
      </nav>
      <div {...stylex.props(styles.end)}>
        <UiSlot token={headerActions} />
        <UiSlot token={sidebarUser} />
      </div>
    </div>
  )
}

/**
 * The same sections as a row of chips, for the foot of whatever band the
 * page opens on.
 *
 * A bar of its own above the page's name is a second piece of chrome the
 * reader has to look past to reach what they came for, and a row of
 * underlined words at 13px is a desk's affordance. Under the words, where
 * the eye already is, they are what they are: the parts of this application,
 * with the open one filled in.
 */
export function SectionChips({ items }: { items: readonly ResolvedNavigationItem[] }) {
  // Where the row was scrolled to, kept across pages.
  //
  // The row belongs to the application, but it is drawn by whatever band the
  // open page happens to draw - so moving to another page builds it again
  // from nothing, at offset zero, and the section the reader had scrolled to
  // was suddenly off the left edge. It is one row per application, so one
  // remembered offset is enough.
  const seat = useRef<HTMLDivElement>(null)
  // which edges the row runs past, so it can say so rather than ending in a
  // chip cut clean in half that reads as the last one
  const [more, setMore] = useState({ start: false, end: false })
  const read = useCallback(() => {
    const row = seat.current
    if (row === null) return
    const over = row.scrollWidth - row.clientWidth
    setMore({ start: row.scrollLeft > 1, end: over > 1 && row.scrollLeft < over - 1 })
  }, [])
  useLayoutEffect(() => {
    const row = seat.current
    if (row === null) return
    row.scrollLeft = held
    // the open one brought back into view, for a reader who arrived by some
    // other route than pressing it here
    row.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
    read()
    const watch = new ResizeObserver(read)
    watch.observe(row)
    return () => watch.disconnect()
  }, [read])
  if (items.length < 2) return null
  return (
    <div
      ref={seat}
      data-testid="section-chips"
      onScroll={(event) => {
        held = event.currentTarget.scrollLeft
        read()
      }}
      {...stylex.props(
        styles.chipRow,
        more.start && more.end
          ? styles.fadeBoth
          : more.start
            ? styles.fadeStart
            : more.end
              ? styles.fadeEnd
              : null,
      )}
    >
      {items.map((item) =>
        item.target.kind === 'page' ? (
          <SectionChip
            key={item.id}
            to={item.target.path}
            page={item.target.pageId}
            label={item.label}
          />
        ) : (
          <a
            key={item.id}
            {...stylex.props(styles.chip)}
            href={item.target.href}
            {...(item.target.newWindow ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
          >
            <LocalizedText value={item.label} />
          </a>
        ),
      )}
    </div>
  )
}

/** how far the sections were scrolled, the last time anybody drew them */
let held = 0

function SectionChip({
  to,
  page,
  label,
}: {
  to: string
  page: NamespacedId
  label: ResolvedNavigationItem['label']
}) {
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  return (
    <NavLink
      to={to}
      end
      data-testid="section-chip"
      onClick={navigation.onClick}
      onPointerEnter={() => prefetch(page)}
      onFocus={() => prefetch(page)}
      aria-busy={navigation.pending || undefined}
      className={({ isActive }) =>
        stylex.props(styles.chip, (isActive || navigation.pending) && styles.chipOpen).className ??
        ''
      }
    >
      <LocalizedText value={label} />
    </NavLink>
  )
}

/** the sections of the open application, when it has more than one */
export function SectionBar({ items }: { items: readonly ResolvedNavigationItem[] }) {
  if (items.length < 2) return null
  return (
    <div {...stylex.props(styles.sectionBar)}>
      <nav {...stylex.props(styles.tabsNav, styles.sectionScroller)}>
        <ul {...stylex.props(styles.tabsList, styles.sectionList)}>
          {items.map((item) => (
            <li key={item.id}>
              {item.target.kind === 'page' ? (
                <BarLink
                  to={item.target.path}
                  page={item.target.pageId}
                  base={styles.sectionLink}
                  lit={styles.sectionActive}
                  idle={styles.sectionIdle}
                  word={styles.sectionWord}
                >
                  <LocalizedText value={item.label} />
                </BarLink>
              ) : (
                <a
                  {...stylex.props(styles.sectionLink, styles.sectionIdle)}
                  href={item.target.href}
                  {...(item.target.newWindow
                    ? { target: '_blank', rel: 'noreferrer noopener' }
                    : {})}
                >
                  <LocalizedText value={item.label} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
