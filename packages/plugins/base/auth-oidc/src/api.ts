import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { Viewer } from '@qualy/auth-contract/session'

// Two addresses a browser is sent to: `start` sends the person to the
// identity provider - to sign in, or from their own account to bind one -
// and the provider sends them back to `callback`. Both answer with
// redirects; what went wrong travels as a code in the address they land on.

const providerCode = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(63))

// Nothing a callback receives is bounded here. Its values are the other
// side's - a code, a ticket, a session marker - and nothing promises how long
// they run: a Microsoft authorization code runs to thousands of characters. A
// value this contract refused would never reach the handler, and the person
// would be shown a page of JSON instead of being sent back to the sign-in page
// with a reason. The handler checks what it relies on and redirects when it
// does not hold; the server bounds the request as a whole.
const received = Schema.optional(Schema.String)

/** the provider did not vouch for anybody, or vouched in a way that does not hold */
export class OidcRejected extends Schema.TaggedError<OidcRejected>()(
  'AUTH_OIDC_REJECTED',
  {},
  { httpApiStatus: 401, identifier: 'OidcRejected' },
) {}

/** the provider could not be asked */
export class OidcUnavailable extends Schema.TaggedError<OidcUnavailable>()(
  'AUTH_OIDC_UNAVAILABLE',
  {},
  { httpApiStatus: 502, identifier: 'OidcUnavailable' },
) {}

export const authOidcApiGroup = HttpApiGroup.make('authOidc')
  .add(
    HttpApiEndpoint.get('start', '/auth/oidc/:providerCode/start', {
      params: Schema.Struct({ providerCode }),
      query: Schema.Struct({
        intent: Schema.optional(Schema.Literal('bind')),
        returnTo: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
      }),
      success: HttpApiSchema.Empty(302),
    }).middleware(Viewer),
  )
  .add(
    // the response is read from the address as a whole by the client
    // library; these are declared so the contract says what arrives
    HttpApiEndpoint.get('callback', '/auth/oidc/:providerCode/callback', {
      params: Schema.Struct({ providerCode: Schema.String }),
      query: Schema.Struct({
        code: received,
        state: received,
        iss: received,
        error: received,
        error_description: received,
        session_state: received,
      }),
      success: HttpApiSchema.Empty(303),
    }),
  )
