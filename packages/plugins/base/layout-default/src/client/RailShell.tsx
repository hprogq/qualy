import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router'
import { Reveal } from '@qualy/ui/reveal'
import { PanelLeftIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { Loader } from '@qualy/brand/loader'
import { a11yStyles } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { shell } from './shell.stylex.ts'
import { pending } from './pending.ts'
import {
  drawerAccount,
  drawerIdentity,
  drawerSignOut,
  headerActions,
  navigationGroups,
  sidebarUser,
  type NamespacedId,
  type NavigationItem,
  type ResolvedNavigationItem,
  type UiCollectionToken,
  type UiSlotToken,
} from '@qualy/ui-contract'
import {
  ScreenFootScope,
  UiSlot,
  useIdlePagePrefetch,
  usePagePrefetch,
  usePendingNavigation,
  useUiCollection,
  useScreenFootClaimed,
  WorkspaceCapabilityScope,
  useWorkspaceCapabilities,
} from '@qualy/web-runtime'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
import { Skeleton } from '@qualy/ui/skeleton'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { TopBar } from './TopBar.tsx'
import { AppsBar, BottomBar } from './BottomBar.tsx'
import { NavIcon } from './icons.tsx'
import { useAppNavigation } from './useAppNavigation.ts'
import { byOrder, fill, hasEntriesBelow, isHere, useCellsAcross, useNavDrawer } from './rail.ts'
import { layoutMessages as m } from './i18n.ts'

// The shape two contracts share: the same applications across the top, then
// a strip saying what is open and a rail of everything that can be done to
// it or known about it. The workspace shell mounts it around a batch, the
// user-detail shell around a person; which collection fills the rail and
// which slot fills the strip are the whole difference, and they come in as
// props so there is one shell here rather than two copies drifting apart.
//
// The rail's entries name pages whose paths carry parameters - a batch, a
// person, whatever the shell turns out to be around - and it fills them from
// the route it is mounted at. It knows nothing else about them: the strip
// above the rail is a slot, filled by whoever does know.
//
// Below the width where two columns fit, the shell changes shape rather than
// stacking, and the two things it is mounted around want different shapes.
//
// Around a workspace the rail becomes the bar at the foot: for as long as
// the reader is inside one batch, every move they make is a move between its
// sections, so that is what the easiest place on the screen should hold -
// not the modules, which the bar at the top still carries. What does not fit
// across becomes one cell at the end that opens the rest, together with the
// account and the way back out.
//
// Around one person the sections stay a row of chips under the banner. There
// are few of them, they are parts of one record rather than places to live
// in, and the foot goes on carrying the modules: reading somebody's file is
// not somewhere the product disappears from.

/** where the shell stops being two columns */
const SHELL_BREAKPOINT = 1024

/**
 * Where the shell's own head gives way to the open workspace's.
 *
 * On a phone inside a batch the top of the screen is worth more to the batch
 * than to the product: the mark, the modules and the account cost a whole bar
 * to say what the bar at the foot and one avatar already say. So the head
 * becomes the workspace's own - the way back, what is open, the account - and
 * the product's bar is not drawn at all. The same boundary the bars at the top
 * use to stop drawing their row of words.
 */
const HEAD_BREAKPOINT = 768

// The scroll model, stated once: the body never scrolls (the root is the
// viewport), the main column owns the page scroll, the rail and the drawer's
// entry list each scroll themselves.
const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100dvh',
    width: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  topFold: {
    flexShrink: 0,
    overflow: 'hidden',
    height: 56,
    transitionProperty: 'height',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  contextBar: {
    position: 'relative',
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: {
      default: 16,
      [breakpoints.phone]: 8,
    },
  },
  contextLine: {
    height: 52,
  },
  /**
   * The band as the window's own head.
   *
   * It keeps no inset: what fills it draws two rows of its own, and a rule
   * between them has to reach both edges of the screen or it reads as an
   * underline belonging to the words above it. So the inset is the filler's,
   * per row, and the shell only holds the corner open for the account.
   */
  contextHead: {
    alignItems: 'stretch',
    paddingInline: 0,
  },
  // The head's own outline, held while what fills it is on its way.
  //
  // The band is the window's head here, so an outline of one short bar is
  // not a placeholder - it is the head having collapsed. Drawn to the shape
  // the filler will take: a way back and a name across the top, a strip
  // under it, so nothing moves when the real one arrives.
  headBones: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
  },
  headBonesRow: {
    display: 'flex',
    minHeight: 48,
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
  },
  headBonesStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: 16,
    paddingBlock: 11,
  },
  headAccount: {
    position: 'absolute',
    insetInlineEnd: 16,
    top: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  // a floor rather than a height: the person arrives a moment after the
  // shell, and the floor is what keeps the page from moving when they do
  contextBanner: {
    minHeight: 120,
    overflow: 'hidden',
    // the same room held as the column under it holds for its scrollbar, so
    // the banner's measure and the page's are centred on the same line
    scrollbarGutter: 'stable',
    paddingTop: 14,
    paddingBottom: 20,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
  },
  // the hairlines every other band in the product opens on, gathered in the
  // far corner and gone before they reach the words
  hairlines: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: 0.06,
    color: tokens.foreground,
    backgroundImage: 'repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 24px)',
    maskImage: 'radial-gradient(130% 115% at 100% 0%, black, transparent 62%)',
  },
  // the banner keeps the measure the pages under it are read at
  contextSeatBanner: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    maxWidth: '72rem',
    marginInline: 'auto',
    flexDirection: 'column',
  },
  contextSeat: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  aside: {
    height: '100%',
    flexShrink: 0,
    overflow: 'hidden',
    transitionProperty: 'width',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  asideOpen: {
    width: 224,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  asideClosed: {
    width: 52,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  asideGone: {
    width: 0,
  },
  // the rail is always its full width; the column around it is what narrows
  railNav: {
    display: 'flex',
    height: '100%',
    width: 224,
    flexDirection: 'column',
    gap: 20,
    overflowY: 'auto',
    padding: 12,
  },
  toggleSeat: {
    display: 'flex',
  },
  toggleButton: {
    borderRadius: tokens.radiusMd,
    padding: 6,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    backgroundColor: {
      default: null,
      ':hover': tokens.surfaceMuted,
    },
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  toggleGlyph: {
    width: 16,
    height: 16,
  },
  fadeGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  fadedOut: {
    opacity: 0,
  },
  entryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  sectionLabel: {
    paddingInline: 12,
    paddingBottom: 4,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  entry: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  entryActive: {
    backgroundColor: tokens.surfaceMuted,
    fontWeight: 500,
    color: tokens.foreground,
  },
  entryIdle: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  entryIcon: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  entryLabel: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  main: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    overflowY: 'auto',
    // The scrollbar's room is held whether or not the page needs it: a page
    // long enough to scroll lost a scrollbar's width, and the centred
    // measure moved left by that much from one page to the next. Where the
    // scrollbar floats over the page - every phone - it holds nothing.
    scrollbarGutter: 'stable',
  },
  // exactly the bar's own height, so the last row of a page ends above it
  // rather than behind it
  mainFoot: {
    paddingBottom: `calc(${shell.bottomBarHeight} + env(safe-area-inset-bottom))`,
  },
  // Around one person the rail is part of the page rather than of the
  // window: the banner above is held to a measure, and a rail out at the
  // window's edge left the sections two hand-widths from what they open. So
  // the sections stand inside the same measure, beside their content.
  bannerBones: { display: 'flex', alignItems: 'center', gap: 16, paddingTop: 34 },
  bannerBoneWords: { display: 'flex', flexDirection: 'column', gap: 10 },
  // the reader's own banner has no way back above the name, and a smaller
  // portrait on a phone: its outline is drawn to that, or the page opened
  // with a gap over the name and dropped when the name arrived
  selfBones: {
    display: 'flex',
    alignItems: 'center',
    gap: { default: 16, [breakpoints.phone]: 12 },
  },
  selfBoneFace: {
    width: { default: 52, [breakpoints.phone]: 44 },
    height: { default: 52, [breakpoints.phone]: 44 },
    flexShrink: 0,
    borderRadius: 9999,
  },
  // the height of the name's line, a gap and the unit's line, which is what
  // the header stands at once it arrives
  selfBoneWords: {
    display: 'flex',
    minWidth: 0,
    minHeight: 56,
    flexGrow: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 6,
  },
  railBones: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    paddingInline: 12,
    paddingBlock: 14,
  },
  // The inset is the column's and the measure is the seat's, the way the
  // banner above holds them: with the inset inside a seat of the same
  // measure, a wide window drew the page one inset in from the banner.
  // A column the section fills: a section that failed to load says so in
  // the middle of the room it would have had, not against the banner.
  personMain: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    // The scrollbar's room is held whether or not the page needs it: a page
    // long enough to scroll lost a scrollbar's width, and the centred
    // measure moved left by that much from one page to the next. Where the
    // scrollbar floats over the page - every phone - it holds nothing.
    scrollbarGutter: 'stable',
    backgroundColor: tokens.background,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
  },
  personSeat: {
    display: 'flex',
    flexGrow: 1,
    width: '100%',
    maxWidth: '72rem',
    marginInline: 'auto',
    alignItems: 'stretch',
    gap: 28,
    paddingTop: 20,
    // clear of the bar a narrow window carries at its foot
    paddingBottom: { default: 24, [breakpoints.phone]: 84 },
  },
  personNav: {
    alignSelf: 'flex-start',
    position: 'sticky',
    top: 20,
    display: 'flex',
    width: 200,
    flexShrink: 0,
    flexDirection: 'column',
    gap: 18,
    paddingTop: 2,
  },
  personGroup: { display: 'flex', flexDirection: 'column', gap: 2 },
  // the sections as one line, scrolled sideways: the whole record's shape
  // at a glance, where a phone has the width for a row and not a column
  chipRow: {
    display: { default: 'none', '@media (max-width: 1023.98px)': 'flex' },
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    // bled back out to the window's edges: the banner holds its words to a
    // measure, but a row that scrolls has to start and end at the screen or
    // the last chip looks like the last section
    marginInline: { default: -24, [breakpoints.phone]: -16 },
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingBottom: 2,
    overflowX: 'auto',
    scrollbarWidth: 'none',
  },
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingInline: 12,
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 13,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    color: tokens.mutedForeground,
  },
  chipOpen: {
    backgroundColor: tokens.primary,
    fontWeight: 500,
    color: tokens.primaryForeground,
  },
  personHeading: {
    margin: 0,
    paddingInline: 12,
    paddingBottom: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  personList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  personEntry: {
    display: 'flex',
    height: 34,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 12,
    borderRadius: 8,
    fontSize: 13.5,
    textDecoration: 'none',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
  },
  personEntryIdle: {
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  personEntryActive: {
    fontWeight: 600,
    color: tokens.foreground,
    backgroundColor: tokens.surfaceMuted,
  },
  personWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  personContent: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  drawerPanel: {
    maxHeight: '82dvh',
    gap: 0,
    overflow: 'hidden',
    borderStartStartRadius: 20,
    borderStartEndRadius: 20,
    padding: 0,
  },
  drawerHead: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 4,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    paddingInline: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  grabber: {
    marginInline: 'auto',
    height: 4,
    width: 36,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  headSkeleton: {
    marginInline: 4,
    marginTop: 4,
    marginBottom: 2,
    height: 44,
    borderRadius: tokens.radiusLg,
  },
  drawerNav: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 14,
    paddingTop: 14,
    paddingBottom: 16,
  },
  drawerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  drawerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  drawerSectionLabel: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  drawerEntry: {
    display: 'flex',
    height: 46,
    alignItems: 'center',
    gap: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    backgroundColor: tokens.background,
    color: tokens.foreground,
  },
  drawerEntryActive: {
    borderColor: tokens.surfaceMuted,
    backgroundColor: tokens.surfaceMuted,
    fontWeight: 500,
  },
  drawerFoot: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    paddingInline: 16,
    paddingTop: 10,
    paddingBottom: 'max(1.375rem, env(safe-area-inset-bottom))',
  },
  footSkeleton: {
    height: 28,
    width: '100%',
  },
  modulesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 10,
  },
  modulesLabel: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  modulesWrap: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 6,
  },
  moduleLink: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: tokens.foreground,
  },
  moduleIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  moduleWord: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
})

