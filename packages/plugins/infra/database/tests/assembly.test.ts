import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
import { entityContributions } from '../src/assembly/entities.ts'
import { allMigrationFiles, scanDestructive } from '../src/assembly/drop-guard.ts'
import { guardDestructive } from '../src/assembly/generate.ts'
import { asState } from '../src/assembly/state.ts'

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

// where a throwaway assembly keeps its lineage: the same declaration the
// runtime reads, so generation and application cannot mean different folders
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
    const workspace = workspaceFor([...INFRA, '@qualy/plugin-org'])
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
    const workspace = workspaceFor([...INFRA, '@qualy/plugin-org'])
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
    const selection = [...INFRA, '@qualy/plugin-org', '@qualy/plugin-ping']
    const enabled = workspaceFor(selection)
    const disabled = workspaceFor(selection, { disabled: ['@qualy/plugin-ping'] })
    const removed = workspaceFor(selection)
    try {
      // named by plugin, because every entities file is called
      // src/db/entities.ts and comparing basenames would assert only how many
      // there are
      const of = async (workspace: ReturnType<typeof createWorkspace>) => {
        const work = await context(workspace)
        return entityContributions(work, asState(work.state)).map((entry) =>
          entry.file.replace(/^.*\/packages\/plugins\//, ''),
        )
      }
      const baseline = await of(enabled)
      expect(baseline).toEqual(['base/org/src/db/entities.ts', 'demo/ping/src/db/entities.ts'])
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

describe('database dependency graph', () => {
  const orderOf = async (workspace: ReturnType<typeof createWorkspace>) =>
    asState((await context(workspace)).state).order

  it('refuses a selection that leaves a schema dependency behind', async () => {
    // rbac's tables reference auth's. Without this the failure arrives from
    // postgres midway through applying a migration, naming a relation rather
    // than the plugin that owns it.
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
    const forward = workspaceFor([...INFRA, '@qualy/plugin-org', '@qualy/plugin-auth'])
    const reversed = workspaceFor(['@qualy/plugin-auth', '@qualy/plugin-org', ...INFRA])
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
    const contribution = (dependsOn: string) => ({
      contributions: { database: { entitiesEntry: 'index.js', dependsOn: [dependsOn] } },
    })
    const cyclic = createWorkspace([...INFRA, '@fake/plugin-a', '@fake/plugin-b'], {
      configs: { '@qualy/plugin-database': { migrationsFolder: MIGRATIONS } },
      synthetic: [
        { id: '@fake/plugin-a', qualy: contribution('@fake/plugin-b') },
        { id: '@fake/plugin-b', qualy: contribution('@fake/plugin-a') },
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
})

describe.runIf(postgresAvailable).concurrent('assembly deployment', () => {
  const selections: Record<string, string[]> = {
    // no auth, no rbac: the smallest thing that still owns tables
    minimal: [...INFRA, '@qualy/plugin-org'],
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

  it('keeps the tables of a detached plugin in the lineage', async () => {
    // taking a plugin out of the manifest must not make the generator see its tables
    // disappear, because the data is still there
    const selection = [...INFRA, '@qualy/plugin-org', '@qualy/plugin-ping']
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
