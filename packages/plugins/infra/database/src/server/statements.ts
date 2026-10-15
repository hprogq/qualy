import { AsyncLocalStorage } from 'node:async_hooks'
import type { Pool, PoolClient } from 'pg'
import { Clock, Context, Exit, Fiber, Metric, Option, References, Tracer } from 'effect'
import { exportMessage } from '@qualy/telemetry/redaction'
import { failureClassOf } from './constraints.ts'

// One client span per statement the server is sent.
//
// `query` and `transaction` see an opaque promise: a callback may run seven
// statements, and the span around it said only that the time went to the
// database. The driver's client is where every statement passes - Kysely's
// connection calls `client.query(sql, parameters)` (kysely
// dist/esm/dialect/postgres/postgres-driver.js), and MikroORM 7 runs its own
// queries and transaction control through that same Kysely client
// (repos/mikro-orm/packages/sql/src/AbstractSqlConnection.ts) - so each
// pooled client's `query` is timed there, once per statement.
//
// The span belongs to whoever asked: `query` and `transaction` hand the
// driver the asking fiber's span, tracer and clock through AsyncLocalStorage,
// read once when they call out, so a statement still running after its fiber
// moved on is still filed under the operation that started it. A statement
// with no such context - the migrator, the pool's own housekeeping - is not
// traced: it has no operation to belong to.
//
// What a span carries is the statement's text as the driver sends it: the
// template, `$1` where a value goes. Values travel as bind parameters and are
// never read here; the gate in tests/sql-text.test.ts holds the code to
// keeping values out of the text itself. A failure is described by its class
// alone - SQLSTATE, or a fixed name - never the server's message, which can
// quote the value that was refused.

interface StatementContext {
  readonly parent: Tracer.AnySpan | undefined
  readonly tracer: Tracer.Tracer
  readonly clock: Clock.Clock
  readonly traced: boolean
  readonly timed: boolean
  readonly annotations: Readonly<Record<string, unknown>>
  readonly services: Context.Context<never>
}

const statementContext = new AsyncLocalStorage<StatementContext>()

/**
 * Runs `run` with the current fiber's span as the parent of every statement
 * it sends. Called where an effect hands work to the driver, synchronously
 * on that fiber.
 */
export const forStatements = <A>(run: () => Promise<A>): Promise<A> => {
  const fiber = Fiber.getCurrent()
  if (fiber === undefined) return run()
  return statementContext.run(
    {
      parent: fiber.cache.span,
      tracer: fiber.getRef(Tracer.Tracer),
      clock: fiber.getRef(Clock.Clock),
      traced: fiber.getRef(References.TracerEnabled),
      timed: fiber.getRef(References.TracerTimingEnabled),
      annotations: fiber.getRef(References.TracerSpanAnnotations),
      services: fiber.context,
    },
    run,
  )
}

/**
 * The stable-semconv duration of every statement. Success and failure both
 * count; a failure carries its class as `error.type`, and its SQLSTATE as
 * `db.response.status_code` when it has one - a bounded vocabulary either
 * way, never the message.
 */
const operationDuration = Metric.histogram('db.client.operation.duration', {
  description: 'Duration of database client operations.',
  boundaries: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
})

const OPERATIONS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'WITH',
  'VALUES',
  'BEGIN',
  'START',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'SET',
  'SHOW',
  'LOCK',
  'CALL',
  'LISTEN',
  'NOTIFY',
  'UNLISTEN',
  'TRUNCATE',
])

/** the statement's verb, from a fixed list, and the first table it names */
export const summaryOf = (text: string): { operation: string; summary: string } => {
  const verb = /^\s*([a-z]+)/i.exec(text)?.[1]?.toUpperCase()
  const operation = verb !== undefined && OPERATIONS.has(verb) ? verb : 'OTHER'
  const table = /\b(?:from|into|update|join)\s+"?([a-z_][a-z0-9_]*)"?/i.exec(text)?.[1]
  return { operation, summary: table === undefined ? operation : `${operation} ${table}` }
}

const DB = { 'db.system.name': 'postgresql', unit: 's' } as const

type Query = PoolClient['query']

const instrumented = new WeakSet<PoolClient>()

/** times every statement a client sends, for the rest of its life */
const instrument = (client: PoolClient): void => {
  if (instrumented.has(client)) return
  instrumented.add(client)
  const original = client.query.bind(client) as (...args: unknown[]) => unknown
  const where = client as unknown as { database?: string; host?: string; port?: number }
  client.query = ((...args: unknown[]) => {
    const context = statementContext.getStore()
    const first = args[0]
    const text =
      typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'text' in first
          ? (first as { text?: unknown }).text
          : undefined
    // a callback, a cursor, or no operation to belong to: as the driver had it
    if (
      context === undefined ||
      typeof text !== 'string' ||
      typeof args[args.length - 1] === 'function' ||
      (typeof first === 'object' && first !== null && 'submit' in first)
    ) {
      return original(...args)
    }
    const started = performance.now()
    const { operation, summary } = summaryOf(text)
    let span: Tracer.Span | undefined
    try {
      if (context.traced && context.parent !== undefined) {
        span = context.tracer.span({
          name: summary,
          parent: Option.some(context.parent),
          annotations: Context.empty(),
          links: [],
          startTime: context.timed ? context.clock.currentTimeNanosUnsafe() : 0n,
          kind: 'client',
          root: false,
          sampled: context.parent.sampled,
        })
        for (const key in context.annotations) span.attribute(key, context.annotations[key])
        span.attribute('db.system.name', 'postgresql')
        if (where.database !== undefined) span.attribute('db.namespace', where.database)
        if (where.host !== undefined) span.attribute('server.address', where.host)
        if (where.port !== undefined) span.attribute('server.port', where.port)
        span.attribute('db.operation.name', operation)
        span.attribute('db.query.summary', summary)
        span.attribute('db.query.text', text)
      }
    } catch {
      // telemetry that cannot describe a statement does not stop it
      span = undefined
    }
    const settle = (failure: unknown) => {
      try {
        const failed = failure !== undefined
        const kind = failed ? failureClassOf(failure) : undefined
        const attributes = {
          ...DB,
          'db.operation.name': operation,
          ...(kind === undefined ? {} : { 'error.type': kind.type }),
          ...(kind?.sqlstate === undefined ? {} : { 'db.response.status_code': kind.sqlstate }),
        }
        Metric.withAttributes(operationDuration, attributes).updateUnsafe(
          (performance.now() - started) / 1000,
          context.services,
        )
        if (span === undefined) return
        if (kind !== undefined) {
          span.attribute('error.type', kind.type)
          if (kind.sqlstate !== undefined) span.attribute('db.response.status_code', kind.sqlstate)
        }
        span.end(
          context.timed ? context.clock.currentTimeNanosUnsafe() : 0n,
          kind === undefined ? Exit.void : Exit.fail(statementFailed(kind.type)),
        )
      } catch {
        // as above: the statement's outcome is the driver's, not this
      }
    }
    const running = original(...args) as Promise<unknown>
    return running.then(
      (result) => {
        settle(undefined)
        return result
      },
      (error: unknown) => {
        settle(error)
        throw error
      },
    )
  }) as Query
}

/** a statement's failure as a span may carry it: its class, and nothing it was told */
const statementFailed = (type: string): Error => {
  const message = `a database statement failed (${type})`
  const error = new Error(message)
  error.name = 'StatementFailed'
  return Object.assign(error, { [exportMessage]: message })
}

/** instruments every client the pool opens */
export const instrumentPool = (pool: Pool): void => {
  pool.on('connect', instrument)
}
