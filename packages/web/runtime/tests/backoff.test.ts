import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { retryQuery } from '../src/api-query.ts'
import { liveBackoffMs } from '../src/live-channel.ts'

// Both policies here answer the same question - how long to wait before
// knocking again - and both used to answer it from something that does not
// distinguish the cases: the presence of a `_tag`, and the arrival of an
// event.

// What a dropped connection is by the time a query sees it.
//
// Built through the real client rather than by hand: the runtime crosses from
// Effect to a promise, and what runPromise rejects with is the squashed
// failure itself, so the predicate is handed the http client's own tagged
// error and not the TypeError fetch threw.
const droppedConnection = async (): Promise<unknown> => {
  const refuse = (() =>
    Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof globalThis.fetch
  const request = HttpClient.get('https://example.invalid/api/app/manifest').pipe(
    Effect.provideService(FetchHttpClient.Fetch, refuse),
    Effect.provide(FetchHttpClient.layer),
  ) as Effect.Effect<unknown, unknown>
  try {
    await Effect.runPromise(request)
  } catch (error) {
    return error
  }
  throw new Error('the request was supposed to fail')
}

describe('retrying a failed read', () => {
  it('retries once when nothing was decided between here and the server', async () => {
    const error = await droppedConnection()
    expect((error as { _tag?: string })._tag).toBe('HttpClientError')
    expect(retryQuery(0, error)).toBe(true)
    // one attempt, not a ladder
    expect(retryQuery(1, error)).toBe(false)
  })

  it('does not retry a refusal the server meant', async () => {
    // the shape a derived client decodes a declared failure into
    const denied = Object.assign(new Error('ACCESS_DENIED'), { _tag: 'ACCESS_DENIED' })
    expect(retryQuery(0, denied)).toBe(false)
    expect(retryQuery(0, await droppedConnection())).toBe(true)
  })
})

describe('waiting before a live channel dials again', () => {
  const bounds = { floor: 1_000, cap: 30_000 }

  it('doubles from the floor up to the cap, drawn from the upper half', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => liveBackoffMs(attempt, bounds, () => 1))).toEqual(
      [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
    )
    expect([0, 1, 2, 5].map((attempt) => liveBackoffMs(attempt, bounds, () => 0))).toEqual([
      500, 1_000, 2_000, 15_000,
    ])
  })

  it('spreads a hundred pages refused at once over the whole of the window', () => {
    const waits = Array.from({ length: 100 }, () => liveBackoffMs(3, bounds))
    for (const wait of waits) {
      expect(wait).toBeGreaterThanOrEqual(4_000)
      expect(wait).toBeLessThanOrEqual(8_000)
    }
    // not one knock: the earliest and the latest are seconds apart
    expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(2_000)
  })
})
