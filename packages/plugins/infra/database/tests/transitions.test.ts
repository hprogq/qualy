import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilityWorkContext, commitLock, createWorkspace } from '@qualy/assembly/testkit'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import { runMigrations } from '../src/migrator.ts'
import provider, { type DatabaseContribution, type DatabaseState } from '../src/assembly/index.ts'
import { createTestContext, postgresAvailable } from '../src/testkit.ts'

// A one-time data step, shipped by a plugin, reaching every instance once.
//
// The lineage used to be this repository's, so a data step was a hand-written
// migration in it and every instance replayed the same file. A lineage that
// belongs to each instance has no shared file. What these cases hold is the
// replacement: the plugin carries the step, an instance with a history
// compiles it into its own lineage exactly once, and an instance built from
// nothing records that it never needed it - without running SQL written for
// a shape it never had.

const INFRA = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']
const AUTHORIZED = ['@qualy/plugin-org', '@qualy/plugin-auth', '@qualy/plugin-rbac']
const STEPS = '@fake/plugin-steps'
const MIGRATIONS = 'migrations'

/** a plugin owning no tables of its own, carrying a data step for org's */
const steps = (transitions: Record<string, string>) => ({
  id: STEPS,
  files: {
    'index.js': [
      `export default { _tag: 'Plugin', id: '${STEPS}', dependsOn: [], features: [{`,
      "  _tag: 'Contribute', point: { id: '@qualy/plugin-database/entities' },",
      "  value: { entities: [], dependsOn: ['@qualy/plugin-org'], transitionsDir: './transitions' },",
      '}] }',
    ].join('\n'),
    ...Object.fromEntries(
      Object.entries(transitions).map(([name, sql]) => [`transitions/${name}`, sql]),
    ),
  },
})

const RENAME = ['-- phase: post-structure', "update org_types set name = 'College' where name = 'Old College';", ''].join('\n')

const workspaceFor = (transitions: Record<string, string>, selection: readonly string[]) =>
  createWorkspace(selection, {
    configs: { '@qualy/plugin-database': { migrationsFolder: MIGRATIONS } },
    synthetic: [steps(transitions)],
  })

const migrationsOf = (workspace: ReturnType<typeof createWorkspace>) =>
  path.join(workspace.dir, MIGRATIONS)

const lineageOf = (workspace: ReturnType<typeof createWorkspace>) =>
  fs
    .readdirSync(migrationsOf(workspace))
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((entry) => ({ name: entry, sql: fs.readFileSync(path.join(migrationsOf(workspace), entry), 'utf8') }))

const context = async (workspace: ReturnType<typeof createWorkspace>) => {
  await commitLock(workspace)
  return (await capabilityWorkContext(workspace, 'database')) as CapabilityWorkContext<
    DatabaseContribution,
    DatabaseState
  >
}

const generate = async (workspace: ReturnType<typeof createWorkspace>) =>
  provider.generate!(await context(workspace))

/** the transition's own package file, edited or extended after it was compiled */
const transitionFile = (workspace: ReturnType<typeof createWorkspace>, name: string) =>
  path.join(workspace.dir, 'node_modules', ...STEPS.split('/'), 'transitions', name)

describe.runIf(postgresAvailable)('a transition on a fresh instance', () => {
  it('is recorded as satisfied and never run', async () => {
    const workspace = workspaceFor({ '0001_rename-college.sql': RENAME }, [
      ...INFRA,
      ...AUTHORIZED,
      STEPS,
    ])
    try {
      await generate(workspace)
      const [initial] = lineageOf(workspace)
      expect(initial).toBeDefined()
      // the marker names the file and says why nothing follows it
      expect(initial!.sql).toMatch(
        /^-- qualy-transition: @fake\/plugin-steps transitions\/0001_rename-college\.sql [0-9a-f]{16} satisfied$/m,
      )
      expect(initial!.sql).not.toContain("update org_types set name = 'College'")
      // the marker is a comment; the migration still applies to an empty database
      const db = await createTestContext('transition-fresh', { migrationsFolder: migrationsOf(workspace) })
      try {
        const kinds = await db.row<{ count: number }>(
          `select count(*)::int as count from information_schema.tables where table_name = 'org_types'`,
        )
        expect(kinds.count).toBe(1)
      } finally {
        await db.dispose()
      }
      // and it is accounted for: the next generation has nothing to add
      const logged: string[] = []
      const log = console.log
      console.log = (line: string) => logged.push(line)
      try {
        await generate(workspace)
      } finally {
        console.log = log
      }
      expect(logged).toContain('database: nothing to generate')
      expect(lineageOf(workspace)).toHaveLength(1)
    } finally {
      workspace.dispose()
    }
  }, 180_000)
})

