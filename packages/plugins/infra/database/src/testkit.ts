import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { Pool } from 'pg'
import type { EntitySchema } from '@mikro-orm/core'
import { schemaParity as compareSchemas, type SchemaParityOptions } from './parity.ts'
import { CompiledQuery, type RawBuilder } from 'kysely'
import {
  DatabaseConfig,
  Entities,
  entityManager,
  kyselyOf,
  layer as databaseLayer,
  query as runQuery,
  type StartupFailure,
  type Orm,
} from './server/index.ts'

// The postgres lifecycle a database-backed test needs, owned by the plugin
// that owns connections in production.
//
// Six plugin suites had each grown their own copy: probe the server, mint a
// database name, create it through an admin pool, locate the migration
// lineage, run it by hand, then start the database plugin with migrations
// turned off. That left two owners of the same database, so the plugin's own
// disposal path was never the thing under test, and every copy silenced pool
// errors to hide the fallout of dropping a database out from under live
// connections.
//
// Here the plugin owns the connection exactly as it does in production, the
// fiber is disposed before the database is dropped, and nothing is silenced.
//
// It lives beside the plugin rather than in a package of its own because the
// driver, the connection string and the migration lineage are this plugin's
// concerns. A shared test package holding them would have moved the leak
// rather than closed it: business suites would still be reaching past the
// database service to a peer that reimplements it.

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const migrationsFolder = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))

// Probed once per module instance rather than once per suite. Vitest isolates
// files by default, so that is normally once per test file, not once for the
// whole run; it is still six probes fewer than one per suite hand-rolled.
export const postgresAvailable = await (async () => {
  const probe = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 1500 })
  try {
    await probe.query('select 1')
    return true
  } catch {
    return false
  } finally {
    await probe.end().catch(() => {})
  }
})()

// A suite may skip when there is no server to talk to, but CI says so out
// loud: silently skipping the only tests that touch the real constraint
// engine reads exactly like passing them.
if (!postgresAvailable && process.env.QUALY_REQUIRE_POSTGRES_TESTS === '1') {
  throw new Error('postgres-backed tests are required but the server is unreachable')
}

export interface TestContext {
  /**
   * The database layer for this scratch database.
   *
   * Its failures are the layer's own: a test that provides it is asserting the
   * lineage applies and the server answers, which is the same claim a
   * deployment makes.
   */
  services: Layer.Layer<Orm, StartupFailure>
  /** the scratch database this context is bound to */
  url: string
  /**
   * A parameterized statement on the context's own connection, for the
   * assertions that must reach past the services: a constraint only earns
   * its place if it refuses what a service would never send.
   *
   * Values come back the way the orm hands them over, which is not always
   * the way the pg driver alone would: a timestamptz arrives as a string.
   * Assert on the value rather than on its javascript type.
   */
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[] }>
  /**
   * The single row a statement was expected to produce.
   *
   * `rows[0]!.id` is the most repeated shape in these suites, and the `!`
   * quietly asserts that an `insert ... returning id` returned something. It
   * usually did; when it did not, the failure surfaced as a null dereference
   * three lines later. This says so where it happens.
   */
  row<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<Row>
  /** disposes the fiber, then drops the database */
  dispose(): Promise<void>
}

/**
 * Raw sql on the connection the services are on, for building a fixture.
 *
 * A fixture states the shape a test starts from, so it is written as sql
 * rather than driven through the services under test: a seed built by them
 * would only prove they agree with themselves. It has to run on their
 * connection, though - a row inserted on a second pool is a row a transaction
 * under test cannot see, which is not a hypothetical.
 *
 * It dies rather than failing: a fixture that did not apply is a broken test,
 * not a case the test is about.
 */
export const runSql = <Row = Record<string, unknown>>(
  statement: CompiledQuery | RawBuilder<Row>,
): Effect.Effect<{ rows: Row[] }, never, Orm> =>
  Effect.gen(function* () {
    const em = yield* entityManager<readonly []>()
    const db = kyselyOf(em)
    return yield* runQuery(() =>
      'sql' in statement ? db.executeQuery<Row>(statement) : statement.execute(db),
    )
  }).pipe(Effect.orDie)

