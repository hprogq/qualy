import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import type COS from 'cos-nodejs-sdk-v5'
import { Effect } from 'effect'
import { backendFailure, type BackendUnavailable } from '@qualy/plugin-storage/errors'

/** A direct SDK read, released even when the caller never starts consuming it. */
export const readObject = (cos: COS, params: COS.GetObjectParams) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        let closed = false
        let body: Readable | undefined
        let finish!: (failure: BackendUnavailable | null) => void
        const completed = new Promise<BackendUnavailable | null>((resolve) => {
          finish = resolve
        })
        const failed = (cause: unknown) => {
          const failure = backendFailure('read', cause)
          finish(failure)
          body?.destroy(failure)
        }
        const check = (
          status: number | undefined,
          headers: Record<string, unknown> | undefined,
        ) => {
          const encoding = String(headers?.['content-encoding'] ?? '')
            .trim()
            .toLowerCase()
          if (status !== 200 || (encoding !== '' && encoding !== 'identity')) {
            failed(new Error('the store did not return an unencoded complete object'))
            return false
          }
          return true
        }
        const returned = cos.getObjectStream(
          { ...params, Headers: { 'Accept-Encoding': 'identity' } },
          (error, result) => {
            if (error) failed(error)
            else if (check(result.statusCode, result.headers)) finish(null)
          },
        )
        if (!(returned instanceof Readable)) throw new Error('the store returned no readable body')
        body = returned
        // The SDK aborts its request on an output error, not on close. Keep
        // an error listener before any consumer exists, including while the
        // SDK is still obtaining credentials and has not piped its request.
        body.on('error', (cause) => finish(backendFailure('read', cause)))
        body.on('pipe', (request: Readable) => {
          request.once('response', (response: IncomingMessage) => {
            check(response.statusCode, response.headers)
          })
          if (closed) body.emit('error', new Error('storage read was closed'))
        })
        const stream = body
        const close = () => {
          closed = true
          if (!stream.readableEnded) stream.destroy(new Error('storage read was closed'))
        }
        const bytes = (async function* () {
          try {
            for await (const chunk of stream) yield chunk as Uint8Array
            // The SDK's completion validates status and headers too; an
            // error response or partial body must never become a valid file.
            const failure = await completed
            if (failure !== null) throw failure
          } catch (cause) {
            throw backendFailure('read', cause)
          } finally {
            close()
          }
        })()
        return { bytes, close }
      },
      catch: (cause) => backendFailure('read', cause),
    }),
    (resource) => Effect.sync(resource.close),
  ).pipe(Effect.map((resource) => resource.bytes))
