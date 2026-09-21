import * as stylex from '@stylexjs/stylex'
import { NavLink } from 'react-router'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { shell } from './shell.stylex.ts'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
import { NavIcon } from './icons.tsx'
import { layoutMessages as m } from './i18n.ts'
import type { AppEntry } from './TopBar.tsx'

// The applications, at the foot of a narrow window.
//
// The top bar carries a row of words because a wide window has room for
// them beside the brand; a phone does not, and the row that has to go
// somewhere goes where a thumb already is. So the same applications, the
// same order, drawn as icon over word.
//
// It is glass at rest rather than on a threshold, unlike the bar at the
// top: this one always has the page running under it, so there is no
// moment at which it sits on nothing and a plain fill would be honest.
//
// Which one is open is said in ink and in weight, and not with the ink
// line the top bar draws: that line belongs to a word, drawn as wide as
// the word, and under an icon it would be a rule under a picture.
//
// One application is not a choice, so the bar does not appear for it. The
// shell then gives the page back the room, down to the safe area.

/** under the shell's head (50) and under everything a screen floats (40) is wrong here: the bar outranks a page's own foot */
const BAR_LAYER = 45

const styles = stylex.create({
  bar: {
    display: { default: 'none', [breakpoints.phone]: 'block' },
    // Fixed to the window, not to the shell. Against the shell it would be
    // as wide as the page and would scroll sideways with it, which is
    // tidier at widths no device has - and wrong on the one that matters:
    // on iOS an absolutely placed bar follows the layout, which the
    // browser settles only after its own bars have finished moving, so it
    // spent those frames behind them. The window is what a bar at the foot
    // belongs to.
    position: 'fixed',
    insetInline: 0,
    bottom: 0,
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
    // the device's own gesture area, kept clear under the row
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  row: {
    display: 'grid',
    height: shell.bottomBarHeight,
    gridAutoFlow: 'column',
    gridAutoColumns: 'minmax(0, 1fr)',
  },
  item: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
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
})

export function BottomBar({ apps, activeApp }: { apps: readonly AppEntry[]; activeApp?: string }) {
  const { format } = useI18n()
  // one application is where the reader already is; a bar to switch to it
  // is a row of one that never changes anything
  if (apps.length < 2) return null
  return (
    <nav data-testid="bottom-bar" data-shell-bottom="" aria-label={format(m.appsNav)} {...stylex.props(styles.bar)}>
      <div {...stylex.props(styles.row)}>
        {apps.map((app) => (
          <NavLink
            key={app.id}
            to={app.path}
            className={
              stylex.props(styles.item, app.id === activeApp ? styles.itemActive : styles.itemIdle)
                .className
            }
          >
            <NavIcon name={app.icon} className={stylex.props(styles.glyph).className} />
            <span {...stylex.props(styles.word)}>
              <LocalizedText value={app.label} />
            </span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
