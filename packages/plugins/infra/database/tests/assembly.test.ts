import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  capabilityWorkContext,
  commitLock,
  createWorkspace,
  resolveWorkspace,
} from '@qualy/assembly/testkit'
import { createTestContext, postgresAvailable } from '../src/testkit.ts'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import provider, { type DatabaseContribution, type DatabaseState } from '../src/assembly/index.ts'
import { collectBaseline, compiledBaseline, pendingBaseline } from '../src/assembly/baseline.ts'
import { declaredEntityModules } from '../src/assembly/entities.ts'
import { execFileSync } from 'node:child_process'
import {
  allMigrationFiles,
  changedMigrationFiles,
  scanDestructive,
} from '../src/assembly/drop-guard.ts'
import { guardDestructive } from '../src/assembly/generate.ts'
import { asState } from '../src/assembly/state.ts'
import { databaseTarget, databaseWork, LOCAL_FALLBACK } from '../src/assembly/work.ts'
import { diffAgainstDeclared } from '../src/assembly/diff.ts'
import { defineEntity } from '@mikro-orm/core'
import type { EntityModule } from '../src/assembly/entities.ts'

// Can a plugin selection other than this repository's own build a lineage from
// nothing and deploy it?
//
// Adding a plugin on top of the migrations already committed proved only that
// the generator can build a schema from them. Starting from an empty migrations directory is
// a different question, and the answer was no for every selection tried,
// including the default one: `CREATE EXTENSION ltree` lived in a hand-written
// host migration, a schema generator reproduces tables and nothing else, and org_nodes
// cannot be created without the type that extension provides. The plugin that
// needed it already said so in a comment, `-- owner: @qualy/plugin-org`; it
// just had no way to carry it.

const INFRA = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']

// org, auth and rbac are one selection, not three. They contribute codes to
// the permissions capability rbac provides, and rbac's tables reference
// auth's, so any of them alone is an assembly resolution refuses - which was
// always true of running one of them alone, and is now true of resolving it.
const AUTHORIZED = ['@qualy/plugin-org', '@qualy/plugin-auth', '@qualy/plugin-rbac']

// where a throwaway assembly keeps its lineage: the same declaration the
// runtime reads, so generation and application cannot mean different folders
const LEDGER = 'mikro_orm_migrations'