/**
 * A migrated database, built once and copied per test.
 *
 * Every suite used to create an empty database and replay the whole lineage
 * into it, which is most of what a database-backed test costs: the assertions
 * are milliseconds and the lineage is not. `CREATE DATABASE ... TEMPLATE`
 * copies the files instead, so the lineage runs once per distinct lineage
 * rather than once per test.
 *
 * The name carries a hash of the migration files, so editing one produces a
 * different template rather than reusing a stale one. It survives the run on
 * purpose: a second run skips the lineage entirely.
 */
const templateName = (folder: string) => {
  const hash = createHash('sha256')
  const walk = (dir: string) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.sql')) hash.update(entry.name).update(fs.readFileSync(full))
    }
  }
  walk(folder)
  return `qualy_tpl_${hash.digest('hex').slice(0, 16)}`
}

/**
 * Builds the template if nobody has, and waits if somebody is.
 *
 * Test files run in parallel workers, so several arrive here at once. The
 * advisory lock makes exactly one of them do the work; the rest block on the
 * lock and then find it already there. Without it they would race on CREATE
 * DATABASE and all but one would fail.
 */
const ensureTemplate = async (admin: Pool, folder: string): Promise<string> => {
  const name = templateName(folder)
  const lock = BigInt.asIntN(
    64,
    BigInt(`0x${createHash('sha256').update(name).digest('hex').slice(0, 15)}`),
  )
  const client = await admin.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [lock.toString()])
    const { rows } = await client.query('select 1 from pg_database where datname = $1', [name])
    if (rows.length === 0) {
      const building = `${name}_building_${randomUUID().slice(0, 8)}`
      await client.query(`create database "${building}"`)
      const url = new URL(baseUrl)
      url.pathname = `/${building}`
      // the plugin's own migrator, so the template is built the way a
      // deployment is rather than by a second implementation
      await build(
        url.href,
        { migrations: 'apply', migrationsFolder: folder, entities: [] },
        async () => {},
      )
      // renamed only once it is complete, so a crashed build never becomes a
      // template that other tests copy
      await client.query(`alter database "${building}" rename to "${name}"`)
      // a template must not be written to, and postgres refuses to copy one
      // that has connections, so it is marked and left alone
      await client.query(`update pg_database set datallowconn = true where datname = $1`, [name])
    }
    return name
  } finally {
    await client.query('select pg_advisory_unlock($1)', [lock.toString()])
    client.release()
  }
}

export interface TestContextOptions {
  /**
   * 'apply' is the production path and the default: the plugin runs the
   * committed lineage during init, so every suite that boots also proves the
   * lineage still applies. 'off' leaves the database empty, for tests that
   * drive the migrations themselves.
   */
  migrations?: 'apply' | 'off'
  /** the committed lineage unless a test is deliberately pointing elsewhere */
  migrationsFolder?: string
  /** the entity set the assembly under test has, empty unless a suite queries through the orm */
  entities?: readonly EntitySchema[]
}

/**
 * Tears everything down and reports everything that went wrong.
 *
 * A harness earns its keep on the failing run, not the green one, so no step
 * is allowed to skip the ones after it. Force is the last resort and only
 * ever after an ordinary drop has already failed: it clears the scratch
 * database so the next run starts clean, and it never converts a teardown
 * failure into a pass, because every error collected here is still thrown.
 */
