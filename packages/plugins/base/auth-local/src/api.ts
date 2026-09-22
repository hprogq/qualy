import { TooManyAttemptsResponse } from '@qualy/auth-contract/session'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// url shape is /auth/<provider-type>/<provider-code>/<operation>: the code
// selects one provider of the tenant; for this driver there is exactly one.

/**
 * One uniform refusal.
 *
 * It never distinguishes an unknown identifier from a wrong password, and the
 * handler equalizes timing as well, so neither the answer nor how long it took
 * reveals whether an account exists.
 */
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()(
  'INVALID_CREDENTIALS',
  {},
  { httpApiStatus: 401, identifier: 'InvalidCredentials' },
) {}

const signedInUser = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  businessNo: Schema.NullOr(Schema.String),
  userType: Schema.Struct({ id: Schema.String, code: Schema.String, name: Schema.String }),
  primaryOrgNode: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
  }),
  tenant: Schema.Struct({ id: Schema.String, slug: Schema.String, name: Schema.String }),
})

export const authLocalApiGroup = HttpApiGroup.make('authLocal').add(
  HttpApiEndpoint.post('login', '/auth/local/:providerCode/login', {
    params: Schema.Struct({
      providerCode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(63)),
    }),
    // Only the shape is checked here. The rules a new password must meet are
    // asked when one is set, never at the door: a stranger learns nothing
    // about them, and a password set before a rule changed still opens it.
    payload: Schema.Struct({
      email: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(320)),
      password: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    }),
    success: Schema.Struct({ user: signedInUser }),
    error: [InvalidCredentials, TooManyAttemptsResponse],
  }),
)
