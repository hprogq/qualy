import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities, compositeForeignKeys } from '../src/db/entities.ts'

// Is the schema these entities build the schema the formula library runs
// on? The version table is the immutable execution record: a delete rule
// that drifted between the declared entities and the committed lineage
// would quietly change what "published" promises. Both databases start
// from the lineage; only the two formula tables are dropped and rebuilt
// from the entities, org keeps its own.

const TABLES = ['assessment_formula_functions', 'assessment_formula_versions']

const DEPENDENCY_TABLES = ['org_nodes', 'org_type_rules', 'org_types', 'tenants']

describe.runIf(postgresAvailable)('a schema built from formula entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'formula-parity',
      tables: TABLES,
      entities,
      dependencies: { entities: [...orgEntities], tables: DEPENDENCY_TABLES },
      afterCreate: compositeForeignKeys,
    })
    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
    expect(parity.triggers.entities, 'triggers differ').toEqual(parity.triggers.lineage)
  })
})
