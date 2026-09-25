import { MAX_ENTRIES_PER_ACCOUNT, MAX_ENTRIES_PER_ITEM } from '../api.ts'

/**
 * How many live claims one participant may hold on one question, and the
 * refusal that says so once they do.
 *
 * The question's own limit where it sets one, within the platform ceiling;
 * the ceiling where it sets none (ruling of 2026-09-25). A limit stored
 * before the ceiling existed may exceed it, and the ceiling still holds.
 * Every door that adds a claim - filing, recording, importing - asks this
 * one function, so the reason the reader sees names the limit that was hit.
 */
export interface EntryLimit {
  readonly limit: number
  readonly reason: 'max-entries-reached' | 'entry-ceiling-reached'
}

export const entryLimitOf = (maxEntries: number | null): EntryLimit =>
  maxEntries !== null && maxEntries <= MAX_ENTRIES_PER_ITEM
    ? { limit: maxEntries, reason: 'max-entries-reached' }
    : { limit: MAX_ENTRIES_PER_ITEM, reason: 'entry-ceiling-reached' }

/** the live claims a participant already holds, on the question and in the whole round */
export interface HeldEntries {
  readonly onItem: number
  readonly inRound: number
}

/** somebody with no live claim anywhere, whom a grouped count leaves out */
export const NOTHING_HELD: HeldEntries = { onItem: 0, inRound: 0 }

export type EntryLimitReason = EntryLimit['reason'] | 'account-ceiling-reached'

/**
 * Why one more claim would not fit, or null when it does.
 *
 * The question's limit first, then the round's: a person at both is told
 * about the question, which is the one a reader can act on.
 */
export const entryRefusalOf = (
  maxEntries: number | null,
  held: HeldEntries,
): EntryLimitReason | null => {
  const ceiling = entryLimitOf(maxEntries)
  if (held.onItem >= ceiling.limit) return ceiling.reason
  if (held.inRound >= MAX_ENTRIES_PER_ACCOUNT) return 'account-ceiling-reached'
  return null
}
