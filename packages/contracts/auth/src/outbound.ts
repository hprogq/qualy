import { Context, Data } from 'effect'
import type { Effect } from 'effect'

// Every request the server makes on a login entrance's behalf.
//
// A CAS server's validation address, an OIDC issuer, a token endpoint: each
// is typed in by a tenant's administrator and then fetched by this process,
// which makes each of them a way to point the server at something it can
// reach and the administrator cannot. Drivers never fetch for themselves;
// they ask this port, and the one implementation behind it decides what may
// be reached and holds the connection to exactly the address it checked.

export interface OutboundRequest {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  /** a form or a string; a form is sent as application/x-www-form-urlencoded */
  readonly body?: string | URLSearchParams
  /** how long the whole exchange may take; ten seconds when absent */
  readonly timeoutMs?: number
  /** how much of the answer may be read; one mebibyte when absent */
  readonly maxBytes?: number
}

export interface OutboundResponse {
  readonly status: number
  /** lower-cased names; a repeated header keeps its last value */
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

/**
 * The request was not made: the address is one this deployment does not
 * let an entrance reach.
 *
 * `reason` names the rule, for the log and for the screen that set the
 * address up; the address itself is not repeated.
 */
export class OutboundRefused extends Data.TaggedError('OutboundRefused')<{
  readonly reason:
    | 'scheme'
    | 'credentials'
    | 'fragment'
    | 'unresolvable'
    | 'loopback'
    | 'link-local'
    | 'unspecified'
    | 'metadata'
    | 'private'
    | 'reserved'
}> {}

/** the request was made and did not come back as an answer */
export class OutboundFailed extends Data.TaggedError('OutboundFailed')<{
  readonly reason: 'timeout' | 'network' | 'too-large'
}> {}

export class AuthOutbound extends Context.Service<
  AuthOutbound,
  {
    /**
     * One request, never following a redirect: a 3xx comes back as the
     * answer it is, because an upstream that sends the server somewhere else
     * is sending it somewhere nobody checked.
     */
    readonly fetch: (
      request: OutboundRequest,
    ) => Effect.Effect<OutboundResponse, OutboundRefused | OutboundFailed>
  }
>()('@qualy/auth-contract/AuthOutbound') {}
