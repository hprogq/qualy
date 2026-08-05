import { Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { LoginSessions } from '@qualy/auth-contract/login'
import { authLocalApiGroup, InvalidCredentials } from '../api.ts'
import { normalizeLocalIdentifier, timingEqualizerHash, verifyPassword } from '../password.ts'

// Password authentication: prove the user against a local provider instance,
// then hand the proof to the core for session creation.
//
// Every failure between resolving the provider and verifying the password
// answers the same INVALID_CREDENTIALS, and an unknown identifier still burns
// one argon2 verification, so timing does not reveal account existence either.
// The driver's own presentation lives in ../login-driver.ts, which the
// assembly imports without loading any of this.

/**
 * What this plugin contributes to the running application: no services.
 *
 * A driver proves a password and hands the proof to the core; it owns no state
 * and answers no peer. The entry still exists because the assembly imports the
 * handlers from it, and the presentation the sign-in screen needs is a
 * separate zero-dependency module the catalog reads instead.
 */
export const layer: Layer.Layer<never> = Layer.empty

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(authLocalApiGroup).prefix(QUALY_API_PREFIX)

export const authLocalApiHandlers = HttpApiBuilder.group(local, 'authLocal', (handlers) =>
  handlers.handle(
    'login',
    Effect.fn('authLocal.login.handler')(function* ({ params, payload }) {
      const sessions = yield* LoginSessions
      // the equalizing hash is verified on every path that would otherwise
      // return early, so a miss costs what a hit costs
      const fail = Effect.fn('authLocal.login.fail')(function* () {
        yield* Effect.promise(() => verifyPassword(timingEqualizerHash, payload.password))
        return yield* new InvalidCredentials()
      })

      const resolved = yield* sessions.resolveProvider({
        providerCode: params.providerCode,
        expectedType: 'local',
      })
      if (!resolved) return yield* fail()
      const identifier = normalizeLocalIdentifier(payload.identifier)
      if (!identifier) return yield* fail()
      const identity = yield* sessions.findIdentity({
        tenantId: resolved.tenantId,
        providerId: resolved.providerId,
        identifier,
      })
      if (!identity?.credentialHash) return yield* fail()
      const verified = yield* Effect.promise(() =>
        verifyPassword(identity.credentialHash!, payload.password),
      )
      if (!verified) return yield* new InvalidCredentials()
      // a type that does not admit passwords cannot be signed in with one,
      // however good the password is
      if (!identity.allowsLocalLogin) return yield* new InvalidCredentials()
      const user = yield* sessions.completeLogin({
        tenantId: resolved.tenantId,
        userId: identity.userId,
        identityId: identity.id,
      })
      if (!user) return yield* new InvalidCredentials()
      return { user }
    }),
  ),
)
