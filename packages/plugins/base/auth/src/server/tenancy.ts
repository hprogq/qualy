import { Context, Data, Effect, Layer } from 'effect'
import { sql } from 'kysely'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { AuthConfig } from './auth-config.ts'
import { db } from './db.ts'

// Which tenant a visitor who has not signed in belongs to.
//
// Everything anonymous needs an answer to this: which entrances the sign-in
// page lists, which row a provider code names, whose account a proof is
// about. It is one question with one answer today - the deployment's single
// tenant - and it is a service rather than a lookup inside sign-in so the
// answer can come from somewhere else later without the drivers or the
// sign-in service learning about tenancy at all.
//
// The later implementation reads the host the request arrived on, from the
// request context the http layer already resolves, and never the raw header:
// a Host somebody sends is not evidence of anything until the proxy tier has
// been accounted for, which is where that resolution lives.

export interface AnonymousTenant {
  readonly id: string
  readonly slug: string
  readonly name: string
}

/** nobody can sign in here: no such tenant, or one that has lapsed */
export class TenantUnavailable extends Data.TaggedError('TenantUnavailable')<{
  readonly slug: string
}> {}

export class AnonymousTenantResolver extends Context.Service<
  AnonymousTenantResolver,
  { readonly resolve: Effect.Effect<AnonymousTenant, TenantUnavailable> }
>()('@qualy/plugin-auth/AnonymousTenantResolver') {}

/**
 * The tenant a sign-in screen belongs to, and whether it is one at all.
 *
 * A lapsed tenant is not a tenant one may sign in to, so the liveness test
 * travels with the lookup rather than being a second thing to remember.
 */
const activeTenantBySlug = (slug: string) =>
  db.query((k) =>
    k
      .selectFrom('Tenant')
      .select(['id', 'slug', 'name'])
      .where('slug', '=', slug)
      .where('enabled', '=', true)
      .where((eb) => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', sql<Date>`now()`)]))
      .executeTakeFirst(),
  )

/** one deployment, one tenant, named by QUALY_DEFAULT_TENANT */
export const singleTenantLayer: Layer.Layer<AnonymousTenantResolver, never, Orm | AuthConfig> =
  Layer.effect(
    AnonymousTenantResolver,
    Effect.gen(function* () {
      const config = yield* AuthConfig
      const withDb = yield* withDatabase
      const slug = config.defaultTenantSlug
      return AnonymousTenantResolver.of({
        resolve: withDb(activeTenantBySlug(slug)).pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row === undefined ? Effect.fail(new TenantUnavailable({ slug })) : Effect.succeed(row),
          ),
        ),
      })
    }),
  )
