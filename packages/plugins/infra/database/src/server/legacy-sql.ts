import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { Effect } from 'effect'
import { CompiledQuery } from 'kysely'
import {
  Orm,
  entityManager,
  kyselyOf,
  query,
  transaction,
  withDatabase,
  type QueryFailed,
} from './orm.ts'

// Drizzle-authored SQL, executed on the ORM's connection.
//
// TEMPORARY. It exists for exactly as long as both query runtimes do, and goes
// out with the last drizzle statement.
//
// The reason it exists: a transaction cannot span the two runtimes, because
// each takes its connection from its own pool. Three plugins call into each
// other inside a held tenant lock - org asks auth whether a retype strands
// anybody, auth asks rbac whether a tenant keeps an administrator - and each
// of those answers has to be about what the caller is about to commit. Migrate
// one plugin at a time and the peer quietly answers from committed state
// instead. It does not fail; it answers a different question.
//
// So the runtimes cannot be mixed per plugin. Without this, the alternative
// was one commit rewriting every statement in all three at once, with no
// working state in between. With it, the switch is one line per plugin and the
// statements move afterwards, one module at a time, each against the whole
// suite.
//
// Drizzle stays as the thing that BUILDS sql, and stops being the thing that
// runs it. `PgDialect` is what drizzle's own drivers compile with, so the text
// and the parameters are exactly what they were.

const dialect = new PgDialect()

/** what a call site holds: the same two methods the drizzle service offered */
export interface LegacyExecutor {
  readonly execute: (statement: SQL) => Effect.Effect<{ rows: unknown[] }, QueryFailed>
}

export interface LegacySql extends LegacyExecutor {
  /** the body may reach for a manager of its own: the transaction supplies one */
  readonly transaction: <A, E, R>(
    body: (tx: LegacyExecutor) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Orm>>
}

const run = (statement: SQL) =>
  Effect.gen(function* () {
    // no tuple: a raw statement names its own tables, and asking for a closure
    // here would put the aggregate's type back in front of every plugin
    const em = yield* entityManager<readonly []>()
    const compiled = dialect.sqlToQuery(statement)
    return yield* query(() =>
      kyselyOf(em).executeQuery(CompiledQuery.raw(compiled.sql, [...compiled.params])),
    )
  })

/**
 * The old surface, closed over this layer's database.
 *
 * Closed over rather than required, because it replaces a service the plugins
 * already resolved at construction: their methods declared no requirements and
 * must keep declaring none. Supplying `Orm` does not displace an open
 * transaction - `entityManager` looks for that first, and it travels in the
 * fiber from whoever opened it.
 */
export const LegacySql: Effect.Effect<LegacySql, never, Orm> = Effect.gen(function* () {
  const withDb = yield* withDatabase
  const executor: LegacyExecutor = { execute: (statement) => withDb(run(statement)) }
  return {
    ...executor,
    transaction: (body) => withDb(transaction(body(executor))),
  }
})
