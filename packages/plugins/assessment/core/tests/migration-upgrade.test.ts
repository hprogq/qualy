import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MIGRATIONS_FOLDER, runMigrations } from '@qualy/plugin-database/migrator'
import { Effect, Exit, Schema } from 'effect'
import { inspect } from 'node:util'
import { transaction } from '@qualy/plugin-database/server'
import { builtinAggregators, builtinCalculators } from '../src/scoring/builtins.ts'
import { testDefinitions, testRuntime } from './support/catalogs.ts'
import { auditStoredPlans, sweepScoringPlans } from '../src/scoring/backfill.ts'
import { CalculatorRuntimeError, type CalculatorRegistration } from '../src/plugin.ts'
import { semanticPlanBody } from '../src/scoring/plan.ts'
import { hashCanonicalJson } from '@qualy/value-schema/hash'

// The scope migration carries a data step - every batch's single scope node
// moves into batch_scope_nodes before the columns drop - and replaying the
// lineage into an empty database proves nothing about it. This builds the
// shape the step upgrades FROM, puts a live batch in it, and only then lets
// the migration run.

const TARGET = '20260809085658_batch-scope-node-set.sql'

describe.runIf(postgresAvailable)('the batch-scope-node-set migration', () => {
  it('carries an existing batch scope into the join table before dropping it', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, TARGET))).toBe(true)
    // the lineage up to, but not including, the migration under test; the
    // migrator's ledger makes the later full run apply exactly the remainder
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-scope-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== TARGET) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('scope-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('upgrade', 'Upgrade') returning id`,
        )
      ).id
      const orgType = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, name) values ($1, 'College') returning id`,
          [tenant],
        )
      ).id
      const node = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'College', 'upg', 0) returning id`,
          [tenant, orgType],
        )
      ).id
      const batch = (
        await db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, scope_node_id, scope_path, material_range)
           values ($1, 'Old shape', $2, 'upg', daterange('2026-03-01', '2026-09-01')) returning id`,
          [tenant, node],
        )
      ).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const moved = await db.row<{ node_id: string }>(
        `select node_id from batch_scope_nodes where tenant_id = $1 and batch_id = $2`,
        [tenant, batch],
      )
      expect(moved.node_id).toBe(node)
      const leftover = await db.query(
        `select column_name from information_schema.columns
         where table_name = 'assessment_batches' and column_name in ('scope_node_id', 'scope_path')`,
      )
      expect(leftover.rows).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})

// Taking the participant actions out of the rbac catalog leaves rows behind:
// a role somebody had already ticked "submit an entry" on, and the catalog
// entries themselves. Replaying the lineage into an empty database proves
// nothing about either, because neither was ever inserted there.

const CLEANUP = '20260811225407_drop-participant-action-permissions.sql'

describe.runIf(postgresAvailable)('the participant-action cleanup migration', () => {
  it('takes the codes off the roles that had them, and out of the catalog', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, CLEANUP))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-participant-actions-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== CLEANUP) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('participant-action-cleanup', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('cleanup', 'Cleanup') returning id`,
        )
      ).id
      // the world as it was: the code in the catalog, and a role carrying it
      const permission = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('assessment.entry.submit', 'assessment', 'Submit', 'tenant') returning id`,
        )
      ).id
      const kept = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('assessment.review.process', 'assessment', 'Review', 'org-node') returning id`,
        )
      ).id
      const role = (
        await db.row<{ id: string }>(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values ($1, 'reviewer', 'Reviewer', 'org', 'active', 'explicit', 'allow-list') returning id`,
          [tenant],
        )
      ).id
      for (const id of [permission, kept]) {
        await db.query(
          `insert into role_permissions (tenant_id, role_id, permission_id) values ($1, $2, $3)`,
          [tenant, role, id],
        )
      }

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const codes = await db.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id = rp.permission_id
          where rp.role_id = $1`,
        [role],
      )
      // the grant is gone, and so is the code nobody may grant any more
      expect(codes.rows.map((row) => row.code)).toEqual(['assessment.review.process'])
      // the catalog row is gone too, so the tenant administrator - who holds
      // every active definition by definition - stops holding this one
      const left = await db.query<{ code: string }>(
        `select code from permissions where plugin = 'assessment' order by code`,
      )
      expect(left.rows.map((row) => row.code)).toEqual(['assessment.review.process'])
    } finally {
      await db.dispose()
    }
  })
})

// `assessment.entry.resubmit` followed the other participant actions out of
// the catalog, one release later - so the earlier cleanup does not name it,
// and a database upgraded from that release still carries it in the catalog,
// in roles, and in whatever ceilings a batch had accepted it into.

const RESUBMIT = '20260812183000_drop-resubmit-permission.sql'

