import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
// Two cuts. The first is the release deployed as Deployment B, named by the
// lineage that release actually carried: tests/fixtures/lineage-deployment-b.json
// lists its migrations and their SHA-256 as `git show 05714cf2` has them, and
// this checks that every one of them is still here, byte for byte, before
// building the old database from them. A cut by timestamp would have used
// today's copies of those files, which proves a historical upgrade only as
// long as nobody has edited one. The second cut is the midpoint of the
// lineage, which makes the upgrade long enough to cross most of its history.

const LINEAGE = fileURLToPath(new URL('../../../../../db/migrations', import.meta.url))

const migrations = fs
  .readdirSync(LINEAGE)
  .filter((name) => name.endsWith('.sql'))
  .sort()

interface HistoricalLineage {
  readonly release: string
  readonly commit: string
  readonly migrations: readonly { readonly name: string; readonly sha256: string }[]
}
const deploymentB = JSON.parse(
  fs.readFileSync(new URL('./fixtures/lineage-deployment-b.json', import.meta.url), 'utf8'),
) as HistoricalLineage

const cuts = [
  {
    label: `the lineage ${deploymentB.release} deployed`,
    names: deploymentB.migrations.map((one) => one.name),
  },
  {
    label: 'the midpoint of the lineage',
    names: migrations.slice(0, Math.floor(migrations.length / 2)),
  },
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

describe('the lineage a past release carried', () => {
  it(`is still here, byte for byte: ${deploymentB.release}`, () => {
    // the fixture is only worth something while it names the current files
    expect(deploymentB.migrations.length).toBeGreaterThan(0)
    const drifted = deploymentB.migrations
      .filter((one) => {
        const at = path.join(LINEAGE, one.name)
        return (
          !fs.existsSync(at) ||
          createHash('sha256').update(fs.readFileSync(at)).digest('hex') !== one.sha256
        )
      })
      .map((one) => one.name)
    expect(drifted, 'a migration an earlier release applied was edited or removed').toEqual([])
    // and the release's lineage is a prefix of today's, in today's order
    expect(migrations.slice(0, deploymentB.migrations.length)).toEqual(
      deploymentB.migrations.map((one) => one.name),
    )
  })
})

describe.runIf(postgresAvailable)('upgrading a database from an earlier release', () => {
  it.each(cuts)('$label: applying the rest ends where one pass ends', async ({ names }) => {
    expect(names.length).toBeGreaterThan(0)
    expect(names.length).toBeLessThan(migrations.length)
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lineage-prefix-'))
    for (const name of names) {
      fs.copyFileSync(path.join(LINEAGE, name), path.join(prefix, name))
    }
    const old = await createTestContext(`lineage-upgrade-${String(names.length)}`, {
      migrationsFolder: prefix,
    })
    const fresh = await createTestContext(`lineage-fresh-${String(names.length)}`)
    try {
      const before = await describeSchema(old)
      expect(before.ledger).toEqual([...names])

      // the migration job, against a database whose ledger stops early
      const { applied } = await runMigrations(old.url, { folder: LINEAGE, entities: [] })
      expect(applied).toBe(migrations.length - names.length)

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

// The fixture names the commit it was taken from. That is only provenance
// until something checks it: the commit itself, when the clone has it, has to
// carry exactly these migrations with exactly these bytes, or the fixture has
// been edited into a release that never was. A shallow clone without the
// commit skips the check rather than guessing.
describe('the fixture of a past release', () => {
  // git pathspecs are relative to the working directory, so the repository
  // root is the place to ask from
  const REPO = path.resolve(LINEAGE, '../..')
  const inClone = (() => {
    try {
      execFileSync('git', ['cat-file', '-e', `${deploymentB.commit}^{commit}`], {
        cwd: REPO,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  })()

  it.runIf(inClone)(`is what commit ${deploymentB.commit.slice(0, 8)} carried`, () => {
    const listed = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', deploymentB.commit, '--', 'db/migrations'],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.endsWith('.sql'))
      .map((line) => path.posix.basename(line))
      .sort()
    const carried = listed.map((name) => ({
      name,
      sha256: createHash('sha256')
        .update(
          execFileSync('git', ['show', `${deploymentB.commit}:db/migrations/${name}`], {
            cwd: REPO,
          }),
        )
        .digest('hex'),
    }))
    expect(deploymentB.migrations).toEqual(carried)
  })
})
