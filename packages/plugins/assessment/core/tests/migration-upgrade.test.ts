import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MIGRATIONS_FOLDER, runMigrations } from '@qualy/plugin-database/migrator'

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
          `insert into org_types (tenant_id, code, name) values ($1, 'college', 'College') returning id`,
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
          `insert into roles (tenant_id, code, name, kind, status, permission_mode)
           values ($1, 'reviewer', 'Reviewer', 'org', 'active', 'explicit') returning id`,
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
          `insert into org_types (tenant_id, code, name) values ($1, 'college', 'College') returning id`,
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
          `insert into roles (tenant_id, code, name, kind, status, permission_mode)
           values ($1, 'reviewer', 'Reviewer', 'org', 'active', 'explicit') returning id`,
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
          `insert into org_types (tenant_id, code, name) values ($1, 'college', 'College') returning id`,
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

// Splitting the doubt route off the ordinary one changes how a round says
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
        current_route: 'doubt',
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