describe.runIf(postgresAvailable)('the resubmit cleanup migration', () => {
  it('takes the code out of the catalog, the roles and the batches that held it', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, RESUBMIT))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-resubmit-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== RESUBMIT) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('resubmit-cleanup', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('resubmit', 'Resubmit') returning id`,
        )
      ).id
      const orgType = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, name) values ($1, 'College') returning id`,
          [tenant],
        )
      ).id
      const node = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'College', 'res', 0) returning id`,
          [tenant, orgType],
        )
      ).id
      const userType = (
        await db.row<{ id: string }>(
          `insert into user_types (tenant_id, code, name, placement_mode)
           values ($1, 'teacher', 'Teacher', 'unrestricted') returning id`,
          [tenant],
        )
      ).id
      const user = (
        await db.row<{ id: string }>(
          `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
           values ($1, 'Reviewer', $2, $3) returning id`,
          [tenant, userType, node],
        )
      ).id
      // the world as it was: the code in the catalog, on a role, and accepted
      // into a batch as staff authority
      const resubmit = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('assessment.entry.resubmit', 'assessment', 'Resubmit', 'tenant') returning id`,
        )
      ).id
      const kept = (
        await db.row<{ id: string }>(
          `insert into permissions (code, plugin, name, target_kind)
           values ('assessment.review.process', 'assessment', 'Review', 'org-node') returning id`,
        )
      ).id
      const role = (
        await db.row<{ id: string }>(
          `insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values ($1, 'reviewer', 'Reviewer', 'org', 'active', 'explicit', 'allow-list') returning id`,
          [tenant],
        )
      ).id
      for (const id of [resubmit, kept]) {
        await db.query(
          `insert into role_permissions (tenant_id, role_id, permission_id) values ($1, $2, $3)`,
          [tenant, role, id],
        )
      }
      const grant = (
        await db.row<{ id: string }>(
          `insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
           values ($1, $2, $3, $4, 'subtree') returning id`,
          [tenant, user, role, node],
        )
      ).id
      const batch = (
        await db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, material_range)
           values ($1, 'Old round', daterange('2026-03-01', '2026-09-01')) returning id`,
          [tenant],
        )
      ).id
      const source = (
        await db.row<{ id: string }>(
          `insert into batch_access_sources (tenant_id, batch_id, role_assignment_id, subject_id, origin)
           values ($1, $2, $3, $4, 'inherited') returning id`,
          [tenant, batch, grant, user],
        )
      ).id
      for (const code of ['assessment.entry.resubmit', 'assessment.review.process']) {
        await db.query(
          `insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
           values ($1, $2, $3)`,
          [tenant, source, code],
        )
      }
      await db.query(
        `insert into batch_access_denies (tenant_id, batch_id, subject_id, permission_code)
         values ($1, $2, $3, 'assessment.entry.resubmit')`,
        [tenant, batch, user],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const granted = await db.query<{ code: string }>(
        `select p.code from role_permissions rp join permissions p on p.id = rp.permission_id
          where rp.role_id = $1`,
        [role],
      )
      expect(granted.rows.map((row) => row.code)).toEqual(['assessment.review.process'])
      const catalog = await db.query<{ code: string }>(
        `select code from permissions where plugin = 'assessment' order by code`,
      )
      expect(catalog.rows.map((row) => row.code)).toEqual(['assessment.review.process'])
      // and the ceiling a batch had accepted it into, with the refusal beside it
      const ceiling = await db.query<{ permission_code: string }>(
        `select permission_code from batch_access_source_permissions where source_id = $1`,
        [source],
      )
      expect(ceiling.rows.map((row) => row.permission_code)).toEqual(['assessment.review.process'])
      const denies = await db.query(`select 1 from batch_access_denies where batch_id = $1`, [
        batch,
      ])
      expect(denies.rows).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})

// The boundary a round is administered from is the one it was created with.
// The first backfill read every roster_imports row, and that table is written
// again every time somebody imports more people - so a round created for one
// college and topped up from another came out of the upgrade belonging to
// both.

const ANCHORS = '20260813090000_management-anchors-from-first-import.sql'

describe.runIf(postgresAvailable)('the management-anchor rebuild', () => {
  it('keeps the units a round was created with, and drops the ones it imported later', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, ANCHORS))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-anchors-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== ANCHORS) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('anchor-rebuild', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('anchors', 'Anchors') returning id`,
        )
      ).id
      const orgType = (
        await db.row<{ id: string }>(
          `insert into org_types (tenant_id, name) values ($1, 'College') returning id`,
          [tenant],
        )
      ).id
      // one root, because a tenant may only have one, and two units under it
      const root = (
        await db.row<{ id: string }>(
          `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
           values ($1, $2, 'Root', 'anc', 0) returning id`,
          [tenant, orgType],
        )
      ).id
      const node = async (name: string, pathValue: string) =>
        (
          await db.row<{ id: string }>(
            `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
             values ($1, $2, $3, $4, $5, 1) returning id`,
            [tenant, orgType, root, name, pathValue],
          )
        ).id
      const first = await node('First', 'anc.one')
      const later = await node('Later', 'anc.two')
      const batch = (
        await db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, material_range)
           values ($1, 'Topped up', daterange('2026-03-01', '2026-09-01')) returning id`,
          [tenant],
        )
      ).id
      // the round as it was created, and the import somebody ran a month later
      await db.query(
        `insert into roster_imports (tenant_id, batch_id, org_node_ids, user_type_ids,
                                     imported_count, occurred_at)
         values ($1, $2, $3::jsonb, '[]'::jsonb, 3, now() - interval '30 days')`,
        [tenant, batch, JSON.stringify([first])],
      )
      await db.query(
        `insert into roster_imports (tenant_id, batch_id, org_node_ids, user_type_ids,
                                     imported_count, occurred_at)
         values ($1, $2, $3::jsonb, '[]'::jsonb, 1, now())`,
        [tenant, batch, JSON.stringify([later])],
      )
      // the boundary as the first backfill left it: both units
      const upgraded = await db.query<{ org_node_id: string }>(
        `select org_node_id from batch_management_anchors where batch_id = $1`,
        [batch],
      )
      expect(upgraded.rows).toHaveLength(0)

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const anchors = await db.query<{ org_node_id: string }>(
        `select org_node_id from batch_management_anchors where batch_id = $1`,
        [batch],
      )
      expect(anchors.rows.map((row) => row.org_node_id)).toEqual([first])
    } finally {
      await db.dispose()
    }
  })
})

// Splitting the escalation route off the ordinary one changes how a round says
// where it stands: a position into one list becomes a route plus the step's
// own name. Rounds already open have to arrive on the other side standing
// exactly where they were, and replaying the lineage into an empty database
// says nothing about that.

const ROUTES = '20260815070000_review-routes.sql'

describe.runIf(postgresAvailable)('the review-routes migration', () => {
  it('lands every open round on the route and step it was already standing at', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, ROUTES))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-review-routes-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      // everything before the one under test; the two that follow it are
      // part of the run being proved, not of the shape it starts from
      if (file.endsWith('.sql') && file < ROUTES) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('review-routes-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('routes', 'Routes') returning id`,
      )
      const orgType = await one(
        `insert into org_types (tenant_id, code, name) values ($1, 'class', 'Class') returning id`,
        [tenant],
      )
      const node = await one(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $2, 'Class', 'routes', 0) returning id`,
        [tenant, orgType],
      )
      const userType = await one(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenant],
      )
      const user = await one(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Zhang San', $2, $3) returning id`,
        [tenant, userType, node],
      )
      const batch = await one(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, 'Old rounds', daterange('2026-03-01', '2026-09-01')) returning id`,
        [tenant],
      )
      const group = await one(
        `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '文体') returning id`,
        [tenant, batch],
      )
      const item = await one(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
         values ($1, $2, 'evidence', '退役复学', $3, 'active') returning id`,
        [tenant, batch, group],
      )
      const itemRevision = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
         values ($1, $2, 1, 'student', '{}', '{}', '{}', '{}', $3) returning id`,
        [tenant, item, user],
      )
      const participant = await one(
        `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
         values ($1, $2, $3, $4, (select path from org_nodes where id = $4), '[]'::jsonb, $5)
         returning id`,
        [tenant, batch, user, node, userType],
      )

      // three stages in one list with the marker after the first: stage 0 is
      // the ordinary route, stages 1 and 2 are what escalation walked
      const chain = JSON.stringify({
        normalTerminal: 0,
        stages: [0, 1, 2].map((index) => ({
          index,
          selector: { kind: 'roleAt', nodeTypeId: orgType, roleIds: [] },
          quorum: { type: 'any' },
          roleIds: [],
          nodeId: node,
          skipped: null,
        })),
      })

      const openRound = async (stageIndex: number, mode: 'normal' | 'escalated') => {
        const entry = await one(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
           values ($1, $2, $3, $4, 'self', 'in_review') returning id`,
          [tenant, batch, item, participant],
        )
        const revision = await one(
          `insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
           values ($1, $2, $3, $4, 1, '{}', $5, $5, 'self') returning id`,
          [tenant, entry, item, itemRevision, user],
        )
        return one(
          `insert into review_instances
             (tenant_id, entry_id, revision_id, round_no, origin, initiator, effective_chain,
              mode, current_stage_index, current_role_ids, current_node_id, current_node_path)
           values ($1, $2, $3, 1, 'initial', 'participant', $4::jsonb, $5, $6, '{}', $7,
                   (select path from org_nodes where id = $7))
           returning id`,
          [tenant, entry, revision, chain, mode, stageIndex, node],
        )
      }

      const ordinary = await openRound(0, 'normal')
      const escalated = await openRound(2, 'escalated')
      // the state the new model has no word for: escalated, but standing at
      // or before the marker. It keeps its step and stays on the ordinary
      // route rather than being moved to a level nobody sent it to.
      const halfway = await openRound(0, 'escalated')

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const standing = async (id: string) =>
        db.row<{ current_route: string; current_stage_id: string }>(
          `select current_route, current_stage_id from review_instances where id = $1`,
          [id],
        )
      expect(await standing(ordinary)).toEqual({
        current_route: 'normal',
        current_stage_id: 'legacy-0',
      })
      expect(await standing(escalated)).toEqual({
        current_route: 'escalation',
        current_stage_id: 'legacy-2',
      })
      expect(await standing(halfway)).toEqual({
        current_route: 'normal',
        current_stage_id: 'legacy-0',
      })

      const gone = await db.query(
        `select column_name from information_schema.columns
         where table_name = 'review_instances' and column_name in ('mode', 'current_stage_index')`,
      )
      expect(gone.rows).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('the entry-appeal-naming migration', () => {
  const RENAME = '20260816120000_entry-appeal-naming.sql'

  it('moves the appeal gate out of the resubmit name wherever a phase stored it', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, RENAME))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-appeal-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== RENAME) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('appeal-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('appeal-upg', 'Upgrade') returning id`,
        )
      ).id
      const batch = (
        await db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, material_range)
           values ($1, 'Old profile', daterange('2026-03-01', '2026-09-01')) returning id`,
          [tenant],
        )
      ).id
      await db.row(
        `insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name, permission_profile)
         values ($1, $2, 0, 'appeal-window', 'Appeals',
                 '["assessment.entry.resubmit", "assessment.review.process"]'::jsonb) returning id`,
        [tenant, batch],
      )
      await db.row(
        `insert into phase_templates (tenant_id, name, phases)
         values ($1, 'With appeals',
                 '[{"phaseKey": "appeal", "displayName": "Appeals",
                    "permissionProfile": ["assessment.entry.resubmit"]}]'::jsonb) returning id`,
        [tenant],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const phase = await db.row<{ permission_profile: string[] }>(
        `select permission_profile from batch_phases where tenant_id = $1`,
        [tenant],
      )
      expect(phase.permission_profile).toEqual([
        'assessment.entry.appeal',
        'assessment.review.process',
      ])
      const template = await db.row<{ phases: { permissionProfile: string[] }[] }>(
        `select phases from phase_templates where tenant_id = $1`,
        [tenant],
      )
      expect(template.phases[0]!.permissionProfile).toEqual(['assessment.entry.appeal'])
    } finally {
      await db.dispose()
    }
  })
})

