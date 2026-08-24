import { defineEntity } from '@mikro-orm/core'
import { Effect, Layer, Metric, Option, Tracer } from 'effect'
import { describe, expect, it } from 'vitest'
import { entityManager, kyselyOf, query, transaction } from '../src/server/index.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// The database boundary in a trace.
//
// pg auto-instrumentation is deliberately not installed (it would bring the
// @opentelemetry SDK family and an ESM loader hook this process does not
// run), so these spans are the entire database story a trace tells: a query
// wears `db.query`, a real transaction wears `db.transaction` around
// everything it commits, and a body that merely joins an open transaction
// adds no second one. The recording tracer below is the upstream-documented
// test pattern - what it captures is exactly what an exporter would see.

const p = defineEntity.properties

const Tenant = defineEntity({
  name: 'Tenant',
  tableName: 'tenants',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    slug: p.string().length(63),
    name: p.string().length(255),
    enabled: p.boolean(),
  },
})

const entities = [Tenant] as const

const recorder = () => {
  const spans: Tracer.NativeSpan[] = []
  const layer = Layer.succeed(
    Tracer.Tracer,
    Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options)
        spans.push(span)
        return span
      },
    }),
  )
  return { spans, layer }
}

const selectSlugs = Effect.gen(function* () {
  const em = yield* entityManager<typeof entities>()
  return yield* query(() => kyselyOf(em).selectFrom('Tenant').select(['slug']).execute())
})

const parentNameOf = (span: Tracer.NativeSpan): string | undefined => {
  const parent = Option.getOrUndefined(span.parent)
  return parent !== undefined && parent._tag === 'Span' ? parent.name : undefined
}

describe.runIf(postgresAvailable)('the database boundary in a trace', () => {
  it('wears db.query with the postgres attribute, under the caller span', async () => {
    const db = await createTestContext('trace-query')
    try {
      const { spans, layer } = recorder()
      await Effect.runPromise(
        selectSlugs.pipe(
          Effect.withSpan('caller-operation'),
          Effect.provide(Layer.mergeAll(databaseFor(db.url, { entities }), layer)),
        ),
      )
      const boundary = spans.filter((span) => span.name === 'db.query')
      expect(boundary).toHaveLength(1)
      expect(boundary[0]!.attributes.get('db.system.name')).toBe('postgresql')
      expect(boundary[0]!.kind).toBe('client')
      expect(parentNameOf(boundary[0]!)).toBe('caller-operation')
      // the stable-semconv duration is recorded at the same funnel
      const durations = (await Effect.runPromise(Metric.snapshot)).filter(
        (state) => state.id === 'db.client.operation.duration',
      )
      expect(durations.length).toBeGreaterThan(0)
      expect(durations[0]!.attributes?.['db.system.name']).toBe('postgresql')
    } finally {
      await db.dispose()
    }
  })

  it('wraps a real transaction once, queries inside it as children', async () => {
    const db = await createTestContext('trace-transaction')
    try {
      const { spans, layer } = recorder()
      await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            yield* selectSlugs
            // a nested call joins the open transaction: JOIN-EXISTING must
            // survive tracing, and joining is not opening - no second span
            yield* transaction(selectSlugs)
          }),
        ).pipe(
          Effect.withSpan('write-operation'),
          Effect.provide(Layer.mergeAll(databaseFor(db.url, { entities }), layer)),
        ),
      )
      const transactions = spans.filter((span) => span.name === 'db.transaction')
      expect(transactions).toHaveLength(1)
      expect(transactions[0]!.attributes.get('db.system.name')).toBe('postgresql')
      expect(parentNameOf(transactions[0]!)).toBe('write-operation')
      const queries = spans.filter((span) => span.name === 'db.query')
      expect(queries).toHaveLength(2)
      for (const inner of queries) {
        expect(parentNameOf(inner)).toBe('db.transaction')
      }
    } finally {
      await db.dispose()
    }
  })
})
