import { describe, expect, it } from 'vitest'
import { assessmentMessages as m } from '../src/client/i18n.ts'
import zhCN from '../src/client/locales/zh-CN.ts'

// Every standing a claim's chip can show is a word of its own, in every
// language the product speaks: two standings sharing a word read as one on
// the chip, and a reader cannot tell a claim sent back for revision from one
// waiting on more material, or a record the office took back from a claim
// its owner took back to edit.

const STANDINGS = [
  m.entryStatusDraft,
  m.entryStatusRevising,
  m.entryStatusInReview,
  m.entryStatusNeedsRevision,
  m.entryStatusAwaitingSupplement,
  m.entryStatusAppealing,
  m.entryStatusReopened,
  m.entryStatusApproved,
  m.entryStatusRejected,
  m.entryStatusAbandoned,
  // an office record's own standings; one under appeal is the same news as
  // a claim under appeal, and may say it in the same word
  m.recordStandingSettled,
  m.recordStandingOverturned,
  m.recordStandingWithdrawn,
]

/** standings that share a word, as `id = id` pairs */
const shared = (wordOf: (id: string, fallback: string) => string) => {
  const seen = new Map<string, string>()
  const clashes: string[] = []
  for (const standing of STANDINGS) {
    const word = wordOf(standing.id, standing.defaultMessage).trim().toLowerCase()
    const first = seen.get(word)
    if (first === undefined) seen.set(word, standing.id)
    else clashes.push(`${first} = ${standing.id}`)
  }
  return clashes
}

describe('the words a claim’s standing is said in', () => {
  it('gives every standing its own word in English', () => {
    expect(shared((_id, fallback) => fallback)).toEqual([])
  })

  it('gives every standing its own word in Chinese', () => {
    const catalog = zhCN as Record<string, string>
    expect(shared((id, fallback) => catalog[id] ?? fallback)).toEqual([])
  })

  it('keeps the office taking a record back apart from the owner’s own withdrawing', () => {
    const owner = m.entryWithdraw.defaultMessage.toLowerCase()
    expect(m.recordStandingWithdrawn.defaultMessage.toLowerCase()).not.toContain(owner)
  })
})
