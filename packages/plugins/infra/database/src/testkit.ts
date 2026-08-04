import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from 'cordis'
import { sql, type SQL } from 'drizzle-orm'
import { Pool } from 'pg'
import Database from './index.ts'

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
  ctx: Context
  /** the scratch database this context is bound to */
  url: string
  /**
   * A parameterized statement on the context's own connection, for the
   * assertions that must reach past the services: a constraint only earns
   * its place if it refuses what a service would never send.
   *
   * Values come back the way drizzle hands them over, which is not always
   * the way the pg driver alone would: a timestamptz arrives as a string,
   * because drizzle asks for the raw text and maps per column. Assert on the
   * value rather than on its javascript type.
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

// `$1` placeholders kept as they are, because that is what these statements
// already read like and what a reader can paste into psql. sql.raw would
// interpolate instead of binding, so the numbers are resolved into real
// parameters here.
//
// sql.param rather than a bare template value: drizzle expands a top-level
// array into an inline `(a, b)` list, which turns `= any($1::uuid[])` into a
// record cast postgres refuses. A Param binds as one value, the way the
// driver does.
function parameterize(text: string, params: readonly unknown[]): SQL {
  const parts = text.split(/\$(\d+)/)
  return sql.join(
    parts.map((part, index) =>
      index % 2 === 0 ? sql.raw(part) : sql`${sql.param(params[Number(part) - 1])}`,
    ),
  )
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
  ctx?: Context
  admin: Pool
  name: string
}): Promise<void> {
  const errors: unknown[] = []
  if (options.ctx) {
    try {
      await options.ctx.fiber.dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    await options.admin.query(`drop database "${options.name}"`)
  } catch (error) {
    errors.push(error)
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
 * A cordis context bound to a database of its own. The label only makes the
 * scratch name readable while a test is running; uniqueness comes from the
 * uuid, so parallel suites never share one.
 */
export async function createTestContext(
  label: string,
  options: TestContextOptions = {},
): Promise<TestContext> {
  const name = `qualy_${label.replaceAll(/[^a-z0-9]+/gi, '_')}_${randomUUID().slice(0, 8)}`
  const admin = new Pool({ connectionString: baseUrl })
  try {
    await admin.query(`create database "${name}"`)
  } catch (error) {
    // nothing was created, so there is nothing to drop; the pool still has
    // to go, which the old shape skipped by starting its try one line later
    await admin.end().catch(() => {})
    throw error
  }
  const url = new URL(baseUrl)
  url.pathname = `/${name}`

  const ctx = new Context()
  try {
    await ctx.plugin(Database, {
      url: url.href,
      migrations: options.migrations ?? 'apply',
      migrationsFolder: options.migrationsFolder ?? migrationsFolder,
    })
  } catch (error) {
    // init may already have registered effects, so the partial context is
    // disposed like any other; the original failure is what the caller
    // needs to see, with anything teardown adds attached to it
    try {
      await teardown({ ctx, admin, name })
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], `could not start a test database for ${label}`)
    }
    throw error
  }

  return {
    ctx,
    url: url.href,
    query: (text, params = []) => ctx.db.drizzle.execute(parameterize(text, params)) as never,
    async row(text, params = []) {
      const { rows } = await ctx.db.drizzle.execute(parameterize(text, params))
      if (rows.length === 0) throw new Error(`expected a row from: ${text.trim()}`)
      return rows[0] as never
    },
    // Order matters and is the point: disposing the fiber runs the database
    // plugin's own disposer, so by the time the database goes there is
    // nothing connected to it. A drop that has to force its way past live
    // backends is a leak the suite should be reporting, not working around.
    dispose: () => teardown({ ctx, admin, name }),
  }
}

/**
 * The SQLSTATE a write was refused with, or 'no error' when it succeeded.
 *
 * Drizzle wraps driver failures in its own error and puts the original on
 * `cause`, so reading `code` off the top level quietly yields undefined and
 * an assertion about a constraint becomes an assertion about nothing.
 */
export function pgCode(work: Promise<unknown>): Promise<string> {
  return work.then(
    () => 'no error',
    (error: unknown) => {
      for (let current = error; current; current = (current as { cause?: unknown }).cause) {
        const code = (current as { code?: unknown }).code
        if (typeof code === 'string') return code
      }
      return String(error)
    },
  )
}
