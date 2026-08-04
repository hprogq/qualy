import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectBaseline,
  compiledBaseline,
  pendingBaseline,
  renderBaseline,
} from '../lib/baseline.ts'
import { resolveSchemaEntries } from '../lib/schema-entries.ts'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'

// Can a plugin selection other than this repository's own build a lineage
// from nothing and deploy it?
//
// Adding a plugin on top of the fourteen migrations already committed proved
// only that drizzle can diff against them. Starting from an empty migrations
// directory is a different question, and the answer was no for every
// selection tried, including the default one: `CREATE EXTENSION ltree` lived
// in a hand-written host migration, drizzle-kit reproduces tables and nothing
// else, and org_nodes cannot be created without the type that extension
// provides. The plugin that needed it already said so in a comment, `--
// owner: @qualy/plugin-org`; it just had no way to carry it.

const ROOT = process.cwd()
const DRIZZLE = path.join(ROOT, 'node_modules/.bin/drizzle-kit')

const write = (file: string, body: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
}

/** the lineage this selection would produce with nothing behind it */
function generateFromNothing(plugins: readonly string[]): { dir: string; fragments: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-assembly-'))
  const manifest = path.join(dir, 'qualy.yml')
  write(manifest, `${plugins.map((name) => `- name: '${name}'`).join('\n')}\n`)
  write(
    path.join(dir, 'drizzle.config.ts'),
    `import { defineConfig } from 'drizzle-kit'
     import { resolveSchemaEntries } from '${ROOT}/scripts/lib/schema-entries.ts'
     export default defineConfig({
       dialect: 'postgresql',
       schema: resolveSchemaEntries({ ymlPath: '${manifest}' }),
       out: '${dir}/migrations',
       migrations: { schema: 'cordis_meta', table: 'schema_migrations' },
       // generate is a diff between the schema and the snapshot, so it needs
       // no server; the credentials stay where they belong
       dbCredentials: { url: 'postgres://generate-only/unused' },
     })`,
  )
  fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true })
  execFileSync(DRIZZLE, ['generate', '--config', path.join(dir, 'drizzle.config.ts'), '--name', 'baseline'], {
    cwd: ROOT,
    stdio: 'pipe',
  })

  const migrations = path.join(dir, 'migrations')
  const pending = pendingBaseline(
    collectBaseline({ ymlPath: manifest }),
    compiledBaseline(migrations),
  )
  const created = fs.readdirSync(migrations).find((entry) =>
    fs.existsSync(path.join(migrations, entry, 'migration.sql')),
  )!
  const file = path.join(migrations, created, 'migration.sql')
  const structure = fs.readFileSync(file, 'utf8').trim()
  const phase = (want: string) =>
    pending.filter((fragment) => fragment.phase === want).map(renderBaseline)
  write(
    file,
    `${[...phase('pre-structure'), structure, ...phase('post-structure')].join(
      '--> statement-breakpoint\n\n',
    )}\n`,
  )
  return { dir: migrations, fragments: pending.length }
}

describe('assembly generation', () => {
  it('refuses a selection that leaves a schema dependency behind', () => {
    // rbac's tables reference auth's. Without this the failure arrives from
    // postgres midway through applying a migration, naming a relation rather
    // than the plugin that owns it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-incomplete-'))
    const manifest = path.join(dir, 'qualy.yml')
    write(manifest, "- name: '@qualy/plugin-org'\n- name: '@qualy/plugin-rbac'\n")
    expect(() => resolveSchemaEntries({ ymlPath: manifest })).toThrow(
      /rbac needs @qualy\/plugin-auth/,
    )
  })

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
      const { dir } = generateFromNothing(plugins)
      // the plugin applies the generated lineage on the path production
      // uses, so this asserts deployment rather than a hand-rolled replay
      const db = await createTestContext(`assembly-${name}`, { migrationsFolder: dir })
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
        fs.rmSync(path.dirname(dir), { recursive: true, force: true })
      }
    })
  }
})
