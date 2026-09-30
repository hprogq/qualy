import { useMemo } from 'react'

import type { RosterWaiting } from './roster-view.ts'
import { widthOf } from './measure.ts'
import * as m from '#messages'

// What one person's claims wait on, counted: the words for each kind, the
// order they are said in, and how wide the roster's waiting column must be
// for a page of rows. RosterFilings draws them.

export type Filings = Readonly<Record<RosterWaiting, number>>

export const WORDS = {
  inReview: m.roster_waitingInReviewCount,
  toSupplement: m.roster_waitingToSupplementCount,
  reconsidering: m.roster_waitingReconsideringCount,
  toRevise: m.roster_waitingToReviseCount,
  blocked: m.roster_waitingBlockedCount,
} as const

export const ORDER: readonly RosterWaiting[] = [
  'blocked',
  'toSupplement',
  'reconsidering',
  'inReview',
  'toRevise',
]

/** the space between two counts, as RosterFilings draws them */
export const COUNT_GAP = 10

/**
 * The narrowest and widest the column asks for; past the widest a row's
 * counts wrap, unless the roster has room to spare, which goes to this
 * column so that its counts can stand side by side.
 */
const COLUMN_LEAST = 48
const COLUMN_MOST = 144

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
  return useMemo(() => {
    let widest = widthOf(heading, 11, 500)
    for (const row of rows) {
      const counts = ORDER.filter((kind) => row.filings[kind] > 0).map((kind) =>
        widthOf(WORDS[kind]({ count: row.filings[kind] }), 12, 400),
      )
      if (counts.length === 0) continue
      widest = Math.max(
        widest,
        counts.reduce((sum, one) => sum + one, 0) + COUNT_GAP * (counts.length - 1),
      )
    }
    return `${String(Math.ceil(Math.min(COLUMN_MOST, Math.max(COLUMN_LEAST, widest + 4))))}px`
  }, [rows, heading])
}
