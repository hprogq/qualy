import { Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { db } from './db.ts'
import { entranceSecrets, unreadableSecretsOf } from './readiness.ts'

// Entrance secrets that no longer open, found before serving.
//
// A secret that does not decrypt keeps its door out of service - readiness
// says so, the sign-in page leaves the door out, its settings screen asks for
// the secret again - and the rest of the deployment serves: refusing to start
// would take away the password door somebody needs to fix it. What start
// adds is the one thing no single door can see: when most of them fail at
// once, the likelier story is the master key, not the secrets.

/** unreadable secrets past which the key itself is the likelier suspect */
const MANY = 3

export interface UnreadableSecret {
  readonly tenantSlug: string
  readonly providerCode: string
  readonly key: string
}

export interface SecretHealth {
  /** entrance secrets stored, across every tenant */
  readonly stored: number
  readonly unreadable: readonly UnreadableSecret[]
}

/** the doors of the kinds that keep secrets, across every tenant */
const secretKeepingDoors = (types: readonly string[]) =>
  types.length === 0
    ? Effect.succeed([])
    : db.query((k) =>
        k
          .selectFrom('AuthProvider as p')
          .innerJoin('Tenant as t', 't.id', 'p.tenantId')
          .select(['p.id', 'p.tenantId', 'p.code', 't.slug'])
          .where('p.deletedAt', 'is', null)
          .where('p.type', 'in', [...types])
          .orderBy('t.slug')
          .orderBy('p.code')
          .execute(),
      )

/** every stored entrance secret, opened once to see whether it still does */
export const entranceSecretHealth = Effect.gen(function* () {
  const drivers = yield* LoginDrivers
  const secrets = yield* Secrets
  const types = (yield* drivers.all).flatMap(({ driver }) =>
    driver.provisioning.mode === 'tenant-managed' &&
    driver.provisioning.entrance.fields.some((field) => field.kind === 'secret')
      ? [driver.type]
      : [],
  )
  let stored = 0
  const unreadable: UnreadableSecret[] = []
  for (const door of yield* secretKeepingDoors(types).pipe(Effect.orDie)) {
    const owner = entranceSecrets(door.tenantId, door.id)
    const keys = yield* secrets.keysOf(owner)
    stored += keys.length
    for (const key of yield* unreadableSecretsOf(secrets, owner, keys)) {
      unreadable.push({ tenantSlug: door.slug, providerCode: door.code, key })
    }
  }
  return { stored, unreadable } satisfies SecretHealth
})

/** what start says about it: each door, and the key when that is the likelier story */
export const reportSecretHealth = Effect.fn('Auth.reportSecretHealth')(function* (
  health: SecretHealth,
) {
  if (health.unreadable.length === 0) return
  for (const one of health.unreadable) {
    yield* Effect.logWarning(
      `entrance ${one.tenantSlug}/${one.providerCode} holds a ${one.key} that does not decrypt; ` +
        'it is out of service until the secret is entered again',
    )
  }
  if (health.unreadable.length === health.stored || health.unreadable.length >= MANY) {
    yield* Effect.logError(
      `${String(health.unreadable.length)} of ${String(health.stored)} stored entrance secrets ` +
        'do not decrypt: QUALY_SECRETS_MASTER_KEY is probably not the key they were written with; ' +
        'restore that key, or enter each secret again',
    )
  }
})

/** checked once, before the port binds; never refuses to start */
export const secretHealthBootCheck: Layer.Layer<
  never,
  never,
  Orm | LoginDrivers | Secrets | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const drivers = yield* LoginDrivers
    const secrets = yield* Secrets
    const withDb = yield* withDatabase
    yield* assembled.register({
      name: 'auth/entrance-secrets',
      run: withDb(Effect.flatMap(entranceSecretHealth, reportSecretHealth)).pipe(
        Effect.provideService(LoginDrivers, drivers),
        Effect.provideService(Secrets, secrets),
        // a check that could not be made is said, and start goes on: this
        // one only ever reports
        Effect.ignoreCause({ log: 'Warn', message: 'entrance secrets could not be checked' }),
      ),
    })
  }),
)
