import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { QualyNamingStrategy, entities, orgCompositeForeignKeys } from '../src/db/entities.ts'

// Is the schema these entities build the schema org runs on?
//
// The assembly's tables come from this declaration, so anything it fails to
// state is an object that stops existing: a check that no longer refuses, a
// partial index that no longer keeps a tenant to one root, a foreign key that
// no longer confines a reference to one tenant. None of those fail a query -
// they fail later, as data that should not exist.
//
// Both databases start from the committed lineage, because it is what creates
// the ltree extension and everything these tables reference; only org's four
// are dropped and rebuilt from the entities.

const TABLES = ['org_nodes', 'org_type_rules', 'org_types', 'tenants']

describe.runIf(postgresAvailable)('a schema built from org entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'org-parity',
      tables: TABLES,
      entities,
      namingStrategy: QualyNamingStrategy,
      afterCreate: orgCompositeForeignKeys,
    })

    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      // a comparison of two empty lists is not a comparison
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
  }, 240_000)
})
