import { Context, Effect } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { NodeHttpServerRequest } from '@effect/platform-node'
import type * as Http from 'node:http'

// The two Node-shaped things a plugin sometimes needs, and nowhere else to put
// them.
//
// Its own subpath because the kit's root is reachable from the browser through
// the oRPC contract package, and nothing here belongs in a bundle. It lives in
// the kit rather than in a package of its own because neither of these is any
// plugin's domain: they are runtime primitives, and one subpath is cheaper than
// one package for two exports. Promote it if a third appears.

/**
 * The `http.Server` the process is listening on.
 *
 * The platform's `HttpServer` service exposes an address and a serve function
 * and not the instance, but `NodeHttpServer.layer` takes a thunk, so the host
 * can create it, publish it here, and hand the same object to both. Vite needs
 * exactly this for `middlewareMode`, which is how its hot-reload websocket ends
 * up on the application's own port instead of a second one.
 */
export class NodeServer extends Context.Service<NodeServer, Http.Server>()(
  '@qualy/api-kit/NodeServer',
) {}

/** a connect-style handler: writes the response itself, or calls next */
export type ConnectMiddleware = (
  request: Http.IncomingMessage,
  response: Http.ServerResponse,
  next: (error?: unknown) => void,
) => void

/**
 * Runs a connect-style middleware as a route handler.
 *
 * The middleware writes to the raw Node response rather than returning
 * anything, so the effect waits for one of two outcomes: the response finished,
 * or `next` was called because the middleware declined. Returning a response
 * after it finished is deliberately harmless - the platform's writer starts
 * with `if (nodeResponse.writableEnded) return`, which is what makes this
 * handoff supported rather than a trick.
 *
 * A third outcome is not an answer at all: the client went away while the
 * middleware was still writing. The head is out and the body never ended, so
 * the platform's guard does not hold, and the platform itself then answers
 * the abort with a 499 of its own, written as a second head - "Cannot write
 * headers after they are sent", once per abandoned asset. So the response is
 * ended here, where nothing can reach the client any more anyway: that is
 * the fact the guard reads. The request then ends with the answer that went
 * out - the head the client was sent - as any other finished one does;
 * interrupting it from here instead would carry no client-abort mark and
 * read to the platform as its own failure, a 503.
 *
 * `next(error)` is a defect, not a decline. Treating them alike would turn a
 * middleware's own crash into a 404 and lose it, and there is no domain failure
 * here for a caller to act on: the fallback either serves or it is broken.
 */
export const fromConnect = (middleware: ConnectMiddleware) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const nodeRequest = NodeHttpServerRequest.toIncomingMessage(request)
    const nodeResponse = NodeHttpServerRequest.toServerResponse(request)

    const declined = yield* Effect.callback<boolean>((resume) => {
      let settled = false
      const settle = (effect: Effect.Effect<boolean>) => {
        if (settled) return
        settled = true
        nodeResponse.off('finish', onFinish)
        nodeResponse.off('close', onClose)
        resume(effect)
      }
      const onFinish = () => settle(Effect.succeed(false))
      // close before the answer ended is a client that went away
      // mid-response: the request is over, and nothing is left to write
      const onClose = () => {
        if (!nodeResponse.writableEnded) nodeResponse.end()
        settle(Effect.succeed(false))
      }
      nodeResponse.once('finish', onFinish)
      nodeResponse.once('close', onClose)
      const fault = (error: unknown) =>
        Effect.die(error instanceof Error ? error : new Error(String(error)))
      try {
        middleware(nodeRequest, nodeResponse, (error) =>
          settle(error === undefined ? Effect.succeed(true) : fault(error)),
        )
      } catch (error) {
        // Thrown rather than passed to next, and possibly after the head went
        // out: a head that promised a length the body will never reach leaves
        // the client waiting on a kept-alive connection for bytes that are
        // not coming. Nothing can finish that answer honestly, so the
        // connection is cut; the defect is still the request's 500.
        if (nodeResponse.headersSent) nodeResponse.destroy()
        settle(fault(error))
      }
    })

    // Declining means no route matched anywhere, since this handler is the
    // last thing tried. The status is what a caller sees; the body stays empty
    // because a fallback has nothing useful to say about a path it does not own.
    return declined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.empty({ status: 200 })
  })
