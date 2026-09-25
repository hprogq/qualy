import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import {
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_TIMEOUT_VARIABLE,
  pendingMigrations,
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
      ).rejects.toThrow(
        /another migration run has held the lock on .*migrator_lock_timeout.* for 500ms/,
      )
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

  // A validate-only start is the one path whose whole purpose is to leave
  // the database exactly as it found it, and production's default is that
  // path. Asking the migrator its own question used to create the ledger.
  it('counts what is pending without writing anything', async () => {
    const target = await emptyDatabase('migrator-read-only-count')
    const folder = lineage({
      '00000000000001_first.sql': 'create table counted_probe (id int);\n',
      '00000000000002_second.sql': 'create table counted_probe_two (id int);\n',
    })
    try {
      const before = await pendingMigrations(target.db.url, { folder, entities: [] })
      const ledger = await target.db.query<{ here: string | null }>(
        `select to_regclass('${LEDGER}')::text as here`,
      )
      expect(before).toBe(2)
      // the count is the whole lineage, and the question left no trace
      expect(ledger.rows[0]?.here).toBe(null)

      await runMigrations(target.db.url, { folder, entities: [] })
      expect(await pendingMigrations(target.db.url, { folder, entities: [] })).toBe(0)
    } finally {
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  }, 120_000)

  it('refuses a database that is not there, by its name, without creating it', async () => {
    const folder = lineage({ '00000000000001_probe.sql': 'create table missing_probe (id int);\n' })
    const target = await emptyDatabase('migrator-missing-target')
    const missing = new URL(target.db.url)
    missing.pathname = `/qualy_absent_${Date.now().toString(36)}`
    const name = missing.pathname.slice(1)
    try {
      await expect(pendingMigrations(missing.href, { folder, entities: [] })).rejects.toThrow(
        new RegExp(`there is no database named ${name}`),
      )
      await expect(runMigrations(missing.href, { folder, entities: [] })).rejects.toThrow(
        new RegExp(`there is no database named ${name}`),
      )
      const created = await target.db.query('select 1 from pg_database where datname = $1', [name])
      expect(created.rows).toHaveLength(0)
    } finally {
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  // A pooler configured for the application's database alone, or a role
  // without CONNECT on `postgres`, refused every start - the validate-only
  // production one included - with an error about a database the
  // deployment never named.
  it('connects to nothing but the database it was given', async () => {
    const target = await emptyDatabase('migrator-no-maintenance')
    const folder = lineage({ '00000000000001_probe.sql': 'create table reached_probe (id int);\n' })
    // every session anything opens, pools included: pg's Client is where
    // each of them connects
    const reached: string[] = []
    // a pool connects with a callback and a lone client with a promise; both
    // go through untouched
    const original: (this: Client, ...args: unknown[]) => unknown = Client.prototype.connect
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(function (
      this: Client,
      ...args: unknown[]
    ) {
      reached.push(String((this as unknown as { database: unknown }).database))
      return original.apply(this, args)
    })
    try {
      await pendingMigrations(target.db.url, { folder, entities: [] })
      await runMigrations(target.db.url, { folder, entities: [] })
      const name = new URL(target.db.url).pathname.slice(1)
      expect(reached.length).toBeGreaterThan(0)
      expect(new Set(reached)).toEqual(new Set([name]))
    } finally {
      connect.mockRestore()
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  // The application's request limits travel on DATABASE_URL, and the deploy
  // job reads the same .env: a url tightened for requests used to end a long
  // backfill, a DDL queued behind a running server, or the wait for another
  // run's lock - which then failed as a canceled statement rather than
  // with the refusal that names the target.
  it('runs under none of the request limits the url carries', async () => {
    const target = await emptyDatabase('migrator-url-limits')
    await target.db.query('create table held_probe (id int)')
    const folder = lineage({
      '00000000000001_slow.sql': [
        // queued behind a transaction holding the table
        'alter table held_probe add column noted int;',
        // longer than the url's statement limit
        'select pg_sleep(0.3);',
        `create table limits_probe as select
           current_setting('statement_timeout') as statement,
           current_setting('lock_timeout') as lock,
           current_setting('idle_in_transaction_session_timeout') as idle_in_transaction,
           current_setting('idle_session_timeout') as idle;`,
      ].join('\n'),
    })
    const limited = new URL(target.db.url)
    limited.searchParams.set('statement_timeout', '100')
    limited.searchParams.set('lock_timeout', '100')
    limited.searchParams.set('idle_in_transaction_session_timeout', '100')
    // another run holding the migration lock, and a transaction holding the
    // table, each for longer than the url allows a wait
    const run = new Client({ connectionString: target.db.url })
    const reader = new Client({ connectionString: target.db.url })
    await run.connect()
    await reader.connect()
    try {
      await run.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
      await reader.query('begin')
      await reader.query('lock table held_probe in access share mode')
      const applying = runMigrations(limited.href, { folder, entities: [] })
      await new Promise((resolve) => setTimeout(resolve, 500))
      await run.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      await new Promise((resolve) => setTimeout(resolve, 500))
      await reader.query('commit')

      const { applied } = await applying
      expect(applied).toBe(1)
      const seen = await target.db.query<Record<string, string>>('select * from limits_probe')
      expect(seen.rows).toEqual([
        { statement: '0', lock: '0', idle_in_transaction: '0', idle: '0' },
      ])
    } finally {
      await reader.end().catch(() => {})
      await run.end().catch(() => {})
      await target.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  // A pooler that drops startup parameters leaves the limits to the
  // database's own defaults (docs/deployment.md), which every new session
  // takes, the migrator's included.
  it('runs under none of the limits the database gives its sessions either', async () => {
    const target = await emptyDatabase('migrator-database-limits')
    const folder = lineage({
      '00000000000001_slow.sql': 'select pg_sleep(0.3);\ncreate table slow_probe (id int);\n',
    })
    const name = new URL(target.db.url).pathname.slice(1)
    await target.db.query(`alter database "${name}" set statement_timeout = 100`)
    try {
      const { applied } = await runMigrations(target.db.url, { folder, entities: [] })
      expect(applied).toBe(1)
    } finally {
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
