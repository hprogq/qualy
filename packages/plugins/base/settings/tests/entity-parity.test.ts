import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities } from '../src/db/entities.ts'

// Is the schema these entities build the schema the lineage runs on? The
// table's one unique index and two checks are what keep a tenant to one row
// per setting and a version that only moves forward.

const TABLES = ['tenant_setting_values']

describe.runIf(postgresAvailable)('a schema built from settings entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'settings-parity',
      tables: TABLES,
      entities,
      // org's tables are present but left alone: the row points at the tenant
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
