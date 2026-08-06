import { describe, expect, it } from 'vitest'
import { defineEntity } from '@mikro-orm/core'
import { assertNoCollisions } from '../src/assembly/entities.ts'
import { parseDeclaration } from '../src/assembly/contribution.ts'
import type { DatabaseDeclaration } from '../src/plugin.ts'

// What reading a plugin's database declaration refuses.
//
// The generated aggregate module is gone - the running set is compiled by the
// descriptor assembler, the retained set is read from the same descriptors by
// the CLI - so what is left to assert is the checking both paths share:
// collisions read from metadata, and declaration shapes that would corrupt a
// schema.

/** what a plugin's descriptor declares, as the reader hands it over */
const declaring = (pluginId: string, ...entities: { name: string; tableName?: string }[]) => ({
  pluginId,
  entities: entities.map((entity) => defineEntity({ ...entity, properties: {} })),
})

const parse = (declaration: object) =>
  parseDeclaration('@qualy/plugin-a', '/pkg', { entities: [], ...declaration } as DatabaseDeclaration)

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

describe('validating a database declaration', () => {
  it('refuses composite foreign keys that are not statements', () => {
    // a string here used to be iterated one character at a time, and each
    // character run as a statement; only `entities` was ever checked
    expect(() =>
      parse({ compositeForeignKeys: 'ALTER TABLE a ADD CONSTRAINT b' as never }),
    ).toThrow(/compositeForeignKeys must be an array of sql statements/)

    expect(() => parse({ compositeForeignKeys: ['ok', 42] as never })).toThrow(
      /not a sql statement: 42/,
    )
  })

  it('refuses a declaration with no entity tuple', () => {
    expect(() =>
      parseDeclaration('@qualy/plugin-a', '/pkg', { entities: 'nope' } as never),
    ).toThrow(/must be given an entity tuple/)
  })

  it('refuses something that is not a defineEntity value', () => {
    expect(() => parse({ entities: [{ notMeta: true }] as never })).toThrow(
      /not a defineEntity value/,
    )
  })

  it('projects entity names for the lock, sorted', () => {
    const projected = parse({
      entities: declaring('@qualy/plugin-a', { name: 'B', tableName: 'b' }, { name: 'A' }).entities,
      dependsOn: ['@qualy/plugin-z', '@qualy/plugin-b'],
    })
    expect(projected).toEqual({
      entities: ['A', 'B'],
      dependsOn: ['@qualy/plugin-b', '@qualy/plugin-z'],
    })
  })
})
