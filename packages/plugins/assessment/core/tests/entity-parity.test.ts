import { describe, expect, it } from 'vitest'
import { postgresAvailable, schemaParity } from '@qualy/plugin-database/testkit'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { entities, compositeForeignKeys } from '../src/db/entities.ts'

// Is the schema these entities build the schema assessment runs on?
//
// The tables that carry decisions are the ones where a missing object stops
// being a query problem and becomes a data problem: a determination that
// could cite another entry's filing, an approved claim with nothing recorded
// about what it was approved as, a round pointing at a recognition contract
// from a different tenant. None of those fail loudly - they fail as rows
// that should never have existed.
//
// The comparison covers every table this plugin owns; both databases start
// from the committed lineage, and only these are dropped and rebuilt from
// the entities. The plugins it references keep theirs - their own gates own
// those - but their entities are handed to the generator so a reference
// resolves instead of becoming a table assessment invents.

const DEPENDENCY_TABLES = [
  'auth_provider_user_types',
  'auth_providers',
  'org_nodes',
  'org_type_rules',
  'org_types',
  'permissions',
  'role_allowed_org_types',
  'role_allowed_user_types',
  'role_grant_rules',
  'role_grants',
  'role_permissions',
  'roles',
  'sessions',
  'sign_in_events',
  'storage_attachments',
  'storage_upload_reservations',
  'tenants',
  'user_identities',
  'user_type_allowed_org_types',
  'user_types',
  'users',
]

const TABLES = [
  'assessment_batches',
  'assessment_item_revisions',
  'assessment_items',
  'batch_access_denies',
  'batch_access_source_permissions',
  'batch_access_sources',
  'batch_config_revisions',
  'batch_lifecycle_events',
  'batch_management_anchors',
  'batch_participant_events',
  'batch_participants',
  'batch_phases',
  'entries',
  'entry_events',
  'entry_recognitions',
  'entry_revision_attachments',
  'entry_revisions',
  'phase_events',
  'phase_item_scopes',
  'phase_participant_scopes',
  'phase_templates',
  'review_events',
  'review_instances',
  'review_panel_assignments',
  'review_panels',
  'review_supplement_attachments',
  'review_supplement_requests',
  'review_supplement_responses',
  'review_votes',
  'roster_imports',
  'score_groups',
]

describe.runIf(postgresAvailable)('a schema built from assessment entities', () => {
  it('has the columns, constraints and indexes the lineage builds', async () => {
    const parity = await schemaParity({
      label: 'assessment-parity',
      tables: TABLES,
      entities,
      dependencies: {
        entities: [...orgEntities, ...authEntities, ...rbacEntities, ...storageEntities],
        tables: DEPENDENCY_TABLES,
      },
      afterCreate: compositeForeignKeys,
    })

    for (const what of ['columns', 'constraints', 'indexes'] as const) {
      // a comparison of two empty lists is not a comparison
      expect(parity[what].lineage.length, `no ${what} were compared`).toBeGreaterThan(0)
      expect(parity[what].entities, `${what} differ`).toEqual(parity[what].lineage)
    }
    expect(parity.triggers.entities, 'triggers differ').toEqual(parity.triggers.lineage)
  }, 240_000)
})
