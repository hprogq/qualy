import { createServer, type Server } from 'node:http'
import { defineEntity } from '@mikro-orm/core'
import { sql } from 'kysely'
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Metric,
  Option,
  References,
  Tracer,
} from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { telemetryLayer } from '@qualy/telemetry'
import { entityManager, kyselyOf, query, transaction, type Orm } from '../src/server/index.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// The database in a trace.
//
// Every statement the server is sent is a client span of its own, carrying
// the statement's template and its timing, under the operation that ran it:
// `db.query` for a query callback, `db.transaction` for the transaction
// control around a real transaction. Those two are internal spans now - the
// grouping, not a second count of the same database calls. The recording
// tracer below is the upstream-documented test pattern; the export case at
// the end runs the real OTLP exporter into a local receiver, because what
// may not leave the process is decided on the wire, not in a span object.

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

const parentOf = (span: Tracer.NativeSpan): Tracer.NativeSpan | undefined => {
  const parent = Option.getOrUndefined(span.parent)
  return parent !== undefined && parent._tag === 'Span' ? (parent as Tracer.NativeSpan) : undefined
}

const statementsOf = (spans: readonly Tracer.NativeSpan[]) =>
  spans.filter((span) => span.kind === 'client')

const ended = (span: Tracer.NativeSpan) => {
  if (span.status._tag !== 'Ended') throw new Error(`${span.name} never ended`)
  return span.status
}

/** two statements in one callback: the shape a page of the review queue has */
const slugsAndCount = Effect.gen(function* () {
  const em = yield* entityManager<typeof entities>()
  return yield* query(async () => {
    const k = kyselyOf(em)
    const slugs = await k
      .selectFrom('Tenant')
      .select(['slug'])
      .where('slug', '=', 'nobody')
      .execute()
    const counted = await k
      .selectFrom('Tenant')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow()
    return { slugs, count: Number(counted.n) }
  })
})

const durationCount = async () =>
  (await Effect.runPromise(Metric.snapshot))
    .filter(
      (state) =>
        state.id === 'db.client.operation.duration' &&
        state.attributes?.['db.operation.name'] === 'SELECT',
    )
    .reduce((sum, state) => sum + (state.type === 'Histogram' ? state.state.count : 0), 0)

