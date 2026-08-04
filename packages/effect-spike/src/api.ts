import { sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSecurity,
} from 'effect/unstable/httpapi'
import { tenants as tenantTable } from '@qualy/plugin-org/schema'
import { Database } from './index.ts'

// M1b spike. The question is not "can Effect serve HTTP" but whether one
// HttpApi definition can carry what this project's oRPC contracts carry
// today: a path parameter, a query string, a header, a JSON body, a session
// read from an HttpOnly cookie, and business errors whose status codes are
// declared rather than mapped by a runtime boundary.

/** the shape of a tenant as the API exposes it */
export const TenantView = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
})

// Status is a schema annotation, read by the HttpApi layer. This is what
// replaces defineDomainErrors + errorStatuses + walkProcedureContractsSync:
// the code lives on the error, once, and the transport reads it.
export class TenantNotFound extends Schema.TaggedErrorClass<TenantNotFound>()(
  'TenantNotFound',
  { slug: Schema.String },
  { httpApiStatus: 404 },
) {}

export class SlugTaken extends Schema.TaggedErrorClass<SlugTaken>()(
  'SlugTaken',
  { slug: Schema.String },
  { httpApiStatus: 409 },
) {}

/** the session cookie this project already uses, declared as a security scheme */
export const sessionCookie = HttpApiSecurity.apiKey({ in: 'cookie', key: 'qualy_session' })

// Two groups, because they need different things. `tenants` is pure transport
// and can be exercised with no database at all; `system` reads one, and that
// requirement shows up in its handler's type rather than in a comment.
export const spikeApi = HttpApi.make('spike')
  .add(
    HttpApiGroup.make('tenants')
      .add(
        HttpApiEndpoint.get('read', '/tenants/:slug', {
          params: Schema.Struct({ slug: Schema.String }),
          query: Schema.Struct({ verbose: Schema.optional(Schema.String) }),
          headers: Schema.Struct({ 'x-request-id': Schema.optional(Schema.String) }),
          success: TenantView,
          error: TenantNotFound,
        }),
      )
      .add(
        HttpApiEndpoint.post('create', '/tenants', {
          payload: Schema.Struct({ slug: Schema.String, name: Schema.String }),
          success: TenantView,
          error: SlugTaken,
        }),
      ),
  )
  .add(
    HttpApiGroup.make('system').add(
      HttpApiEndpoint.get('count', '/tenants-count', {
        success: Schema.Struct({ tenants: Schema.Number }),
      }),
    ),
  )

/** an in-memory store, so the transport is what is under test and not the database */
const store = new Map<string, { slug: string; name: string }>([
  ['default', { slug: 'default', name: 'Qualy' }],
])

export const tenantHandlers = HttpApiBuilder.group(spikeApi, 'tenants', (handlers) =>
  handlers
    .handle('read', ({ params }) =>
      Effect.gen(function* () {
        const found = store.get(params.slug)
        // the handler returns the domain failure directly; nothing catches
        // and rethrows it as a transport error
        if (!found) return yield* new TenantNotFound({ slug: params.slug })
        return found
      }),
    )
    .handle('create', ({ payload }) =>
      Effect.gen(function* () {
        if (store.has(payload.slug)) return yield* new SlugTaken({ slug: payload.slug })
        store.set(payload.slug, payload)
        return payload
      }),
    ),
)

export const systemHandlers = HttpApiBuilder.group(spikeApi, 'system', (handlers) =>
  handlers.handle('count', () =>
    Effect.gen(function* () {
      const drizzle = yield* Database
      const rows = yield* drizzle.select({ count: sql<number>`count(*)::int` }).from(tenantTable)
      return { tenants: rows[0]?.count ?? 0 }
    }).pipe(
      // The endpoint declares no error, so this does not compile until the
      // database failure is dealt with. A query that fails for a reason the
      // API never promised is infrastructure, not a business outcome, so it
      // becomes a defect and the request becomes a 500 rather than being
      // dressed up as a result. Under oRPC the same failure was an untyped
      // throw that happened to reach the same place, with nothing in the type
      // to say so.
      Effect.orDie,
    ),
  ),
)
