import * as stylex from '@stylexjs/stylex'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { COLUMNS, HEADS, ORDER, WORDS, type Filings } from './filings.ts'
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
//
// Where the table has the room, each kind stands in a column of its own
// instead, and a row is read down a column rather than along its words.

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
  kinds: (template: string) => ({
    display: 'grid',
    gridTemplateColumns: template,
    alignItems: 'center',
    justifyItems: 'center',
  }),
  head: { whiteSpace: 'nowrap' },
  // a count is a chip, so the few rows with something waiting stand out of
  // a column of quiet dashes
  count: {
    display: 'inline-flex',
    minWidth: 22,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 6,
    borderRadius: tokens.radiusPill,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.foreground,
  },
  warnCount: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 18%, transparent)`,
    color: tokens.warningForeground,
  },
  zero: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 35%, transparent)`,
  },
})

export function RosterFilings({
  filings,
  columns,
}: {
  filings: Filings
  /** the kinds' own columns, where the table has the room for them */
  columns?: string | undefined
}) {
  const said = ORDER.filter((kind) => filings[kind] > 0)
  const facts = {
    'data-testid': 'participant-filings',
    'data-in-review': filings.inReview,
    'data-to-supplement': filings.toSupplement,
    'data-reconsidering': filings.reconsidering,
    'data-to-revise': filings.toRevise,
    'data-blocked': filings.blocked,
    'data-waiting': said.length > 0 ? 'some' : 'none',
  }
  const spoken =
    said.length === 0
      ? m.roster_waitingNone()
      : said.map((kind) => WORDS[kind]({ count: filings[kind] })).join(', ')
  if (columns !== undefined)
    return (
      <span {...facts} {...stylex.props(styles.kinds(columns))}>
        {COLUMNS.map((kind) => {
          const count = filings[kind]
          return (
            <span
              key={kind}
              aria-hidden
              data-kind={kind}
              {...stylex.props(
                count === 0 ? styles.zero : styles.count,
                count > 0 && kind === 'blocked' && styles.warnCount,
              )}
            >
              {count === 0 ? '—' : count}
            </span>
          )
        })}
        <VisuallyHidden>{spoken}</VisuallyHidden>
      </span>
    )
  return (
    <span {...facts} {...stylex.props(styles.list)}>
      {said.length === 0 ? (
        <>
          <span aria-hidden {...stylex.props(styles.none)}>
            —
          </span>
          <VisuallyHidden>{spoken}</VisuallyHidden>
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

/** the kinds' column heads, laid out as RosterFilings lays out their counts */
export function RosterFilingsHead({ columns }: { columns: string }) {
  return (
    <span {...stylex.props(styles.kinds(columns))}>
      {COLUMNS.map((kind) => (
        <span key={kind} {...stylex.props(styles.head)}>
          {HEADS[kind]()}
        </span>
      ))}
    </span>
  )
}
