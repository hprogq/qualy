import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectBaseline,
  compiledBaseline,
  pendingBaseline,
  renderBaseline,
} from '../lib/baseline.ts'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import {
  commitLock,
  createWorkspace,
  writeDrizzleConfig,
  type Workspace,
} from './support/workspace.ts'

// Can a plugin selection other than this repository's own build a lineage
// from nothing and deploy it?
//
// Adding a plugin on top of the migrations already committed proved only that
// drizzle can diff against them. Starting from an empty migrations directory
// is a different question, and the answer was no for every selection tried,
// including the default one: `CREATE EXTENSION ltree` lived in a hand-written
// host migration, drizzle-kit reproduces tables and nothing else, and
// org_nodes cannot be created without the type that extension provides. The
// plugin that needed it already said so in a comment, `-- owner:
// @qualy/plugin-org`; it just had no way to carry it.

const DRIZZLE = path.join(process.cwd(), 'node_modules/.bin/drizzle-kit')

/** the lineage this workspace's selection produces with nothing behind it */
function generateFromNothing(workspace: Workspace): { fragments: number } {
  const config = writeDrizzleConfig(workspace)
  execFileSync(DRIZZLE, ['generate', '--config', config, '--name', 'baseline'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  })

  const pending = pendingBaseline(
    collectBaseline({ ymlPath: workspace.manifestPath }),
    compiledBaseline(workspace.migrationsDir),
  )
  const created = fs
    .readdirSync(workspace.migrationsDir)
    .find((entry) => fs.existsSync(path.join(workspace.migrationsDir, entry, 'migration.sql')))!
  const file = path.join(workspace.migrationsDir, created, 'migration.sql')
  const structure = fs.readFileSync(file, 'utf8').trim()
  const phase = (want: string) =>
    pending.filter((fragment) => fragment.phase === want).map(renderBaseline)
  fs.writeFileSync(
    file,
    `${[...phase('pre-structure'), structure, ...phase('post-structure')].join(
      '--> statement-breakpoint\n\n',
    )}\n`,
  )
  return { fragments: pending.length }
}

describe('baseline fragments', () => {
  it('carries the sql a plugin owns but drizzle cannot see', () => {
    const fragments = collectBaseline()
    const ltree = fragments.find((fragment) => fragment.plugin === '@qualy/plugin-org')
    expect(ltree).toBeDefined()
    // before the structure, because a column type depends on it
    expect(ltree!.phase).toBe('pre-structure')
    expect(ltree!.sql).toMatch(/CREATE EXTENSION IF NOT EXISTS ltree/)
  })

  it('treats a compiled fragment as history', () => {
    const fragments = collectBaseline()
    const compiled = new Map(
      fragments.map((fragment) => [`${fragment.plugin} ${fragment.file}`, 'a-different-hash']),
    )
    // editing a fragment databases have already run would leave the lineage
    // and the package disagreeing about what was applied
    expect(() => pendingBaseline(fragments, compiled)).toThrow(/changed after they were compiled/)
  })

  it('compiles each fragment once', () => {
    const fragments = collectBaseline()
    const compiled = new Map(
      fragments.map((fragment) => [`${fragment.plugin} ${fragment.file}`, fragment.sha]),
    )
    expect(pendingBaseline(fragments, compiled)).toEqual([])
  })
})

describe.runIf(postgresAvailable)('assembly deployment', () => {
  const selections: Record<string, string[]> = {
    // no auth, no rbac: the smallest thing that still owns tables
    minimal: [
      '@qualy/plugin-database',
      '@qualy/plugin-server',
      '@qualy/plugin-ui-registry',
      '@qualy/plugin-org',
    ],
    // what this repository ships
    full: [
      '@qualy/plugin-database',
      '@qualy/plugin-server',
      '@qualy/plugin-ui-registry',
      '@qualy/plugin-ping',
      '@qualy/plugin-web',
      '@qualy/plugin-rbac',
      '@qualy/plugin-auth',
      '@qualy/plugin-org',
      '@qualy/plugin-dict',
      '@qualy/plugin-auth-local',
      '@qualy/plugin-layout-default',
      '@qualy/plugin-api-reference',
    ],
  }

  for (const [name, plugins] of Object.entries(selections)) {
    it(`deploys the ${name} selection to an empty database`, async () => {
      const workspace = createWorkspace(plugins)
      generateFromNothing(workspace)
      // the plugin applies the generated lineage on the path production
      // uses, so this asserts deployment rather than a hand-rolled replay
      const db = await createTestContext(`assembly-${name}`, {
        migrationsFolder: workspace.migrationsDir,
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
    // taking a plugin out of the manifest must not make drizzle see its
    // tables disappear, because the data is still there
    const workspace = createWorkspace([
      '@qualy/plugin-database',
      '@qualy/plugin-server',
      '@qualy/plugin-ui-registry',
      '@qualy/plugin-org',
      '@qualy/plugin-ping',
    ])
    try {
      commitLock(workspace)
      generateFromNothing(workspace)
      const db = await createTestContext('assembly-detached', {
        migrationsFolder: workspace.migrationsDir,
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
      workspace.writeManifest([
        '@qualy/plugin-database',
        '@qualy/plugin-server',
        '@qualy/plugin-ui-registry',
        '@qualy/plugin-org',
      ])
      commitLock(workspace)
      const config = writeDrizzleConfig(workspace)
      const output = execFileSync(DRIZZLE, ['generate', '--config', config], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
      expect(output).not.toMatch(/DROP TABLE/i)
      const sql = fs
        .readdirSync(workspace.migrationsDir)
        .filter((entry) =>
          fs.existsSync(path.join(workspace.migrationsDir, entry, 'migration.sql')),
        )
        .map((entry) =>
          fs.readFileSync(path.join(workspace.migrationsDir, entry, 'migration.sql'), 'utf8'),
        )
        .join('\n')
      expect(sql).not.toMatch(/DROP TABLE/i)
    } finally {
      workspace.dispose()
    }
  })
})
