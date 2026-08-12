import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, pgCode, postgresAvailable } from '@qualy/plugin-database/testkit'

// The item, entry and review tables, exercised as raw sql against the
// committed lineage.
//
// What earns a place here is the batch boundary and the parent boundary: an
// entry citing an item from another round, a round citing a revision of
// another entry, an item pointing its current configuration at a different
// item's revision. Every one of these is a reference a service bug could
// write, and every one must be a 23503 rather than a row that looks fine
// until scoring reads it.

describe.runIf(postgresAvailable)('assessment m2 schema', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  const createFixture = async (slug: string) => {
    const tenantId = (
      await db.row<{ id: string }>(
        `insert into tenants (slug, name) values ($1, $1) returning id`,
        [slug],
      )
    ).id
    const orgTypeId = (
      await db.row<{ id: string }>(
        `insert into org_types (tenant_id, code, name) values ($1, 'college', 'College') returning id`,
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

  type Fixture = Awaited<ReturnType<typeof createFixture>>

  /** a batch with a group, an item on its first revision, and one participant */
  const createBatchGraph = async (f: Fixture, name: string) => {
    const batchId = (
      await db.row<{ id: string }>(
        `insert into assessment_batches (tenant_id, name, material_range)
         values ($1, $2, daterange('2026-03-01', '2026-09-01')) returning id`,
        [f.tenantId, name],
      )
    ).id
    const groupId = (
      await db.row<{ id: string }>(
        `insert into score_groups (tenant_id, batch_id, name, cap) values ($1, $2, '文体', 10.0000) returning id`,
        [f.tenantId, batchId],
      )
    ).id
    const itemId = (
      await db.row<{ id: string }>(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id, max_entries)
         values ($1, $2, 'evidence', '退役复学', $3, 1) returning id`,
        [f.tenantId, batchId, groupId],
      )
    ).id
    const itemRevisionId = (
      await db.row<{ id: string }>(
        `insert into assessment_item_revisions
           (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
         values ($1, $2, 1, 'student', '{}', '{"calculator":"fixed@1"}', '{}', '{}', $3) returning id`,
        [f.tenantId, itemId, f.userId],
      )
    ).id
    await db.query(`update assessment_items set current_revision_id = $1 where id = $2`, [
      itemRevisionId,
      itemId,
    ])
    const participantId = (
      await db.row<{ id: string }>(
        `insert into batch_participants (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
         values ($1, $2, $3, $4, (select path from org_nodes where id = $4), $5::jsonb, $6)
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
    return { batchId, groupId, itemId, itemRevisionId, participantId }
  }

  const createEntry = async (f: Fixture, g: Awaited<ReturnType<typeof createBatchGraph>>) => {
    const entryId = (
      await db.row<{ id: string }>(
        `insert into entries (tenant_id, batch_id, item_id, participant_id, source)
         values ($1, $2, $3, $4, 'self') returning id`,
        [f.tenantId, g.batchId, g.itemId, g.participantId],
      )
    ).id
    const revisionId = (
      await db.row<{ id: string }>(
        `insert into entry_revisions (tenant_id, entry_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
         values ($1, $2, $3, 1, '{"note":"discharged 2025"}', $4, $4, 'self') returning id`,
        [f.tenantId, entryId, g.itemRevisionId, f.userId],
      )
    ).id
    await db.query(`update entries set current_revision_id = $1 where id = $2`, [
      revisionId,
      entryId,
    ])
    return { entryId, revisionId }
  }

  beforeAll(async () => {
    db = await createTestContext('assessment-m2-schema')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('round-trips a group, an item, an entry and a round', async () => {
    const f = await createFixture('m2-rt')
    const g = await createBatchGraph(f, '2026 春季综测')
    const e = await createEntry(f, g)

    const entry = await db.row<Record<string, unknown>>(
      `select status, source, current_revision_id from entries where id = $1`,
      [e.entryId],
    )
    expect(entry).toMatchObject({
      status: 'draft',
      source: 'self',
      current_revision_id: e.revisionId,
    })

    const instanceId = (
      await db.row<{ id: string }>(
        `insert into review_instances
           (tenant_id, entry_id, revision_id, round_no, origin, initiator, effective_chain, current_role_ids, current_node_id, current_node_path)
         values ($1, $2, $3, 1, 'initial', 'participant', '{"stages":[]}', $4::uuid[], $5,
                 (select path from org_nodes where id = $5))
         returning id`,
        [f.tenantId, e.entryId, e.revisionId, `{${randomUUID()}}`, f.nodeId],
      )
    ).id
    await db.query(`update entries set current_review_instance_id = $1 where id = $2`, [
      instanceId,
      e.entryId,
    ])
    await db.query(
      `insert into review_events (tenant_id, review_instance_id, kind, actor_id)
       values ($1, $2, 'submitted', $3)`,
      [f.tenantId, instanceId, f.userId],
    )

    const instance = await db.row<Record<string, unknown>>(
      `select state, mode, round_no, array_length(current_role_ids, 1) as roles from review_instances where id = $1`,
      [instanceId],
    )
    expect(instance).toMatchObject({ state: 'active', mode: 'normal', round_no: 1, roles: 1 })
  })

  it('refuses an entry citing an item from another batch', async () => {
    const f = await createFixture('m2-xbatch-item')
    const a = await createBatchGraph(f, 'Round A')
    const b = await createBatchGraph(f, 'Round B')

    // same tenant, real item, wrong round: only the composite key sees it
    expect(
      await pgCode(
        db.query(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, source)
           values ($1, $2, $3, $4, 'self')`,
          [f.tenantId, a.batchId, b.itemId, a.participantId],
        ),
      ),
    ).toBe('23503')
  })

  it('refuses an entry citing a participant from another batch', async () => {
    const f = await createFixture('m2-xbatch-part')
    const a = await createBatchGraph(f, 'Round A')
    const b = await createBatchGraph(f, 'Round B')

    expect(
      await pgCode(
        db.query(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, source)
           values ($1, $2, $3, $4, 'self')`,
          [f.tenantId, a.batchId, a.itemId, b.participantId],
        ),
      ),
    ).toBe('23503')
  })

  it('refuses an item whose score group belongs to another batch', async () => {
    const f = await createFixture('m2-xbatch-group')
    const a = await createBatchGraph(f, 'Round A')
    const b = await createBatchGraph(f, 'Round B')

    expect(
      await pgCode(
        db.query(
          `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id)
           values ($1, $2, 'evidence', 'strayed', $3)`,
          [f.tenantId, a.batchId, b.groupId],
        ),
      ),
    ).toBe('23503')
  })

  it('refuses pointing an entry at a revision of a different entry', async () => {
    const f = await createFixture('m2-xrev')
    const g = await createBatchGraph(f, 'Round A')
    const first = await createEntry(f, g)
    const second = await createEntry(f, g)

    expect(
      await pgCode(
        db.query(`update entries set current_revision_id = $1 where id = $2`, [
          first.revisionId,
          second.entryId,
        ]),
      ),
    ).toBe('23503')
  })

  it('refuses a round citing a revision of a different entry', async () => {
    const f = await createFixture('m2-xround')
    const g = await createBatchGraph(f, 'Round A')
    const first = await createEntry(f, g)
    const second = await createEntry(f, g)

    expect(
      await pgCode(
        db.query(
          `insert into review_instances
             (tenant_id, entry_id, revision_id, round_no, origin, initiator, effective_chain, current_role_ids, current_node_id, current_node_path)
           values ($1, $2, $3, 1, 'initial', 'participant', '{}', '{}', $4,
                   (select path from org_nodes where id = $4))`,
          [f.tenantId, second.entryId, first.revisionId, f.nodeId],
        ),
      ),
    ).toBe('23503')
  })

  it('refuses pointing an item at another item’s revision', async () => {
    const f = await createFixture('m2-xitemrev')
    const g = await createBatchGraph(f, 'Round A')
    const otherItemId = (
      await db.row<{ id: string }>(
        `insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id)
         values ($1, $2, 'evidence', 'another question', $3) returning id`,
        [f.tenantId, g.batchId, g.groupId],
      )
    ).id

    expect(
      await pgCode(
        db.query(`update assessment_items set current_revision_id = $1 where id = $2`, [
          g.itemRevisionId,
          otherItemId,
        ]),
      ),
    ).toBe('23503')
  })

  it('holds one open round per entry, whoever asks for a second', async () => {
    const f = await createFixture('m2-double')
    const g = await createBatchGraph(f, 'Round A')
    const e = await createEntry(f, g)

    const open = () =>
      db.query(
        `insert into review_instances
           (tenant_id, entry_id, revision_id, round_no, origin, initiator, effective_chain, current_role_ids, current_node_id, current_node_path)
         values ($1, $2, $3, (select coalesce(max(round_no), 0) + 1 from review_instances where entry_id = $2),
                 'initial', 'participant', '{}', '{}', $4, (select path from org_nodes where id = $4))`,
        [f.tenantId, e.entryId, e.revisionId, f.nodeId],
      )
    await open()
    // the double submit: a second open round is refused by the partial unique
    expect(await pgCode(open())).toBe('23505')

    // completing the first frees the entry for a genuine next round
    await db.query(
      `update review_instances set state = 'completed', outcome = 'rejected', completed_at = now()
       where entry_id = $1`,
      [e.entryId],
    )
    await open()
  })

  it('keeps revision numbers unique per entry and per item', async () => {
    const f = await createFixture('m2-revno')
    const g = await createBatchGraph(f, 'Round A')
    const e = await createEntry(f, g)

    expect(
      await pgCode(
        db.query(
          `insert into entry_revisions (tenant_id, entry_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
           values ($1, $2, $3, 1, '{}', $4, $4, 'self')`,
          [f.tenantId, e.entryId, g.itemRevisionId, f.userId],
        ),
      ),
    ).toBe('23505')
    expect(
      await pgCode(
        db.query(
          `insert into assessment_item_revisions
             (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
           values ($1, $2, 1, 'student', '{}', '{}', '{}', '{}', $3)`,
          [f.tenantId, g.itemId, f.userId],
        ),
      ),
    ).toBe('23505')
  })

  it('ties an attachment citation to a real stored attachment in the same tenant', async () => {
    const f = await createFixture('m2-attach')
    const g = await createBatchGraph(f, 'Round A')
    const e = await createEntry(f, g)

    // a real attachment, staged by storage in this tenant
    const attachmentId = randomUUID()
    await db.query(
      `insert into storage_attachments
         (id, tenant_id, owner_user_id, backend, filename, declared_mime, size, integrity_algorithm, integrity_value, storage_key, status)
       values ($1, $2, $3, 'local', '证书.pdf', 'application/pdf', 1024, 'sha256', 'abc', $4, 'staged')`,
      [attachmentId, f.tenantId, f.userId, `attachments/${f.tenantId}/${attachmentId}`],
    )
    await db.query(
      `insert into entry_revision_attachments (tenant_id, revision_id, attachment_id, position)
       values ($1, $2, $3, 0)`,
      [f.tenantId, e.revisionId, attachmentId],
    )

    // citing an attachment that does not exist is refused outright
    expect(
      await pgCode(
        db.query(
          `insert into entry_revision_attachments (tenant_id, revision_id, attachment_id, position)
           values ($1, $2, $3, 1)`,
          [f.tenantId, e.revisionId, randomUUID()],
        ),
      ),
    ).toBe('23503')

    // and a cited attachment cannot be deleted out from under the revision
    expect(
      await pgCode(db.query(`delete from storage_attachments where id = $1`, [attachmentId])),
    ).toBe('23001')
  })

  it('refuses the states and shapes nothing should ever write', async () => {
    const f = await createFixture('m2-checks')
    const g = await createBatchGraph(f, 'Round A')

    // a voided item without a reason is not a voided item
    expect(
      await pgCode(
        db.query(`update assessment_items set status = 'voided' where id = $1`, [g.itemId]),
      ),
    ).toBe('23514')
    // an unknown entry source
    expect(
      await pgCode(
        db.query(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, source)
           values ($1, $2, $3, $4, 'telepathy')`,
          [f.tenantId, g.batchId, g.itemId, g.participantId],
        ),
      ),
    ).toBe('23514')
    // a completed round must say when it completed
    const e = await createEntry(f, g)
    expect(
      await pgCode(
        db.query(
          `insert into review_instances
             (tenant_id, entry_id, revision_id, round_no, origin, initiator, effective_chain, current_role_ids, current_node_id, current_node_path, state)
           values ($1, $2, $3, 1, 'initial', 'participant', '{}', '{}', $4,
                   (select path from org_nodes where id = $4), 'completed')`,
          [f.tenantId, e.entryId, e.revisionId, f.nodeId],
        ),
      ),
    ).toBe('23514')
  })

  it('rejects cross-tenant references between the new tables', async () => {
    const a = await createFixture('m2-xta')
    const b = await createFixture('m2-xtb')
    const ga = await createBatchGraph(a, 'A')
    const gb = await createBatchGraph(b, 'B')

    // tenant B's batch citing tenant A's group, item or participant all die
    // on the composite keys, whatever the ids happen to be
    expect(
      await pgCode(
        db.query(
          `insert into entries (tenant_id, batch_id, item_id, participant_id, source)
           values ($1, $2, $3, $4, 'self')`,
          [b.tenantId, gb.batchId, ga.itemId, gb.participantId],
        ),
      ),
    ).toBe('23503')
  })
})
