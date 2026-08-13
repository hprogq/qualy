import { Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { Storage } from '@qualy/plugin-storage/server'

// The disk's upload door: one PUT per reservation, mounted at the exact url
// the grant named. The reservation id is the whole credential - unguessable,
// single-purpose, expiring - the same trust shape as a cloud store's signed
// url, enforced by core storage when the bytes arrive and again at complete.
//
// A raw route rather than an api endpoint on purpose: the body is the file
// itself, the caller is a grant holder rather than a session, and nothing
// about it belongs in the openapi document.

export const routes: Layer.Layer<never, never, HttpRouter.HttpRouter | Storage> = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const storage = yield* Storage
    yield* router.add(
      'PUT',
      '/api/storage/local/uploads/:reservationId',
      Effect.gen(function* () {
        const { reservationId } = yield* HttpRouter.params
        if (reservationId === undefined) return HttpServerResponse.empty({ status: 404 })
        const request = yield* HttpServerRequest.HttpServerRequest
        const body = yield* Stream.toAsyncIterableEffect(request.stream)
        const received = yield* Effect.result(storage.receiveUpload({ reservationId, body }))
        if (received._tag === 'Success') return HttpServerResponse.empty({ status: 204 })
        const refusal = received.failure
        switch (refusal._tag) {
          case 'STORAGE_RESERVATION_NOT_FOUND':
            return HttpServerResponse.empty({ status: 404 })
          case 'STORAGE_RESERVATION_INVALID':
            // expired and oversize alike: the ticket cannot take these bytes
            return HttpServerResponse.empty({ status: 410 })
          default:
            return HttpServerResponse.empty({ status: 503 })
        }
      }),
    )
  }),
)