/** the variable a deployment addresses its database with, for one call */
const withDatabaseUrl = async <A>(url: string, body: () => Promise<A>): Promise<A> => {
  const before = process.env.DATABASE_URL
  process.env.DATABASE_URL = url
  try {
    return await body()
  } finally {
    if (before === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = before
  }
}
const MIGRATIONS = 'migrations'
const workspaceFor = (plugins: readonly string[], options: { disabled?: readonly string[] } = {}) =>
  createWorkspace(plugins, {
    ...options,
    configs: { '@qualy/plugin-database': { migrationsFolder: MIGRATIONS } },
  })
const migrationsOf = (workspace: ReturnType<typeof createWorkspace>) =>
  path.join(workspace.dir, MIGRATIONS)

const context = async (workspace: ReturnType<typeof createWorkspace>) => {
  await commitLock(workspace)
  return (await capabilityWorkContext(workspace, 'database')) as CapabilityWorkContext<
    DatabaseContribution,
    DatabaseState
  >
}

/** the lineage this selection produces with nothing behind it */
async function generateFromNothing(workspace: ReturnType<typeof createWorkspace>) {
  const work = await context(workspace)
  await provider.generate!(work)
  return work
}

describe('database contributions', () => {
  it('carries the sql a plugin owns but no schema comparison can see', async () => {
    const workspace = workspaceFor([...INFRA, ...AUTHORIZED])
    try {
      const work = await context(workspace)
      const ltree = collectBaseline(work, asState(work.state)).find(
        (fragment) => fragment.plugin === '@qualy/plugin-org',
      )
      expect(ltree).toBeDefined()
      // before the structure, because a column type depends on it
      expect(ltree!.phase).toBe('pre-structure')
      expect(ltree!.sql).toMatch(/CREATE EXTENSION IF NOT EXISTS ltree/)
    } finally {
      workspace.dispose()
    }
  })

  it('treats a compiled fragment as history', async () => {
    const workspace = workspaceFor([...INFRA, ...AUTHORIZED])
    try {
      const work = await context(workspace)
      const fragments = collectBaseline(work, asState(work.state))
      const compiled = new Map(
        fragments.map((fragment) => [`${fragment.plugin} ${fragment.file}`, 'a-different-hash']),
      )
      // editing a fragment databases have already run would leave the lineage
      // and the package disagreeing about what was applied
      const carried = asState(work.state).order
      expect(() => pendingBaseline(fragments, compiled, carried)).toThrow(
        /changed after they were compiled/,
      )
      expect(
        pendingBaseline(
          fragments,
          new Map(fragments.map((f) => [`${f.plugin} ${f.file}`, f.sha])),
          carried,
        ),
      ).toEqual([])

      // and losing one is the same fault as editing one, including when it was
      // the plugin's only fragment. The check used to ask whether the plugin
      // still had SOME fragment on disk, so deleting the last one - the shape
      // org actually has, one file holding the extension its column type needs
      // - produced a lineage that failed on every empty database
      expect(() =>
        pendingBaseline(
          [],
          new Map(fragments.map((f) => [`${f.plugin} ${f.file}`, f.sha])),
          carried,
        ),
      ).toThrow(/no longer exist/)

      // a plugin that has left the assembly keeps its history instead
      expect(
        pendingBaseline([], new Map(fragments.map((f) => [`${f.plugin} ${f.file}`, f.sha])), []),
      ).toEqual([])
    } finally {
      workspace.dispose()
    }
  })

  it('aggregates the schema of plugins that are switched off or removed', async () => {
    // neither switching a plugin off nor taking it out of the manifest removes
    // its tables, so neither may change what the declared schema is built from
    const selection = [...INFRA, ...AUTHORIZED, '@qualy/plugin-ping']
    const enabled = workspaceFor(selection)
    const disabled = workspaceFor(selection, { disabled: ['@qualy/plugin-ping'] })
    const removed = workspaceFor(selection)
    try {
      const of = async (workspace: ReturnType<typeof createWorkspace>) => {
        const work = await context(workspace)
        return declaredEntityModules(work, asState(work.state)).map((module) => module.pluginId)
      }
      const baseline = await of(enabled)
      expect(baseline).toEqual([
        '@qualy/plugin-org',
        '@qualy/plugin-auth',
        '@qualy/plugin-ping',
        '@qualy/plugin-rbac',
      ])
      expect(await of(disabled)).toEqual(baseline)

      await commitLock(removed)
      removed.writeManifest(selection.filter((id) => id !== '@qualy/plugin-ping'))
      expect(await of(removed)).toEqual(baseline)
    } finally {
      enabled.dispose()
      disabled.dispose()
      removed.dispose()
    }
  })
})

// Which database the cli reaches, and whether anything says so.
//
// The process refuses to assume one in production and names the one it
// assumed otherwise (src/server/config.ts). The cli took the same fallback in
// silence, so a deploy meant for staging applied the lineage to whatever
// postgres answers on localhost and printed the line it prints when it was
// right.
describe('the target of a work phase', () => {
  const withEnv = <A>(values: Record<string, string | undefined>, body: () => A): A => {
    const before = Object.keys(values).map((key) => [key, process.env[key]] as const)
    const set = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const [key, value] of Object.entries(values)) set(key, value)
    try {
      return body()
    } finally {
      for (const [key, value] of before) set(key, value)
    }
  }

  it('names the database it assumed, and assumes none in production', async () => {
    const workspace = workspaceFor(INFRA)
    const warnings: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
      warnings.push(parts.join(' '))
    })
    try {
      const work = await context(workspace)
      const assumed = withEnv({ DATABASE_URL: undefined, NODE_ENV: 'development' }, () =>
        databaseWork(work),
      )
      expect(assumed.url).toBe(LOCAL_FALLBACK)
      expect(warnings.join('\n')).toContain(LOCAL_FALLBACK)

      // the phases this feeds apply migrations; being softer than the process
      // that only reads is how a deployment writes to a database nobody meant
      // to give it
      withEnv({ DATABASE_URL: undefined, NODE_ENV: 'production' }, () => {
        expect(() => databaseWork(work)).toThrow(/will not assume a database/)
      })

      // and a stated target is not something to warn about
      warnings.length = 0
      const named = withEnv(
        { DATABASE_URL: 'postgres://qualy:qualy@db.internal:5432/staging', NODE_ENV: 'production' },
        () => databaseWork(work),
      )
      expect(named.url).toBe('postgres://qualy:qualy@db.internal:5432/staging')
      expect(warnings).toEqual([])
    } finally {
      warn.mockRestore()
      workspace.dispose()
    }
  })

  it('renders a target a success line can carry, without the password', () => {
    expect(databaseTarget('postgres://qualy:hunter2@db.internal:5432/staging')).toBe(
      'db.internal:5432/staging',
    )
    expect(databaseTarget('postgres://qualy:hunter2@db.internal:5432/staging')).not.toMatch(
      /hunter2/,
    )
    // an unparseable url still has to produce a line rather than an exception
    expect(databaseTarget('not a url')).toBe('the configured database')
  })
})

