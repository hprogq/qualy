import { describe, expect, it } from 'vitest'
import { Effect, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { clientFor } from '../src/api.ts'

// What a browser request tells the server about tracing: nothing.
//
// Effect's client tracing writes `traceparent` and `b3` from a span the
// browser will never export - there is no RUM, no exporter - and a server
// honoring those headers records every request as the child of a parent that
// never arrives. `clientFor` therefore disables propagation on the browser
// client only. The control test below keeps the guard honest: it proves the
// default client DOES write the headers, so the absence asserted here is the
// work of `clientFor`, not of tracing being off altogether.

const api = HttpApi.make('propagation-under-test').add(
  HttpApiGroup.make('ping').add(
    HttpApiEndpoint.get('hello', '/ping/hello', {
      success: Schema.Struct({ msg: Schema.String }),
    }),
  ),
)

/** a fetch that answers the endpoint and writes down every header it saw */
const capturing =
  (seen: Record<string, string>[]): typeof globalThis.fetch =>
  async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    seen.push(Object.fromEntries(headers.entries()))
    return new Response(JSON.stringify({ msg: 'pong' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

describe('what a browser api request propagates', () => {
  it('carries neither traceparent nor b3', async () => {
    const seen: Record<string, string>[] = []
    const answer = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test')
        return yield* client.ping.hello()
      }).pipe(
        // a live enclosing span, so propagation WOULD have something to say
        Effect.withSpan('page-operation'),
        Effect.provideService(FetchHttpClient.Fetch, capturing(seen)),
      ),
    )
    expect(answer.msg).toBe('pong')
    expect(seen).toHaveLength(1)
    expect(Object.keys(seen[0]!)).not.toContain('traceparent')
    expect(Object.keys(seen[0]!)).not.toContain('b3')
  })

  it('control: the default client does write them, so the guard tests something', async () => {
    const seen: Record<string, string>[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(api, { baseUrl: 'http://qualy.test' })
        return yield* client.ping.hello()
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.withSpan('page-operation'),
        Effect.provideService(FetchHttpClient.Fetch, capturing(seen)),
      ),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]!.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(seen[0]!.b3).toBeDefined()
  })
})
