import * as stylex from '@stylexjs/stylex'
import { layoutPreferenceRoot } from '@qualy/ui/theme/layout-preference.stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { shell, shellRoot } from './shell.stylex.ts'

export const styles = stylex.create({
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
    height: { default: shell.topBarHeight, [breakpoints.phone]: shell.phoneTopBarHeight },
    transitionProperty: 'height',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  workspaceTop: { display: { default: 'block', [breakpoints.phone]: 'none' } },
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
    height: { default: 52, [breakpoints.phone]: 'auto' },
    alignItems: { default: 'center', [breakpoints.phone]: 'stretch' },
    paddingInline: { default: 16, [breakpoints.phone]: 0 },
  },
  // The head's own outline, held while what fills it is on its way.
  //
  // The band is the window's head here, so an outline of one short bar is
  // not a placeholder - it is the head having collapsed. Drawn to the shape
  // the filler will take: a way back and a name across the top, a strip
  // under it, so nothing moves when the real one arrives.
  headBones: {
    display: { default: 'none', [breakpoints.phone]: 'flex' },
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
    height: 47,
    flexShrink: 0,
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
    display: { default: 'none', [breakpoints.phone]: 'flex' },
    alignItems: 'center',
    gap: 8,
  },
  // a floor rather than a height: the person arrives a moment after the
  // shell, and the floor is what keeps the page from moving when they do
  lineBone: { display: { default: 'block', [breakpoints.phone]: 'none' } },
  contextBanner: {
    minHeight: 120,
    overflow: 'hidden',
    // the same room held as the column under it holds for its scrollbar, so
    // the banner's measure and the page's are centred on the same line
    scrollbarGutter: {
      default: 'stable',
      // a phone's scrollbar floats over the page, and a window that narrow
      // holds no strip for one either
      [breakpoints.phone]: 'auto',
      // a screen that fills the room says so in its html (ScreenFill)
      [stylex.when.ancestor(':has([data-screen-fill="always"])', shellRoot)]: 'auto',
      [stylex.when.ancestor(':has([data-screen-fill="tablet"])', shellRoot)]: 'auto',
      // beside a column of its own a screen runs to the window's edge;
      // only the gutter goes - a long account beside it still scrolls
      [stylex.when.ancestor(':has([data-screen-aside])', shellRoot)]: {
        default: 'stable',
        [breakpoints.phone]: 'auto',
        [breakpoints.desktop]: 'auto',
      },
    },
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
    // A screen that stands something of its own beside its work - one
    // person on a roster - draws that column itself, in the rail's place,
    // and the rail stands down while it does: the way back to the sections
    // is that screen's way out. Said in the screen's html, so the column and
    // not the rail is what a server drew.
    display: {
      default: 'none',
      [breakpoints.desktop]: 'block',
      [stylex.when.ancestor(':has([data-screen-aside])', shellRoot)]: {
        default: 'none',
        [breakpoints.desktop]: 'none',
      },
    },
    height: '100%',
    flexShrink: 0,
    overflow: 'hidden',
    width: {
      default: 224,
      [stylex.when.ancestor('[data-ui-folded~="workspace-rail-folded"]', layoutPreferenceRoot)]: 52,
    },
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
    transitionProperty: 'width',
    transitionDuration: { default: '200ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: 'linear',
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
    opacity: {
      default: 1,
      [stylex.when.ancestor('[data-ui-folded~="workspace-rail-folded"]', layoutPreferenceRoot)]: 0,
    },
    visibility: {
      default: 'visible',
      [stylex.when.ancestor('[data-ui-folded~="workspace-rail-folded"]', layoutPreferenceRoot)]:
        'hidden',
    },
    transitionProperty: 'opacity, visibility',
    transitionDuration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
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
    fontWeight: 400,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    transitionProperty: 'color',
    transitionDuration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  entryActive: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.foreground,
  },
  entryIdle: {
    transitionDuration: '0ms',
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
    // the page's room, for what a page sizes to it in its html, before any
    // script could measure it (StickyFill)
    containerType: 'size',
    overflowY: {
      default: 'auto',
      [stylex.when.ancestor(':has([data-screen-fill="always"])', shellRoot)]: 'hidden',
      [stylex.when.ancestor(':has([data-screen-fill="tablet"])', shellRoot)]: {
        default: 'hidden',
        [breakpoints.phone]: 'auto',
      },
    },
    // The scrollbar's room is held whether or not the page needs it: a page
    // long enough to scroll lost a scrollbar's width, and the centred
    // measure moved left by that much from one page to the next. Where the
    // scrollbar floats over the page - every phone - it holds nothing.
    scrollbarGutter: {
      default: 'stable',
      // a phone's scrollbar floats over the page, and a window that narrow
      // holds no strip for one either
      [breakpoints.phone]: 'auto',
      // a screen that fills the room says so in its html (ScreenFill)
      [stylex.when.ancestor(':has([data-screen-fill="always"])', shellRoot)]: 'auto',
      [stylex.when.ancestor(':has([data-screen-fill="tablet"])', shellRoot)]: 'auto',
      // beside a column of its own a screen runs to the window's edge;
      // only the gutter goes - a long account beside it still scrolls
      [stylex.when.ancestor(':has([data-screen-aside])', shellRoot)]: {
        default: 'stable',
        [breakpoints.phone]: 'auto',
        [breakpoints.desktop]: 'auto',
      },
    },
  },
  // the applications' bar at the foot of a phone, held clear of the last row
  mainApps: {
    paddingBottom: {
      default: null,
      [breakpoints.phone]: `calc(${shell.bottomBarHeight} + env(safe-area-inset-bottom))`,
    },
  },
  // Folded away, never unmounted: the band holds whoever said the record is
  // absent, and taking them off the screen would take back what they said.
  folded: {
    display: 'none',
  },
  // the column a person's sections stand in, holding no inset of its own
  // once they have gone: what stands there instead keeps its own
  personMainBare: {
    paddingInline: 0,
  },
  // where the record's pages would have been, for what its owner shows
  // instead: the whole of the room under the product's own bar
  absence: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    flexDirection: 'column',
  },
  // exactly the bar's own height, so the last row of a page ends above it
  // rather than behind it
  // - none where the open screen has taken the foot for a bar of its own,
  // which it says in its html (ScreenFoot)
  mainFoot: {
    paddingBottom: {
      default: `calc(${shell.bottomBarHeight} + env(safe-area-inset-bottom))`,
      [breakpoints.desktop]: 0,
      [stylex.when.ancestor(':has([data-screen-foot="always"])', shellRoot)]: {
        default: 0,
        [breakpoints.desktop]: 0,
      },
      [stylex.when.ancestor(':has([data-screen-foot="phone"])', shellRoot)]: {
        default: `calc(${shell.bottomBarHeight} + env(safe-area-inset-bottom))`,
        [breakpoints.phone]: 0,
        [breakpoints.desktop]: 0,
      },
    },
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
    overflowY: {
      default: 'auto',
      [stylex.when.ancestor(':has([data-screen-fill="always"])', shellRoot)]: 'hidden',
      [stylex.when.ancestor(':has([data-screen-fill="tablet"])', shellRoot)]: {
        default: 'hidden',
        [breakpoints.phone]: 'auto',
      },
    },
    // The scrollbar's room is held whether or not the page needs it: a page
    // long enough to scroll lost a scrollbar's width, and the centred
    // measure moved left by that much from one page to the next. Where the
    // scrollbar floats over the page - every phone - it holds nothing.
    scrollbarGutter: {
      default: 'stable',
      // a phone's scrollbar floats over the page, and a window that narrow
      // holds no strip for one either
      [breakpoints.phone]: 'auto',
      // a screen that fills the room says so in its html (ScreenFill)
      [stylex.when.ancestor(':has([data-screen-fill="always"])', shellRoot)]: 'auto',
      [stylex.when.ancestor(':has([data-screen-fill="tablet"])', shellRoot)]: 'auto',
      // beside a column of its own a screen runs to the window's edge;
      // only the gutter goes - a long account beside it still scrolls
      [stylex.when.ancestor(':has([data-screen-aside])', shellRoot)]: {
        default: 'stable',
        [breakpoints.phone]: 'auto',
        [breakpoints.desktop]: 'auto',
      },
    },
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
    display: { default: 'none', [breakpoints.desktop]: 'flex' },
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
  personHeading: {
    margin: 0,
    paddingInline: 12,
    paddingBottom: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.mutedForeground,
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
    fontWeight: 400,
    display: 'flex',
    height: 34,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 12,
    borderRadius: 8,
    fontSize: 13.5,
    textDecoration: 'none',
    transitionProperty: 'color',
    transitionDuration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
  },
  personEntryIdle: {
    transitionDuration: '0ms',
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  personEntryActive: {
    color: tokens.foreground,
    backgroundColor: tokens.surfaceMuted,
  },
  personWord: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
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
    transitionDuration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0ms' },
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
