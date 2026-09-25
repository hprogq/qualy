import {
  MAX_ADMINISTRATIVE_ENTRIES_PER_ACCOUNT,
  MAX_ENTRIES_PER_ITEM,
  MAX_PARTICIPANT_ENTRIES_PER_ACCOUNT,
} from '../api.ts'
import type { EntryChannel } from '../item/channels.ts'

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

/**
 * Each door's allowance across a whole round. Two allowances rather than
 * one pool, so neither side can use up the other's: a participant's drafts
 * never stop the office recording a finding about them, and the office's
 * findings never stop the participant filing.
 */
export const ACCOUNT_CEILINGS: Readonly<Record<EntryChannel, number>> = {
  participant: MAX_PARTICIPANT_ENTRIES_PER_ACCOUNT,
  administrative: MAX_ADMINISTRATIVE_ENTRIES_PER_ACCOUNT,
}

/**
 * The sources a participant's own filing is written with. Every other
 * source counts against the office's allowance, so the two allowances
 * together cover every live claim and their sum bounds the account.
 */
export const PARTICIPANT_SOURCES = ['self', 'proxy'] as const

/** live claims in a whole round, by the door each came in through */
export type HeldInRound = Readonly<Record<EntryChannel, number>>

/** the live claims a participant already holds, on the question and in the whole round */
export interface HeldEntries {
  readonly onItem: number
  readonly inRound: HeldInRound
}

/** somebody with no live claim anywhere, whom a grouped count leaves out */
export const NOTHING_HELD: HeldEntries = {
  onItem: 0,
  inRound: { participant: 0, administrative: 0 },
}

/** the same holding with this many more on the question, come in through this door */
export const heldWith = (held: HeldEntries, channel: EntryChannel, more: number): HeldEntries => ({
  onItem: held.onItem + more,
  inRound: { ...held.inRound, [channel]: held.inRound[channel] + more },
})

export type EntryLimitReason = EntryLimit['reason'] | 'account-ceiling-reached'

/** whether this door's allowance for the round is used up, whatever the question */
export const accountRefusalOf = (
  inRound: HeldInRound,
  channel: EntryChannel,
): 'account-ceiling-reached' | null =>
  inRound[channel] >= ACCOUNT_CEILINGS[channel] ? 'account-ceiling-reached' : null

/**
 * Why one more claim through this door would not fit, or null when it does.
 *
 * The question's limit first, then the round's: a person at both is told
 * about the question, which is the one a reader can act on. The question's
 * limit counts every live claim on it, whichever door it came through - it
 * is the question's own business rule; the round's counts only the door
 * being asked.
 */
export const entryRefusalOf = (
  maxEntries: number | null,
  held: HeldEntries,
  channel: EntryChannel,
): EntryLimitReason | null => {
  const ceiling = entryLimitOf(maxEntries)
  if (held.onItem >= ceiling.limit) return ceiling.reason
  return accountRefusalOf(held.inRound, channel)
}
