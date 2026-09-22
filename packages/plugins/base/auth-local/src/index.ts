import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { LoginDriver } from '@qualy/auth-contract/login'
import { Login } from '@qualy/auth-contract/plugin'
import { normalizeEmail } from '@qualy/auth-contract/email'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { LoginSessions } from '@qualy/auth-contract/login'
import { authLocalApiGroup, InvalidCredentials } from './api.ts'
import { message } from '@qualy/i18n-contract'
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  timingEqualizerHash,
  verifyPassword,
} from './password.ts'

// Email and password: find the person by their own email, prove them against
// the credential bound to this door, then hand the proof to the core for
// session creation.
//
// Every failure between resolving the door and verifying the password
// answers the same INVALID_CREDENTIALS, and every miss still burns one argon2
// verification, so neither the answer nor its timing reveals whether an
// account exists.

/** the password door: one per tenant, provisioned by the platform */
export const driver: LoginDriver = {
  type: 'local',
  presentation: { mode: 'component', component: Ui.react('./client/LoginMethod') },
  provisioning: { mode: 'system-singleton', code: 'local' },
  // the address a person signs in with is theirs, kept on the person: the
  // door stores no second copy of it
  resolution: { mode: 'user-field', field: 'email' },
  // whoever administers the person may set their password; what a password
  // is and how it is kept stays here, and the core is handed a digest
  binding: {
    mode: 'managed',
    secret: {
      label: message('auth-local/binding/password', 'Password'),
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
    },
    prepare: Effect.fn('authLocal.binding.prepare')(function* ({ secret }) {
      if (secret.length < PASSWORD_MIN_LENGTH || secret.length > PASSWORD_MAX_LENGTH) {
        return { ok: false as const }
      }
      return { ok: true as const, credentialHash: yield* Effect.promise(() => hashPassword(secret)) }
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
      const email = normalizeEmail(payload.email)
      const person =
        email === null
          ? undefined
          : yield* sessions.findUserByField({
              tenantId: resolved.tenantId,
              providerId: resolved.providerId,
              field: 'email',
              value: email,
            })
      if (!person) {
        yield* sessions.failAttempt(resolved, { reason: 'user-not-found' })
        return yield* fail()
      }
      const binding = yield* sessions.findBindingForUser({
        tenantId: resolved.tenantId,
        providerId: resolved.providerId,
        userId: person.userId,
      })
      if (!binding?.credentialHash) {
        // resolved as far as the person: the record may say whom it was about
        yield* sessions.failAttempt(resolved, { reason: 'binding-not-found', userId: person.userId })
        return yield* fail()
      }
      const verified = yield* Effect.promise(() =>
        verifyPassword(binding.credentialHash!, payload.password),
      )
      if (!verified) {
        yield* sessions.failAttempt(resolved, {
          reason: 'invalid-credentials',
          userId: person.userId,
          bindingId: binding.id,
        })
        return yield* new InvalidCredentials()
      }
      const user = yield* sessions.completeLogin({
        tenantId: resolved.tenantId,
        providerId: resolved.providerId,
        userId: person.userId,
        bindingId: binding.id,
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
