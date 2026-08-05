import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilityModules, moduleDrift } from '@qualy/assembly'
import {
  commitLock,
  createWorkspace,
  resolveWorkspace,
  type SyntheticPackage,
} from '@qualy/assembly/testkit'
import { assertNoCollisions, renderEntityModule } from '../src/assembly/entities.ts'
import type { EntityContribution } from '../src/assembly/entities.ts'

// What the entity aggregate is allowed to be.
//
// It concatenates tuples and nothing else, so almost everything worth
// asserting is about what it refuses: two plugins claiming one table, a
// declaration the package does not export, and - the one that costs data - an
// aggregate built from the running set instead of the retained one.

const contribution = (pluginId: string, source: string): EntityContribution => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'qualy-entities-'))
  const file = path.join(dir, 'db.ts')
  fs.writeFileSync(file, source)
  return { pluginId, specifier: `${pluginId}/db`, file }
}

describe('the generated entity aggregate', () => {
  it('imports each plugin tuple and spreads it, as a tuple', () => {
    const module = renderEntityModule([
      { pluginId: '@qualy/plugin-org', specifier: '@qualy/plugin-org/db', file: '/x' },
      { pluginId: '@qualy/plugin-auth-local', specifier: '@qualy/plugin-auth-local/db', file: '/y' },
    ])
    expect(module).toContain("import { entities as pluginOrgEntities } from '@qualy/plugin-org/db'")
    // the hyphen becomes a capital rather than a syntax error, and the plugin
    // prefix stays, matching how runtime.gen.ts already names its imports
    expect(module).toContain(
      "import { entities as pluginAuthLocalEntities } from '@qualy/plugin-auth-local/db'",
    )
    expect(module).toContain('...pluginOrgEntities,')
    // `as const` is what carries element types into the entity manager; a
    // plain array makes every table name unusable and nothing here would fail
    expect(module).toContain('] as const')
    expect(module).toContain('export type Database = typeof entities')
  })

  it('is a valid module when no plugin ships entities yet', () => {
    // true for most of the migration: the aggregate has to build from whatever
    // has been ported so far
    expect(renderEntityModule([])).toContain('export const entities = [] as const')
  })

  it('refuses two plugins claiming one table', () => {
    // silent in a concatenation: the tuple just holds two elements with one
    // name, and whichever the orm registers last decides what a query means
    expect(() =>
      assertNoCollisions([
        contribution('@qualy/plugin-a', `defineEntity({ name: 'Node', tableName: 'org_nodes' })`),
        contribution('@qualy/plugin-b', `defineEntity({ name: 'Other', tableName: 'org_nodes' })`),
      ]),
    ).toThrow(/tableName org_nodes is declared by both/)
  })

  it('refuses two plugins claiming one entity name', () => {
    expect(() =>
      assertNoCollisions([
        contribution('@qualy/plugin-a', `defineEntity({ name: 'Node', tableName: 'a' })`),
        contribution('@qualy/plugin-b', `defineEntity({ name: 'Node', tableName: 'b' })`),
      ]),
    ).toThrow(/name Node is declared by both/)
  })

  it('lets one plugin declare a table once', () => {
    expect(() =>
      assertNoCollisions([
        contribution(
          '@qualy/plugin-org',
          `defineEntity({ name: 'Node', tableName: 'org_nodes' })
           defineEntity({ name: 'Type', tableName: 'org_types' })`,
        ),
      ]),
    ).not.toThrow()
  })
})

// The same generator reached the way the CLI reaches it: through a resolution,
// from plugins that only exist for these cases. What the aggregate says about
// a plugin set is a property of the plugin set, so it is asserted against one.

const INFRA = ['@qualy/plugin-database']

/** a plugin whose only reason to exist is one entity */
const shipping = (id: string, table: string, dependsOn: string[] = []): SyntheticPackage => ({
  id,
  qualy: { contributions: { database: { entitiesEntry: 'db.js', dependsOn } } },
  exports: { './db': './db.js' },
  files: { 'db.js': `export const entities = [defineEntity({ name: '${table}' })]\n` },
})

const aggregate = async (workspace: ReturnType<typeof createWorkspace>) => {
  await commitLock(workspace)
  const modules = capabilityModules(await resolveWorkspace(workspace))
  const entities = modules.find((module) => module.path.endsWith('entities.gen.ts'))
  if (!entities) throw new Error(`no entity module among ${modules.map((m) => m.path).join(', ')}`)
  return entities
}

const workspaceOf = (
  plugins: readonly string[],
  options: { disabled?: readonly string[]; synthetic?: readonly SyntheticPackage[] } = {},
) => createWorkspace([...INFRA, ...plugins], options)

