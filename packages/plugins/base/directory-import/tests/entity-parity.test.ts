import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities } from '../src/db/entities.ts'

// Is the schema these entities build the schema the lineage runs on? The
// one-upload-one-import index and the disposition checks are what keep
// history honest, and a difference here is one of them quietly gone.

const TABLES = [
  'directory_import_events',
  'directory_import_nodes',
  'directory_import_rows',
  'directory_imports',
]

describe.runIf(postgresAvailable)('a schema built from directory-import entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'directory-import-parity',
      tables: TABLES,
      entities,
      // org's tables are present but left alone: the rows point at the tenant
      dependencies: {
        entities: orgEntities,
        tables: ['org_nodes', 'org_type_rules', 'org_types', 'tenants'],
      },
    })
    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
    expect(parity.triggers.entities, 'triggers differ').toEqual(parity.triggers.lineage)
  }, 240_000)
})
