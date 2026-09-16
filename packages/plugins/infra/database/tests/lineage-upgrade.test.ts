import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrator.ts'
import { createTestContext, postgresAvailable } from '../src/testkit.ts'

// An instance that stopped at an earlier release upgrades to this one.
//
// Replaying the whole lineage onto an empty database is what `qualy database
// verify` proves; a deployment never does that twice. It applies the tail of
// the lineage onto a database that already holds the head, with the ledger
// saying where it stopped. So: build a database at a historical cut of the
// committed lineage, bring it up to date the way the migration job does, and
// compare it object by object with one built in a single pass. The ledger
// must name every migration, and the schema must not know the difference.
//
// Two cuts: the release that was deployed on 2026-09-12, which is the
// database that actually exists somewhere, and the midpoint of the lineage,
// which makes the upgrade long enough to cross most of its history.

const LINEAGE = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))
const DEPLOYED_STAMP = '20260912235959'

const migrations = fs
  .readdirSync(LINEAGE)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const cuts = [
  {
    label: 'the release deployed on 2026-09-12',
    count: migrations.filter((name) => name.slice(0, 14) <= DEPLOYED_STAMP).length,
  },
  { label: 'the midpoint of the lineage', count: Math.floor(migrations.length / 2) },
]

interface Db {
  readonly url: string
  query<Row>(text: string): Promise<{ rows: Row[] }>
}

/** every object in the public schema, as text lines, in a stable order */
const describeSchema = async (db: Db) => {
  const read = async (sql: string) =>
    (await db.query<Record<string, string>>(sql)).rows.map((row) => Object.values(row)[0]!)
  return {
    extensions: await read(`select extname || ' ' || extversion from pg_extension order by 1`),
    functions: await read(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid))
       from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`,
    ),
    tables: await read(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    ),
    columns: await read(
      `select table_name || '.' || column_name || ' ' || data_type
         || coalesce('(' || character_maximum_length || ')', '')
         || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', '')
         || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
       from information_schema.columns where table_schema = 'public' order by 1`,
    ),
    constraints: await read(
      `select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
       from pg_constraint where connamespace = 'public'::regnamespace order by 1`,
    ),
    indexes: await read(`select indexdef from pg_indexes where schemaname = 'public' order by 1`),
    triggers: await read(
      `select c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal order by 1`,
    ),
    ledger: await read(`select name from mikro_orm_migrations order by name`),
  }
}

describe.runIf(postgresAvailable)('upgrading a database from an earlier release', () => {
  it.each(cuts)('$label: applying the rest ends where one pass ends', async ({ count }) => {
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(migrations.length)
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lineage-prefix-'))
    for (const name of migrations.slice(0, count)) {
      fs.copyFileSync(path.join(LINEAGE, name), path.join(prefix, name))
    }
    const old = await createTestContext(`lineage-upgrade-${String(count)}`, {
      migrationsFolder: prefix,
    })
    const fresh = await createTestContext(`lineage-fresh-${String(count)}`)
    try {
      const before = await describeSchema(old)
      expect(before.ledger).toEqual(migrations.slice(0, count))

      // the migration job, against a database whose ledger stops early
      const { applied } = await runMigrations(old.url, { folder: LINEAGE, entities: [] })
      expect(applied).toBe(migrations.length - count)

      const upgraded = await describeSchema(old)
      const single = await describeSchema(fresh)
      expect(upgraded.ledger).toEqual(migrations)
      expect(upgraded).toEqual(single)
    } finally {
      await Promise.all([old.dispose(), fresh.dispose()])
      fs.rmSync(prefix, { recursive: true, force: true })
    }
  })
})