describe('the entity aggregate of an assembly', () => {
  it('lands in the host workspace, not beside the manifest', async () => {
    // the real manifest sits at the repository root while the host is a
    // package inside it, so the two are different directories; a module
    // written next to the manifest is not one the host can import, and an
    // aggregate nobody imports fails no test
    const workspace = createWorkspace(INFRA, { workspace: './host' })
    fs.mkdirSync(path.join(workspace.dir, 'host'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace.dir, 'host', 'package.json'),
      '{ "name": "host", "version": "0.0.0", "private": true }\n',
    )
    try {
      expect((await aggregate(workspace)).path).toBe('host/entities.gen.ts')
    } finally {
      workspace.dispose()
    }
  })

  it('orders plugins by what their tables need, not by the manifest', async () => {
    // two manifests naming the same plugins in opposite orders have to produce
    // the same bytes, or `pnpm gen` reports a change every time somebody sorts
    // the file differently
    const synthetic = [
      shipping('@fake/plugin-late', 'Late', ['@fake/plugin-early']),
      shipping('@fake/plugin-early', 'Early'),
    ]
    const forward = workspaceOf(['@fake/plugin-early', '@fake/plugin-late'], { synthetic })
    const reversed = workspaceOf(['@fake/plugin-late', '@fake/plugin-early'], { synthetic })
    try {
      const body = (await aggregate(forward)).content
      expect(body).toBe((await aggregate(reversed)).content)
      expect(body.indexOf('pluginEarlyEntities')).toBeLessThan(body.indexOf('pluginLateEntities'))
    } finally {
      forward.dispose()
      reversed.dispose()
    }
  })

  it('refuses a plugin whose tables need one this assembly does not have', async () => {
    const workspace = workspaceOf(['@fake/plugin-late'], {
      synthetic: [shipping('@fake/plugin-late', 'Late', ['@fake/plugin-early'])],
    })
    try {
      await expect(aggregate(workspace)).rejects.toThrow(
        /@fake\/plugin-late needs @fake\/plugin-early/,
      )
    } finally {
      workspace.dispose()
    }
  })

  it('keeps a switched-off plugin, and one taken out of the manifest', async () => {
    // neither removes a table, and an aggregate that dropped them would hand a
    // diffing schema generator a database missing them
    const synthetic = [shipping('@fake/plugin-a', 'A'), shipping('@fake/plugin-b', 'B')]
    const workspace = workspaceOf(['@fake/plugin-a', '@fake/plugin-b'], { synthetic })
    try {
      expect((await aggregate(workspace)).content).toContain('pluginBEntities')

      workspace.writeManifest([...INFRA, '@fake/plugin-a', '@fake/plugin-b'], {
        disabled: ['@fake/plugin-b'],
      })
      expect((await aggregate(workspace)).content).toContain('pluginBEntities')

      workspace.writeManifest([...INFRA, '@fake/plugin-a'])
      const detached = await aggregate(workspace)
      expect((await resolveWorkspace(workspace)).plugins.get('@fake/plugin-b')!.state).toBe(
        'detached',
      )
      expect(detached.content).toContain('pluginBEntities')
    } finally {
      workspace.dispose()
    }
  })

  it('makes a tree that has not been regenerated fail the frozen gate', async () => {
    // The lock alone does not answer this. It records that a plugin joined,
    // and a tree can hold a matching lock next to an aggregate generated
    // before it; the queries then typecheck against a schema this assembly
    // does not have, and CI passes.
    const synthetic = [shipping('@fake/plugin-a', 'A'), shipping('@fake/plugin-b', 'B')]
    const workspace = workspaceOf(['@fake/plugin-a'], { synthetic })
    try {
      await commitLock(workspace)
      // the working tree as codegen left it for this selection
      const tree = new Map(
        capabilityModules(await resolveWorkspace(workspace)).map((module) => [
          module.path,
          module.content,
        ]),
      )
      const read = (at: string) => tree.get(at)
      expect(moduleDrift(capabilityModules(await resolveWorkspace(workspace)), read)).toEqual([])

      workspace.writeManifest([...INFRA, '@fake/plugin-a', '@fake/plugin-b'])
      await commitLock(workspace)
      expect(moduleDrift(capabilityModules(await resolveWorkspace(workspace)), read)).toEqual([
        expect.stringContaining('entities.gen.ts is not what this manifest generates'),
      ])
    } finally {
      workspace.dispose()
    }
  })

  it('says nothing a typechecker has to take on trust', async () => {
    const workspace = workspaceOf(['@fake/plugin-a'], {
      synthetic: [shipping('@fake/plugin-a', 'A')],
    })
    try {
      const body = (await aggregate(workspace)).content
      // an `any` anywhere in here would erase the tuple that carries table
      // names, and every query against it would still compile
      expect(body).not.toMatch(/\bany\b/)
      expect(body).not.toMatch(/\bunknown\b/)
      expect(body).not.toContain('@ts-')
    } finally {
      workspace.dispose()
    }
  })
})