// Backfilling default review reasons only reaches batches that were never
// initialised: replaying into an empty database exercises the UPDATE against
// zero rows, which proves neither the fill nor - more importantly - what it
// must leave alone.

const REASONS = '20260819143000_default-review-reasons.sql'

describe.runIf(postgresAvailable)('the default-review-reasons migration', () => {
  it('fills the never-initialised shape and leaves every decision alone', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, REASONS))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-review-reasons-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== REASONS) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('review-reasons-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const tenant = (
        await db.row<{ id: string }>(
          `insert into tenants (slug, name) values ('reasons', 'Reasons') returning id`,
        )
      ).id
      const batch = (label: string, reasons: string) =>
        db.row<{ id: string }>(
          `insert into assessment_batches (tenant_id, name, material_range, review_reasons)
           values ($1, $2, daterange('2026-03-01', '2026-09-01'), $3::jsonb) returning id`,
          [tenant, label, reasons],
        )
      const untouched = (await batch('Never initialised', '{}')).id
      const configured = (await batch('Configured', '{"reject": ["材料不清晰"], "escalate": []}'))
        .id
      const switchedOff = (await batch('Switched off', '{"reject": [], "escalate": []}')).id

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const read = async (id: string) =>
        (
          await db.row<{ review_reasons: { reject?: string[]; escalate?: string[] } }>(
            `select review_reasons from assessment_batches where id = $1`,
            [id],
          )
        ).review_reasons
      // the blank shape got the defaults, ending in the open reason
      const filled = await read(untouched)
      expect(filled.reject?.length).toBeGreaterThan(0)
      expect(filled.reject?.at(-1)).toBe('其他原因')
      expect(filled.escalate?.at(-1)).toBe('其他原因')
      // an administrator's list, and an administrator's explicit "none",
      // both stand exactly as they were
      expect(await read(configured)).toEqual({ reject: ['材料不清晰'], escalate: [] })
      expect(await read(switchedOff)).toEqual({ reject: [], escalate: [] })
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('the review-panels migration', () => {
  const PANELS = '20260820131214_review-panels.sql'

  it('backfills the one reason every already-blocked round had', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, PANELS))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-panels-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file < PANELS) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('panels-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('panels', 'Panels') returning id`,
      )
      const orgType = await one(
        `insert into org_types (tenant_id, code, name) values ($1, 'class', 'Class') returning id`,
        [tenant],
      )
      const node = await one(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $2, 'Class', 'panels', 0) returning id`,
        [tenant, orgType],
      )
      const userType = await one(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenant],
      )
      const user = await one(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Zhang San', $2, $3) returning id`,
        [tenant, userType, node],
      )
      const batch = await one(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, 'Old rounds', daterange('2026-03-01', '2026-09-01')) returning id`,
        [tenant],
      )
      const group = await one(
        `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '文体') returning id`,
        [tenant, batch],
      )
      const item = await one(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
         values ($1, $2, 'evidence', '退役复学', $3, 'active') returning id`,
        [tenant, batch, group],
      )
      const itemRevision = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
         values ($1, $2, 1, 'student', '{}', '{}', '{}', '{}', $3) returning id`,
        [tenant, item, user],
      )
      const participant = await one(
        `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
         values ($1, $2, $3, $4, (select path from org_nodes where id = $4), '[]'::jsonb, $5)
         returning id`,
        [tenant, batch, user, node, userType],
      )
      const openRound = async (state: 'active' | 'blocked') => {
        const entry = await one(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
           values ($1, $2, $3, $4, 'self', 'in_review') returning id`,
          [tenant, batch, item, participant],
        )
        const revision = await one(
          `insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
           values ($1, $2, $3, $4, 1, '{}', $5, $5, 'self') returning id`,
          [tenant, entry, item, itemRevision, user],
        )
        return one(
          `insert into review_instances
             (tenant_id, entry_id, revision_id, round_no, origin, initiator, policy_revision_id,
              effective_chain, current_route, current_stage_id, state, current_role_ids,
              current_node_id, current_node_path)
           values ($1, $2, $3, 1, 'initial', 'participant', $4, '{}'::jsonb, 'normal', 'n1', $5,
                   '{}', $6, (select path from org_nodes where id = $6))
           returning id`,
          [tenant, entry, revision, itemRevision, state, node],
        )
      }
      // rounds blocked before the reason column existed had exactly one
      // cause - the old patrol wrote blocked only for a staffing gap
      const waiting = await openRound('blocked')
      const working = await openRound('active')

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const reasonOf = async (id: string) =>
        (
          await db.row<{ blocked_reason: string | null }>(
            `select blocked_reason from review_instances where id = $1`,
            [id],
          )
        ).blocked_reason
      expect(await reasonOf(waiting)).toBe('no-assignee')
      expect(await reasonOf(working)).toBeNull()
      // and the check that guards the shape from now on is really in place
      await expect(
        db.query(`update review_instances set blocked_reason = null where id = $1`, [waiting]),
      ).rejects.toThrow(/chk_review_instances_blocked_reason_shape/)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('the drop-bind-permissions migration', () => {
  const BINDS = '20260820160000_drop-bind-permissions.sql'

  it('takes both escape hatches out of the catalog and off the roles that had them', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, BINDS))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-binds-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file !== BINDS) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('binds-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('binds', 'Binds') returning id`,
      )
      const bind = await one(
        `insert into permissions (code, plugin, name, target_kind)
         values ('iam.org-role.bind', 'rbac', 'bind', 'org-node') returning id`,
      )
      const keeper = await one(
        `insert into permissions (code, plugin, name, target_kind)
         values ('iam.grant.manage', 'rbac', 'manage', 'org-node')
         on conflict (code) do update set code = excluded.code returning id`,
      )
      const role = await one(
        `insert into roles (tenant_id, code, name, kind, status, permission_mode, anchor_mode)
        values ($1, 'steward', 'Steward', 'org', 'active', 'explicit', 'allow-list') returning id`,
        [tenant],
      )
      await db.query(
        `insert into role_permissions (tenant_id, role_id, permission_id) values ($1, $2, $3), ($1, $2, $4)`,
        [tenant, role, bind, keeper],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const codes = await db.query(
        `select p.code from role_permissions rp join permissions p on p.id = rp.permission_id
         where rp.role_id = $1 order by p.code`,
        [role],
      )
      // the escape hatch is gone from the role and from the catalog; the
      // role's real capability is untouched
      expect(codes.rows).toEqual([{ code: 'iam.grant.manage' }])
      const gone = await db.query(
        `select code from permissions where code in ('iam.org-role.bind', 'iam.tenant-role.bind')`,
      )
      expect(gone.rows).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('the scoring-plan column and its backfill', () => {
  const PLAN = '20260830100000_item-scoring-plan.sql'

  it('adds the column empty and fills it through the one compiler', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, PLAN))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-plan-upgrade-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file < PLAN) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('plan-upgrade', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('plans', 'Plans') returning id`,
      )
      const orgType = await one(
        `insert into org_types (tenant_id, name) values ($1, 'Class') returning id`,
        [tenant],
      )
      const node = await one(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $2, 'Class', 'plans', 0) returning id`,
        [tenant, orgType],
      )
      const userType = await one(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenant],
      )
      const user = await one(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Zhang San', $2, $3) returning id`,
        [tenant, userType, node],
      )
      const batch = await one(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, 'Old rounds', daterange('2026-03-01', '2026-09-01')) returning id`,
        [tenant],
      )
      const group = await one(
        `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '文体') returning id`,
        [tenant, batch],
      )
      const item = await one(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
         values ($1, $2, 'evidence', '献血', $3, 'active') returning id`,
        [tenant, batch, group],
      )
      // a question saved the way every question was saved before plans
      const revision = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
         values ($1, $2, 1, 'student', '{}',
                 '{"calculator":{"ref":"fixed@1","config":{"value":"3.00"}},"aggregator":{"ref":"sum@1","config":{}}}',
                 '{}', '{}', $3) returning id`,
        [tenant, item, user],
      )
      // and one whose arithmetic no longer exists: the sweep must refuse
      // rather than leave a question that fails on sight
      const broken = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
         values ($1, $2, 2, 'student', '{}',
                 '{"calculator":{"ref":"vanished@1","config":{}},"aggregator":{"ref":"sum@1","config":{}}}',
                 '{}', '{}', $3) returning id`,
        [tenant, item, user],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const planOf = async (id: string) =>
        (
          await db.row<{
            scoring_plan: { calculator?: { ref: string }; planHash?: string } | null
          }>(`select scoring_plan from assessment_item_revisions where id = $1`, [id])
        ).scoring_plan
      // the migration alone only makes room
      expect(await planOf(revision)).toBeNull()

      const sweep = () =>
        Effect.runPromiseExit(
          Effect.provide(
            sweepScoringPlans({
              itemTypes: new Map(),
              definitions: testDefinitions([...builtinCalculators], builtinAggregators),
              ...testRuntime([...builtinCalculators]),
            }).pipe(
              Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
              (effect) => transaction(effect),
            ),
            db.services,
          ),
        )

      // a question whose arithmetic no longer exists stops the sweep, and
      // with it the boot: a server that started while holding an item
      // revision guaranteed to fail on sight is worse than one that refuses
      const refused = await sweep()
      expect(Exit.isFailure(refused)).toBe(true)
      expect(inspect(refused, { depth: 6 })).toContain('ASSESSMENT_SCORING_PLAN_BACKFILL_FAILED')
      expect(inspect(refused, { depth: 6 })).toContain('calculator-not-installed')
      // and it rolled back: nothing half-compiled was left behind
      expect(await planOf(revision)).toBeNull()

      // once the unusable revision is gone, the sweep completes
      await db.query(`delete from assessment_item_revisions where id = $1`, [broken])
      expect(Exit.isSuccess(await sweep())).toBe(true)
      const compiled = await planOf(revision)
      expect(compiled?.calculator?.ref).toBe('fixed@1')
      expect(compiled?.planHash).toMatch(/^[0-9a-f]{64}$/)

      // running it again changes nothing: it only ever fills a null
      expect(Exit.isSuccess(await sweep())).toBe(true)
      expect((await planOf(revision))?.planHash).toBe(compiled?.planHash)
    } finally {
      await db.dispose()
    }
  }, 240_000)
})