describe.runIf(postgresAvailable)('a transition on an instance with a history', () => {
  it('is compiled into its lineage once, runs against its data, and is then history', async () => {
    // release N: the plugin is not in the assembly yet; the instance is built
    // and holds a row in the old shape
    const workspace = workspaceFor({ '0001_rename-college.sql': RENAME }, [...INFRA, ...AUTHORIZED])
    try {
      await generate(workspace)
      expect(lineageOf(workspace)).toHaveLength(1)
      const db = await createTestContext('transition-upgrade', {
        migrationsFolder: migrationsOf(workspace),
      })
      try {
        const tenant = (
          await db.row<{ id: string }>(
            `insert into tenants (slug, name) values ('t', 'Tenant') returning id`,
          )
        ).id
        await db.query(`insert into org_types (tenant_id, name) values ($1, 'Old College')`, [tenant])

        // release N+1: the plugin arrives with its transition
        workspace.writeManifest([...INFRA, ...AUTHORIZED, STEPS])
        await generate(workspace)
        const lineage = lineageOf(workspace)
        expect(lineage).toHaveLength(2)
        const upgrade = lineage[1]!.sql
        expect(upgrade).toMatch(
          /^-- qualy-transition: @fake\/plugin-steps transitions\/0001_rename-college\.sql [0-9a-f]{16}$/m,
        )
        expect(upgrade).not.toContain('satisfied')
        expect(upgrade).toContain("update org_types set name = 'College' where name = 'Old College'")

        // applied the way a deployment applies it, it changes the instance's row
        await runMigrations(db.url, { folder: migrationsOf(workspace), entities: [] })
        const renamed = await db.row<{ name: string }>(
          `select name from org_types where tenant_id = $1`,
          [tenant],
        )
        expect(renamed.name).toBe('College')

        // once compiled it is history: nothing more to generate, and an edit
        // to the shipped file is refused rather than compiled again
        const logged: string[] = []
        const log = console.log
        console.log = (line: string) => logged.push(line)
        try {
          await generate(workspace)
        } finally {
          console.log = log
        }
        expect(logged).toContain('database: nothing to generate')
        fs.writeFileSync(
          transitionFile(workspace, '0001_rename-college.sql'),
          RENAME.replace("'College'", "'Faculty'"),
        )
        await expect(generate(workspace)).rejects.toThrow(
          /transitions changed after they were compiled into the lineage/,
        )
      } finally {
        await db.dispose()
      }
    } finally {
      workspace.dispose()
    }
  }, 240_000)

  it('runs a later transition even on an instance that was fresh when the first arrived', async () => {
    // fresh: the first transition is satisfied without running. A second one
    // shipped later meets an instance with a history, and runs.
    const workspace = workspaceFor({ '0001_rename-college.sql': RENAME }, [
      ...INFRA,
      ...AUTHORIZED,
      STEPS,
    ])
    try {
      await generate(workspace)
      fs.writeFileSync(
        transitionFile(workspace, '0002_mark-legacy.sql'),
        "update org_types set name = name || ' (legacy)' where name = 'Kept';\n",
      )
      await generate(workspace)
      const lineage = lineageOf(workspace)
      expect(lineage).toHaveLength(2)
      expect(lineage[1]!.sql).toContain("update org_types set name = name || ' (legacy)'")
      expect(lineage[1]!.sql).not.toContain('satisfied')
      // a transition-only migration carries no structural statement at all
      expect(lineage[1]!.sql).not.toMatch(/\b(create|alter|drop) table\b/i)
    } finally {
      workspace.dispose()
    }
  }, 180_000)

  it('places each transition by its phase, after the baseline of that phase', async () => {
    const workspace = workspaceFor(
      {
        '0001_before.sql': '-- phase: pre-structure\nselect 1 as before_structure;\n',
        '0002_after.sql': 'select 1 as after_structure;\n',
      },
      [...INFRA, ...AUTHORIZED],
    )
    try {
      await generate(workspace)
      // the plugin arrives together with something structural to order
      // against: ping's table, so the migration has statements between the
      // two phases
      workspace.writeManifest([...INFRA, ...AUTHORIZED, STEPS, '@qualy/plugin-ping'])
      await generate(workspace)
      const upgrade = lineageOf(workspace)[1]!.sql
      const at = (needle: string) => {
        const index = upgrade.indexOf(needle)
        expect(index, needle).toBeGreaterThanOrEqual(0)
        return index
      }
      const structure = at('ping_logs')
      expect(at('before_structure')).toBeLessThan(structure)
      expect(at('after_structure')).toBeGreaterThan(structure)
    } finally {
      workspace.dispose()
    }
  }, 180_000)
})

describe('declaring transitions', () => {
  it('refuses a directory that is not inside the package', async () => {
    const workspace = createWorkspace([...INFRA, STEPS], {
      configs: { '@qualy/plugin-database': { migrationsFolder: MIGRATIONS } },
      synthetic: [
        {
          id: STEPS,
          files: {
            'index.js': [
              `export default { _tag: 'Plugin', id: '${STEPS}', dependsOn: [], features: [{`,
              "  _tag: 'Contribute', point: { id: '@qualy/plugin-database/entities' },",
              "  value: { entities: [], transitionsDir: '../elsewhere' },",
              '}] }',
            ].join('\n'),
          },
        },
      ],
    })
    try {
      await expect(commitLock(workspace)).rejects.toThrow(/transitionsDir points outside the package/)
    } finally {
      workspace.dispose()
    }
  })
})
