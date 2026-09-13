import { Context, Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
  SERVER_MAX_CLIENT_PROTOCOL,
  SERVER_MIN_CLIENT_PROTOCOL,
} from '@qualy/release-contract'

// Whether the client asking may still talk to this api.
//
// A Qualy web page names its protocol generation on every api request; a
// server serves a window of generations, widened before a breaking change
// ships and narrowed once the old pages have drained. A page outside the
// window is told so at once, in an infrastructure answer that no handler
// ever sees and no plugin's error union has to carry: 409, a header the
// browser transport reads, and a body naming the window. A request that
// names no protocol passes - the api is not the web page's alone; the cli,
// a test client and an integration ask it too - and only the api mount is
// judged: the shell, the health probes and the release endpoint are how a
// page finds out it is behind, and must answer whoever asks.
//
// The release id a page also sends is never judged here: an older page and
// a newer server are meant to work together inside the window, and the id
// is for diagnostics and logs.

export const CLIENT_PROTOCOL_UNSUPPORTED = 'QUALY_CLIENT_PROTOCOL_UNSUPPORTED'

export interface ProtocolWindow {
  readonly min: number
  readonly max: number
}

export const SERVER_PROTOCOL_WINDOW: ProtocolWindow = {
  min: SERVER_MIN_CLIENT_PROTOCOL,
  max: SERVER_MAX_CLIENT_PROTOCOL,
}

const insideApi = (url: string) =>
  url === QUALY_API_PREFIX ||
  url.startsWith(`${QUALY_API_PREFIX}/`) ||
  url.startsWith(`${QUALY_API_PREFIX}?`)

/** the header's value as a generation, or nothing where it is not one */
const generationOf = (declared: string): number | undefined =>
  /^\d{1,7}$/.test(declared) ? Number(declared) : undefined

const refusal = (declared: string, window: ProtocolWindow) =>
  HttpServerResponse.text(
    JSON.stringify({
      code: CLIENT_PROTOCOL_UNSUPPORTED,
      received: generationOf(declared) ?? declared,
      supported: { min: window.min, max: window.max },
    }),
    {
      status: 409,
      contentType: 'application/json; charset=utf-8',
      headers: {
        [QUALY_CLIENT_UNSUPPORTED_HEADER]: '1',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  )

export const clientCompatibility = (window: ProtocolWindow = SERVER_PROTOCOL_WINDOW) => {
  if (!Number.isInteger(window.min) || !Number.isInteger(window.max) || window.min > window.max) {
    throw new Error(`not a protocol window: ${String(window.min)}..${String(window.max)}`)
  }
  return <A, E, R>(
    httpApp: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    A | HttpServerResponse.HttpServerResponse,
    E,
    R | HttpServerRequest.HttpServerRequest
  > =>
    Effect.withFiber<A | HttpServerResponse.HttpServerResponse, E, R>((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
      if (!insideApi(request.url)) return httpApp
      const declared = request.headers[QUALY_CLIENT_PROTOCOL_HEADER]
      if (declared === undefined) return httpApp
      const generation = generationOf(declared)
      if (generation !== undefined && generation >= window.min && generation <= window.max) {
        return httpApp
      }
      return Effect.logWarning('request refused: web client protocol outside the window').pipe(
        Effect.annotateLogs({
          path: request.url.split('?')[0]!,
          received: declared,
          min: window.min,
          max: window.max,
        }),
        Effect.andThen(Effect.succeed(refusal(declared, window))),
      )
    })
}