describe.runIf(postgresAvailable)('the stored-plan boot gate', () => {
  it('refuses ready while any frozen plan is unreadable or names an absent driver', async () => {
    const db = await createTestContext('plan-driver-gate')
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('gate', 'Gate') returning id`,
      )
      const orgType = await one(
        `insert into org_types (tenant_id, name) values ($1, 'Class') returning id`,
        [tenant],
      )
      const node = await one(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $2, 'Class', 'gate', 0) returning id`,
        [tenant, orgType],
      )
      const userType = await one(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenant],
      )
      const user = await one(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Li Si', $2, $3) returning id`,
        [tenant, userType, node],
      )
      const batch = await one(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, 'Gate rounds', daterange('2026-03-01', '2026-09-01')) returning id`,
        [tenant],
      )
      const group = await one(
        `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '学业') returning id`,
        [tenant, batch],
      )
      const item = await one(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
         values ($1, $2, 'evidence', '竞赛', $3, 'active') returning id`,
        [tenant, batch, group],
      )
      // start from a REAL plan: the sweep compiles it through the shipped
      // compiler, so the deep reader passes and what remains under test is
      // exactly the gate in question
      const revision = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
         values ($1, $2, 1, 'student', '{}',
                 '{"calculator":{"ref":"fixed@1","config":{"value":"3"}},"aggregator":{"ref":"sum@1","config":{}}}',
                 '{}', '{}', $3) returning id`,
        [tenant, item, user],
      )
      const catalogs = {
        itemTypes: new Map(),
        definitions: testDefinitions([...builtinCalculators], builtinAggregators),
        ...testRuntime([...builtinCalculators]),
      }
      const provided = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect.pipe(
              Effect.catchTag('QueryFailed' as never, (error) => Effect.die(error)),
              (one) => transaction(one as never),
            ) as never,
            db.services,
          ),
        )
      expect(Exit.isSuccess(await provided(sweepScoringPlans(catalogs)))).toBe(true)
      const audit = () => provided(auditStoredPlans(catalogs))
      expect(Exit.isSuccess(await audit())).toBe(true)

      const stored = (
        await db.row<{ scoring_plan: Record<string, unknown> }>(
          `select scoring_plan from assessment_item_revisions where id = $1`,
          [revision],
        )
      ).scoring_plan
      // poison only the driver name and restate the hash the poisoned body
      // would carry: the deep reader passes, the driver gate must refuse
      const { planHash: _oldHash, ...body } = stored as { planHash: string } & Record<
        string,
        unknown
      >
      const poisoned = {
        ...body,
        calculator: { ...(body['calculator'] as Record<string, unknown>), ref: 'formula@1' },
      }
      await db.query(
        `update assessment_item_revisions set scoring_plan = $2::jsonb where id = $1`,
        [
          revision,
          JSON.stringify({
            ...poisoned,
            planHash: hashCanonicalJson(semanticPlanBody(poisoned as never)),
          }),
        ],
      )
      const missing = await audit()
      expect(Exit.isFailure(missing)).toBe(true)
      const said = inspect(missing, { depth: 8 })
      expect(said).toContain('ASSESSMENT_STORED_SCORING_DRIVER_MISSING')
      expect(said).toContain('formula@1')
      expect(said).toContain(revision)

      // a plan whose body and identity have come apart is refused as
      // unreadable, whatever drivers it names
      await db.query(
        `update assessment_item_revisions set scoring_plan = $2::jsonb where id = $1`,
        [revision, JSON.stringify({ ...stored, planHash: 'f'.repeat(64) })],
      )
      const corrupted = await audit()
      expect(Exit.isFailure(corrupted)).toBe(true)
      expect(inspect(corrupted, { depth: 8 })).toContain(
        'ASSESSMENT_STORED_SCORING_PLAN_UNREADABLE',
      )

      // A driver may be installed and the plan perfectly readable, and the
      // frozen runtime fact behind it still gone - the verify gate is the
      // one that notices, and it must say which revision and which
      // calculator, without ever contacting an execution process.
      const handed: unknown[] = []
      const verifyRefusing: CalculatorRegistration = {
        kind: 'calculator',
        ref: 'verify-test@1',
        configSchema: Schema.Struct({}),
        bind: Effect.succeed({
          ref: 'verify-test@1',
          compile: () => Effect.die(new Error('compile is not part of this audit')),
          // records what the audit handed over before refusing: the boot
          // audit must pass the WHOLE frozen fact, not just a config
          verify: (frozen) =>
            Effect.suspend(() => {
              handed.push(frozen)
              return Effect.fail(
                new CalculatorRuntimeError('integrity', 'the frozen runtime fact is gone'),
              )
            }),
          prepare: () => Effect.die(new Error('prepare is not part of this audit')),
        }),
      }
      const refused = {
        ...body,
        calculator: { ...(body['calculator'] as Record<string, unknown>), ref: 'verify-test@1' },
      }
      await db.query(
        `update assessment_item_revisions set scoring_plan = $2::jsonb where id = $1`,
        [
          revision,
          JSON.stringify({
            ...refused,
            planHash: hashCanonicalJson(semanticPlanBody(refused as never)),
          }),
        ],
      )
      const installed = [...builtinCalculators, verifyRefusing]
      const unverifiable = await provided(
        auditStoredPlans({
          itemTypes: new Map(),
          definitions: testDefinitions(installed, builtinAggregators),
          ...testRuntime(installed),
        }),
      )
      expect(Exit.isFailure(unverifiable)).toBe(true)
      const spoken = inspect(unverifiable, { depth: 8 })
      expect(spoken).toContain('ASSESSMENT_STORED_SCORING_RUNTIME_INVALID')
      expect(spoken).toContain('verify-test@1')
      expect(spoken).toContain(revision)
      expect(spoken).toContain('the frozen runtime fact is gone')
      // and what verify received was the whole frozen fact of the stored V1
      // plan - contract identity and both schemas intact, with no invented
      // runtime reference or profile versions for a plan that froze none
      expect(handed).toHaveLength(1)
      const frozen = handed[0] as Record<string, unknown>
      const storedPlan = refused as Record<string, unknown>
      expect(frozen['contractHash']).toBe(
        (storedPlan['calculator'] as Record<string, unknown>)['contractHash'],
      )
      expect(frozen['config']).toEqual(
        (storedPlan['calculator'] as Record<string, unknown>)['config'],
      )
      expect(frozen['inputSchema']).toEqual(storedPlan['inputSchema'])
      expect(frozen['outputSchema']).toEqual(storedPlan['outputSchema'])
      expect(frozen['runtimeRef']).toBeUndefined()
      expect(frozen['valueSchemaProfileVersion']).toBeUndefined()
      expect(frozen['regexProfileVersion']).toBeUndefined()

      // restoring the true plan clears the gate
      await db.query(
        `update assessment_item_revisions set scoring_plan = $2::jsonb where id = $1`,
        [revision, JSON.stringify(stored)],
      )
      expect(Exit.isSuccess(await audit())).toBe(true)
    } finally {
      await db.dispose()
    }
  }, 240_000)
})

describe.runIf(postgresAvailable)('the recognition-history migration', () => {
  const HISTORY = '20260830140000_recognition-history.sql'

  it('recovers every approval, names the one in force, and chains them', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, HISTORY))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-recognition-history-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file < HISTORY) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('recognition-history', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('hist', 'Hist') returning id`,
      )
      const orgType = await one(
        `insert into org_types (tenant_id, name) values ($1, 'Class') returning id`,
        [tenant],
      )
      const node = await one(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $2, 'Class', 'hist', 0) returning id`,
        [tenant, orgType],
      )
      const userType = await one(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenant],
      )
      const user = await one(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Zhang San', $2, $3) returning id`,
        [tenant, userType, node],
      )
      const batch = await one(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, 'Old rounds', daterange('2026-03-01', '2026-09-01')) returning id`,
        [tenant],
      )
      const participant = await one(
        `insert into batch_participants
           (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage,
            user_type_id, status)
         values ($1, $2, $3, $4, 'hist', '{}', $5, 'active') returning id`,
        [tenant, batch, user, node, userType],
      )
      const group = await one(
        `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '文体') returning id`,
        [tenant, batch],
      )
      const item = await one(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
         values ($1, $2, 'evidence', '献血', $3, 'active') returning id`,
        [tenant, batch, group],
      )
      const revision = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by, scoring_plan)
         values ($1, $2, 1, 'student', '{}',
                 '{"calculator":{"ref":"fixed@1","config":{"value":"3"}},"aggregator":{"ref":"sum@1","config":{}}}',
                 '{}', '{}', $3, '{}') returning id`,
        [tenant, item, user],
      )
      await db.query(`update assessment_items set current_revision_id = $1 where id = $2`, [
        revision,
        item,
      ])
      // the question was written before any of this happened: an automatic
      // approval names the revision in force at that moment, and a revision
      // stamped today is in force for nothing in the past
      await db.query(
        `update assessment_item_revisions set created_at = '2026-04-01T09:00:00Z' where id = $1`,
        [revision],
      )

      const entryOf = async (status: string) => {
        const entry = await one(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, status, source)
           values ($1, $2, $3, $4, $5, 'self') returning id`,
          [tenant, batch, item, participant, status],
        )
        const filing = await one(
          `insert into entry_revisions
             (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
           values ($1, $2, $3, $4, 1, '{}', $5, $5, 'self') returning id`,
          [tenant, entry, item, revision, user],
        )
        await db.query(`update entries set current_revision_id = $1 where id = $2`, [filing, entry])
        return { entry, filing }
      }

      const round = async (entry: string, filing: string, at: string) => {
        const instance = await one(
          `insert into review_instances
             (tenant_id, entry_id, revision_id, round_no, origin, initiator, policy_revision_id,
              recognition_revision_id, effective_chain, current_stage_id, state, outcome,
              current_node_id, current_node_path, current_role_ids, created_at, completed_at)
           values ($1, $2, $3, 1, 'initial', 'participant', $4, $4, '{}', 's1', 'completed', 'approved',
                   $5, 'hist', '{}', $6::timestamptz, $6::timestamptz) returning id`,
          [tenant, entry, filing, revision, node, at],
        )
        const event = await one(
          `insert into review_events
             (tenant_id, review_instance_id, kind, actor_id, route, stage_id, created_at)
           values ($1, $2, 'approved', $3, 'normal', 's1', $4::timestamptz) returning id`,
          [tenant, instance, user, at],
        )
        return { instance, event }
      }

      // a claim approved in May, appealed since, and open again today: the
      // approval is in its history and nothing recorded what it determined
      const contested = await entryOf('in_review')
      const may = await round(contested.entry, contested.filing, '2026-05-01T09:00:00Z')

      // and one approved by a reviewer, sent back, and then approved again
      // by the rule after the question stopped needing review: the standing
      // decision is the automatic one, not the older round's word
      const switched = await entryOf('draft')
      const may2 = await round(switched.entry, switched.filing, '2026-05-02T09:00:00Z')
      await db.query(
        `insert into entry_events (tenant_id, entry_id, kind, actor_id, created_at)
         values ($1, $2, 'auto-approved', $3, '2026-07-01T09:00:00Z')`,
        [tenant, switched.entry, user],
      )
      // as the first backfill left it: one determination, attributed to the
      // round rather than to the rule that actually approved it
      const misattributed = await one(
        `insert into entry_recognitions
           (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
            values, source, review_instance_id, review_event_id, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, '{}', 'review', $7, $8, $9, '2026-05-02T09:00:00Z')
         returning id`,
        [
          tenant,
          batch,
          switched.entry,
          switched.filing,
          item,
          revision,
          may2.instance,
          may2.event,
          user,
        ],
      )
      await db.query(
        `update entries set status = 'approved', current_recognition_id = $1 where id = $2`,
        [misattributed, switched.entry],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const rowsOf = async (entry: string) =>
        (
          await db.query<{
            id: string
            source: string
            review_event_id: string | null
            supersedes_id: string | null
          }>(
            `select id, source, review_event_id, supersedes_id from entry_recognitions
             where entry_id = $1 order by created_at`,
            [entry],
          )
        ).rows

      // the round that was appealed left a determination behind, even
      // though the claim does not stand approved today
      const contestedRows = await rowsOf(contested.entry)
      expect(contestedRows).toHaveLength(1)
      expect(contestedRows[0]!.source).toBe('review')
      expect(contestedRows[0]!.review_event_id).toBe(may.event)
      // and the claim points at it: a determination in the past is not
      // erased by the claim being looked at again, the scorer just reads
      // the status rather than the pointer
      const pointer = await db.row<{ current_recognition_id: string | null }>(
        `select current_recognition_id from entries where id = $1`,
        [contested.entry],
      )
      expect(pointer.current_recognition_id).toBe(contestedRows[0]!.id)

      // the misattributed row now names the rule that actually approved it,
      // and the reviewer's earlier word gets a determination of its own
      const switchedRows = await rowsOf(switched.entry)
      expect(switchedRows).toHaveLength(2)
      expect(switchedRows.map((each) => each.source)).toEqual(['review', 'system'])
      expect(switchedRows[1]!.id).toBe(misattributed)
      expect(switchedRows[1]!.review_event_id).toBeNull()
      expect(switchedRows[1]!.supersedes_id).toBe(switchedRows[0]!.id)
      const standing = await db.row<{ current_recognition_id: string }>(
        `select current_recognition_id from entries where id = $1`,
        [switched.entry],
      )
      expect(standing.current_recognition_id).toBe(misattributed)

      // one word cannot be the origin of two determinations, and the trail
      // cannot fork
      await expect(
        db.query(
          `insert into entry_recognitions
             (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
              values, source, review_instance_id, review_event_id)
           values ($1, $2, $3, $4, $5, $6, '{}', 'review', $7, $8)`,
          [
            tenant,
            batch,
            contested.entry,
            contested.filing,
            item,
            revision,
            may.instance,
            may.event,
          ],
        ),
      ).rejects.toThrow()

      // and the word a determination cites cannot be deleted out from under
      // it: the shape check says it names one, so nulling it would refuse
      await expect(
        db.query(`delete from review_events where id = $1`, [may.event]),
      ).rejects.toThrow()
    } finally {
      await db.dispose()
    }
  })
})