function RailEntry({
  id,
  label,
  icon,
  to,
  page,
  exact,
  badge,
}: {
  /** the entry's own id, so whoever counts for it can find its badge */
  id: string
  label: ResolvedNavigationItem['label']
  icon?: string
  to: string
  /** the slot a live count beside this entry is contributed to, when the shell has one */
  badge: UiSlotToken | undefined
  /** the page behind the entry, for fetching its code ahead of the press */
  page?: NamespacedId
  /**
   * Whether only this exact path counts as being here.
   *
   * A section that opens one of its own rows navigates deeper - a queue to
   * one submission, a list to one record - and the rail must stay lit while
   * the reader is down there, or the workspace looks like it was left. So
   * matching is by prefix, except for an entry that another entry lives
   * underneath: the workspace root would otherwise be lit on every page.
   */
  exact: boolean
}) {
  // The press answers at once, before the address has moved: the entry
  // lights, and after a beat its icon gives way to the loader for as long
  // as the page's code is on its way. An entry drawn without an icon keeps
  // its shape and only lights. Pointing at it or reaching it with the
  // keyboard fetches the code already, so the press usually waits for
  // nothing at all.
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  const warm = page === undefined ? undefined : () => prefetch(page)
  return (
    <li>
      <NavLink
        end={exact}
        to={to}
        onClick={navigation.onClick}
        onPointerEnter={warm}
        onFocus={warm}
        aria-busy={navigation.pending || undefined}
        data-pending={navigation.pending ? '' : undefined}
        data-indicating={navigation.indicating ? '' : undefined}
        className={({ isActive }) =>
          stylex.props(
            styles.entry,
            isActive || navigation.pending ? styles.entryActive : styles.entryIdle,
          ).className ?? ''
        }
      >
        {icon !== undefined && navigation.indicating ? (
          <Loader size={16} xstyle={styles.entryIcon} />
        ) : (
          <NavIcon name={icon} className={stylex.props(styles.entryIcon).className} />
        )}
        <span {...stylex.props(styles.entryLabel)}>
          <LocalizedText value={label} />
        </span>
        {/* a live number the manifest cannot carry: whoever owns the page
            answers for it, and an entry nobody answers for shows nothing */}
        {badge !== undefined && <UiSlot token={badge} context={{ navigationId: id }} />}
      </NavLink>
    </li>
  )
}

