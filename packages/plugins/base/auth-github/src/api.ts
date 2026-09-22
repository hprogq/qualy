import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/unstable/httpapi'
import { Viewer } from '@qualy/auth-contract/session'

// Two addresses a browser is sent to: `start` sends the person to GitHub -
// to sign in, or, from their own account, to bind one - and GitHub sends them
// back to `callback`. Both answer with redirects, so neither declares an
// error body; what went wrong travels as a code in the address they land on.

const providerCode = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(63))

/** GitHub did not vouch for anybody: the person turned back, or the code was refused */
export class GithubRejected extends Schema.TaggedError<GithubRejected>()(
  'AUTH_GITHUB_REJECTED',
  {},
  { httpApiStatus: 401, identifier: 'GithubRejected' },
) {}

/** GitHub could not be asked */
export class GithubUnavailable extends Schema.TaggedError<GithubUnavailable>()(
  'AUTH_GITHUB_UNAVAILABLE',
  {},
  { httpApiStatus: 502, identifier: 'GithubUnavailable' },
) {}

export const authGithubApiGroup = HttpApiGroup.make('authGithub')
  .add(
    HttpApiEndpoint.get('start', '/auth/github/:providerCode/start', {
      params: Schema.Struct({ providerCode }),
      query: Schema.Struct({
        // `bind` from somebody's own account: the account goes to them
        intent: Schema.optional(Schema.Literal('bind')),
        returnTo: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
      }),
      success: HttpApiSchema.Empty(302),
    }).middleware(Viewer),
  )
  .add(
    HttpApiEndpoint.get('callback', '/auth/github/:providerCode/callback', {
      params: Schema.Struct({ providerCode }),
      query: Schema.Struct({
        code: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
        state: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
        // GitHub says why it sent the person back without a code
        error: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
      }),
      success: HttpApiSchema.Empty(303),
    }),
  )
