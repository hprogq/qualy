import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/unstable/http'
import { retryQuery } from '../src/api-query.ts'
import { nextRedialMs } from '../src/api-stream.ts'

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

describe('re-dialling a stream', () => {
  it('keeps backing away while every connection dies on arrival', () => {
    // the accept-and-drop server: each dial is answered, delivers the
    // catch-up event and ends within milliseconds
    const waits: number[] = []
    let wait = 3_000
    for (let dial = 0; dial < 5; dial += 1) {
      wait = nextRedialMs(wait, 40)
      waits.push(wait)
    }
    expect(waits).toEqual([6_000, 12_000, 24_000, 48_000, 60_000])
  })

  it('returns to the floor once a connection has lasted', () => {
    expect(nextRedialMs(48_000, 20_000)).toBe(3_000)
  })
})
