import type { ClientUnsupportedReason } from '@qualy/release-contract'

// The live channel's wire, as both ends read it.
//
// A live channel is a WebSocket that carries wake-ups and nothing else: the
// server says that something a page holds may have changed, and the page asks
// the authoritative HTTP reads what the world looks like now. No data, no
// writes and no replay ever cross it. It used to be a server-sent event
// stream, and an edge that ends any response idle for a few seconds made that
// a stream that broke on every quiet minute; a WebSocket is what such an edge
// carries as a long connection.
//
// A browser cannot set headers on a WebSocket, so what the HTTP transport
// says in headers travels another way here. The channel's own generation is
// the subprotocol, which the handshake echoes; the api generation and the
// release ride as two query parameters, neither of them a secret - a release
// id is in every page's HTML. The session is the cookie, as on every request.
// Nothing here carries a locale: no frame is ever words for a reader.
//
// The refusal a page has to act on cannot be an HTTP status either: a browser
// sees a refused handshake only as a connection that failed, the same thing
// an outage looks like. So a refusal is an upgraded socket closed at once
// with an application close code, and the codes below are the protocol's
// whole outward vocabulary. Reasons are short stable words.

/** the subprotocol a live channel speaks; a page that offers another is refused */
export const LIVE_SUBPROTOCOL = 'qualy.live.1'

/** where the api generation and the release travel, in place of their headers */
export const LIVE_PROTOCOL_PARAM = 'protocol'
export const LIVE_RELEASE_PARAM = 'release'

/** what the browser sends: the answer to a heartbeat, and nothing else */
export const LIVE_PONG = 'pong'

/** the largest frame a page may send; a pong is four bytes */
export const LIVE_INBOUND_FRAME_LIMIT = 64

/** how often the server says it is there; well inside every idle limit on the way */
export const LIVE_HEARTBEAT_MS = 25_000

/**
 * How long either end goes without hearing the other before it calls the
 * connection dead: two heartbeats missed, and a margin for a busy tab.
 */
export const LIVE_SILENCE_MS = 2 * LIVE_HEARTBEAT_MS + 10_000

export const LIVE_CLOSE = {
  /** a goodbye: the page let go */
  normal: 1000,
  /** the server is shutting down */
  goingAway: 1001,
  /** a binary frame */
  unsupportedData: 1003,
  /** a frame that is not a pong */
  policy: 1008,
  /** a frame past the limit */
  tooBig: 1009,
  /** the server could not go on */
  internal: 1011,
  /** the connection has lived its time; dial again now and be judged afresh */
  renew: 4000,
  /** no session, or one that has ended */
  unauthenticated: 4401,
  /** the session may not watch this */
  forbidden: 4403,
  /** the other end stopped answering heartbeats */
  unresponsive: 4408,
  /** this page cannot talk to this server; the reason says which of three */
  unsupported: 4409,
  /** every seat is taken; the reason says whose */
  quota: 4429,
} as const

export type LiveCloseCode = (typeof LIVE_CLOSE)[keyof typeof LIVE_CLOSE]

/** whose seats were all taken: the session's share, or the process's */
export type LiveQuotaReason = 'session' | 'capacity'

/** the reason a 4409 close carries, read back as the release protocol names it */
export const unsupportedReasonOf = (reason: string): ClientUnsupportedReason =>
  reason === 'assembly' || reason === 'release' ? reason : 'protocol'

/**
 * What a page does about a close, by its code.
 *
 * `renew` dials again at once, `quota` waits for a seat, `retry` backs away
 * as from an outage, and the three ends stop dialling: a session that is gone
 * is the identity flow's, a refusal is the screen's own reads' to surface,
 * and an unsupported page is the release coordinator's.
 */
export type LiveCloseVerdict =
  | 'renew'
  | 'quota'
  | 'retry'
  | 'unauthenticated'
  | 'forbidden'
  | 'unsupported'

export const liveCloseVerdict = (code: number): LiveCloseVerdict => {
  switch (code) {
    case LIVE_CLOSE.renew:
      return 'renew'
    case LIVE_CLOSE.quota:
      return 'quota'
    case LIVE_CLOSE.unauthenticated:
      return 'unauthenticated'
    case LIVE_CLOSE.forbidden:
      return 'forbidden'
    case LIVE_CLOSE.unsupported:
      return 'unsupported'
    default:
      // a server going away, a dropped network (1006), a heartbeat nobody
      // answered and a frame the server would not take are all the same
      // question for the page: try again, more slowly each time
      return 'retry'
  }
}
