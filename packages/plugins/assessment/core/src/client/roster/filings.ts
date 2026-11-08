import type { RosterWaiting } from './roster-view.ts'
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

/** each kind's column head, where the kinds stand in columns of their own */
export const HEADS = {
  inReview: m.roster_columnInReview,
  toSupplement: m.roster_columnToSupplement,
  reconsidering: m.roster_columnReconsidering,
  toRevise: m.roster_columnToRevise,
  blocked: m.roster_columnBlocked,
} as const

/** the kinds in the order a claim meets them, the one nobody can move last */
export const COLUMNS: readonly RosterWaiting[] = [
  'inReview',
  'toSupplement',
  'toRevise',
  'reconsidering',
  'blocked',
]

/** CSS measures waiting text across the shared table tracks, including server HTML. */
export const WAITING_COLUMN = 'fit-content(9rem)'

/** Each kind sizes its own heading without a browser measurement. */
export const KIND_COLUMNS = `repeat(${String(COLUMNS.length)}, minmax(max-content, 1fr))`

/** whether anything of this person's waits on anybody */
export const waitsOnAnything = (filings: Filings): boolean =>
  ORDER.some((kind) => filings[kind] > 0)
