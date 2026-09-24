import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { RETURN_PATH_MAX_LENGTH } from '@qualy/ui-contract/return-path'

// Two addresses a browser is sent to, never called by a script: `start` sends
// the person to the CAS server, and the server sends them back to `callback`
// with a ticket. Both answer with a redirect - onwards, or to the sign-in page
// with the reason it did not work - so neither declares an error body.

const providerCode = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(63))

// Nothing a callback receives is bounded here. Its values are the other
// side's - a code, a ticket, a session marker - and nothing promises how long
// they run: a Microsoft authorization code runs to thousands of characters. A
// value this contract refused would never reach the handler, and the person
// would be shown a page of JSON instead of being sent back to the sign-in page
// with a reason. The handler checks what it relies on and redirects when it
// does not hold; the server bounds the request as a whole.
const received = Schema.optional(Schema.String)

/**
 * Why a CAS sign-in did not go through, as the sign-in page is told.
 *
 * Carried as the `error` of the address the person is sent back to rather
 * than as a response body, and translated there like any other code.
 */
export class CasTicketRejected extends Schema.TaggedError<CasTicketRejected>()(
  'AUTH_CAS_TICKET_REJECTED',
  {},
  { httpApiStatus: 401, identifier: 'CasTicketRejected' },
) {}

export class CasUpstreamUnavailable extends Schema.TaggedError<CasUpstreamUnavailable>()(
  'AUTH_CAS_UPSTREAM_UNAVAILABLE',
  {},
  { httpApiStatus: 502, identifier: 'CasUpstreamUnavailable' },
) {}

export class CasResponseInvalid extends Schema.TaggedError<CasResponseInvalid>()(
  'AUTH_CAS_RESPONSE_INVALID',
  {},
  { httpApiStatus: 502, identifier: 'CasResponseInvalid' },
) {}

export const authCasApiGroup = HttpApiGroup.make('authCas')
  .add(
    HttpApiEndpoint.get('start', '/auth/cas/:providerCode/start', {
      params: Schema.Struct({ providerCode }),
      // where to land once signed in; anything but a path inside this
      // application is dropped when the flow starts
      query: Schema.Struct({ returnTo: Schema.optional(Schema.String.check(Schema.isMaxLength(RETURN_PATH_MAX_LENGTH))) }),
      success: HttpApiSchema.Empty(302),
    }),
  )
  .add(
    HttpApiEndpoint.get('callback', '/auth/cas/:providerCode/callback', {
      params: Schema.Struct({ providerCode: Schema.String }),
      query: Schema.Struct({
        flow: received,
        ticket: received,
      }),
      success: HttpApiSchema.Empty(303),
    }),
  )
