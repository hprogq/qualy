import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { authCompositeForeignKeys, entities } from '../src/db/entities.ts'

// Is the schema these entities build the schema auth runs on?
//
// org's tables are present but left alone: they are the lineage's, this gate
// is about auth's six, and rebuilding org here would be a second and weaker
// copy of org's own gate. Its entities are still handed to the generator, so
// a reference into them resolves rather than becoming a table auth invents.

const TABLES = [
  'sessions',
  'user_identities',
  'users',
  'user_type_allowed_org_types',
  'user_types',
  'auth_providers',
]

const ORG_TABLES = ['org_nodes', 'org_type_rules', 'org_types', 'tenants']

describe.runIf(postgresAvailable)('a schema built from auth entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'auth-parity',
      tables: TABLES,
      entities,
      dependencies: { entities: orgEntities, tables: ORG_TABLES },
      afterCreate: authCompositeForeignKeys,
    })

    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
  }, 240_000)
})