describe.runIf(postgresAvailable)('the database in a trace', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('trace-statements')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  const run = <A, E>(effect: Effect.Effect<A, E, Orm>, tracer: Layer.Layer<never>): Promise<A> =>
    Effect.runPromise(
      effect.pipe(Effect.provide(Layer.mergeAll(databaseFor(db.url, { entities }), tracer))),
    )

  it('times each statement of a callback on its own, under the query that ran it', async () => {
    const { spans, layer } = recorder()
    const before = await durationCount()
    const answer = await run(slugsAndCount.pipe(Effect.withSpan('caller-operation')), layer)
    expect(answer).toEqual({ slugs: [], count: 0 })

    const operations = spans.filter((span) => span.name === 'db.query')
    expect(operations).toHaveLength(1)
    const operation = operations[0]!
    // the grouping is internal and says nothing a backend counts as a call
    expect(operation.kind).toBe('internal')
    expect(operation.attributes.get('db.system.name')).toBeUndefined()
    expect(parentOf(operation)?.name).toBe('caller-operation')

    const statements = statementsOf(spans)
    expect(statements.map((span) => span.name)).toEqual(['SELECT tenants', 'SELECT tenants'])
    for (const statement of statements) {
      expect(parentOf(statement)).toBe(operation)
      expect(statement.attributes.get('db.system.name')).toBe('postgresql')
      expect(statement.attributes.get('db.operation.name')).toBe('SELECT')
      expect(statement.attributes.get('db.query.summary')).toBe('SELECT tenants')
      expect(typeof statement.attributes.get('db.namespace')).toBe('string')
      // inside the operation's own time
      const inner = ended(statement)
      const outer = ended(operation)
      expect(inner.startTime >= outer.startTime).toBe(true)
      expect(inner.endTime <= outer.endTime).toBe(true)
      expect(inner.endTime >= inner.startTime).toBe(true)
    }
    // the template, with the value as a placeholder
    expect(statements[0]!.attributes.get('db.query.text')).toMatch(/"slug" = \$1/)
    expect(String(statements[0]!.attributes.get('db.query.text'))).not.toContain('nobody')
    // the duration is the statement's: one per statement, not one per callback
    expect((await durationCount()) - before).toBe(2)
  })

  it('files transaction control under the transaction, and joins rather than nests', async () => {
    const { spans, layer } = recorder()
    await run(
      transaction(
        Effect.gen(function* () {
          yield* slugsAndCount
          // a nested call joins the open transaction: JOIN-EXISTING must
          // survive tracing, and joining is not opening - no second span
          yield* transaction(slugsAndCount)
        }),
        { isolation: 'repeatable read', readOnly: true },
      ).pipe(Effect.withSpan('write-operation')),
      layer,
    )
    const transactions = spans.filter((span) => span.name === 'db.transaction')
    expect(transactions).toHaveLength(1)
    const opened = transactions[0]!
    expect(opened.kind).toBe('internal')
    expect(parentOf(opened)?.name).toBe('write-operation')
    const control = statementsOf(spans).filter((span) => parentOf(span) === opened)
    // a connection opened for it may first be checked by the ORM; those are
    // statements too, filed under whoever made the pool open it, and they
    // come before the transaction begins
    const operations = control.map((span) => span.attributes.get('db.operation.name'))
    const begun = operations.indexOf('BEGIN')
    expect(begun).toBeLessThanOrEqual(1)
    expect(operations.slice(begun)).toEqual(['BEGIN', 'SET', 'COMMIT'])
    const queries = spans.filter((span) => span.name === 'db.query')
    expect(queries).toHaveLength(2)
    for (const inner of queries) expect(parentOf(inner)).toBe(opened)
    const work = statementsOf(spans).filter((span) => queries.includes(parentOf(span)!))
    expect(work).toHaveLength(4)
  })

  it('keeps two concurrent callers apart', async () => {
    const { spans, layer } = recorder()
    const sleepy = (who: string) =>
      Effect.gen(function* () {
        const em = yield* entityManager<typeof entities>()
        return yield* query(async () => {
          const k = kyselyOf(em)
          await sql`select pg_sleep(0.15)`.execute(k)
          return k.selectFrom('Tenant').select(['slug']).execute()
        })
      }).pipe(Effect.withSpan(who))
    await run(Effect.all([sleepy('caller-a'), sleepy('caller-b')], { concurrency: 2 }), layer)
    const statements = statementsOf(spans)
    expect(statements).toHaveLength(4)
    const callerOf = (span: Tracer.NativeSpan) => parentOf(parentOf(span)!)?.name
    expect(statements.map(callerOf).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      'caller-a',
      'caller-a',
      'caller-b',
      'caller-b',
    ])
    // they really overlapped, or the case proves nothing
    const [a, b] = ['caller-a', 'caller-b'].map((who) =>
      statements.filter((span) => callerOf(span) === who).map(ended),
    )
    expect(a![0]!.startTime < b![0]!.endTime && b![0]!.startTime < a![0]!.endTime).toBe(true)
  })

  it('describes a failed statement by its class, and hands the caller the failure as it was', async () => {
    const { spans, layer } = recorder()
    const refused = 'not-a-uuid-6c1f'
    const exit = await run(
      Effect.exit(
        Effect.gen(function* () {
          const em = yield* entityManager<typeof entities>()
          return yield* query(() =>
            kyselyOf(em).selectFrom('Tenant').select(['slug']).where('id', '=', refused).execute(),
          )
        }),
      ),
      layer,
    )
    // the caller's failure is untouched: the driver's own words, cause and all
    expect(Exit.isFailure(exit)).toBe(true)
    const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(refused)
    // the statement says what kind of failure, never what was refused
    const [statement] = statementsOf(spans)
    expect(statement!.attributes.get('error.type')).toBe('22P02')
    expect(statement!.attributes.get('db.response.status_code')).toBe('22P02')
    const status = ended(statement!)
    expect(Exit.isFailure(status.exit)).toBe(true)
    expect(Exit.isFailure(status.exit) && Cause.pretty(status.exit.cause)).not.toContain(refused)
  })

  it('changes nothing about the answer when tracing is off, or when the tracer itself fails', async () => {
    const off = recorder()
    const quiet = await run(
      slugsAndCount.pipe(
        Effect.withSpan('caller'),
        Effect.provideService(References.TracerEnabled, false),
      ),
      off.layer,
    )
    expect(quiet).toEqual({ slugs: [], count: 0 })
    expect(statementsOf(off.spans)).toEqual([])

    // a tracer that throws once the database starts asking for spans
    let calls = 0
    const broken = Layer.succeed(
      Tracer.Tracer,
      Tracer.make({
        span(options) {
          calls += 1
          if (options.kind === 'client') throw new Error('the tracer broke')
          return new Tracer.NativeSpan(options)
        },
      }),
    )
    const answer = await run(slugsAndCount.pipe(Effect.withSpan('caller')), broken)
    expect(answer).toEqual({ slugs: [], count: 0 })
    expect(calls).toBeGreaterThan(2)
  })
})

// What leaves the process: the real exporter, a local receiver, and every
// byte it was sent searched for the values the statements were run with.
describe.runIf(postgresAvailable)('what a statement exports', () => {
  const port = 3223
  const received: string[] = []
  let receiver: Server
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('trace-export')
    receiver = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
      })
    })
    await new Promise<void>((resolve) => receiver.listen(port, '127.0.0.1', resolve))
  })

  afterAll(async () => {
    receiver?.closeAllConnections()
    await new Promise<void>((resolve) => receiver?.close(() => resolve()))
    await db?.dispose()
  })

  it('carries templates and failure classes, never a value a statement was given', async () => {
    const kept = 'kept-slug-91d2'
    const refused = 'refused-value-3e7b'
    const telemetry = telemetryLayer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
            OTEL_LOGS_EXPORTER: 'otlp',
          }),
        ),
      ),
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const em = yield* entityManager<typeof entities>()
        // a value that is found, one that is refused, and the refusal logged
        yield* query(() =>
          kyselyOf(em).selectFrom('Tenant').select(['slug']).where('slug', '=', kept).execute(),
        ).pipe(Effect.withSpan('looks up'))
        const failed = yield* Effect.exit(
          query(() =>
            kyselyOf(em).selectFrom('Tenant').select(['slug']).where('id', '=', refused).execute(),
          ).pipe(Effect.withSpan('the handler')),
        )
        if (Exit.isFailure(failed)) yield* Effect.logError('the lookup failed', failed.cause)
      }).pipe(Effect.provide(Layer.mergeAll(databaseFor(db.url, { entities }), telemetry))),
    )
    const exported = received.join('\n')
    expect(exported).toContain('"db.query.text"')
    expect(exported).toContain('\\"slug\\" = $1')
    expect(exported).toContain('22P02')
    expect(exported).not.toContain(kept)
    expect(exported).not.toContain(refused)
  })
})
