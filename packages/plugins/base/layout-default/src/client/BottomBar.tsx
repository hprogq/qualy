import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { NavLink } from 'react-router'
import { MenuIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import type { ResolvedNavigationItem } from '@qualy/ui-contract'
import { shell } from './shell.stylex.ts'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
import { Skeleton } from '@qualy/ui/skeleton'
import { Loader } from '@qualy/brand/loader'
import { usePendingNavigation } from '@qualy/web-runtime'
import { NavIcon } from './icons.tsx'
import { layoutMessages as m } from './i18n.ts'
import type { AppEntry } from './TopBar.tsx'

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
  barNarrow: { display: { default: 'none', '@media (max-width: 1023.98px)': 'block' } },
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
  reach = 'phone',
  pending = 0,
}: {
  /** what a reader hears this bar called */
  label: string
  items: readonly BottomItem[]
  /** the cell at the end that opens everything this bar had no room for */
  more?: { label: string; active: boolean; onPress: () => void }
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
            <span key={index} aria-hidden {...stylex.props(styles.item, styles.itemIdle)}>
              <Skeleton height={22} width={22} radius={6} />
              <Skeleton height={9} width={28} radius={3} />
            </span>
          ))}
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

/**
 * One cell of the bar.
 *
 * The press answers at once, as the rail's entries do: the cell lights
 * before the address has moved, and after a beat its mark gives way to the
 * loader for as long as the page's code is on its way. Without it a press
 * on a page not fetched yet did nothing visible until the page appeared,
 * which reads as a press that missed.
 */
function BottomLink({ item }: { item: BottomItem }) {
  const navigation = usePendingNavigation(item.to)
  return (
    <NavLink
      to={item.to}
      end={item.exact}
      onClick={navigation.onClick}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      data-indicating={navigation.indicating ? '' : undefined}
      {...(item.active === undefined ? {} : { 'aria-current': item.active ? 'page' : undefined })}
      className={({ isActive }) =>
        stylex.props(
          styles.item,
          (item.active ?? isActive) || navigation.pending ? styles.itemActive : styles.itemIdle,
        ).className ?? ''
      }
    >
      {navigation.indicating ? (
        <Loader size={22} xstyle={styles.glyph} />
      ) : (
        <NavIcon name={item.icon} className={stylex.props(styles.glyph).className} />
      )}
      <span {...stylex.props(styles.word)}>
        <LocalizedText value={item.label} />
      </span>
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
  const { format } = useI18n()
  return (
    <BottomBar
      label={format(m.appsNav)}
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