/** one section of a person's record, in the list beside it */
/**
 * One section of a person's record, as a chip in a row.
 *
 * Narrow, a record has no room for a column beside it, and the sections are
 * not a menu to be opened - they are the parts of one thing, read across.
 * A row of chips says how many there are and which one is open without
 * anybody pressing anything, which a bar of five cells could only do for
 * the five, and a record has more parts than that.
 */
function PersonChip({
  label,
  to,
  page,
  exact,
  badge,
}: {
  label: ResolvedNavigationItem['label']
  to: string
  page?: NamespacedId
  exact: boolean
  badge?: ReactNode
}) {
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  const warm = page === undefined ? undefined : () => prefetch(page)
  return (
    <NavLink
      end={exact}
      to={to}
      data-testid="person-chip"
      onClick={navigation.onClick}
      onPointerEnter={warm}
      onFocus={warm}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      className={({ isActive }) =>
        stylex.props(styles.chip, isActive ? styles.chipOpen : navigation.pending && pending.chip)
          .className ?? ''
      }
    >
      <LocalizedText value={label} />
      {badge}
    </NavLink>
  )
}

function PersonEntry({
  label,
  to,
  page,
  exact,
}: {
  label: ResolvedNavigationItem['label']
  to: string
  page?: NamespacedId
  exact: boolean
}) {
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  const warm = page === undefined ? undefined : () => prefetch(page)
  return (
    <li>
      <NavLink
        end={exact}
        to={to}
        onClick={navigation.onClick}
        onPointerEnter={warm}
        onFocus={warm}
        aria-busy={navigation.pending || undefined}
        className={({ isActive }) =>
          stylex.props(
            styles.personEntry,
            isActive || navigation.pending ? styles.personEntryActive : styles.personEntryIdle,
          ).className ?? ''
        }
      >
        <span {...stylex.props(styles.personWord)}>
          <LocalizedText value={label} />
        </span>
      </NavLink>
    </li>
  )
}

