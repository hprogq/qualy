import { describe, expect, it } from 'vitest'
import type { SupportedLocale } from '@qualy/i18n-contract'

import * as m from '#messages'

// Every standing a claim's chip can show is a word of its own, in every
// language the product speaks: two standings sharing a word read as one on
// the chip, and a reader cannot tell a claim sent back for revision from one
// waiting on more material, or a record the office took back from a claim
// its owner took back to edit.

const STANDINGS = [
  m.entry_statusDraft,
  m.entry_statusRevising,
  m.entry_statusInReview,
  m.entry_statusNeedsRevision,
  m.entry_statusAwaitingSupplement,
  m.entry_statusAppealing,
  m.entry_statusReopened,
  m.entry_statusApproved,
  m.entry_statusRejected,
  m.entry_statusAbandoned,
  // an office record's own standings; one under appeal is the same news as
  // a claim under appeal, and may say it in the same word
  m.record_standingSettled,
  m.record_standingOverturned,
  m.record_standingWithdrawn,
]

/** standings that share a word in one language, as `index = index` pairs */
const shared = (locale: SupportedLocale) => {
  const seen = new Map<string, number>()
  const clashes: string[] = []
  STANDINGS.forEach((standing, index) => {
    const word = standing({}, { locale }).trim().toLowerCase()
    const first = seen.get(word)
    if (first === undefined) seen.set(word, index)
    else clashes.push(`${String(first)} = ${String(index)}`)
  })
  return clashes
}

describe('the words a claim’s standing is said in', () => {
  it('gives every standing its own word in English', () => {
    expect(shared('en-US')).toEqual([])
  })

  it('gives every standing its own word in Chinese', () => {
    expect(shared('zh-CN')).toEqual([])
  })

  it('keeps the office taking a record back apart from the owner’s own withdrawing', () => {
    const owner = m.entry_withdraw({}, { locale: 'en-US' }).toLowerCase()
    expect(m.record_standingWithdrawn({}, { locale: 'en-US' }).toLowerCase()).not.toContain(owner)
  })
})