describe.runIf(postgresAvailable)('the recognition-history repair', () => {
  const REPAIR = '20260830160000_recognition-history-repair.sql'

  it('leaves one determination per decision, and one for every decision', async () => {
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, REPAIR))).toBe(true)
    const before = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-recognition-repair-'))
    for (const file of fs.readdirSync(MIGRATIONS_FOLDER).sort()) {
      if (file.endsWith('.sql') && file < REPAIR) {
        fs.copyFileSync(path.join(MIGRATIONS_FOLDER, file), path.join(before, file))
      }
    }
    const db = await createTestContext('recognition-repair', {
      migrations: 'apply',
      migrationsFolder: before,
    })
    try {
      const one = async (sql: string, values: unknown[] = []) =>
        (await db.row<{ id: string }>(sql, values)).id
      const tenant = await one(
        `insert into tenants (slug, name) values ('rep', 'Rep') returning id`,
      )
      const orgType = await one(
        `insert into org_types (tenant_id, name) values ($1, 'Class') returning id`,
        [tenant],
      )
      const node = await one(
        `insert into org_nodes (tenant_id, org_type_id, name, path, depth)
         values ($1, $2, 'Class', 'rep', 0) returning id`,
        [tenant, orgType],
      )
      const userType = await one(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenant],
      )
      const user = await one(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Zhang San', $2, $3) returning id`,
        [tenant, userType, node],
      )
      const batch = await one(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, 'Old rounds', daterange('2026-03-01', '2026-09-01')) returning id`,
        [tenant],
      )
      const participant = await one(
        `insert into batch_participants
           (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage,
            user_type_id, status)
         values ($1, $2, $3, $4, 'rep', '{}', $5, 'active') returning id`,
        [tenant, batch, user, node, userType],
      )
      const group = await one(
        `insert into score_groups (tenant_id, batch_id, name) values ($1, $2, '文体') returning id`,
        [tenant, batch],
      )
      const item = await one(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, status)
         values ($1, $2, 'evidence', '献血', $3, 'active') returning id`,
        [tenant, batch, group],
      )
      const revision = await one(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by, scoring_plan)
         values ($1, $2, 1, 'student', '{}',
                 '{"calculator":{"ref":"fixed@1","config":{"value":"3"}},"aggregator":{"ref":"sum@1","config":{}}}',
                 '{}', '{}', $3, '{}') returning id`,
        [tenant, item, user],
      )
      await db.query(`update assessment_items set current_revision_id = $1 where id = $2`, [
        revision,
        item,
      ])
      await db.query(
        `update assessment_item_revisions set created_at = '2026-04-01T09:00:00Z' where id = $1`,
        [revision],
      )

      const filingOf = async (entry: string, at: string) => {
        const filing = await one(
          `insert into entry_revisions
             (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source, created_at)
           values ($1, $2, $3, $4, (select coalesce(max(revision_no), 0) + 1 from entry_revisions
                                    where tenant_id = $1 and entry_id = $2),
                   '{}', $5, $5, 'self', $6::timestamptz) returning id`,
          [tenant, entry, item, revision, user, at],
        )
        await db.query(`update entries set current_revision_id = $1 where id = $2`, [filing, entry])
        return filing
      }
      const entryOf = async (status: string) =>
        await one(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, status, source)
           values ($1, $2, $3, $4, $5, 'self') returning id`,
          [tenant, batch, item, participant, status],
        )

      // A round up a two-step ladder: the class confirms, the department
      // ends it. Both wrote an approved event; only the second is a
      // determination, and the first backfill made two.
      const climbed = await entryOf('draft')
      const climbedFiling = await filingOf(climbed, '2026-04-10T09:00:00Z')
      const instance = await one(
        `insert into review_instances
           (tenant_id, entry_id, revision_id, round_no, origin, initiator, policy_revision_id,
            recognition_revision_id, effective_chain, current_stage_id, state, outcome,
            current_node_id, current_node_path, current_role_ids, created_at, completed_at)
         values ($1, $2, $3, 1, 'initial', 'participant', $4, $4, '{}', 'dept', 'completed', 'approved',
                 $5, 'rep', '{}', '2026-05-01T09:00:00Z', '2026-05-03T09:00:00Z') returning id`,
        [tenant, climbed, climbedFiling, revision, node],
      )
      const stageWord = await one(
        `insert into review_events
           (tenant_id, review_instance_id, kind, actor_id, route, stage_id, created_at)
         values ($1, $2, 'approved', $3, 'normal', 'class', '2026-05-02T09:00:00Z') returning id`,
        [tenant, instance, user],
      )
      const finalWord = await one(
        `insert into review_events
           (tenant_id, review_instance_id, kind, actor_id, route, stage_id, created_at)
         values ($1, $2, 'approved', $3, 'normal', 'dept', '2026-05-03T09:00:00Z') returning id`,
        [tenant, instance, user],
      )
      const stack = async (eventId: string, at: string) =>
        await one(
          `insert into entry_recognitions
             (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
              values, source, review_instance_id, review_event_id, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6, '{}', 'review', $7, $8, $9, $10::timestamptz)
           returning id`,
          [tenant, batch, climbed, climbedFiling, item, revision, instance, eventId, user, at],
        )
      // as the history backfill left it: one per approved event - and the
      // POINTER on the surplus one, which is the branch the repair's own
      // comment promises to survive. An approved claim's pointer may never
      // pass through NULL on the way to the kept row.
      const surplus = await stack(stageWord, '2026-05-02T09:00:00Z')
      const kept = await stack(finalWord, '2026-05-03T09:00:00Z')
      await db.query(`update entry_recognitions set supersedes_id = $1 where id = $2`, [
        surplus,
        kept,
      ])
      await db.query(
        `update entries set status = 'approved', current_recognition_id = $1 where id = $2`,
        [surplus, climbed],
      )

      // and a claim the rule approved twice: sent back in between, and only
      // the later of the two recovered.
      //
      // The row the repair inserts lands BETWEEN two that are already
      // chained, which is the shape that makes re-chaining order-dependent:
      // the later determination has to let go of its link before the
      // recovered one can take it. A single set-based UPDATE would succeed
      // or fail here depending on physical order alone.
      const twice = await entryOf('draft')
      const firstFiling = await filingOf(twice, '2026-04-11T09:00:00Z')
      for (const at of ['2026-06-01T09:00:00Z', '2026-07-01T09:00:00Z']) {
        await db.query(
          `insert into entry_events (tenant_id, entry_id, kind, actor_id, created_at)
           values ($1, $2, 'auto-approved', $3, $4::timestamptz)`,
          [tenant, twice, user, at],
        )
      }
      const secondFiling = await filingOf(twice, '2026-06-15T09:00:00Z')
      // an older determination the claim already stood on, and the later
      // one chained onto it: the recovered June approval belongs between
      const oldest = await one(
        `insert into entry_recognitions
           (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
            values, source, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, '{}', 'system', $7, '2026-05-20T09:00:00Z') returning id`,
        [tenant, batch, twice, firstFiling, item, revision, user],
      )
      const latest = await one(
        `insert into entry_recognitions
           (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
            values, source, supersedes_id, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, '{}', 'system', $7, $8, '2026-07-01T09:00:00Z')
         returning id`,
        [tenant, batch, twice, secondFiling, item, revision, oldest, user],
      )
      await db.query(
        `update entries set status = 'approved', current_recognition_id = $1 where id = $2`,
        [latest, twice],
      )

      await runMigrations(db.url, { folder: MIGRATIONS_FOLDER, entities: [] })

      const rowsOf = async (entry: string) =>
        (
          await db.query<{
            id: string
            source: string
            review_event_id: string | null
            supersedes_id: string | null
            entry_revision_id: string
          }>(
            `select id, source, review_event_id, supersedes_id, entry_revision_id
             from entry_recognitions where entry_id = $1 order by created_at`,
            [entry],
          )
        ).rows
      const pointerOf = async (entry: string) =>
        (
          await db.row<{ current_recognition_id: string | null }>(
            `select current_recognition_id from entries where id = $1`,
            [entry],
          )
        ).current_recognition_id

      // the stage's confirmation is a step on the way, not a determination:
      // the round produced one, the same as it would today
      const climbedRows = await rowsOf(climbed)
      expect(climbedRows).toHaveLength(1)
      expect(climbedRows[0]!.id).toBe(kept)
      expect(climbedRows[0]!.review_event_id).toBe(finalWord)
      expect(climbedRows[0]!.supersedes_id).toBeNull()
      expect(await pointerOf(climbed)).toBe(kept)

      // and both automatic approvals are on the record, in order, each
      // naming the filing that was current when it happened
      const twiceRows = await rowsOf(twice)
      expect(twiceRows).toHaveLength(3)
      expect(twiceRows.map((each) => each.source)).toEqual(['system', 'system', 'system'])
      // the recovered June approval took its place in the middle, and the
      // line runs through it rather than around it
      expect(twiceRows[0]!.id).toBe(oldest)
      expect(twiceRows[1]!.entry_revision_id).toBe(firstFiling)
      expect(twiceRows[2]!.id).toBe(latest)
      expect(twiceRows[1]!.supersedes_id).toBe(oldest)
      expect(twiceRows[2]!.supersedes_id).toBe(twiceRows[1]!.id)
      expect(await pointerOf(twice)).toBe(latest)
    } finally {
      await db.dispose()
    }
  })
})
