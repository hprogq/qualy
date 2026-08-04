import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { createTestContext, pgCode, postgresAvailable } from '../src/testkit.ts'

// The harness every database-backed suite now depends on, pinned here rather
// than left to be covered sideways by the suites that use it. Each of these
// started as a real defect: a SQLSTATE assertion that quietly stopped
// asserting, an array parameter that became invalid sql, a missing row that
// surfaced three lines later as a null dereference, and teardown paths that
// skipped the rest of teardown as soon as one step failed.

const baseUrl = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'

const scratchDatabases = async () => {
  const admin = new Pool({ connectionString: baseUrl })
  try {
    const { rows } = await admin.query<{ datname: string }>(
      `select datname from pg_database where datname like 'qualy\\_testkit%'`,
    )
    return rows.map((row) => row.datname)
  } finally {
    await admin.end()
  }
}

describe.runIf(postgresAvailable)('database testkit', () => {
  it('reads the sqlstate through the wrapper drizzle puts around it', async () => {
    const db = await createTestContext('testkit-sqlstate')
    try {
      // drizzle raises its own error and hangs the driver's on cause, so a
      // reader that only looks at the top level returns undefined and the
      // assertion it feeds stops being an assertion
      const refused = db.query(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $1, 'orphan', 'x', 0)`,
        ['00000000-0000-7000-8000-000000000000'],
      )
      expect(await pgCode(refused)).toBe('23503')
      expect(await pgCode(db.query(`select 1`))).toBe('no error')
    } finally {
      await db.dispose()
    }
  })

  it('binds an array as one parameter rather than an inline list', async () => {
    const db = await createTestContext('testkit-array')
    try {
      // drizzle expands a bare array into `(a, b)`, which turns any(...) into
      // a record cast postgres refuses; the harness binds through a param so
      // a suite can keep writing the statement the driver accepts
      const ids = ['019fca00-0000-7000-8000-000000000001', '019fca00-0000-7000-8000-000000000002']
      const counted = await db.row<{ count: number }>(
        `select cardinality($1::uuid[])::int as count`,
        [ids],
      )
      expect(counted.count).toBe(2)
      // and the shape the suites actually use it in
      const matched = await db.row<{ count: number }>(
        `select count(*)::int as count from (select unnest($1::uuid[]) as id) ids
         where ids.id = any($1::uuid[])`,
        [ids],
      )
      expect(matched.count).toBe(2)
    } finally {
      await db.dispose()
    }
  })

  it('refuses a statement that returned no row instead of handing back nothing', async () => {
    const db = await createTestContext('testkit-row')
    try {
      await expect(
        db.row(`select 1 where false`),
      ).rejects.toThrow(/expected a row/)
      // and still returns the row when there is one
      expect(await db.row<{ n: number }>(`select 1::int as n`)).toEqual({ n: 1 })
    } finally {
      await db.dispose()
    }
  })

  it('drops its scratch database when the context disposes cleanly', async () => {
    const db = await createTestContext('testkit-drop')
    const name = new URL(db.url).pathname.slice(1)
    expect(await scratchDatabases()).toContain(name)
    await db.dispose()
    expect(await scratchDatabases()).not.toContain(name)
  })

  it('leaves nothing behind when the context fails to start', async () => {
    // a folder with no lineage in it: the plugin's init fails after the
    // database exists, which is the window where a scratch database is most
    // easily orphaned
    await expect(
      createTestContext('testkit-bad-start', { migrations: 'apply', migrationsFolder: 'nowhere' }),
    ).rejects.toThrow()
    expect(await scratchDatabases()).toEqual([])
  })

  it('reports a teardown it could not complete instead of resolving anyway', async () => {
    const db = await createTestContext('testkit-report')
    await db.dispose()
    // the second teardown has nothing left to work with: the database is
    // gone and the admin pool is closed. What matters is that it says so.
    // A harness earns its keep on the failing run, and one that resolves
    // whatever happened cannot tell a clean teardown from a leaked one.
    const failed = await db.dispose().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failed).toBeInstanceOf(AggregateError)
    expect((failed as AggregateError).errors.length).toBeGreaterThan(0)
  })

  // Worth knowing when reading the teardown above: cordis resolves
  // fiber.dispose() even when a disposer throws, so a plugin that fails to
  // release something says nothing here. The failures this harness can
  // report are the ones postgres refuses.
  it('cannot see a disposer that throws, but still clears the database', async () => {
    const db = await createTestContext('testkit-quiet')
    const name = new URL(db.url).pathname.slice(1)
    await db.ctx.plugin({
      name: 'awkward',
      apply: (child: typeof db.ctx) => {
        child.effect(() => () => {
          throw new Error('disposer said no')
        })
      },
    })
    await db.dispose()
    expect(await scratchDatabases()).not.toContain(name)
  })
})
