import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { compositeForeignKeys, entities } from '../src/db/entities.ts'

// Is the schema these entities build the schema auth runs on?
//
// org's tables are present but left alone: they are the lineage's, this gate
// is about auth's six, and rebuilding org here would be a second and weaker
// copy of org's own gate. Its entities are still handed to the generator, so
// a reference into them resolves rather than becoming a table auth invents.

const TABLES = [
  'auth_flows',
  'sessions',
  'session_auth_grants',
  'auth_rate_limit_buckets',
  'user_email_challenges',
  'sign_in_events',
  'user_auth_bindings',
  'users',
  'user_type_allowed_org_types',
  'user_types',
  'auth_provider_user_types',
  'auth_providers',
]

const ORG_TABLES = ['org_nodes', 'org_type_rules', 'org_types', 'tenants']
const baseline = readFileSync(
  new URL('../db/baseline/0001_tenant_session_lifecycle.sql', import.meta.url),
  'utf8',
)

describe.runIf(postgresAvailable)('a schema built from auth entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'auth-parity',
      tables: TABLES,
      entities,
      dependencies: { entities: orgEntities, tables: ORG_TABLES },
      afterCreate: [...compositeForeignKeys, baseline],
    })

    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
    // Sessions are rebuilt, so auth's baseline must restore its guard.
    expect(parity.triggers.lineage).toHaveLength(1)
    expect(parity.triggers.lineage[0]).toContain('sessions.qualy_auth_session_tenant_guard')
    expect(parity.triggers.entities, 'triggers differ').toEqual(parity.triggers.lineage)
  }, 240_000)

  it('detects a changed trigger function even if its declaration is unchanged', async () => {
    const altered = baseline.replace('tenant is not enabled', 'a different refusal')
    expect(altered).not.toBe(baseline)
    const parity = await schemaParity({
      label: 'auth-trigger-function-parity',
      tables: TABLES,
      entities,
      dependencies: { entities: orgEntities, tables: ORG_TABLES },
      afterCreate: [...compositeForeignKeys, altered],
    })
    expect(parity.triggers.lineage).toHaveLength(1)
    expect(parity.triggers.entities).not.toEqual(parity.triggers.lineage)
  }, 240_000)
})
