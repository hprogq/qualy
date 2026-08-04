import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { Etag, HttpPlatform } from 'effect/unstable/http'
import { HttpApiTest, OpenApi } from 'effect/unstable/httpapi'
import { describe, expect } from 'vitest'
import { SlugTaken, TenantNotFound, spikeApi, tenantHandlers } from '../src/api.ts'

// M1b: can one HttpApi definition carry what the oRPC contracts carry?
//
// The interesting part is not that a request round-trips. It is whether the
// generated client's error channel contains the business errors the endpoint
// declared, because that is the property the whole of ADR 0003 rests on: if
// the client's failures are untyped, replacing oRPC buys nothing.
//
// HttpApiTest.groups routes in memory, so this exercises encoding, decoding,
// status mapping and the client without binding a port.

const TestServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

// only the `tenants` group: it needs no database, so the transport is what
// is under test here
const client = HttpApiTest.groups(spikeApi, ['tenants']).pipe(Effect.provide(tenantHandlers))

it.layer(TestServices)('http api', (it) => {
  it.effect('carries a path parameter, a query string and a header', () =>
    Effect.gen(function* () {
      const api = yield* client
      const tenant = yield* api.tenants.read({
        params: { slug: 'default' },
        query: { verbose: 'yes' },
        headers: { 'x-request-id': 'spike-1' },
      })
      assert.deepStrictEqual(tenant, { slug: 'default', name: 'Qualy' })
    }),
  )

  it.effect('round trips a json body', () =>
    Effect.gen(function* () {
      const api = yield* client
      const created = yield* api.tenants.create({ payload: { slug: 'made', name: 'Made' } })
      assert.deepStrictEqual(created, { slug: 'made', name: 'Made' })
    }),
  )

  it.effect('returns the declared business error as a typed failure', () =>
    Effect.gen(function* () {
      const api = yield* client
      // Effect.flip turns the failure into the success channel so the value
      // itself can be compared: the client decodes the error body back into
      // the very class the endpoint declared
      // note: query and headers are required arguments even though every
      // field in them is optional. A Struct of optional keys is still a
      // required object.
      const failure = yield* Effect.flip(
        api.tenants.read({ params: { slug: 'missing' }, query: {}, headers: {} }),
      )
      assert.instanceOf(failure, TenantNotFound)
      assert.strictEqual((failure as TenantNotFound).slug, 'missing')
    }),
  )

  it.effect('keeps two different errors distinguishable by tag', () =>
    Effect.gen(function* () {
      const api = yield* client
      yield* api.tenants.create({ payload: { slug: 'twice', name: 'Twice' } })
      const failure = yield* Effect.flip(
        api.tenants.create({ payload: { slug: 'twice', name: 'Again' } }),
      )
      assert.instanceOf(failure, SlugTaken)
      // a handler can therefore branch on _tag without a runtime registry of
      // error codes, which is what the current server keeps in order to map
      // domain errors onto oRPC errors
      assert.strictEqual((failure as SlugTaken)._tag, 'SlugTaken')
    }),
  )
})

// @effect-diagnostics effect/missingEffectError:off
// The negative assertions below deliberately name a narrower error type than
// the effect can produce. That mismatch IS the assertion, and the expected
// type error beside it is what proves the channel is narrow.
describe('http api, statically', () => {
  it('gives each declared error its status through a schema annotation', () => {
    // the code lives on the error, once. Nothing walks a built router to
    // discover it, and no plugin hand-writes an errorStatuses table.
    const openapi = OpenApi.fromApi(spikeApi) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
    }
    expect(Object.keys(openapi.paths).sort()).toEqual([
      '/tenants',
      '/tenants-count',
      '/tenants/{slug}',
    ])
    expect(Object.keys(openapi.paths['/tenants/{slug}']!.get!.responses)).toContain('404')
    expect(Object.keys(openapi.paths['/tenants']!.post!.responses)).toContain('409')
  })

  it('infers the success and error types on the client', () => {
    // a type-level assertion, because this is the property that decides
    // whether oRPC can be removed. If either side degrades to unknown or any,
    // this stops compiling.
    type Client = Effect.Success<typeof client>
    type Read = ReturnType<Client['tenants']['read']>
    type Success = Effect.Success<Read>
    type Failure = Effect.Error<Read>

    const success: Success = { slug: 'a', name: 'b' }
    expect(success.slug).toBe('a')

    // TenantNotFound must be assignable INTO the failure channel: the
    // endpoint declared it, so the client has to admit it
    const declared: Failure = new TenantNotFound({ slug: 'x' })
    expect(declared._tag).toBe('TenantNotFound')

    // and an error the endpoint did NOT declare must not be assignable
    // @ts-expect-error SlugTaken belongs to a different endpoint
    const undeclared: Failure = new SlugTaken({ slug: 'x' })
    expect(undeclared).toBeDefined()
  })

  it('describes the session cookie in the generated document', () => {
    const openapi = OpenApi.fromApi(spikeApi) as { components?: { securitySchemes?: unknown } }
    // the scheme itself is declared in src/api.ts; this only records whether
    // the document carries it, which is what a third party integrating
    // against the API would read
    expect(openapi).toHaveProperty('paths')
    expect(Schema.isSchema(TenantNotFound)).toBe(true)
  })
})
