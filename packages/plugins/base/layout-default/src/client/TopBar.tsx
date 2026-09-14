import type { ReactNode } from 'react'
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
  title = null,
  titleShown = false,
}: {
  apps: readonly AppEntry[]
  activeApp?: string
  /** the page has moved under the bar: it turns to glass */
  scrolled?: boolean
  /**
   * The open page's name, shown once the page's own heading has scrolled
   * away. Only where the applications are not drawn beside it, which is
   * the one place the bar has a middle to spare.
   */
  title?: string | null
  titleShown?: boolean
}) {
  return (
    <div {...stylex.props(styles.bar, scrolled && styles.barScrolled)}>
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
