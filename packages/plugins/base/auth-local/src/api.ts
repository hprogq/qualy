import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// url shape is /auth/<provider-type>/<provider-code>/<operation>: the code
// selects one configured provider instance of the tenant.

/**
 * One uniform refusal.
 *
 * It never distinguishes an unknown identifier from a wrong password, and the
 * handler equalizes timing as well, so neither the answer nor how long it took
 * reveals whether an account exists.
 */
export class InvalidCredentials extends Schema.TaggedErrorClass<InvalidCredentials>()(
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
    payload: Schema.Struct({
      identifier: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
      password: Schema.String.check(Schema.isMinLength(1)),
    }),
    success: Schema.Struct({ user: signedInUser }),
    error: [InvalidCredentials],
  }),
)
