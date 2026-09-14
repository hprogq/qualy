import { Effect, Stream } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { Api } from '@qualy/api-kit/plugin'
import { Storage } from '@qualy/plugin-storage/server'
import { storageLocalApiGroup } from '../api.ts'

// The door's implementation: one PUT per reservation, the bytes going to
// disk as they arrive.
//
// Raw, because the body is the file. A decoded handler would have to hold
// the whole attachment in memory first, and the ceiling on one is large
// enough that doing so is the difference between a stream and an outage.
// Everything else about the endpoint - method, path, parameter - is the
// contract's, so this handler receives `reservationId` already decoded.

const local = Api.local(storageLocalApiGroup)

export const storageLocalApiHandlers = HttpApiBuilder.group(local, 'storageLocal', (handlers) =>
  handlers.handleRaw(
    'uploadObject',
    Effect.fn('storageLocal.uploadObject.handler')(function* ({ params }) {
      const storage = yield* Storage
      const request = yield* HttpServerRequest.HttpServerRequest
      const body = yield* Stream.toAsyncIterableEffect(request.stream)
      const received = yield* Effect.result(
        storage.receiveUpload({ reservationId: params.reservationId, body }),
      )
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
  ),
)