describe('database dependency graph', () => {
  const orderOf = async (workspace: ReturnType<typeof createWorkspace>) =>
    asState((await context(workspace)).state).order

  it('refuses a selection that leaves a schema dependency behind', async () => {
    // rbac's tables reference auth's. Without this the failure arrives from
    // postgres midway through applying a migration, naming a relation rather
    // than the plugin that owns it. rbac is in the selection so the permissions
    // capability is satisfied and this is the only thing left to refuse.
    const workspace = workspaceFor([...INFRA, '@qualy/plugin-org', '@qualy/plugin-rbac'])
    try {
      await expect(orderOf(workspace)).rejects.toThrow(
        /@qualy\/plugin-rbac needs @qualy\/plugin-auth, which this assembly does not include/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('orders by declared dependency, not by the file', async () => {
    const forward = workspaceFor([...INFRA, ...AUTHORIZED])
    const reversed = workspaceFor([
      '@qualy/plugin-rbac',
      '@qualy/plugin-auth',
      '@qualy/plugin-org',
      ...INFRA,
    ])
    try {
      for (const workspace of [forward, reversed]) {
        const order = await orderOf(workspace)
        expect(order.indexOf('@qualy/plugin-org')).toBeLessThan(order.indexOf('@qualy/plugin-auth'))
      }
    } finally {
      forward.dispose()
      reversed.dispose()
    }
  })

  it('refuses a cycle and names the path', async () => {
    // tables are created in this order, so it has to exist
    // descriptor literals with a database declaration, no real entities needed
    const declaring = (id: string, dependsOn: string) => ({
      id,
      files: {
        'index.js': [
          `export default { _tag: 'Plugin', id: '${id}', dependsOn: [], features: [{`,
          `  _tag: 'Contribute', point: { id: '@qualy/plugin-database/entities' },`,
          `  value: { entities: [{ meta: { className: '${id.slice(6)}', tableName: '${id.slice(6)}' } }], dependsOn: ['${dependsOn}'] },`,
          '}] }',
        ].join('\n'),
      },
    })
    const cyclic = createWorkspace([...INFRA, '@fake/plugin-a', '@fake/plugin-b'], {
      configs: { '@qualy/plugin-database': { migrationsFolder: MIGRATIONS } },
      synthetic: [
        declaring('@fake/plugin-a', '@fake/plugin-b'),
        declaring('@fake/plugin-b', '@fake/plugin-a'),
      ],
    })
    try {
      await expect(orderOf(cyclic)).rejects.toThrow(
        /database dependency cycle: @fake\/plugin-a -> @fake\/plugin-b -> @fake\/plugin-a/,
      )
    } finally {
      cyclic.dispose()
    }
  })
})

describe('drop guard', () => {
  it('refuses a destructive statement unless it has been approved', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-guard-'))
    try {
      const write = (name: string, sql: string) => {
        const file = path.join(dir, name)
        fs.writeFileSync(file, sql)
        return file
      }
      const plain = write('0001_plain.sql', 'CREATE TABLE a (id uuid);\n')
      const destructive = write('0002_drop.sql', 'DROP TABLE a;\n')
      const approved = write('0003_ok.sql', '-- destructive: approved\nDROP TABLE a;\n')

      expect(allMigrationFiles(dir).sort()).toEqual([plain, destructive, approved].sort())
      expect(scanDestructive([plain])).toEqual([])
      expect(scanDestructive([approved])).toEqual([])
      expect(scanDestructive([destructive])).toHaveLength(1)
      expect(() => guardDestructive([destructive])).toThrow(/destructive statements detected/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // The CLI is anchored at its own location and works from any directory, so
  // this one has to as well. git prints repository-relative paths whatever the
  // cwd is; resolving those against process.cwd() dropped every changed file
  // the moment the command ran from a subdirectory, and a guard that scans
  // nothing reports success - the one failure mode this gate must not have.
  it('finds the migrations a ref changed from any working directory', () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-guard-git-')))
    const cwd = process.cwd()
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
      git('init', '-q')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'test')
      const migrations = path.join(repo, 'db', 'migrations')
      fs.mkdirSync(migrations, { recursive: true })
      fs.writeFileSync(path.join(migrations, '0001_base.sql'), 'CREATE TABLE a (id uuid);\n')
      git('add', '.')
      git('commit', '-qm', 'base')
      fs.writeFileSync(path.join(migrations, '0002_drop.sql'), 'DROP TABLE a;\n')
      git('add', '.')
      git('commit', '-qm', 'destructive')

      const deep = path.join(repo, 'db')
      for (const from of [repo, deep, cwd]) {
        process.chdir(from)
        const changed = changedMigrationFiles(migrations, 'HEAD~1')
        expect(changed.map((file) => path.basename(file))).toEqual(['0002_drop.sql'])
        expect(() => guardDestructive(changed)).toThrow(/destructive statements detected/)
      }
    } finally {
      process.chdir(cwd)
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe.runIf(postgresAvailable).concurrent('assembly deployment', () => {
  const selections: Record<string, string[]> = {
    // no auth, no rbac: the smallest thing that still owns tables
    minimal: [...INFRA, ...AUTHORIZED],
    // what this repository ships
    full: [
      ...INFRA,
      '@qualy/plugin-ping',
      '@qualy/plugin-web',
      '@qualy/plugin-rbac',
      '@qualy/plugin-auth',
      '@qualy/plugin-org',
      '@qualy/plugin-auth-local',
      '@qualy/plugin-layout-default',
    ],
  }

  for (const [name, plugins] of Object.entries(selections)) {
    it(`deploys the ${name} selection to an empty database`, async () => {
      const workspace = workspaceFor(plugins)
      await generateFromNothing(workspace)
      // the plugin applies the generated lineage on the path production uses,
      // so this asserts deployment rather than a hand-rolled replay
      const db = await createTestContext(`assembly-${name}`, {
        migrationsFolder: migrationsOf(workspace),
      })
      try {
        const tables = await db.row<{ count: number }>(
          `select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
        )
        expect(tables.count).toBeGreaterThan(0)
        // and the extension the structure depends on really did land first
        const extension = await db.row<{ count: number }>(
          `select count(*)::int as count from pg_extension where extname = 'ltree'`,
        )
        expect(extension.count).toBe(1)
      } finally {
        await db.dispose()
        workspace.dispose()
      }
    })
  }

  it('refuses a destructive migration without leaving it behind', async () => {
    // the guard used to run on the file it had just written, so a refused
    // migration stayed in the lineage: the next deploy would apply it, and the
    // next generation would read its baseline markers as already compiled and
    // never emit those fragments again
    const workspace = createWorkspace([...INFRA, '@fake/plugin-drops'], {
      configs: { '@qualy/plugin-database': { migrationsFolder: MIGRATIONS } },
      synthetic: [
        {
          id: '@fake/plugin-drops',
          files: {
            'index.js': [
              "export default { _tag: 'Plugin', id: '@fake/plugin-drops', dependsOn: [], features: [{",
              "  _tag: 'Contribute', point: { id: '@qualy/plugin-database/entities' },",
              "  value: { entities: [], baselineDir: './baseline' },",
              '}] }',
            ].join('\n'),
            'baseline/0001_drop.sql': 'DROP TABLE IF EXISTS whatever;\n',
          },
        },
      ],
    })
    try {
      const work = await context(workspace)
      await expect(provider.generate!(work)).rejects.toThrow(/destructive statements detected/)
      expect(allMigrationFiles(migrationsOf(workspace))).toEqual([])
      expect(fs.readdirSync(migrationsOf(workspace))).toEqual([])
    } finally {
      workspace.dispose()
    }
  })

  it('keeps the tables of a detached plugin in the lineage', async () => {
    // taking a plugin out of the manifest must not make the generator see its tables
    // disappear, because the data is still there
    const selection = [...INFRA, ...AUTHORIZED, '@qualy/plugin-ping']
    const workspace = workspaceFor(selection)
    try {
      await generateFromNothing(workspace)
      const db = await createTestContext('assembly-detached', {
        migrationsFolder: migrationsOf(workspace),
      })
      try {
        const before = await db.row<{ count: number }>(
          `select count(*)::int as count from information_schema.tables where table_name = 'ping_logs'`,
        )
        expect(before.count).toBe(1)
      } finally {
        await db.dispose()
      }

      // ping leaves the manifest, and the next generation has nothing to say
      workspace.writeManifest(selection.filter((id) => id !== '@qualy/plugin-ping'))
      const work = await context(workspace)
      expect((await resolveWorkspace(workspace)).plugins.get('@qualy/plugin-ping')!.state).toBe(
        'detached',
      )
      await provider.generate!(work)
      const sql = fs
        .readdirSync(migrationsOf(workspace))
        .filter((entry) => entry.endsWith('.sql'))
        .map((entry) => fs.readFileSync(path.join(migrationsOf(workspace), entry), 'utf8'))
        .join('\n')
      expect(sql).not.toMatch(/DROP TABLE/i)
    } finally {
      workspace.dispose()
    }
  })
})

// Adopting a database means recording a lineage as applied without running it,
// so the only thing standing between it and a permanently wrong ledger is what
// the command checks first. It had no coverage at all.
describe.runIf(postgresAvailable)('adopting an existing database', () => {
  it('carries the baseline objects the structural comparison cannot see', async () => {
    const workspace = workspaceFor([...INFRA, ...AUTHORIZED])
    await generateFromNothing(workspace)
    // a database built by the lineage, then stripped of exactly what a
    // fragment guarantees: structurally identical, semantically missing the
    // extension its own column type depends on
    const db = await createTestContext('assembly-adopt', {
      migrationsFolder: migrationsOf(workspace),
    })
    try {
      await db.query(`delete from ${LEDGER}`)
      // the work context reads the target from the environment, the way a
      // deployment addresses one database with one variable
      const work = await withDatabaseUrl(db.url, () => context(workspace))
      await withDatabaseUrl(db.url, () => provider.commands!.adopt!(work))

      const ledger = await db.row<{ count: number }>(`select count(*)::int as count from ${LEDGER}`)
      expect(ledger.count).toBeGreaterThan(0)
      // the fragment ran rather than being assumed: ltree is what org's
      // baseline exists for, and nothing structural would have noticed
      const extension = await db.row<{ count: number }>(
        `select count(*)::int as count from pg_extension where extname = 'ltree'`,
      )
      expect(extension.count).toBe(1)
    } finally {
      await db.dispose()
      workspace.dispose()
    }
  })

  it('refuses a database whose structure is not the one this assembly declares', async () => {
    const workspace = workspaceFor([...INFRA, ...AUTHORIZED])
    await generateFromNothing(workspace)
    const db = await createTestContext('assembly-adopt-differs', {
      migrationsFolder: migrationsOf(workspace),
    })
    try {
      await db.query(`delete from ${LEDGER}`)
      await db.query('alter table org_nodes drop column name')
      const work = await withDatabaseUrl(db.url, () => context(workspace))
      await expect(withDatabaseUrl(db.url, () => provider.commands!.adopt!(work))).rejects.toThrow(
        /is not the schema/,
      )
      // and it wrote nothing: a refused adoption must leave the ledger empty
      const ledger = await db.row<{ count: number }>(`select count(*)::int as count from ${LEDGER}`)
      expect(ledger.count).toBe(0)
    } finally {
      await db.dispose()
      workspace.dispose()
    }
  })
})

// An index whose name stayed and whose body changed.
//
// The comparator cannot see one: an index declared through the raw
// `expression` escape hatch is matched by name alone, and it says so
// (repos/mikro-orm/packages/sql/src/schema/SchemaComparator.ts, `diffIndex`).
// That is not a defect - nothing decides whether two arbitrary SQL
// expressions mean the same thing by reading them - but it did once cost a
// hand-written migration, which is the failure this suite exists to prevent:
// a lineage nobody can regenerate.
//
// Because both sides of the diff are real databases, postgres answers it
// instead. The declared index goes in, comes back normalised, and two
// normalised definitions are equal exactly when the indexes are the same.

const probeEntity = (indexBody: string) =>
  defineEntity({
    name: 'DiffProbe',
    tableName: 'diff_probe',
    properties: {
      id: defineEntity.properties.uuid().primary().defaultRaw('uuidv7()'),
      tenantId: defineEntity.properties.uuid(),
      resourceId: defineEntity.properties.uuid().nullable(),
    },
    indexes: [
      {
        name: 'uq_diff_probe',
        expression: `create unique index uq_diff_probe on diff_probe (${indexBody})`,
      },
    ],
  })

const probeModule = (indexBody: string): EntityModule => ({
  pluginId: '@qualy/plugin-diff-probe',
  entities: [probeEntity(indexBody)],
})

describe.runIf(postgresAvailable)('generation', () => {
  it('replaces an index whose definition changed under the same name', async () => {
    // no lineage at all: this is about the generator, not about the product's
    // schema, so the database starts as empty as a fresh install's
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-diff-'))
    const db = await createTestContext('diff-index-body', { migrationsFolder: empty })
    try {
      // built through the generator too, so the starting shape is one it
      // produced rather than one the test wrote by hand
      const before = await diffAgainstDeclared(db.url, db.url, [probeModule('tenant_id')], [])
      for (const statement of before.up) await db.query(statement)

      const after = await diffAgainstDeclared(
        db.url,
        db.url,
        [probeModule(`tenant_id, coalesce(resource_id, '00000000-0000-0000-0000-000000000000')`)],
        [],
      )
      expect(after.up).toHaveLength(2)
      expect(after.up[0]).toBe('drop index "uq_diff_probe"')
      expect(after.up[1]).toMatch(/COALESCE\(resource_id/)

      // and it applies, on the database it was computed against
      for (const statement of after.up) await db.query(statement)
      // idempotent once it has: the same declaration diffs to nothing, which
      // is what stops a redefinition being emitted into every later migration
      const settled = await diffAgainstDeclared(
        db.url,
        db.url,
        [probeModule(`tenant_id, coalesce(resource_id, '00000000-0000-0000-0000-000000000000')`)],
        [],
      )
      expect(settled.up).toEqual([])
    } finally {
      await db.dispose()
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })
})