/** one cell of the drawer's grid: the same entry, sized for a thumb */
function DrawerEntry({
  id,
  label,
  to,
  page,
  exact,
  badge,
}: {
  id: string
  label: ResolvedNavigationItem['label']
  to: string
  page?: NamespacedId
  exact: boolean
  badge: UiSlotToken | undefined
}) {
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  const warm = page === undefined ? undefined : () => prefetch(page)
  return (
    <NavLink
      end={exact}
      to={to}
      onClick={navigation.onClick}
      onPointerEnter={warm}
      onFocus={warm}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      className={({ isActive }) =>
        stylex.props(
          styles.drawerEntry,
          (isActive || navigation.pending) && styles.drawerEntryActive,
        ).className ?? ''
      }
    >
      <span {...stylex.props(styles.entryLabel)}>
        <LocalizedText value={label} />
      </span>
      {badge !== undefined && <UiSlot token={badge} context={{ navigationId: id }} />}
    </NavLink>
  )
}

export interface RailShellProps {
  /** the collection whose entries fill the rail */
  navigation: UiCollectionToken<NavigationItem, ResolvedNavigationItem>
  /** the slot that says what is open, above the rail */
  context: UiSlotToken
  /** the slot a live count beside a rail entry is contributed to */
  badge?: UiSlotToken
  /**
   * The strip as a banner that takes the height its contribution needs,
   * rather than a one-line bar of fixed height.
   *
   * A batch is named in a line; a person is a portrait, a name, a status and
   * the things worth doing to them, and a bar that fixed its height at one
   * line would clip them. The fixed height is kept where it can be kept, so
   * that a bar filled a moment after the shell does not move the page.
   */
  banner?: boolean
  /**
   * What the banner's outline is drawn as while its filler is on its way:
   * a record opened from a list, with a way back above the name, or the
   * reader's own account, with none.
   */
  bannerShape?: 'record' | 'self'
}

