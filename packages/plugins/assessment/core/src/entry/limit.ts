import { MAX_ENTRIES_PER_ITEM } from '../api.ts'

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
