import { describe, expect, it, vi } from 'vitest'
import { Effect, Exit, Schema } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
} from '@qualy/release-contract'
import { getApiErrorCode, isBackendUnavailable } from '@qualy/web-i18n'
import { clientFor } from '../src/api.ts'

// What a browser api request says about the page, and what the page hears
// back: the identity on every request from the one transport, and the
// server's refusal of the protocol read off the raw response.

/** an endpoint's own 503, the way a mail that could not be sent is declared */
class ProbeBusy extends Schema.TaggedError<ProbeBusy>()(
  'PROBE_BUSY',
  { retryInSeconds: Schema.Number },
  { httpApiStatus: 503, identifier: 'ProbeBusy' },
) {}

/** an endpoint's own 404 */
class ProbeMissing extends Schema.TaggedError<ProbeMissing>()(
  'PROBE_MISSING',
  {},
  { httpApiStatus: 404, identifier: 'ProbeMissing' },
) {}

const api = HttpApi.make('transport-under-test').add(
  HttpApiGroup.make('ping')
    .add(
      HttpApiEndpoint.get('hello', '/ping/hello', {
        success: Schema.Struct({ msg: Schema.String }),
      }),
    )
    .add(
      HttpApiEndpoint.post('send', '/ping/send', {
        success: Schema.Struct({ msg: Schema.String }),
        error: [ProbeBusy, ProbeMissing],
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

describe('the server unable to serve a request right now', () => {
  /** what the api answers when a dependency of the server's is unavailable */
  const unavailable = () =>
    new Response(JSON.stringify({ _tag: 'SERVICE_UNAVAILABLE', message: 'try again' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })

  /** what the server answers while it is itself starting */
  const starting = () =>
    new Response('qualy is starting\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-qualy-state': 'starting' },
    })

  const failureOf = async (answer: () => Response, endpoint: 'hello' | 'send' = 'hello') => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* clientFor(api, 'http://qualy.test')
        return yield* endpoint === 'hello' ? client.ping.hello() : client.ping.send()
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, answering([], answer))),
    )
    if (Exit.isSuccess(exit)) throw new Error('the request succeeded')
    const reason = exit.cause.reasons[0]
    return reason?._tag === 'Fail' ? reason.error : undefined
  }

  it('is given back its own name, though the endpoint declares nothing for it', async () => {
    expect(getApiErrorCode(await failureOf(unavailable))).toBe('SERVICE_UNAVAILABLE')
  })

  it('is given back its own name by an endpoint that declares a 503 of its own', async () => {
    expect(getApiErrorCode(await failureOf(unavailable, 'send'))).toBe('SERVICE_UNAVAILABLE')
    // and a proxy's 503, which has no tagged body at all, is the same news
    const proxied = () =>
      new Response('<html>503 Service Temporarily Unavailable</html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      })
    expect(getApiErrorCode(await failureOf(proxied, 'send'))).toBe('SERVICE_UNAVAILABLE')
  })

  it('leaves the endpoint its own 503', async () => {
    const busy = () =>
      new Response(JSON.stringify({ _tag: 'PROBE_BUSY', retryInSeconds: 5 }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    const failure = await failureOf(busy, 'send')
    expect(getApiErrorCode(failure)).toBe('PROBE_BUSY')
    expect(failure).toMatchObject({ retryInSeconds: 5 })
  })

  it('leaves a server between processes to be waited out', async () => {
    for (const endpoint of ['hello', 'send'] as const) {
      const failure = await failureOf(starting, endpoint)
      expect(getApiErrorCode(failure), endpoint).toBeUndefined()
      expect(isBackendUnavailable(failure), endpoint).toBe(true)
    }
  })

  it('gives the pipeline its own name at a status the endpoint declares too', async () => {
    const gone = () =>
      new Response(JSON.stringify({ _tag: 'API_ROUTE_NOT_FOUND', message: 'no route' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    expect(getApiErrorCode(await failureOf(gone, 'send'))).toBe('API_ROUTE_NOT_FOUND')
    const own = () =>
      new Response(JSON.stringify({ _tag: 'PROBE_MISSING' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    expect(getApiErrorCode(await failureOf(own, 'send'))).toBe('PROBE_MISSING')
  })
})
