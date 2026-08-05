import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
