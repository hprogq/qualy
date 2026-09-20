import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { LoginDriver } from '@qualy/auth-contract/login'
import { Login } from '@qualy/auth-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { LoginSessions } from '@qualy/auth-contract/login'
import { authLocalApiGroup, InvalidCredentials } from './api.ts'
import { message } from '@qualy/i18n-contract'
import {
  hashPassword,
  normalizeLocalIdentifier,
  timingEqualizerHash,
  verifyPassword,
} from './password.ts'

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
/** shorter than this and the argon2 cost protects very little */
const PASSWORD_MIN_LENGTH = 8
/** argon2 hashes any length; a bound keeps one request from hashing a megabyte */
const PASSWORD_MAX_LENGTH = 128

const driver: LoginDriver = {
  type: 'local',
  presentation: { mode: 'component', component: Ui.react('./client/LoginMethod') },
  // A local account is a name and a password, and whoever administers the
  // person may set both. What a password is and how it is kept stays here:
  // the core is handed a digest and stores it.
  binding: {
    mode: 'managed',
    identifierLabel: message('auth-local/binding/identifier', 'Sign-in name'),
    identifierHint: message(
      'auth-local/binding/identifier-hint',
      '2 to 64 characters: lowercase letters, digits, dot, underscore or hyphen, starting with a letter or digit',
    ),
    secret: {
      label: message('auth-local/binding/password', 'Password'),
      minLength: PASSWORD_MIN_LENGTH,
    },
    prepare: Effect.fn('authLocal.binding.prepare')(function* ({ identifier, secret }) {
      const name = normalizeLocalIdentifier(identifier)
      if (name === null) return { ok: false as const, invalid: 'identifier' as const }
      if (
        secret === undefined ||
        secret.length < PASSWORD_MIN_LENGTH ||
        secret.length > PASSWORD_MAX_LENGTH
      ) {
        return { ok: false as const, invalid: 'secret' as const }
      }
      const credentialHash = yield* Effect.promise(() => hashPassword(secret))
      return { ok: true as const, identifier: name, credentialHash }
    }),
  },
}

/**
 * What this plugin contributes: itself, to the registry that will be asked.
 *
 * A driver owns no state and answers no peer, so it publishes no service. It
 * used to publish its presentation as a separate zero-dependency module that a
 * generated catalog imported - a file, a subpath export and a generator, to
 * say four lines.
 */

const local = Api.local(authLocalApiGroup)

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
      // no resolved door, no record: a URL that names no provider is not an
      // attempt on anybody's account
      if (!resolved) return yield* fail()
      const identifier = normalizeLocalIdentifier(payload.identifier)
      if (!identifier) {
        yield* sessions.failAttempt(resolved, { reason: 'identity-not-found' })
        return yield* fail()
      }
      const identity = yield* sessions.findIdentity({
        tenantId: resolved.tenantId,
        providerId: resolved.providerId,
        identifier,
      })
      if (!identity?.credentialHash) {
        yield* sessions.failAttempt(resolved, { reason: 'identity-not-found' })
        return yield* fail()
      }
      const verified = yield* Effect.promise(() =>
        verifyPassword(identity.credentialHash!, payload.password),
      )
      if (!verified) {
        // resolved this far, so the record can say who it was about; the
        // caller still hears the same refusal as every other path
        yield* sessions.failAttempt(resolved, {
          reason: 'invalid-credentials',
          userId: identity.userId,
          identityId: identity.id,
        })
        return yield* new InvalidCredentials()
      }
      const user = yield* sessions.completeLogin({
        tenantId: resolved.tenantId,
        providerId: resolved.providerId,
        userId: identity.userId,
        identityId: identity.id,
      })
      // an unusable account was recorded by the core, with the precise reason
      if (!user) return yield* new InvalidCredentials()
      return { user }
    }),
  ),
)

const plugin = Plugin.define(
  '@qualy/plugin-auth-local',
  { dependsOn: ['@qualy/plugin-auth'] },
  Ui.i18n('./client/i18n'),
  Login.driver(driver),
  Api.group(authLocalApiGroup, handlers),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// the single group from it, and a value export costs nothing
export const apiHandlers = handlers
