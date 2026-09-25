import { describe, expect, it } from 'vitest'
import { MAX_ENTRIES_PER_ITEM } from '../src/api.ts'
import { mayFile, roomLeft } from '../src/client/entry/standing.ts'

// Whether the paper still offers a new claim on a question. A question
// without a limit of its own still stops at the platform ceiling the server
// refuses past, so the offer and the refusal agree.

const item = (maxEntries: number | null) =>
  ({
    id: 'item-1',
    status: 'active',
    maxEntries,
    currentRevision: { entryChannels: ['participant'] },
  }) as never

const claims = (count: number, status = 'draft') =>
  Array.from({ length: count }, (_, at) => ({ id: `entry-${at}`, status })) as never

describe('room for another claim', () => {
  it('stops a question with no limit at the ceiling, and voided claims hold no place', () => {
    expect(roomLeft(item(null), claims(MAX_ENTRIES_PER_ITEM))).toBeNull()
    expect(mayFile(item(null), claims(MAX_ENTRIES_PER_ITEM - 1))).toBe(true)
    expect(mayFile(item(null), claims(MAX_ENTRIES_PER_ITEM))).toBe(false)
    expect(mayFile(item(null), claims(MAX_ENTRIES_PER_ITEM, 'voided'))).toBe(true)
  })

  it('holds a limit stored above the ceiling to the ceiling', () => {
    expect(roomLeft(item(MAX_ENTRIES_PER_ITEM + 50), claims(MAX_ENTRIES_PER_ITEM))).toBe(0)
    expect(mayFile(item(3), claims(2))).toBe(true)
    expect(mayFile(item(3), claims(3))).toBe(false)
  })
})
