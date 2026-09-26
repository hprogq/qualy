import { useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import type { RosterWaiting } from './roster-view.ts'
import { widthOf } from './measure.ts'

// What one person's claims are waiting on, as short counts: only the kinds
// that have any, so a row with nothing outstanding is quiet. A round nobody
// can take is said in the warning colour - it will not move by itself.
//
// In a column a row with nothing waiting says so with a dash, because an
// empty cell under a heading reads as something that did not load. The
// column is at least as wide as the page's longest answer, measured from
// the words themselves: every row is its own grid, so a track cannot size
// itself to the rows around it.

const WORDS = {
  inReview: m.rosterWaitingInReviewCount,
  toSupplement: m.rosterWaitingToSupplementCount,
  reconsidering: m.rosterWaitingReconsideringCount,
  toRevise: m.rosterWaitingToReviseCount,
  blocked: m.rosterWaitingBlockedCount,
} as const

const ORDER: readonly RosterWaiting[] = [
  'blocked',
  'toSupplement',
  'reconsidering',
  'inReview',
  'toRevise',
]

/** the space between two counts, as drawn below */
const GAP = 10

/**
 * The narrowest and widest the column asks for; past the widest a row's
 * counts wrap, unless the roster has room to spare, which goes to this
 * column so that its counts can stand side by side.
 */
const COLUMN_LEAST = 48
const COLUMN_MOST = 144

const styles = stylex.create({
  list: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: GAP,
    rowGap: 2,
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  // a count longer than its column, in some language, goes on between its
  // words rather than past the column's edge
  one: { whiteSpace: 'normal', fontVariantNumeric: 'tabular-nums' },
  warn: { color: tokens.warning },
  none: { color: `color-mix(in oklab, ${tokens.mutedForeground} 55%, transparent)` },
})

type Filings = Readonly<Record<RosterWaiting, number>>

export function RosterFilings({ filings }: { filings: Filings }) {
  const { format } = useI18n()
  const said = ORDER.filter((kind) => filings[kind] > 0)
  return (
    <span
      data-testid="participant-filings"
      data-in-review={filings.inReview}
      data-to-supplement={filings.toSupplement}
      data-reconsidering={filings.reconsidering}
      data-to-revise={filings.toRevise}
      data-blocked={filings.blocked}
      data-waiting={said.length > 0 ? 'some' : 'none'}
      {...stylex.props(styles.list)}
    >
      {said.length === 0 ? (
        <>
          <span aria-hidden {...stylex.props(styles.none)}>
            —
          </span>
          <VisuallyHidden>{format(m.rosterWaitingNone)}</VisuallyHidden>
        </>
      ) : (
        said.map((kind) => (
          <span key={kind} {...stylex.props(styles.one, kind === 'blocked' && styles.warn)}>
            {format(WORDS[kind], { count: filings[kind] })}
          </span>
        ))
      )}
    </span>
  )
}

/** whether anything of this person's waits on anybody */
export const waitsOnAnything = (filings: Filings): boolean =>
  ORDER.some((kind) => filings[kind] > 0)

/**
 * The waiting column's width for a page of rows: the widest row's counts on
 * one line, or the column's own heading where that is wider, held between a
 * floor and a ceiling. A page where nobody waits keeps a narrow column for
 * its dashes and gives the rest to the names.
 */
export function useWaitingColumn(rows: readonly { filings: Filings }[], heading: string): string {
  const { format } = useI18n()
  return useMemo(() => {
    let widest = widthOf(heading, 11, 500)
    for (const row of rows) {
      const counts = ORDER.filter((kind) => row.filings[kind] > 0).map((kind) =>
        widthOf(format(WORDS[kind], { count: row.filings[kind] }), 12, 400),
      )
      if (counts.length === 0) continue
      widest = Math.max(
        widest,
        counts.reduce((sum, one) => sum + one, 0) + GAP * (counts.length - 1),
      )
    }
    return `${String(Math.ceil(Math.min(COLUMN_MOST, Math.max(COLUMN_LEAST, widest + 4))))}px`
  }, [rows, heading, format])
}
