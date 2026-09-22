import { Data, Effect, Layer } from 'effect'
import { sql } from 'kysely'
import { Assembled } from '@qualy/api-kit/assembled'
import { LoginDrivers, type LoginDriver } from '@qualy/auth-contract/login'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../constants.ts'
import { AuthConfig } from './auth-config.ts'
import { db } from './db.ts'

// How a tenant gets back in when every other way has failed.
//
// Every tenant has a system account, provisioned with the tenant, and it
// always keeps one working way in of its own: the platform's password door,
// with an email to sign in by and a password bound to it. Ordinary provider
// administration may reshape every other door, but not so that this one
// closes - that is the whole of the rule, and it is asked of the state being
// committed, after the write.
//
// "At least one administrator exists" is a separate question, rbac's, and it
// does not try to answer "and they can sign in": whether a door lets somebody
// in depends on the door's driver (a password, an external account, a
// business number), which only this plugin knows about.

/**
 * The kinds of door a recovery account signs in through: provisioned by the
 * platform, finding people by their email, with a credential an
 * administrator may set.
 */
export const recoveryDoorTypes = (drivers: readonly { driver: LoginDriver }[]): string[] =>
  drivers.flatMap(({ driver }) =>
    driver.provisioning.mode === 'system-singleton' &&
    driver.resolution.mode === 'user-field' &&
    driver.resolution.field === 'email' &&
    driver.binding?.mode === 'managed'
      ? [driver.type]
      : [],
  )

/**
 * Whether the tenant's system account can sign in through its own door right
 * now: an enabled account of the enabled system type, with an email, bound
 * by a live credential to a platform door of a kind this assembly serves,
 * which is in service and admits the system type.
 */
export const recoveryChannelIntact = (tenantId: string, doorTypes: readonly string[]) =>
  db
    .query((k) =>
      doorTypes.length === 0
        ? Promise.resolve(undefined)
        : k
            .selectFrom('User as u')
            .innerJoin('UserType as t', (join) =>
              join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
            )
            .select('u.id')
            .where('u.tenantId', '=', tenantId)
            .where('t.code', '=', SYSTEM_ACCOUNT_USER_TYPE)
            .where('t.isSystem', '=', true)
            .where('t.enabled', '=', true)
            .where('u.enabled', '=', true)
            .where('u.deletedAt', 'is', null)
            .where('u.email', 'is not', null)
            .where((eb) =>
              eb.exists(
                eb
                  .selectFrom('UserAuthBinding as b')
                  .innerJoin('AuthProvider as p', (join) =>
                    join
                      .onRef('p.tenantId', '=', 'b.tenantId')
                      .onRef('p.id', '=', 'b.authProviderId'),
                  )
                  .select('b.id')
                  .whereRef('b.tenantId', '=', 'u.tenantId')
                  .whereRef('b.userId', '=', 'u.id')
                  .where('b.revokedAt', 'is', null)
                  .where('b.credentialHash', 'is not', null)
                  .where('p.isSystem', '=', true)
                  .where('p.enabled', '=', true)
                  .where('p.type', 'in', [...doorTypes])
                  .where((inner) =>
                    inner.or([
                      inner('p.audienceMode', '=', 'unrestricted'),
                      inner.exists(
                        inner
                          .selectFrom('AuthProviderUserType as a')
                          .select('a.id')
                          .whereRef('a.tenantId', '=', 'p.tenantId')
                          .whereRef('a.authProviderId', '=', 'p.id')
                          .whereRef('a.userTypeId', '=', 't.id'),
                      ),
                    ]),
                  ),
              ),
            )
            .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** a tenant whose recovery account cannot sign in, found before serving */
export class TenantsUnrecoverable extends Data.TaggedError('TenantsUnrecoverable')<{
  readonly message: string
}> {}

/** the tenants anybody can currently sign in to */
const liveTenants = db.query((k) =>
  k
    .selectFrom('Tenant')
    .select(['id', 'slug'])
    .where('enabled', '=', true)
    .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', sql<Date>`now()`)]))
    .orderBy('slug')
    .execute(),
)

/**
 * Checked once, before the port binds.
 *
 * A recovery account without an address (an upgraded database whose seed has
 * not run yet) or without a password leaves a tenant nobody can recover. The
 * order a deployment follows is migrate, then seed, then start; a production
 * process that finds the seed step skipped refuses to start and says which
 * tenant and what to run. Development warns and serves.
 */
export const recoveryBootCheck: Layer.Layer<
  never,
  never,
  Orm | AuthConfig | LoginDrivers | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const config = yield* AuthConfig
    const drivers = yield* LoginDrivers
    const withDb = yield* withDatabase
    yield* assembled.register({
      name: 'auth/recovery-channel',
      run: withDb(
        Effect.gen(function* () {
          const doorTypes = recoveryDoorTypes(yield* drivers.all)
          const stranded: string[] = []
          for (const tenant of yield* liveTenants.pipe(Effect.orDie)) {
            const intact = yield* recoveryChannelIntact(tenant.id, doorTypes).pipe(Effect.orDie)
            if (!intact) stranded.push(tenant.slug)
          }
          if (stranded.length === 0) return
          const said =
            `tenant ${stranded.join(', ')} cannot be recovered: its system account has no email, ` +
            'no password at the password door, or the door is out of service; ' +
            'set QUALY_ADMIN_EMAIL and QUALY_ADMIN_PASSWORD and run `pnpm seed`'
          if (config.strictBoot === true) {
            return yield* Effect.fail(new TenantsUnrecoverable({ message: said }))
          }
          yield* Effect.logWarning(said)
        }),
      ),
    })
  }),
)