async function teardown(options: {
  scope?: Scope.Scope
  admin: Pool
  name: string
}): Promise<void> {
  const errors: unknown[] = []
  if (options.scope) {
    try {
      await Effect.runPromise(Scope.close(options.scope, Exit.void))
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    await options.admin.query(`drop database "${options.name}"`)
  } catch (error) {
    errors.push(error)
    // What the server had to say about itself when the drop was refused.
    //
    // A drop fails for reasons that are invisible afterwards: a backend still
    // attached, or no slots left to open the next connection. Reading it here,
    // while it is still true, is the difference between a diagnosis and a
    // guess - a failure recovered by the forced drop below would otherwise
    // leave nothing behind at all.
    try {
      const { rows } = await options.admin.query<{ what: string; count: string }>(
        `select 'backends on ' || $1 as what, count(*)::text as count
           from pg_stat_activity where datname = $1
         union all
         select 'connections / max', count(*) || ' / ' || current_setting('max_connections')
           from pg_stat_activity`,
        [options.name],
      )
      for (const row of rows) console.error(`  ${row.what}: ${row.count}`)
    } catch {
      // the diagnosis is best effort; its failure must not replace the real one
    }
    try {
      await options.admin.query(`drop database if exists "${options.name}" with (force)`)
    } catch (forced) {
      errors.push(forced)
    }
  }
  try {
    await options.admin.end()
  } catch (error) {
    errors.push(error)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `failed to dispose the test database ${options.name}`)
  }
}

/**
 * A database of its own, with the layer that serves it. The label only makes the
 * scratch name readable while a test is running; uniqueness comes from the
 * uuid, so parallel suites never share one.
 */
export async function createTestContext(
  label: string,
  options: TestContextOptions = {},
): Promise<TestContext> {
  const name = `qualy_${label.replaceAll(/[^a-z0-9]+/gi, '_')}_${randomUUID().slice(0, 8)}`
  const admin = new Pool({ connectionString: baseUrl })
  const folder = options.migrationsFolder ?? migrationsFolder
  // The template is for the committed lineage and nothing else. A test that
  // names its own folder is asserting something about deploying it - assembly
  // does exactly this - and handing it a database that already has those
  // tables is not an empty database, whatever the journal says. 'off' means
  // the test drives the lineage itself and wants an empty one too.
  const template =
    (options.migrations ?? 'apply') === 'apply' && options.migrationsFolder === undefined
      ? await ensureTemplate(admin, folder)
      : undefined
  try {
    await admin.query(
      template ? `create database "${name}" template "${template}"` : `create database "${name}"`,
    )
  } catch (error) {
    // nothing was created, so there is nothing to drop; the pool still has
    // to go, which the old shape skipped by starting its try one line later
    await admin.end().catch(() => {})
    throw error
  }
  const url = new URL(baseUrl)
  url.pathname = `/${name}`

  const services = servicesFor(url.href, {
    // the copy already carries the lineage, so this run finds it applied and
    // starts; the layer's own check still has to agree, which is the point
    migrations: options.migrations ?? 'apply',
    migrationsFolder: folder,
    entities: options.entities ?? [],
  })
  const scope = await Effect.runPromise(Scope.make())
  let built: Context.Context<Orm>
  try {
    built = await Effect.runPromise(Layer.buildWithScope(services, scope))
  } catch (error) {
    // building may already have acquired resources, so the partial scope is
    // closed like any other; the original failure is what the caller needs to
    // see, with anything teardown adds attached to it
    try {
      await teardown({ scope, admin, name })
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], `could not start a test database for ${label}`)
    }
    throw error
  }

  const execute = (text: string, params: readonly unknown[]) =>
    Effect.runPromise(runSql(CompiledQuery.raw(text, [...params])).pipe(Effect.provide(built)))

  return {
    services,
    url: url.href,
    query: (text, params = []) => execute(text, params) as never,
    async row(text, params = []) {
      const { rows } = (await execute(text, params)) as unknown as { rows: unknown[] }
      if (rows.length === 0) throw new Error(`expected a row from: ${text.trim()}`)
      return rows[0] as never
    },
    // Order matters and is the point: closing the scope runs the database
    // layer's own finalizer, so by the time the database goes there is nothing
    // connected to it. A drop that has to force its way past live backends is
    // a leak the suite should be reporting, not working around.
    dispose: () => teardown({ scope, admin, name }),
  }
}

