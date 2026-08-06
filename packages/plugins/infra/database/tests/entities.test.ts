import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineEntity } from '@mikro-orm/core'
import { assertNoCollisions } from '../src/assembly/entities.ts'
import type { EntityContribution } from '../src/assembly/entities.ts'
import { loadEntityModules } from '../src/assembly/diff.ts'

// What loading a plugin's entity declarations refuses.
//
// The generated aggregate module is gone - the running set is compiled by the
// descriptor assembler, the retained set is read from the lock by the CLI -
// so what is left to assert is the checking both paths share: collisions read
// from metadata, and module shapes that would corrupt a schema.

/** what a plugin's module exports, as the loader hands it over */
const declaring = (pluginId: string, ...entities: { name: string; tableName?: string }[]) => ({
  pluginId,
  entities: entities.map((entity) => defineEntity({ ...entity, properties: {} })),
})

/** a plugin package whose entities module is loaded for real */
const loadable = (pluginId: string, body: string): EntityContribution => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'qualy-entities-'))
  const file = path.join(dir, 'db.js')
  fs.writeFileSync(file, body)
  return { pluginId, specifier: `${pluginId}/db`, file }
}

describe('entity declarations', () => {
  it('refuses two plugins claiming one table', () => {
    // silent in a concatenation: the set just holds two elements with one
    // name, and whichever the orm registers last decides what a query means
    expect(() =>
      assertNoCollisions([
        declaring('@qualy/plugin-a', { name: 'Node', tableName: 'org_nodes' }),
        declaring('@qualy/plugin-b', { name: 'Other', tableName: 'org_nodes' }),
      ]),
    ).toThrow(/table org_nodes is declared by both/)
  })

  it('refuses two plugins claiming one entity name', () => {
    expect(() =>
      assertNoCollisions([
        declaring('@qualy/plugin-a', { name: 'Node', tableName: 'a' }),
        declaring('@qualy/plugin-b', { name: 'Node', tableName: 'b' }),
      ]),
    ).toThrow(/name Node is declared by both/)
  })

  it('refuses one plugin claiming the same table twice', () => {
    // the source scan this replaced asked only whether another plugin had it,
    // so a copied declaration inside one package went through
    expect(() =>
      assertNoCollisions([
        declaring(
          '@qualy/plugin-org',
          { name: 'Node', tableName: 'org_nodes' },
          { name: 'NodeAgain', tableName: 'org_nodes' },
        ),
      ]),
    ).toThrow(/table org_nodes is declared twice by @qualy\/plugin-org/)
  })

  it('lets one plugin declare several tables', () => {
    expect(() =>
      assertNoCollisions([
        declaring(
          '@qualy/plugin-org',
          { name: 'Node', tableName: 'org_nodes' },
          { name: 'Type', tableName: 'org_types' },
        ),
      ]),
    ).not.toThrow()
  })

  it('sees a declaration a regular expression could not', () => {
    // what the source scan got wrong in both directions: the `name` of a check
    // constraint read as an entity, and a table name in double quotes read as
    // nothing at all
    const entity = defineEntity({
      name: 'Node',
      tableName: 'org_nodes',
      properties: {},
      checks: [{ name: 'depth_positive', expression: 'depth >= 0' }],
    })
    expect(() =>
      assertNoCollisions([
        { pluginId: '@qualy/plugin-a', entities: [entity] },
        declaring('@qualy/plugin-b', { name: 'depth_positive', tableName: 'other' }),
      ]),
    ).not.toThrow()
  })
})

describe('loading a plugin entities module', () => {
  it('refuses composite foreign keys that are not statements', async () => {
    // a string here used to be spread one character at a time, and each
    // character run as a statement; only `entities` was ever checked
    await expect(
      loadEntityModules([
        loadable(
          '@qualy/plugin-a',
          `export const entities = []\nexport const compositeForeignKeys = 'ALTER TABLE a ADD CONSTRAINT b'\n`,
        ),
      ]),
    ).rejects.toThrow(/compositeForeignKeys.*must be an array of sql statements/s)

    await expect(
      loadEntityModules([
        loadable(
          '@qualy/plugin-a',
          `export const entities = []\nexport const compositeForeignKeys = ['ok', 42]\n`,
        ),
      ]),
    ).rejects.toThrow(/not a sql statement: 42/)
  })

  it('refuses a module with no entity tuple', async () => {
    await expect(
      loadEntityModules([loadable('@qualy/plugin-a', `export const entities = 'nope'\n`)]),
    ).rejects.toThrow(/must export an `entities` tuple/)
  })
})
