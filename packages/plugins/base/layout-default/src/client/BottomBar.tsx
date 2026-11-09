import { useContext } from 'react'
import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { NavLink } from 'react-router'
import { MenuIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import type { ResolvedNavigationItem } from '@qualy/ui-contract'
import { shell, shellRoot } from './shell.stylex.ts'
import { Skeleton } from '@qualy/ui/skeleton'
import { SectionNavigation } from './section-navigation.ts'
import { usePendingNavigation } from '@qualy/web-runtime'
import { NavIcon } from './icons.tsx'

import type { AppEntry } from './TopBar.tsx'
import * as m from '#messages'

// The bar at the foot of a narrow window, and the one question it answers:
// from where I am, where can I go.
//
// What "where I am" means changes with the shell. On an application's own
// pages the answer is the other applications - the row of words a wide
// window carries beside the brand, moved to where a thumb already is. Inside
// a workspace it is that workspace's own sections: for the next ten minutes
// every move the reader makes is inside this one batch, and a bar still
// offering the modules would be spending the easiest place on screen on two
// destinations nobody is going to.
//
// So the bar takes entries rather than knowing what they are. More than fit
// across become one cell at the end that opens the rest.
//
// It is glass at rest rather than on a threshold, unlike the bar at the
// top: this one always has the page running under it, so there is no moment
// at which it sits on nothing and a plain fill would be honest.

/** under the shell's head (50) and under everything a screen floats (40) is wrong here: the bar outranks a page's own foot */
const BAR_LAYER = 45

const styles = stylex.create({
  bar: {
    // Fixed to the window, not to the shell. Against the shell it would be
    // as wide as the page and would scroll sideways with it, which is
    // tidier at widths no device has - and wrong on the one that matters:
    // on iOS an absolutely placed bar follows the layout, which the
    // browser settles only after its own bars have finished moving, so it
    // spent those frames behind them. The window is what a bar at the foot
    // belongs to.
    position: 'fixed',
    insetInline: 0,
    // A pixel past the edge, with the same pixel given back inside.
    //
    // At bottom: 0 the browser rounds the bar's own box against the
    // viewport's, and on a screen whose device pixels do not divide evenly
    // the rounding left a hairline of the page showing under it - which
    // through a blurred ground reads as a gap rather than as a seam.
    bottom: -1,
    // ...but it keeps the floor the page keeps. Under 320 the page holds
    // its width and the window scrolls; a bar that went on shrinking with
    // the window was the one thing on screen still being squeezed, three
    // applications into a hundred and fifty pixels. It now runs off the
    // right edge the way everything else does, which at least says the
    // same thing about the window.
    minWidth: 320,
    zIndex: BAR_LAYER,
    backgroundColor: `color-mix(in oklch, ${tokens.background} 86%, transparent)`,
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: `color-mix(in oklch, ${tokens.foreground} 8%, transparent)`,
    // the device's own gesture area, kept clear under the row, plus the
    // pixel the box was pushed down by
    paddingBottom: 'calc(env(safe-area-inset-bottom) + 1px)',
  },
  // the applications: drawn where the top bar has stopped drawing them
  barPhone: { display: { default: 'none', [breakpoints.phone]: 'block' } },
  // a workspace's sections: drawn wherever the rail beside the page is gone
  // - and stood down where the open screen has taken the foot for a bar of
  // its own, which it says in its html (ScreenFoot)
  barNarrow: {
    display: {
      default: 'none',
      '@media (max-width: 1023.98px)': 'block',
      [stylex.when.ancestor(':has([data-screen-foot="always"])', shellRoot)]: {
        default: 'none',
        '@media (max-width: 1023.98px)': 'none',
      },
      [stylex.when.ancestor(':has([data-screen-foot="phone"])', shellRoot)]: {
        default: 'none',
        '@media (max-width: 1023.98px)': 'block',
        '@media (max-width: 767.98px)': 'none',
      },
    },
  },
  row: {
    display: 'grid',
    height: shell.bottomBarHeight,
    gridAutoFlow: 'column',
    gridAutoColumns: 'minmax(0, 1fr)',
  },
  item: {
    position: 'relative',
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    fontFamily: 'inherit',
    fontSize: 11,
    lineHeight: 1.2,
    textDecoration: 'none',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'ease',
  },
  itemIdle: { fontWeight: 400, color: tokens.mutedForeground },
  itemActive: { fontWeight: 500, color: tokens.foreground },
  glyph: { width: 22, height: 22, flexShrink: 0, strokeWidth: 1.8 },
  // the name is what makes the target legible, so it is never dropped -
  // an icon this bar has no drawing for would otherwise be a blank tile
  word: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // a count belongs to the mark, not to the line of text under it, so it
  // rides the mark's top corner rather than taking a place in the column
  count: {
    position: 'absolute',
    top: 4,
    insetInlineStart: '50%',
    marginInlineStart: 6,
    display: 'flex',
    pointerEvents: 'none',
  },
})

// How many cells a window has room for: one needs 76 pixels, a mark over a
// word of two or three characters with air either side, and below that the
// words start to be cut, which costs more than the cell was worth. Three at
// the least, five at the most - so the window's width falls in one of three
// bands, and the stylesheet answers which, from html a server drew on.
const W4 = '@media (min-width: 304px)'
const W5 = '@media (min-width: 380px)'
const BAND3 = '@media (max-width: 303.98px)'
const BAND4 = '@media (min-width: 304px) and (max-width: 379.98px)'
const BAND5 = '@media (min-width: 380px)'

/** the most cells a folded bar draws */
export const MOST_CELLS = 5

const fold = stylex.create({
  // a cell shown only from a band up, or only below one
  from4: { display: { default: 'none', [W4]: 'flex' } },
  from5: { display: { default: 'none', [W5]: 'flex' } },
  below4: { display: { default: 'flex', [W4]: 'none' } },
  below5: { display: { default: 'flex', [W5]: 'none' } },
  never: { display: 'none' },
  // the cell that opens the rest, lit in the bands where what is open is
  // among the rest: one rule for each set of bands, since a later rule
  // for the same property replaces an earlier one whole
  lit3: {
    fontWeight: { default: 400, [BAND3]: 500 },
    color: { default: tokens.mutedForeground, [BAND3]: tokens.foreground },
  },
  lit4: {
    fontWeight: { default: 400, [BAND4]: 500 },
    color: { default: tokens.mutedForeground, [BAND4]: tokens.foreground },
  },
  lit5: {
    fontWeight: { default: 400, [BAND5]: 500 },
    color: { default: tokens.mutedForeground, [BAND5]: tokens.foreground },
  },
  lit34: {
    fontWeight: { default: 400, [BAND3]: 500, [BAND4]: 500 },
    color: {
      default: tokens.mutedForeground,
      [BAND3]: tokens.foreground,
      [BAND4]: tokens.foreground,
    },
  },
  lit35: {
    fontWeight: { default: 400, [BAND3]: 500, [BAND5]: 500 },
    color: {
      default: tokens.mutedForeground,
      [BAND3]: tokens.foreground,
      [BAND5]: tokens.foreground,
    },
  },
  lit45: {
    fontWeight: { default: 400, [BAND4]: 500, [BAND5]: 500 },
    color: {
      default: tokens.mutedForeground,
      [BAND4]: tokens.foreground,
      [BAND5]: tokens.foreground,
    },
  },
  lit345: {
    fontWeight: { default: 400, [BAND3]: 500, [BAND4]: 500, [BAND5]: 500 },
    color: {
      default: tokens.mutedForeground,
      [BAND3]: tokens.foreground,
      [BAND4]: tokens.foreground,
      [BAND5]: tokens.foreground,
    },
  },
})

type Band = 3 | 4 | 5
const BANDS: readonly Band[] = [3, 4, 5]

/** how many of `count` entries a band shows, with the cell for the rest if they spill */
const shownIn = (band: Band, count: number) => (count > band ? band - 1 : count)

/**
 * The rule that shows a cell in exactly the bands `shown` says: an entry's
 * only ever widen with the window, the cell for the rest only narrow.
 */
const showing = (shown: (band: Band) => boolean): stylex.StyleXStyles | null => {
  if (shown(3)) return shown(5) ? null : shown(4) ? fold.below5 : fold.below4
  if (shown(4)) return fold.from4
  if (shown(5)) return fold.from5
  return fold.never
}

/** the rule that lights the cell for the rest in exactly the bands given */
const lit = (bands: readonly Band[]): stylex.StyleXStyles | null =>
  bands.length === 0 ? null : fold[`lit${bands.join('')}` as keyof typeof fold]

export interface BottomItem {
  id: string
  label: ResolvedNavigationItem['label']
  icon?: string
  to: string
  /** only this exact path counts as being here */
  exact?: boolean
  /** the bar's own notion of which is open, where the address alone cannot say */
  active?: boolean
  badge?: ReactNode
}

export function BottomBar({
  label,
  items,
  more,
  folding,
  reach = 'phone',
  pending = 0,
}: {
  /** what a reader hears this bar called */
  label: string
  items: readonly BottomItem[]
  /** the cell at the end that opens everything this bar had no room for */
  more?: { label: string; active: boolean; onPress: () => void }
  /**
   * Fold `items` to the cells the window has room for, the rest behind a
   * cell of their own - decided by the stylesheet, band by band. `active`
   * says, for how many entries a band shows, whether the cell for the rest
   * is lit.
   */
  folding?: {
    /** how many entries there are in all, of which `items` are the first */
    total: number
    label: string
    active: (shown: number) => boolean
    onPress: () => void
  }
  /** how wide a window still draws it: to the phone breakpoint, or wherever the rail is folded */
  reach?: 'phone' | 'narrow'
  /**
   * How many cells to hold open while the entries are still being decided.
   *
   * The bar is the whole of this window's navigation, and a bar that is not
   * there yet is a screen with no way off it. Worse on the way in: leaving a
   * workspace's list for the workspace itself took the modules away and put
   * the sections up a beat later, so the foot of the screen went empty and
   * came back - which reads as the bar having been lost rather than changed.
   */
  pending?: number
}) {
  if (pending > 0) {
    return (
      <nav
        data-testid="bottom-bar"
        data-shell-bottom=""
        data-pending=""
        aria-label={label}
        aria-busy
        {...stylex.props(styles.bar, reach === 'narrow' ? styles.barNarrow : styles.barPhone)}
      >
        <div {...stylex.props(styles.row)}>
          {Array.from({ length: pending }, (_, index) => (
            <span
              key={index}
              aria-hidden
              {...stylex.props(
                styles.item,
                styles.itemIdle,
                folding !== undefined && showing((band) => index < band),
              )}
            >
              <Skeleton height={22} width={22} radius={6} />
              <Skeleton height={9} width={28} radius={3} />
            </span>
          ))}
        </div>
      </nav>
    )
  }
  if (folding !== undefined) {
    const total = folding.total
    const count = Math.min(items.length, MOST_CELLS)
    const spills = (band: Band) => total > band
    if (total < 2) return null
    return (
      <nav
        data-testid="bottom-bar"
        data-shell-bottom=""
        aria-label={label}
        {...stylex.props(styles.bar, reach === 'narrow' ? styles.barNarrow : styles.barPhone)}
      >
        <div {...stylex.props(styles.row)}>
          {items.slice(0, count).map((item, index) => (
            <BottomLink
              key={item.id}
              item={item}
              xstyle={showing((band) => index < shownIn(band, total))}
            />
          ))}
          {BANDS.some(spills) && (
            <button
              type="button"
              data-testid="bottom-more"
              aria-haspopup="dialog"
              {...stylex.props(
                styles.item,
                styles.itemIdle,
                showing(spills),
                lit(BANDS.filter((band) => spills(band) && folding.active(shownIn(band, total)))),
              )}
              onClick={folding.onPress}
            >
              <MenuIcon aria-hidden {...stylex.props(styles.glyph)} />
              <span {...stylex.props(styles.word)}>{folding.label}</span>
            </button>
          )}
        </div>
      </nav>
    )
  }
  if (items.length < 2 && more === undefined) return null
  return (
    <nav
      data-testid="bottom-bar"
      data-shell-bottom=""
      aria-label={label}
      {...stylex.props(styles.bar, reach === 'narrow' ? styles.barNarrow : styles.barPhone)}
    >
      <div {...stylex.props(styles.row)}>
        {items.map((item) => (
          <BottomLink key={item.id} item={item} />
        ))}
        {more !== undefined && (
          <button
            type="button"
            data-testid="bottom-more"
            aria-haspopup="dialog"
            {...stylex.props(styles.item, more.active ? styles.itemActive : styles.itemIdle)}
            onClick={more.onPress}
          >
            <MenuIcon aria-hidden {...stylex.props(styles.glyph)} />
            <span {...stylex.props(styles.word)}>{more.label}</span>
          </button>
        )}
      </div>
    </nav>
  )
}

function BottomLink({
  item,
  xstyle = null,
}: {
  item: BottomItem
  /** the bands of a folded bar it shows in */
  xstyle?: stylex.StyleXStyles | null
}) {
  const sections = useContext(SectionNavigation)
  const navigation = usePendingNavigation(
    item.to,
    item.exact ?? false,
    item.active === undefined ? sections : undefined,
  )
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      {...(item.active === undefined ? {} : { 'aria-current': item.active ? 'page' : undefined })}
      className={({ isActive }) =>
        stylex.props(
          styles.item,
          (
            item.active === undefined
              ? navigation.selected(isActive)
              : item.active || navigation.pending
          )
            ? styles.itemActive
            : styles.itemIdle,
          xstyle,
        ).className ?? ''
      }
    >
      <NavIcon name={item.icon} className={stylex.props(styles.glyph).className} />
      <span {...stylex.props(styles.word)}>{item.label}</span>
      {item.badge !== undefined && <span {...stylex.props(styles.count)}>{item.badge}</span>}
    </NavLink>
  )
}

/**
 * The applications, at the foot of a phone.
 *
 * One application is not a choice, so the bar does not appear for it. The
 * shell then gives the page back the room, down to the safe area.
 */
export function AppsBar({ apps, activeApp }: { apps: readonly AppEntry[]; activeApp?: string }) {
  return (
    <BottomBar
      label={m.shell_apps()}
      items={apps.map((app) => ({
        id: app.id,
        label: app.label,
        icon: app.icon,
        to: app.path,
        active: app.id === activeApp,
      }))}
    />
  )
}