/**
 * The database plugin, configured for one database the way an assembly
 * configures it.
 *
 * Every suite that needs a database used to spell this out again, and the
 * copies had begun to drift in the field that decides whether the lineage is
 * applied. It is one function so that adding something the plugin needs is one
 * edit, not fifteen - which is how it came to be extracted.
 */
/**
 * How many connections one suite's database may hold.
 *
 * Small on purpose: vitest runs a dozen files at once, each with its own
 * scratch database and its own stack, and one postgres has one
 * max_connections. A production-sized pool per suite exhausts it, and the
 * error surfaces on whichever test happened to connect next.
 */
const TEST_POOL_SIZE = 2

export const databaseFor = (
  url: string,
  options: { migrations?: 'apply' | 'off'; entities?: readonly EntitySchema[] } = {},
): Layer.Layer<Orm, StartupFailure> =>
  databaseLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          DatabaseConfig,
          DatabaseConfig.of({
            url: Redacted.make(url),
            migrations: options.migrations ?? 'apply',
            migrationsFolder,
            poolSize: TEST_POOL_SIZE,
          }),
        ),
        // A suite asserting one plugin's queries hands in that plugin's own
        // tuple; the rest have no entities, which during the migration is the
        // truth rather than a placeholder.
        Layer.succeed(Entities, options.entities ?? []),
      ),
    ),
  )

/** the database layer, configured for one scratch database */
const servicesFor = (url: string, options: Required<TestContextOptions>) =>
  databaseLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          DatabaseConfig,
          DatabaseConfig.of({
            url: Redacted.make(url),
            migrations: options.migrations,
            migrationsFolder: options.migrationsFolder,
            poolSize: TEST_POOL_SIZE,
          }),
        ),
        Layer.succeed(Entities, options.entities),
      ),
    ),
  )

/** builds the layer, runs the body, and closes the scope whatever happened */
const build = async (
  url: string,
  options: Required<TestContextOptions>,
  body: (services: Context.Context<Orm>) => Promise<void>,
) => {
  const scope = await Effect.runPromise(Scope.make())
  try {
    await body(await Effect.runPromise(Layer.buildWithScope(servicesFor(url, options), scope)))
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}

/**
 * The SQLSTATE a write was refused with, or 'no error' when it succeeded.
 *
 * The orm wraps driver failures and puts the original further down, so reading
 * `code` off the top level quietly yields undefined and an assertion about a
 * constraint becomes an assertion about nothing.
 */
export function pgCode(work: Promise<unknown>): Promise<string> {
  // The chain is a tree, not a list: a wrapper's cause can be an Effect Cause
  // holding an array of failures rather than a single `cause` link, so walking
  // only `.cause` stopped at the wrapper and returned its message.
  const find = (node: unknown, depth: number, seen: Set<unknown>): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 10 || seen.has(node)) return undefined
    seen.add(node)
    const value = node as Record<string, unknown>
    if (typeof value.code === 'string') return value.code
    for (const key of ['cause', 'error', 'reason']) {
      const found = find(value[key], depth + 1, seen)
      if (found) return found
    }
    for (const key of ['failures', 'reasons']) {
      const list = value[key]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        const found = find(entry, depth + 1, seen)
        if (found) return found
      }
    }
    return undefined
  }
  return work.then(
    () => 'no error',
    (error: unknown) => find(error, 0, new Set()) ?? String(error),
  )
}

/**
 * The lineage's schema and the entities' schema, ready to be compared.
 *
 * Here rather than in each plugin because it needs two scratch databases, and
 * creating those is this plugin's job in tests exactly as owning connections
 * is in production. Returns the readings instead of asserting on them, so the
 * failure a suite reports is a diff of catalog rows rather than a boolean.
 */
export const schemaParity = (options: SchemaParityOptions) =>
  compareSchemas((label) => createTestContext(label), options)

export type { SchemaParity, SchemaParityOptions } from './parity.ts'
