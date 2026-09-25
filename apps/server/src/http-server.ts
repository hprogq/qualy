import { createServer, type Server } from 'node:http'

// The Node server this host listens with, and the two clocks it runs on.

/**
 * How long one request may take to ARRIVE, headers and body together.
 *
 * Node's default is five minutes (v24: `requestTimeout` 300000), counted from
 * the first byte whether or not bytes are still flowing. A file upload to the
 * local store is one PUT streaming the whole file, and nothing in front of it
 * buffers: a 45 MB scan on a 1 Mbps dormitory line needs about six minutes,
 * was cut with a 408 at the fifth, and failed the same way on every retry.
 *
 * Half an hour covers the largest attachment on a slow line with room to
 * spare, and it matches the grace a storage grant is given after it expires
 * for exactly this reason: an upload that started inside its grant is still
 * arriving. It stays finite - a deployment that binds the port directly has
 * no proxy to bound a request that never finishes. Idle bodies are the
 * proxy's to cut; an idle timeout here would also cut the event streams
 * and the formula editor's websocket, which are idle by design.
 */
export const REQUEST_TIMEOUT_MS = 30 * 60 * 1000

/** how long the request line and headers may take; a slow-headers client gets no longer than Node's default */
export const HEADERS_TIMEOUT_MS = 60 * 1000

/** a Node http server with this host's timeouts, not yet listening */
export const createHttpServer = (): Server =>
  createServer({ requestTimeout: REQUEST_TIMEOUT_MS, headersTimeout: HEADERS_TIMEOUT_MS })
