import { describe, expect, it } from 'vitest'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { laneOf, overviewReads } from '../src/client/overview-reads.ts'

// The overview's reads as the page and the server that reads first for it
// both make them: the same address, the same inputs, the same cache keys.

describe("the overview's reads", () => {
  it('reads the address the same way, defaults and all', () => {
    expect(laneOf(null)).toBe('all')
    expect(laneOf('')).toBe('all')
    expect(laneOf('reviewer')).toBe('reviewer')
    expect(laneOf('anybody')).toBe('all')
  })

  it('asks for the feed at the place the address names', () => {
    expect(overviewReads('b', { lane: 'all', page: undefined }).activity).toEqual({
      params: { batchId: 'b' },
      query: { page: '1' },
    })
    expect(overviewReads('b', { lane: 'participant', page: '2' }).activity).toEqual({
      params: { batchId: 'b' },
      query: { page: '2', perspective: 'participant' },
    })
    // a page that cannot be one is the first
    expect(overviewReads('b', { lane: 'all', page: 'x' }).activity.query.page).toBe('1')
  })

  it('names the same cache entry for the same address on either side', () => {
    const page = queryKeyOf(
      'assessment',
      'listMyActivity',
      overviewReads('b', { lane: laneOf('participant'), page: '2' }).activity,
    )
    const server = queryKeyOf(
      'assessment',
      'listMyActivity',
      overviewReads('b', { lane: 'participant', page: '2' }).activity,
    )
    expect(server).toEqual(page)
    expect(queryKeyOf('assessment', 'getBatch')).toEqual(['assessment', 'getBatch'])
  })
})
