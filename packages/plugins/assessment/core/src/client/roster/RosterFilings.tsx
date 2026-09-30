import * as stylex from '@stylexjs/stylex'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { ORDER, WORDS, type Filings } from './filings.ts'
import * as m from '#messages'

// What one person's claims are waiting on, as short counts: only the kinds
// that have any, so a row with nothing outstanding is quiet. A round nobody
// can take is said in the warning colour - it will not move by itself.
//
// In a column a row with nothing waiting says so with a dash, because an
// empty cell under a heading reads as something that did not load. The
// column is at least as wide as the page's longest answer, measured from
// the words themselves: every row is its own grid, so a track cannot size
// itself to the rows around it.

const styles = stylex.create({
  list: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    // COUNT_GAP in filings.ts, which measures the column by it
    columnGap: 10,
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

export function RosterFilings({ filings }: { filings: Filings }) {
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
          <VisuallyHidden>{m.roster_waitingNone()}</VisuallyHidden>
        </>
      ) : (
        said.map((kind) => (
          <span key={kind} {...stylex.props(styles.one, kind === 'blocked' && styles.warn)}>
            {WORDS[kind]({ count: filings[kind] })}
          </span>
        ))
      )}
    </span>
  )
}
