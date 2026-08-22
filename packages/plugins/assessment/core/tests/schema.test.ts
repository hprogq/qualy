import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, pgCode, postgresAvailable } from '@qualy/plugin-database/testkit'

// A round trip through the committed lineage: the batch, phase and roster
// rows a real batch is made of, written and read back as raw sql. The checks
// probed here are the ones a service bug would otherwise turn into silent
// data: a publication binding on a non-publication boundary, a duplicate
// ordinal, a second roster row for the same person, a cross-tenant anchor.

describe.runIf(postgresAvailable)('assessment schema', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  const createTenant = async (slug: string) =>
    (
      await db.row<{ id: string }>(
        `insert into tenants (slug, name) values ($1, $1) returning id`,
        [slug],
      )
    ).id

  /** one org node of its own type, plus the user type and user the roster needs */
  const createFixture = async (slug: string) => {
    const tenantId = await createTenant(slug)
    const orgTypeId = (
      await db.row<{ id: string }>(
        `insert into org_types (tenant_id, name) values ($1, 'College') returning id`,
        [tenantId],
      )
    ).id
    const nodeId = (
      await db.row<{ id: string }>(
        `insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
         values ($1, $2, null, 'Software College', $3, 0) returning id`,
        [tenantId, orgTypeId, slug.replaceAll('-', '_')],
      )
    ).id
    const userTypeId = (
      await db.row<{ id: string }>(
        `insert into user_types (tenant_id, code, name, placement_mode)
         values ($1, 'student', 'Student', 'unrestricted') returning id`,
        [tenantId],
      )
    ).id
    const userId = (
      await db.row<{ id: string }>(
        `insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
         values ($1, 'Zhang San', $2, $3) returning id`,
        [tenantId, userTypeId, nodeId],
      )
    ).id
    return { tenantId, orgTypeId, nodeId, userTypeId, userId }
  }

  const createBatch = async (f: Awaited<ReturnType<typeof createFixture>>, name: string) => {
    const batchId = (
      await db.row<{ id: string }>(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, $2, daterange('2026-03-01', '2026-09-01'))
         returning id`,
        [f.tenantId, name],
      )
    ).id
    return batchId
  }

  beforeAll(async () => {
    db = await createTestContext('assessment-schema')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('round-trips a batch, its phases and a roster row', async () => {
    const f = await createFixture('rt')
    const batchId = await createBatch(f, '2026 春季综测')

    const batch = await db.row<Record<string, unknown>>(
      `select material_range, timezone, status, config_revision, current_phase_id
         from assessment_batches where id = $1`,
      [batchId],
    )
    // half-open [start, end): certificates carry dates, not instants
    expect(batch.material_range).toBe('[2026-03-01,2026-09-01)')
    expect(batch.timezone).toBe('Asia/Shanghai')
    expect(batch.status).toBe('draft')
    expect(batch.config_revision).toBe(0)
    expect(batch.current_phase_id).toBeNull()

    // a scheduled phase, then one with no time at all: a phase either has a
    // planned instant or is simply not scheduled yet
    const phaseId = (
      await db.row<{ id: string }>(
        `insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name, description, planned_entry_at, permission_profile)
         values ($1, $2, 0, 'entry', '正式填报', '学生提交材料', '2026-03-01T00:00:00+08:00', '["assessment.entry.submit"]')
         returning id`,
        [f.tenantId, batchId],
      )
    ).id
    await db.query(
      `insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name)
       values ($1, $2, 1, 'appeal', '申诉')`,
      [f.tenantId, batchId],
    )
    const phase = await db.row<Record<string, unknown>>(
      `select actual_entry_at, description, permission_profile from batch_phases where id = $1`,
      [phaseId],
    )
    expect(phase.actual_entry_at).toBeNull()
    expect(phase.description).toBe('学生提交材料')
    expect(phase.permission_profile).toEqual(['assessment.entry.submit'])

    // the projection accepts a phase of the same tenant
    await db.query(`update assessment_batches set current_phase_id = $1 where id = $2`, [
      phaseId,
      batchId,
    ])

    const participantId = (
      await db.row<{ id: string }>(
        `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
         values ($1, $2, $3, $4, (select path from org_nodes where id = $4),
                 $5::jsonb, $6)
         returning id`,
        [
          f.tenantId,
          batchId,
          f.userId,
          f.nodeId,
          JSON.stringify([{ nodeId: f.nodeId, nodeTypeId: f.orgTypeId }]),
          f.userTypeId,
        ],
      )
    ).id
    const participant = await db.row<Record<string, unknown>>(
      `select status, anchor_lineage, excluded_at from batch_participants where id = $1`,
      [participantId],
    )
    expect(participant.status).toBe('active')
    expect(participant.anchor_lineage).toEqual([{ nodeId: f.nodeId, nodeTypeId: f.orgTypeId }])
    expect(participant.excluded_at).toBeNull()

    // the config event log and its counter live side by side
    await db.query(
      `insert into batch_config_revisions (tenant_id, batch_id, revision, diff) values ($1, $2, 1, '{"name": ["a", "b"]}')`,
      [f.tenantId, batchId],
    )
    await db.query(`update assessment_batches set config_revision = 1 where id = $1`, [batchId])

    // ids come from postgres 18's native uuidv7()
    expect(batchId).toMatch(/^[0-9a-f-]{14}7/)
  })

  it('refuses what the checks and unique indexes are there to refuse', async () => {
    const f = await createFixture('chk')
    const batchId = await createBatch(f, 'Constraint probes')

    // a phase must be named
    expect(
      await pgCode(
        db.query(
          `insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name)
           values ($1, $2, 0, 'entry', '   ')`,
          [f.tenantId, batchId],
        ),
      ),
    ).toBe('23514')

    await db.query(
      `insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name)
       values ($1, $2, 0, 'entry', 'Entry')`,
      [f.tenantId, batchId],
    )
    // one ordinal, one phase
    expect(
      await pgCode(
        db.query(
          `insert into batch_phases (tenant_id, batch_id, ordinal, phase_key, display_name)
           values ($1, $2, 0, 'review', 'Review')`,
          [f.tenantId, batchId],
        ),
      ),
    ).toBe('23505')

    // one person, one roster row per batch
    const enroll = () =>
      db.query(
        `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
         values ($1, $2, $3, $4, (select path from org_nodes where id = $4), '[]', $5)`,
        [f.tenantId, batchId, f.userId, f.nodeId, f.userTypeId],
      )
    await enroll()
    expect(await pgCode(enroll())).toBe('23505')
  })

  it('rejects cross-tenant references at the database level', async () => {
    const a = await createFixture('xta')
    const b = await createFixture('xtb')

    // scope rows deliberately carry no node foreign key (a deleted unit must
    // warn, not block), so their tenant discipline is the service's; the
    // roster's references below are where the database itself holds the line

    // a roster row anchored on another tenant's node
    const batchId = await createBatch(a, 'Own batch')
    expect(
      await pgCode(
        db.query(
          `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
           values ($1, $2, $3, $4, 'xtb', '[]', $5)`,
          [a.tenantId, batchId, a.userId, b.nodeId, a.userTypeId],
        ),
      ),
    ).toBe('23503')

    // an import recorded against another tenant's batch
    expect(
      await pgCode(
        db.query(
          `insert into roster_imports (tenant_id, batch_id, org_node_ids, user_type_ids, imported_count)
           values ($1, $2, '[]'::jsonb, '[]'::jsonb, 0)`,
          [
            a.tenantId,
            (
              await db.row<{ id: string }>(
                `insert into assessment_batches (tenant_id, name, material_range)
             values ($1, 'other', daterange('2026-03-01', '2026-09-01')) returning id`,
                [b.tenantId],
              )
            ).id,
          ],
        ),
      ),
    ).toBe('23503')
  })

  it('keeps assessment history when its subjects are deleted, and follows the batch down', async () => {
    const f = await createFixture('del')
    const batchId = await createBatch(f, 'Deletion semantics')
    await db.query(
      `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
       values ($1, $2, $3, $4, (select path from org_nodes where id = $4), '[]', $5)`,
      [f.tenantId, batchId, f.userId, f.nodeId, f.userTypeId],
    )

    // a person, node or type on the roster cannot be deleted out from under it
    expect(await pgCode(db.query(`delete from users where id = $1`, [f.userId]))).toBe('23001')
    expect(await pgCode(db.query(`delete from org_nodes where id = $1`, [f.nodeId]))).toBe('23001')
    expect(await pgCode(db.query(`delete from user_types where id = $1`, [f.userTypeId]))).toBe(
      '23001',
    )

    // deleting the batch takes its own rows with it and frees the subjects
    await db.query(`delete from assessment_batches where id = $1`, [batchId])
    const left = await db.row<{ count: number }>(
      `select (select count(*) from batch_participants where tenant_id = $1)::int
            + (select count(*) from batch_phases where tenant_id = $1)::int as count`,
      [f.tenantId],
    )
    expect(left.count).toBe(0)
    await db.query(`delete from users where id = $1`, [f.userId])
  })
})
