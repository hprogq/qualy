import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import type { LoginDriver } from '@qualy/auth-contract/login'
import { Login } from '@qualy/auth-contract/plugin'
import { normalizeEmail } from '@qualy/auth-contract/email'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { LoginSessions } from '@qualy/auth-contract/login'
import { CaptchaRequired } from '@qualy/plugin-captcha/contract'
import { authLocalApiGroup, InvalidCredentials } from './api.ts'
import { message } from '@qualy/i18n-contract'
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  timingEqualizerHash,
  verifyPassword,
} from './password.ts'
import { acceptable, assessPassword } from './strength.ts'
import { TooManyAttempts } from '@qualy/auth-contract/session'

/** how long a sign-in turned away for want of a seat is told to wait */
const SEATS_BUSY_RETRY_SECONDS = 2

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
  icon: 'mail',
  presentation: { mode: 'component', component: Ui.react('./client/LoginMethod') },
  provisioning: {
    mode: 'system-singleton',
    code: 'local',
    label: message('auth-local/entrance/kind', 'Email and password'),
  },
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
    prepare: Effect.fn('authLocal.binding.prepare')(function* ({ secret, subject }) {
      const checks = yield* Effect.sync(() => assessPassword(secret, subject))
      if (!acceptable(checks)) return { ok: false as const, checks }
      return {
        ok: true as const,
        credentialHash: yield* Effect.promise((signal) => hashPassword(secret, { signal })),
      }
    }),
    assess: ({ secret, subject }) => Effect.sync(() => assessPassword(secret, subject)),
    verify: ({ secret, credentialHash }) =>
      Effect.promise((signal) => verifyPassword(credentialHash, secret, { signal })),
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
      // A check waits for one of the few seats hashing has, and is turned
      // away when too many already wait - whether or not it is about anybody,
      // so the refusal says nothing about the account. A caller that leaves
      // gives its place up.
      const check = (hash: string) =>
        Effect.tryPromise({
          try: (signal) => verifyPassword(hash, payload.password, { signal, bounded: true }),
          catch: () => new TooManyAttempts({ retryAfterSeconds: SEATS_BUSY_RETRY_SECONDS }),
        })
      // the equalizing hash is verified on every path that would otherwise
      // return early, so a miss costs what a hit costs
      const fail = Effect.fn('authLocal.login.fail')(function* () {
        yield* check(timingEqualizerHash)
        return yield* new InvalidCredentials()
      })

      const resolved = yield* sessions.resolveProvider({
        providerCode: params.providerCode,
        expectedType: 'local',
      })
      // no resolved door, no record: a URL that names no provider is not an
      // attempt on anybody's account. Nor a hash - which doors exist is on
      // the sign-in page for anybody to read, so there is no timing to hide,
      // and hashing for a door that is not there would be work anybody could
      // ask for without limit.
      if (!resolved) return yield* new InvalidCredentials()
      const email = normalizeEmail(payload.email)
      // what was typed is the key, whoever it belongs to: an address that is
      // not one is weighed exactly like one nobody has
      const identifier = email ?? payload.email.trim().toLowerCase()
      // counted before anything is looked up or hashed
      const admitted = yield* sessions.admitAttempt({
        provider: resolved,
        identifier,
        ...(payload.captcha === undefined ? {} : { captcha: payload.captcha }),
      })
      if (admitted.kind === 'challenge') {
        // nothing was judged, so nothing is recorded and nothing hashed: the
        // same request comes back with a proof, and is judged then
        return yield* new CaptchaRequired({
          provider: admitted.prompt.provider,
          challenge: { ...admitted.prompt.challenge },
        })
      }
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
        yield* sessions.failAttempt(resolved, {
          reason: 'binding-not-found',
          userId: person.userId,
        })
        return yield* fail()
      }
      const verified = yield* check(binding.credentialHash)
      if (!verified) {
        yield* sessions.failAttempt(resolved, {
          reason: 'invalid-credentials',
          userId: person.userId,
          bindingId: binding.id,
        })
        return yield* new InvalidCredentials()
      }
      // proven: the risk weighed at this address is forgotten now, before the
      // account's own state is asked about - a disabled account refused next
      // was still opened by the right password, not attacked
      yield* sessions.clearIdentifierRisk({ provider: resolved, identifier })
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
  // the captcha contract is read here directly, so it is named here too
  { dependsOn: ['@qualy/plugin-auth', '@qualy/plugin-captcha'] },
  Ui.i18n('./client/i18n'),
  Login.driver(driver),
  Api.group(authLocalApiGroup, handlers),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// the single group from it, and a value export costs nothing
export const apiHandlers = handlers
