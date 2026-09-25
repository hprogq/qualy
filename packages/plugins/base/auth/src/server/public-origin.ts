import { Context, Data, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { LoginDrivers, PublicOriginUnavailable } from '@qualy/auth-contract/login'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { AuthConfig } from './auth-config.ts'
import { db } from './db.ts'
import type { AnonymousTenant } from './tenancy.ts'

// The address the outside world reaches this deployment at.
//
// An entrance that sends somebody to a school's login server has to tell it
// where to send them back, and that address is not something the application
// can work out from the request: behind a proxy the request says whatever the
// proxy says, and a callback built from it is a callback an attacker can
// point elsewhere. So it is configuration - QUALY_PUBLIC_URL - and a
// deployment that has not set one cannot put an entrance of that kind into
// service.
//
// A resolver rather than a string for the same reason tenancy is one: the day
// tenants are told apart by their host, each has its own address, and only
// this module changes.

export class PublicOriginResolver extends Context.Service<
  PublicOriginResolver,
  {
    readonly resolve: (
      tenant: Pick<AnonymousTenant, 'id' | 'slug'>,
    ) => Effect.Effect<URL, PublicOriginUnavailable>
    /** whether an address exists at all, which is what readiness asks */
    readonly configured: boolean
  }
>()('@qualy/plugin-auth/PublicOriginResolver') {}

/** one deployment, one address, from QUALY_PUBLIC_URL */
export const singleOriginLayer: Layer.Layer<PublicOriginResolver, never, AuthConfig> = Layer.effect(
  PublicOriginResolver,
  Effect.gen(function* () {
    const config = yield* AuthConfig
    const origin = config.publicUrl
    return PublicOriginResolver.of({
      configured: origin !== undefined,
      resolve: (tenant) =>
        origin === undefined
          ? Effect.fail(new PublicOriginUnavailable({ tenantSlug: tenant.slug }))
          : Effect.succeed(new URL(origin)),
    })
  }),
)

/** the entrances in service whose kind has to send somebody back here */
const callbackEntrances = (types: readonly string[]) =>
  types.length === 0
    ? Effect.succeed([])
    : db.query((k) =>
        k
          .selectFrom('AuthProvider as p')
          .innerJoin('Tenant as t', 't.id', 'p.tenantId')
          .select(['p.code', 't.slug'])
          .where('p.enabled', '=', true)
          .where('p.deletedAt', 'is', null)
          .where('p.type', 'in', [...types])
          .orderBy('t.slug')
          .orderBy('p.code')
          .execute(),
      )

/**
 * Checked once, before the port binds.
 *
 * An entrance of a kind that redirects is in service and this deployment has
 * no address to be redirected back to: every sign-in through it would fail at
 * the last step, one visitor at a time. Production refuses to start and names
 * the entrances; development warns. The links mail carries are written with
 * the same address, so a deployment without one is told at start that its
 * reset, confirmation and address-change mail cannot go out.
 */
export class CallbackOriginMissing extends Data.TaggedError('CallbackOriginMissing')<{
  readonly message: string
}> {}

export const publicOriginBootCheck: Layer.Layer<
  never,
  never,
  Orm | AuthConfig | LoginDrivers | PublicOriginResolver | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const config = yield* AuthConfig
    const drivers = yield* LoginDrivers
    const origin = yield* PublicOriginResolver
    const withDb = yield* withDatabase
    yield* assembled.register({
      name: 'auth/public-origin',
      run: withDb(
        Effect.gen(function* () {
          if (origin.configured) return
          yield* Effect.logWarning(
            'QUALY_PUBLIC_URL is not set: password reset, address confirmation and ' +
              'address change mail cannot be sent',
          )
          const types = (yield* drivers.all)
            .filter(({ driver }) => driver.callback !== undefined)
            .map(({ driver }) => driver.type)
          const serving = yield* callbackEntrances(types).pipe(Effect.orDie)
          if (serving.length === 0) return
          const said =
            `QUALY_PUBLIC_URL is not set, and ${serving
              .map((row) => `${row.slug}/${row.code}`)
              .join(', ')} sends people away and expects them back: ` +
            'set the address this deployment is reached at, or take those entrances out of service'
          if (config.strictBoot === true) {
            return yield* Effect.fail(new CallbackOriginMissing({ message: said }))
          }
          yield* Effect.logWarning(said)
        }),
      ),
    })
  }),
)
