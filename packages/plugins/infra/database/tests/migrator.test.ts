import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_TIMEOUT_VARIABLE,
  runMigrations,
} from '../src/migrator.ts'
import { createTestContext, postgresAvailable } from '../src/testkit.ts'

// Applying a lineage: one writer at a time, and a failure that leaves no
// false record.
//
// Both are properties of the migrator rather than of any lineage, so they are
// asserted against a lineage of two lines. The database is a scratch one with
// nothing applied to it, so the migrator is the only thing that ever writes
// there.

const LEDGER = 'mikro_orm_migrations'

/** a lineage folder holding the given migrations, in name order */
const lineage = (files: Record<string, string>) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-migrator-'))
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), sql)
  return folder
}

/** a database with nothing in it: the context's own layer is told to leave it alone */
const emptyDatabase = async (label: string) => {
  const nothing = lineage({})
  const db = await createTestContext(label, { migrations: 'off', migrationsFolder: nothing })
  return {
    db,
    dispose: async () => {
      await db.dispose()
      fs.rmSync(nothing, { recursive: true, force: true })
    },
  }
}

/** the lock timeout, for one call */
const withLockTimeout = async <A>(ms: number, body: () => Promise<A>): Promise<A> => {
  const before = process.env[MIGRATION_LOCK_TIMEOUT_VARIABLE]
  process.env[MIGRATION_LOCK_TIMEOUT_VARIABLE] = String(ms)
  try {
    return await body()
  } finally {
    if (before === undefined) delete process.env[MIGRATION_LOCK_TIMEOUT_VARIABLE]
    else process.env[MIGRATION_LOCK_TIMEOUT_VARIABLE] = before
  }
}

describe.runIf(postgresAvailable)('applying a lineage', () => {
  it('waits for another run that holds the migration lock, and runs once it lets go', async () => {
    const target = await emptyDatabase('migrator-single-writer')
    const folder = lineage({ '00000000000001_probe.sql': 'create table lock_probe (id int);\n' })
    // the other run: a session of its own holding the very same lock
    const holder = new Client({ connectionString: target.db.url })
    await holder.connect()
    try {
      await holder.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
      let settled = false
      const waiting = runMigrations(target.db.url, { folder, entities: [] }).finally(() => {
        settled = true
      })
      // it waits rather than racing: nothing has been written while the
      // holder holds on
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(settled).toBe(false)
      const tables = await target.db.query(
        `select 1 from information_schema.tables where table_name = 'lock_probe'`,
      )
      expect(tables.rows).toHaveLength(0)

      await holder.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      const { applied } = await waiting
      expect(applied).toBe(1)
      // and the run released its own lock on the way out: a third run does
      // not wait on it
      const again = await withLockTimeout(2_000, () =>
        runMigrations(target.db.url, { folder, entities: [] }),
      )
      expect(again.applied).toBe(0)
    } finally {
      await holder.end().catch(() => {})
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  it('gives up on a holder that never lets go, naming the target', async () => {
    const target = await emptyDatabase('migrator-lock-timeout')
    const folder = lineage({ '00000000000001_probe.sql': 'create table lock_probe (id int);\n' })
    const holder = new Client({ connectionString: target.db.url })
    await holder.connect()
    try {
      await holder.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
      const started = performance.now()
      await expect(
        withLockTimeout(500, () => runMigrations(target.db.url, { folder, entities: [] })),
      ).rejects.toThrow(/another migration run has held the lock on .*migrator_lock_timeout.* for 500ms/)
      // the bound, not a hang
      expect(performance.now() - started).toBeLessThan(10_000)
      const tables = await target.db.query(
        `select 1 from information_schema.tables where table_name = 'lock_probe'`,
      )
      expect(tables.rows).toHaveLength(0)
    } finally {
      await holder.end().catch(() => {})
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  it('records nothing for a migration that failed, and applies it once it is fixed', async () => {
    const target = await emptyDatabase('migrator-failure')
    const folder = lineage({
      '00000000000001_first.sql': 'create table first_probe (id int);\n',
      // the same table again: fails on the constraint the first one created
      '00000000000002_second.sql': 'create table first_probe (id int);\n',
    })
    try {
      await expect(runMigrations(target.db.url, { folder, entities: [] })).rejects.toThrow(
        /already exists/,
      )
      const recorded = await target.db.query<{ name: string }>(`select name from ${LEDGER}`)
      // whatever the migrator did with the first, the one that failed is not
      // in the ledger, so the next run tries it again rather than skipping it
      expect(recorded.rows.map((row) => row.name)).not.toContain('00000000000002_second.sql')

      fs.writeFileSync(
        path.join(folder, '00000000000002_second.sql'),
        'create table second_probe (id int);\n',
      )
      await runMigrations(target.db.url, { folder, entities: [] })
      const after = await target.db.query<{ name: string }>(`select name from ${LEDGER} order by 1`)
      expect(after.rows.map((row) => row.name)).toEqual([
        '00000000000001_first.sql',
        '00000000000002_second.sql',
      ])
      const tables = await target.db.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_name like '%_probe' order by 1`,
      )
      expect(tables.rows.map((row) => row.table_name)).toEqual(['first_probe', 'second_probe'])
    } finally {
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })
})
