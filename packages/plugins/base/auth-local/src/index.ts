import { Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import type { LoginDriver } from '@qualy/auth-contract/login'
import { Login, legacyDriverLayer } from '@qualy/auth-contract/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { LoginSessions } from '@qualy/auth-contract/login'
import { authLocalApiGroup, InvalidCredentials } from './api.ts'
import { normalizeLocalIdentifier, timingEqualizerHash, verifyPassword } from './password.ts'

// Password authentication: prove the user against a local provider instance,
// then hand the proof to the core for session creation.
//
// Every failure between resolving the provider and verifying the password
// answers the same INVALID_CREDENTIALS, and an unknown identifier still burns
// one argon2 verification, so timing does not reveal account existence either.
/**
 * How this driver asks to be presented on the sign-in screen.
 *
 * The proof itself is the api handler below; this is only what the login shell
 * has to render to collect it.
 */
const driver: LoginDriver = {
  type: 'local',
  describe: () => ({ mode: 'component', component: 'auth-local/LoginMethod' }),
}

/**
 * What this plugin contributes: itself, to the registry that will be asked.
 *
 * A driver owns no state and answers no peer, so it publishes no service. It
 * used to publish its presentation as a separate zero-dependency module that a
 * generated catalog imported - a file, a subpath export and a generator, to
 * say four lines.
 */

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(authLocalApiGroup).prefix(QUALY_API_PREFIX)

const handlers = HttpApiBuilder.group(local, 'authLocal', (handlers) =>
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

const plugin = Plugin.define(
  '@qualy/plugin-auth-local',
  Login.driver(driver),
  Api.group(authLocalApiGroup, handlers),
)

export default plugin

// legacy bridge until the descriptor assembler takes over the host; the
// handlers stay a direct export because their precise type is load-bearing
// in the generated composition
export const apiHandlers = handlers
export const layer = legacyDriverLayer(plugin)
