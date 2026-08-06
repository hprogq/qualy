import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities, compositeForeignKeys } from '../src/db/entities.ts'

// Is the schema these entities build the schema rbac runs on?
//
// org's and auth's tables are present but left alone: their entities are
// handed to the generator so references into them resolve, and their schema
// stays the lineage's, since rebuilding it here would be a second and weaker
// copy of their own gates.

const TABLES = [
  'role_grants',
  'role_permissions',
  'role_allowed_org_types',
  'role_allowed_user_types',
  'roles',
  'permissions',
]

const UPSTREAM_TABLES = [
  'org_nodes',
  'org_type_rules',
  'org_types',
  'tenants',
  'sessions',
  'user_identities',
  'users',
  'user_type_allowed_org_types',
  'user_types',
  'auth_providers',
]

describe.runIf(postgresAvailable)('a schema built from rbac entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'rbac-parity',
      tables: TABLES,
      entities,
      dependencies: {
        entities: [...orgEntities, ...authEntities],
        tables: UPSTREAM_TABLES,
      },
      afterCreate: compositeForeignKeys,
    })

    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
    // no non-empty demand here: this plugin owns no trigger, and the day it
    // does, one the entities cannot rebuild is a difference
    expect(parity.triggers.entities, 'triggers differ').toEqual(parity.triggers.lineage)
  }, 240_000)
})
