import * as stylex from '@stylexjs/stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

// Shared first-paint geometry, without queries, effects or viewport reads.
// Waiting text has a bounded track beside the person; above 800px of list
// width its five kinds share the remaining room. Score and menu keep their
// own tracks in both layouts.

export const rosterStyles = stylex.create({
  // The roster starts directly under the shell's batch context.
  panel: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 12,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingTop: { default: 18, [breakpoints.phone]: 14 },
    paddingBottom: 16,
  },
  head: {
    display: { default: 'flex', [breakpoints.phone]: 'grid' },
    minHeight: 34,
    gridTemplateColumns: { default: null, [breakpoints.phone]: 'auto minmax(0, 1fr) auto' },
    gridTemplateRows: { default: null, [breakpoints.phone]: '34px auto' },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
  },
  title: {
    margin: 0,
    fontSize: { default: 18, [breakpoints.phone]: 17 },
    lineHeight: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  actions: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    marginInlineStart: 'auto',
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
    gridRow: { default: null, [breakpoints.phone]: 2 },
  },
  // The menu stands against both lines of a stacked person.
  rowAct: {
    display: 'inline-flex',
    alignItems: 'center',
    justifySelf: 'end',
    gridColumn: { default: null, [breakpoints.phone]: 3 },
    gridRow: { default: null, [breakpoints.phone]: '1 / 3' },
  },
  listColumn: {
    containerType: 'inline-size',
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
    scrollMarginTop: 12,
  },
  table: {
    '--q-roster-columns': {
      default: '6.5rem minmax(144px, 1fr) 9rem 7.5rem 2rem',
      '@container (min-width: 800px)':
        '6.5rem minmax(180px, min(480px, 30%)) minmax(0, 1fr) 7.5rem 2rem',
    },
  },
  // Only phones wrap: unit, search, then the three choices.
  toolbar: {
    display: 'flex',
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'center',
    gap: 8,
  },
  search: {
    minWidth: { default: '8rem', [breakpoints.phone]: 0 },
    maxWidth: { default: '20rem', [breakpoints.phone]: 'none' },
    width: { default: 'auto', [breakpoints.phone]: '100%' },
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: { default: '10rem', [breakpoints.phone]: 'auto' },
  },
  choice: {
    width: { default: '8rem', [breakpoints.phone]: 'auto' },
    minWidth: { default: '6.5rem', [breakpoints.phone]: 0 },
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 4,
    flexBasis: { default: null, [breakpoints.phone]: '0%' },
  },
  who: {
    display: 'flex',
    minWidth: 0,
    maxWidth: 480,
    flexDirection: 'column',
    gap: 1,
    paddingBlock: 4,
  },
  scoreSeat: { display: 'flex', minWidth: 0, justifyContent: 'flex-end', paddingInlineEnd: 12 },
  headEnd: { textAlign: 'end', paddingInlineEnd: 12 },
})
