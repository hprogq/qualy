import { describe, expect, it, vi } from 'vitest'
import { Effect, Exit, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
} from '@qualy/release-contract'
import { clientFor } from '../src/api.ts'

// What a browser api request says about the page, and what the page hears
// back: the identity on every request from the one transport, and the
// server's refusal of the protocol read off the raw response.

const api = HttpApi.make('transport-under-test').add(
  HttpApiGroup.make('ping').add(
    HttpApiEndpoint.get('hello', '/ping/hello', {
      success: Schema.Struct({ msg: Schema.String }),
    }),
  ),
)

/** a fetch that writes down every header it saw and answers as told */
const answering =
  (seen: Record<string, string>[], answer: () => Response): typeof globalThis.fetch =>
  async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    seen.push(Object.fromEntries(headers.entries()))
    return answer()
  }

const pong = () =>
  new Response(JSON.stringify({ msg: 'pong' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const identity = { releaseId: 'local-20260914T090000Z-3f9a1c2d', clientProtocol: 1 }

describe('the identity a browser request carries', () => {
  it('names the release and the protocol on every request, from the transport alone', async () => {
    const seen: Record<string, string>[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test', { identity })
        yield* client.ping.hello()
        yield* client.ping.hello()
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering(seen, pong))),
    )
    expect(seen).toHaveLength(2)
    for (const headers of seen) {
      expect(headers[QUALY_CLIENT_RELEASE_HEADER]).toBe(identity.releaseId)
      expect(headers[QUALY_CLIENT_PROTOCOL_HEADER]).toBe('1')
      // and still nothing about tracing
      expect(headers).not.toHaveProperty('traceparent')
    }
  })

  it('names nothing when a harness gives no identity', async () => {
    const seen: Record<string, string>[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test')
        yield* client.ping.hello()
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering(seen, pong))),
    )
    expect(seen[0]).not.toHaveProperty(QUALY_CLIENT_RELEASE_HEADER)
    expect(seen[0]).not.toHaveProperty(QUALY_CLIENT_PROTOCOL_HEADER)
  })
})

describe('the server refusing this page', () => {
  const refused = () =>
    new Response(JSON.stringify({ _tag: 'QUALY_CLIENT_PROTOCOL_UNSUPPORTED' }), {
      status: 409,
      headers: {
        'content-type': 'application/json',
        [QUALY_CLIENT_UNSUPPORTED_HEADER]: 'protocol',
      },
    })

  /** the same refusal under each reason a server may give */
  const refusing = (said: string) => () =>
    new Response('{}', {
      status: 409,
      headers: { 'content-type': 'application/json', [QUALY_CLIENT_UNSUPPORTED_HEADER]: said },
    })

  it('is heard off the raw response, and the request still fails the way it would have', async () => {
    const heard = vi.fn()
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test', {
          identity,
          onClientUnsupported: heard,
        })
        return yield* client.ping.hello()
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering([], refused))),
    )
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledWith('protocol')
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('passes on which of the refusals it was, and calls an unknown one a protocol refusal', async () => {
    // three findings the page cannot go on from, and a fourth word a newer
    // server might use: the header's presence is the fact, and a page that
    // ignored a reason it did not know would leave the reader with api
    // errors and nothing to do about them
    for (const [said, expected] of [
      ['protocol', 'protocol'],
      ['assembly', 'assembly'],
      ['release', 'release'],
      ['something-newer', 'protocol'],
    ] as const) {
      const heard = vi.fn()
      await Effect.runPromiseExit(
        Effect.gen(function* () {
          const client = yield* clientFor(api, 'http://qualy.test', {
            identity,
            onClientUnsupported: heard,
          })
          return yield* client.ping.hello()
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering([], refusing(said)))),
      )
      expect(heard, said).toHaveBeenCalledWith(expected)
    }
  })

  it('is not heard for any other 409, nor for a refusal nobody listens for', async () => {
    const heard = vi.fn()
    const conflict = () =>
      new Response('{}', { status: 409, headers: { 'content-type': 'application/json' } })
    await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test', {
          identity,
          onClientUnsupported: heard,
        })
        return yield* client.ping.hello()
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering([], conflict))),
    )
    expect(heard).not.toHaveBeenCalled()
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test', { identity })
        return yield* client.ping.hello()
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering([], refused))),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
