import { PgClient } from '@effect/sql-pg'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { Context, Effect, Layer, Redacted } from 'effect'
import type { SqlError } from 'effect/unstable/sql'

// M1 spike. This package is deliberately temporary: it exists to find out
// whether the Effect stack can carry this project's real schema, and it is
// deleted once the answer is recorded. Nothing may depend on it.
//
// What it does NOT do: reimplement the database plugin. The scratch database,
// its migrations and its teardown stay with the plugin that owns them; this
// only points an Effect client at a database that already exists.

/** what `PgDrizzle.makeWithDefaults()` hands back, without naming drizzle's internals */
export type SpikeDb = Effect.Success<ReturnType<typeof PgDrizzle.makeWithDefaults>>

export class Database extends Context.Service<Database, SpikeDb>()(
  '@qualy/effect-spike/Database',
) {}

/**
 * An Effect database over an existing connection string.
 *
 * `PgClient.layer` builds and owns its own pool, so the scope this layer is
 * built in decides when the pool closes. That is the property the shutdown
 * check depends on.
 *
 * The error channel is not `never`: building the pool can fail, and the layer
 * type says so. Under cordis the same failure existed and was expressed as a
 * throw inside Service.init that nothing in the type system mentioned.
 */
export const databaseLayer = (url: string): Layer.Layer<Database, SqlError.SqlError> =>
  Layer.effect(Database, PgDrizzle.makeWithDefaults()).pipe(
    Layer.provide(PgClient.layer({ url: Redacted.make(url) })),
  )
