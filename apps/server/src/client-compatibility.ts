import { Context, Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { ClientAssembly, type ReleaseStanding } from '@qualy/api-kit/client-assembly'
import { insideApi } from '@qualy/api-kit/route-fallback'
import {
  ClientAssemblyUnsupported,
  ClientProtocolUnsupported,
  ClientReleaseUnsupported,
} from '@qualy/api-kit/schema'
import {
  isReleaseId,
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
  SERVER_MAX_CLIENT_PROTOCOL,
  SERVER_MIN_CLIENT_PROTOCOL,
  type ClientUnsupportedReason,
} from '@qualy/release-contract'

// Whether the client asking may still talk to this api.
//
// Two questions, asked in that order. The protocol generation is about the
// api's SHAPE: a Qualy web page names it on every request, a server serves a
// window of generations, and a page outside the window is told so at once.
// The release is about the api's CONTENTS: since a build carries only the
// active assembly, a page built from a different plugin selection has screens
// this server may have no api for, or will ask a manifest for surfaces its
// own bundle does not have - and the protocol cannot see that, because
// nothing about the shape changed.
//
// The release id used to be for diagnostics alone, and for a superset build
// that was right: every release contained every plugin, so two releases only
// ever differed in code. They can now differ in what the product IS, which
// is why it is judged - but only as far as "same assembly or not". A page
// whose release differs and whose assembly does not is exactly the old tab
// this repository keeps releases around for, and it goes through.
//
// The refusal is one shape for all three: 409, a header naming which of them
// it was, and a body with the tag alone. No handler sees it and no plugin's
// error union has to carry it. A request that names no protocol passes - the
// api is not the web page's alone; the cli, a test client and an integration
// ask it too - and only the api mount is judged: the shell, the health probes
// and the release endpoint are how a page finds out it is behind, and must
// answer whoever asks.

/** the tag the refusal carries, for whoever reads the body rather than the header */
export const CLIENT_PROTOCOL_UNSUPPORTED = 'QUALY_CLIENT_PROTOCOL_UNSUPPORTED'
export const CLIENT_ASSEMBLY_UNSUPPORTED = 'QUALY_CLIENT_ASSEMBLY_UNSUPPORTED'
export const CLIENT_RELEASE_UNSUPPORTED = 'QUALY_CLIENT_RELEASE_UNSUPPORTED'

export interface ProtocolWindow {
  readonly min: number
  readonly max: number
}

export const SERVER_PROTOCOL_WINDOW: ProtocolWindow = {
  min: SERVER_MIN_CLIENT_PROTOCOL,
  max: SERVER_MAX_CLIENT_PROTOCOL,
}

/** the header's value as a generation, or nothing where it is not one */
const generationOf = (declared: string): number | undefined =>
  /^\d{1,7}$/.test(declared) ? Number(declared) : undefined

/** every refusal: 409, the reason in the header the transport reads, the tag in the body */
const answer = {
  status: 409,
  headers: {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
} as const

// Spelled out per reason rather than looked up in a table: the schema and the
// value it encodes have to be the same class, and a table of three makes that
// a union the encoder cannot narrow.
const refusal = (reason: ClientUnsupportedReason) => {
  const headers = { ...answer.headers, [QUALY_CLIENT_UNSUPPORTED_HEADER]: reason }
  const options = { status: answer.status, headers }
  if (reason === 'protocol') {
    return HttpServerResponse.schemaJson(ClientProtocolUnsupported)(
      new ClientProtocolUnsupported(),
      options,
    ).pipe(Effect.orDie)
  }
  if (reason === 'assembly') {
    return HttpServerResponse.schemaJson(ClientAssemblyUnsupported)(
      new ClientAssemblyUnsupported(),
      options,
    ).pipe(Effect.orDie)
  }
  return HttpServerResponse.schemaJson(ClientReleaseUnsupported)(
    new ClientReleaseUnsupported(),
    options,
  ).pipe(Effect.orDie)
}

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
      const path = request.url.split('?')[0]!

      const declared = request.headers[QUALY_CLIENT_PROTOCOL_HEADER]
      if (declared !== undefined) {
        const generation = generationOf(declared)
        if (generation === undefined || generation < window.min || generation > window.max) {
          return Effect.logWarning('request refused: web client protocol outside the window').pipe(
            Effect.annotateLogs({ path, received: declared, min: window.min, max: window.max }),
            Effect.andThen(refusal('protocol')),
          )
        }
      }

      const release = request.headers[QUALY_CLIENT_RELEASE_HEADER]
      // No release named: not a web page. The cli, an integration and every
      // test client are in this branch, and none of them was built from an
      // assembly at all.
      if (release === undefined) return httpApp
      // Whatever registered the judgement, or nothing - see ClientAssembly.
      // Read per request, like readiness, so this file names no plugin.
      const assembly = Context.getOrUndefined(fiber.context, ClientAssembly)
      const standing: ReleaseStanding = !isReleaseId(release)
        ? 'unknown'
        : (assembly?.standingOf(release) ?? 'compatible')
      if (standing === 'compatible') return httpApp
      const reason: ClientUnsupportedReason = standing === 'unknown' ? 'release' : 'assembly'
      return Effect.logWarning(`request refused: web release ${standing}`).pipe(
        Effect.annotateLogs({ path, release }),
        Effect.andThen(refusal(reason)),
      )
    })
}
