import * as stylex from '@stylexjs/stylex'
import type { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { formulaMessages as m } from './i18n.ts'

// The furniture the two library lists share: a masthead, a label over one
// white sheet, a header row and rows on one grid, and a foot that asks for
// the next page. The formulas list and the templates list are the same
// shape as the batch list, so a reader moving between them finds each thing
// where they left it; what differs is only which columns a row carries.

export const libraryStyles = stylex.create({
  page: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    gap: { default: 20, [breakpoints.phone]: 16 },
  },
  masthead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  heading: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  hint: { margin: 0, fontSize: 14, color: tokens.mutedForeground },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 16 },
  sectionLabel: { fontSize: 13, fontWeight: 500, color: tokens.mutedForeground },
  spring: { flexGrow: 1 },
  // the one other place a reader of this list goes, said as a place rather
  // than as a button: it is a page in the navigation, not an action
  elsewhere: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
  sheet: {
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  grid: {
    display: 'grid',
    alignItems: 'center',
    columnGap: 16,
    paddingInline: 20,
  },
  headRow: {
    display: { default: 'grid', [breakpoints.phone]: 'none' },
    paddingTop: 10,
    paddingBottom: 12,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  divided: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  // a sheet whose header row is hidden starts with a row, and that row's
  // own top rule would then sit against the sheet's edge
  firstOnPhone: {
    borderTopWidth: { default: 1, [breakpoints.phone]: 0 },
  },
  row: {
    paddingBlock: 14,
    cursor: 'pointer',
    backgroundColor: { default: null, ':hover': tokens.surfaceInset },
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 5 },
  nameLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
    color: tokens.foreground,
    textDecoration: 'none',
  },
  /** a row that is no longer on offer keeps its place and loses its ink */
  retired: { color: tokens.mutedForeground },
  line: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  tag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 5,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    fontSize: 11,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  cell: {
    display: { default: null, [breakpoints.phone]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  end: { textAlign: 'right' },
  glyph: {
    justifySelf: 'end',
    color: tokens.mutedForeground,
  },
  /** on a phone the columns fold into one quiet line under the name */
  phoneMeta: {
    display: { default: 'none', [breakpoints.phone]: 'flex' },
    minWidth: 0,
    alignItems: 'center',
    gap: 12,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  more: {
    display: 'flex',
    width: '100%',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceInset },
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    color: tokens.surfaceMutedForeground,
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  chips: { display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 5,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 11,
    color: tokens.surfaceMutedForeground,
  },
  chipLabel: {
    fontSize: 11,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  skeletonRow: { display: 'flex', flexDirection: 'column', gap: 8, paddingBlock: 16 },
})

type Format = ReturnType<typeof useI18n>['format']

const clock = (locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/**
 * When, as short as it can be said and still be exact enough to act on:
 * today and yesterday by the clock, this year as the day and the clock,
 * earlier years as the day alone. Written in the reader's own calendar words
 * ("8月29日 14:30", "Aug 29, 14:30") rather than as digits between dots, which
 * in a column of numbers read as one more number.
 */
export function shortWhen(
  at: string,
  format: Format,
  locale: string,
  now: Date = new Date(),
): string {
  const date = new Date(at)
  const startOf = (day: Date) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000)
  if (days === 0) return format(m.whenToday, { time: clock(locale).format(date) })
  if (days === 1) return format(m.whenYesterday, { time: clock(locale).format(date) })
  return date.getFullYear() === now.getFullYear()
    ? new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date)
    : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
        date,
      )
}

/** the clock alone, for something that happened while the page was open */
export function shortTime(at: string, locale: string): string {
  return clock(locale).format(new Date(at))
}

/** the moment in full, for a page that names one thing */
export function fullWhen(at: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at))
}