export function RailShell(props: RailShellProps) {
  return (
    <WorkspaceCapabilityScope>
      <ScreenFootScope>
        <CapableRailShell {...props} />
      </ScreenFootScope>
    </WorkspaceCapabilityScope>
  )
}

function CapableRailShell({
  navigation,
  context,
  badge,
  banner = false,
  bannerShape = 'record',
}: RailShellProps) {
  const { apps, activeApp } = useAppNavigation()
  const entries = useUiCollection(navigation)
  const groups = useUiCollection(navigationGroups)
  const capabilities = useWorkspaceCapabilities()
  const params = useParams()
  const { pathname } = useLocation()
  const { format } = useI18n()
  const narrow = useIsBelow(SHELL_BREAKPOINT)
  // on a phone inside a workspace the head belongs to the workspace, and the
  // product's own bar is not drawn at all
  const owned = useIsBelow(HEAD_BREAKPOINT) && !banner
  const drawer = useNavDrawer()
  // a screen whose own bar ends at the bottom edge has asked for that corner
  const footTaken = useScreenFootClaimed()
  const [railOpen, setRailOpen] = useState(!narrow)
  useEffect(() => setRailOpen(!narrow), [narrow])

  // an entry carrying a capability token waits for the open workspace to
  // publish its set, and renders only while the set holds it; a gated entry
  // must never flash in and be taken away, so "not published yet" hides it
  const admitted = entries.filter(
    (item) =>
      item.capability === undefined ||
      (capabilities.status === 'ready' && capabilities.values.has(item.capability)),
  )
  // how many entries are still waiting to hear whether they may be shown
  const awaited =
    capabilities.status === 'ready'
      ? 0
      : entries.filter((item) => item.capability !== undefined).length
  const addressable = admitted.flatMap((item) => {
    const to = item.target.kind === 'page' ? fill(item.target.path, params) : item.target.href
    return to === undefined ? [] : [{ ...item, to }]
  })
  const registered = new Set(groups.map((group) => group.id))
  const paths = addressable.map((item) => item.to)
  // every page the rail can reach, fetched while the reader looks at this
  // one: the chunks are small, and a press that finds its code here waits
  // for nothing
  useIdlePagePrefetch(
    addressable.flatMap((item) => (item.target.kind === 'page' ? [item.target.pageId] : [])),
  )
  const loose = addressable
    .filter((item) => item.group === undefined || !registered.has(item.group))
    .sort(byOrder)
  const sections = [...groups]
    .sort(byOrder)
    .map((group) => ({
      ...group,
      items: addressable.filter((item) => item.group === group.id).sort(byOrder),
    }))
    .filter((group) => group.items.length > 0)

  // the rail's entries as one run, in the order the rail draws them: what
  // the chips carry across, and what the bar at the foot keeps the first few
  // of. The headings are the rail's and the drawer's; neither of the narrow
  // shapes has room for them.
  const run = [...loose, ...sections.flatMap((section) => section.items)]
  // A workspace keeps its own sections at the foot; a record keeps the
  // modules there, because reading somebody's file is not somewhere the
  // product disappears from. A screen that has claimed the foot for its own
  // decision bar gets it: two bars stacked there is one too many, and that
  // screen is a task with a way back of its own.
  const sectionsAtFoot = narrow && !banner && !footTaken
  const cells = useCellsAcross(5)
  const across = run.length <= cells ? run : run.slice(0, cells - 1)
  const spilled = run.length > across.length
  const exactly = (to: string) => hasEntriesBelow(to, paths)

  const toggle = (label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={railOpen}
      {...stylex.props(styles.toggleButton)}
      onClick={() => setRailOpen((open) => !open)}
    >
      <PanelLeftIcon aria-hidden {...stylex.props(styles.toggleGlyph)} />
    </button>
  )

  // The rail is always its full width; the column around it is what narrows.
  //
  // Swapping the contents for a narrow version instead made the animation
  // play over the wrong thing - the button stretching to full width on the
  // way out, the entries reflowing to one character a line on the way back
  // in. Held at one width and clipped, nothing inside it moves at all; the
  // entries only fade, which changes no layout.
  const rail = (
    <nav {...stylex.props(styles.railNav)}>
      <div {...stylex.props(styles.toggleSeat)}>{toggle(format(m.toggleSidebar))}</div>
      <div
        // out of reach as well as out of sight: a link nobody can see is
        // still a link the keyboard walks into and the screen reader reads
        {...(!railOpen || narrow ? { inert: true, 'aria-hidden': true } : {})}
        {...stylex.props(styles.fadeGroup, (!railOpen || narrow) && styles.fadedOut)}
      >
        {loose.length > 0 && (
          <ul {...stylex.props(styles.entryList)}>
            {loose.map((item) => (
              <RailEntry
                key={item.id}
                id={item.id}
                label={item.label}
                icon={item.icon}
                to={item.to}
                page={item.target.kind === 'page' ? item.target.pageId : undefined}
                exact={hasEntriesBelow(item.to, paths)}
                badge={badge}
              />
            ))}
          </ul>
        )}
        {/* Entries that wait on what the open workspace may do are not drawn
            until it says: drawn and then taken away is worse than late. While
            it has not said, their places are held, so the rail does not stand
            as one entry over an empty column. */}
        {awaited > 0 && (
          <div {...stylex.props(styles.railBones)} aria-hidden data-testid="rail-bones">
            {Array.from({ length: Math.min(awaited, 8) }, (_, index) => (
              <Skeleton
                key={index}
                height={14}
                width={`${String([62, 48, 70, 54][index % 4])}%`}
                radius={4}
              />
            ))}
          </div>
        )}
        {sections.map((section) => (
          <section key={section.id}>
            <p {...stylex.props(styles.sectionLabel)}>
              <LocalizedText value={section.label} />
            </p>
            <ul {...stylex.props(styles.entryList)}>
              {section.items.map((item) => (
                <RailEntry
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  icon={item.icon}
                  to={item.to}
                  page={item.target.kind === 'page' ? item.target.pageId : undefined}
                  exact={hasEntriesBelow(item.to, paths)}
                  badge={badge}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )

  return (
    <div {...stylex.props(styles.root)}>
      {/* Above a record the bar stays whatever the width: it carries the
          product's own mark, and a record opened from somewhere else with
          no mark above it reads as a different site. Inside a workspace on
          a phone it goes: the band below already names what is open and
          carries the account, and two bars would leave the page a third of
          the screen. */}
      {!owned && (
        <div {...stylex.props(styles.topFold)}>
          {/* Ruled, because here the bar can never earn its line. The one it
              draws at rest is earned by the page passing underneath, and in
              this shell nothing passes underneath: the bar below is in the
              flow and never moves. Two bars of the same ground with no rule
              between them read as one crowded band. */}
          <TopBar apps={apps} activeApp={activeApp} stacked />
        </div>
      )}
      {/* its height is fixed rather than found: the slot arrives a moment after
          the shell does, and a bar that grows from empty to filled moves every
          page below it just as the reader starts reading */}
      <div
        {...stylex.props(
          styles.contextBar,
          banner ? styles.contextBanner : owned ? styles.contextHead : styles.contextLine,
        )}
      >
        {banner && <span aria-hidden {...stylex.props(styles.hairlines)} />}
        <div {...stylex.props(styles.contextSeat, banner && styles.contextSeatBanner)}>
          {/* the strip is filled by another plugin's chunk, which arrives a
              moment after the shell: its outline stands in until it does, so
              the bar never opens as an empty band */}
          <UiSlot
            token={context}
            loading={
              banner && bannerShape === 'self' ? (
                <div {...stylex.props(styles.selfBones)} aria-hidden data-testid="self-bones">
                  <Skeleton className={stylex.props(styles.selfBoneFace).className} />
                  <div {...stylex.props(styles.selfBoneWords)}>
                    <Skeleton height={24} width={160} radius={6} />
                    <Skeleton height={14} width="min(15rem, 100%)" radius={4} />
                  </div>
                </div>
              ) : banner ? (
                <div {...stylex.props(styles.bannerBones)} aria-hidden>
                  <Skeleton height={52} width={52} radius={9999} />
                  <div {...stylex.props(styles.bannerBoneWords)}>
                    <Skeleton height={20} width="9rem" radius={6} />
                    <Skeleton height={11} width="18rem" radius={4} />
                  </div>
                </div>
              ) : owned ? (
                <div {...stylex.props(styles.headBones)} aria-hidden data-testid="head-bones">
                  <div {...stylex.props(styles.headBonesRow)}>
                    <Skeleton height={18} width={18} radius={5} />
                    <Skeleton height={17} width="62%" radius={5} />
                  </div>
                  <div {...stylex.props(styles.headBonesStrip)}>
                    <Skeleton height={11} width="5rem" radius={3} />
                    <Skeleton height={11} width="4rem" radius={3} />
                  </div>
                </div>
              ) : (
                <Skeleton height={14} width="14rem" radius={4} />
              )
            }
          />
          {/* the record's own sections, across, at the foot of the banner
              that says whose record it is */}
          {banner && narrow && (
            <nav
              aria-label={format(m.personSections)}
              data-testid="person-chips"
              {...stylex.props(styles.chipRow)}
            >
              {run.map((item) => (
                <PersonChip
                  key={item.id}
                  label={item.label}
                  to={item.to}
                  page={item.target.kind === 'page' ? item.target.pageId : undefined}
                  exact={exactly(item.to)}
                  badge={
                    badge !== undefined ? (
                      <UiSlot token={badge} context={{ navigationId: item.id }} />
                    ) : undefined
                  }
                />
              ))}
            </nav>
          )}
        </div>
        {/* the corner the head holds open: whoever owns sessions fills it,
            the same seat the product's own bar gives it higher up */}
        {owned && (
          <div {...stylex.props(styles.headAccount)}>
            <UiSlot token={headerActions} />
            <UiSlot token={sidebarUser} />
          </div>
        )}
      </div>
      {banner ? (
        <main {...stylex.props(styles.personMain)}>
          <div {...stylex.props(styles.personSeat)}>
            {!narrow && (
              <nav
                aria-label={format(m.personSections)}
                data-testid="person-sections"
                {...stylex.props(styles.personNav)}
              >
                {[
                  // what nobody filed under a heading is the record itself
                  ...(loose.length > 0 ? [{ id: 'account', label: undefined, items: loose }] : []),
                  ...sections.map((section) => ({
                    id: section.id,
                    label: section.label,
                    items: section.items,
                  })),
                ].map((group) => (
                  <section key={group.id} {...stylex.props(styles.personGroup)}>
                    <p {...stylex.props(styles.personHeading)}>
                      {group.label === undefined ? (
                        format(m.personAccount)
                      ) : (
                        <LocalizedText value={group.label} />
                      )}
                    </p>
                    <ul {...stylex.props(styles.personList)}>
                      {group.items.map((item) => (
                        <PersonEntry
                          key={item.id}
                          label={item.label}
                          to={item.to}
                          page={item.target.kind === 'page' ? item.target.pageId : undefined}
                          exact={hasEntriesBelow(item.to, paths)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </nav>
            )}
            {/* each section arrives as its own page would */}
            <Reveal key={pathname} className={stylex.props(styles.personContent).className}>
              <Outlet />
            </Reveal>
          </div>
        </main>
      ) : (
        <div {...stylex.props(styles.body)}>
          {/* Collapsed to a strip rather than to nothing, so the control that
            brings it back stays where it was taken from; on a narrow screen
            collapsed all the way, because the drawer has taken over. */}
          <aside
            data-testid="workspace-rail"
            // fully out of reach while folded: clipped is not gone, and the
            // keyboard would still walk into the toggle behind the fold
            {...(narrow ? { inert: true, 'aria-hidden': true } : {})}
            {...stylex.props(
              styles.aside,
              narrow ? styles.asideGone : railOpen ? styles.asideOpen : styles.asideClosed,
            )}
          >
            {rail}
          </aside>
          {/* auto, not scroll: the screens that fill the viewport - the review
            workbench, my filings - then carry a scrollbar that can never
            move, which reads as a page with somewhere to go. */}
          <main {...stylex.props(styles.main, sectionsAtFoot && styles.mainFoot)}>
            <Outlet />
          </main>
        </div>
      )}

      {/* One bar at the foot, and which one it is depends on what the shell
          is around: a workspace's own sections, or the modules. */}
      {banner ? (
        <AppsBar apps={apps} activeApp={activeApp} />
      ) : (
        sectionsAtFoot && (
          <BottomBar
            reach="narrow"
            label={format(m.workspaceSections)}
            // Held open rather than drawn early. Entries gated on what the
            // open workspace may do are not known until it says, and a bar
            // that drew the two ungated ones first and the rest a beat later
            // read as the navigation having been lost and found.
            pending={awaited > 0 ? cells : 0}
            items={across.map((item) => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
              to: item.to,
              exact: exactly(item.to),
              badge:
                badge !== undefined ? (
                  <UiSlot token={badge} context={{ navigationId: item.id }} />
                ) : undefined,
            }))}
            more={
              spilled
                ? {
                    label: format(m.allSections),
                    // lit while what is open is one of the ones it holds, so
                    // the bar never reads as though the reader is nowhere
                    active:
                      drawer.open ||
                      !across.some((item) => isHere(pathname, item.to, exactly(item.to))),
                    onPress: drawer.show,
                  }
                : undefined
            }
          />
        )
      )}

      {/* The drawer's seats are separate chunks, and fetched only when the
          drawer first opened they arrived one by one - the drawer visibly
          assembled itself. Mounted here out of sight as soon as the shell
          is narrow, the chunks and the session behind the identity are
          already warm when the last cell is first pressed. */}
      {sectionsAtFoot && (
        <div hidden aria-hidden>
          <UiSlot token={drawerIdentity} />
          <UiSlot token={drawerAccount} />
          <UiSlot token={drawerSignOut} />
        </div>
      )}

      <Sheet
        open={!banner && narrow && drawer.open}
        onOpenChange={(next) => {
          if (!next) drawer.hide()
        }}
      >
        {/* the drawer's own shape, merged into the sheet's rather than
            racing it: same properties, one compiled rule */}
        <SheetContent side="bottom" showCloseButton={false} xstyle={styles.drawerPanel}>
          <SheetTitle {...stylex.props(a11yStyles.visuallyHidden)}>
            {format(m.navCapsule)}
          </SheetTitle>
          {/* the person at the head, the pages in the middle, the account at
              the foot - and the shell owns none of the head or the foot's
              controls: whoever owns sessions fills those seats */}
          <div data-sheet-grab="" {...stylex.props(styles.drawerHead)}>
            <span aria-hidden data-sheet-grab="" {...stylex.props(styles.grabber)} />
            <UiSlot
              token={drawerIdentity}
              loading={<Skeleton className={stylex.props(styles.headSkeleton).className} />}
            />
          </div>
          {/* the same entries the rail carries, two to a row because a
              phone-wide column of 46px bars wastes the little height a
              drawer has */}
          <nav {...stylex.props(styles.drawerNav)}>
            {loose.length > 0 && (
              <div {...stylex.props(styles.drawerGrid)}>
                {loose.map((item) => (
                  <DrawerEntry
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    to={item.to}
                    page={item.target.kind === 'page' ? item.target.pageId : undefined}
                    exact={exactly(item.to)}
                    badge={badge}
                  />
                ))}
              </div>
            )}
            {sections.map((section) => (
              <section key={section.id} {...stylex.props(styles.drawerSection)}>
                <p {...stylex.props(styles.drawerSectionLabel)}>
                  <LocalizedText value={section.label} />
                </p>
                <div {...stylex.props(styles.drawerGrid)}>
                  {section.items.map((item) => (
                    <DrawerEntry
                      key={item.id}
                      id={item.id}
                      label={item.label}
                      to={item.to}
                      page={item.target.kind === 'page' ? item.target.pageId : undefined}
                      exact={exactly(item.to)}
                      badge={badge}
                    />
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div {...stylex.props(styles.drawerFoot)}>
            <UiSlot
              token={drawerAccount}
              loading={<Skeleton className={stylex.props(styles.footSkeleton).className} />}
            />
            {/* the modules the bar at the foot gave up its cells for -
                destinations, not tabs - with the way out at the row's end */}
            <div data-testid="drawer-modules" {...stylex.props(styles.modulesRow)}>
              <span {...stylex.props(styles.modulesLabel)}>{format(m.otherPages)}</span>
              <div {...stylex.props(styles.modulesWrap)}>
                {apps.map((app) => (
                  <NavLink
                    key={app.id}
                    to={app.path}
                    className={stylex.props(styles.moduleLink).className}
                  >
                    <NavIcon
                      name={app.icon}
                      className={stylex.props(styles.moduleIcon).className}
                    />
                    <span {...stylex.props(styles.moduleWord)}>
                      <LocalizedText value={app.label} />
                    </span>
                  </NavLink>
                ))}
              </div>
              <span {...stylex.props(styles.spacer)} />
              <UiSlot token={drawerSignOut} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
