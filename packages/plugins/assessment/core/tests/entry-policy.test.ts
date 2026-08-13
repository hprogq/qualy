import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { Effect, Exit, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { Orm } from '@qualy/plugin-database/server'
import { Storage } from '@qualy/plugin-storage/server/service'
import { memoryBackend } from '@qualy/plugin-storage/testkit'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../src/server/index.ts'
import { catalogLayers, storageForTest } from './support/catalogs.ts'

// The resource policy under attack. Every case here is somebody trying the
// thing the matrix forbids: filing as somebody else, recording outside your
// reach, editing what was submitted, citing another person's file, a second
// claim past the limit. Written before any screen exists, because a screen
// only ever hides buttons - this layer is the refusal itself.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...storageEntities,
  ...entities,
] as const

const backend = memoryBackend()

const stack = (url: string) => {
  const services = booted(
    rbacLayer.pipe(
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )
  const storage = storageForTest(backend).pipe(Layer.provide(services))
  return serviceLayer.pipe(
    Layer.provideMerge(storage),
    Layer.provideMerge(services),
    Layer.provide(catalogLayers),
  )
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Assessment | Storage | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const reasonsOf = (exit: Exit.Exit<unknown, unknown>): readonly { error?: unknown }[] =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: unknown }[] }).reasons ?? [])
    : []

const errorOf = <T>(exit: Exit.Exit<unknown, unknown>): T | undefined =>
  reasonsOf(exit)
    .map((entry) => entry.error as T | undefined)
    .find((error) => error !== undefined)

const refusalOf = (exit: Exit.Exit<unknown, unknown>) =>
  errorOf<{ _tag?: string; reason?: string }>(exit)

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

const GATED = [
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.record',
]

/**
 * A running round with people in three places: a student in a class under
 * college A, a second student beside them, a reviewer holding the review
 * role at that exact class, and a member of staff whose record authority is
 * accepted by the batch but anchored to college A only. College B holds a
 * second class, so reach has somewhere to fail.
 */
const seed = (slug: string) =>
  Effect.gen(function* () {
    const t = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const college = one<{ id: string }>(
      yield* runSql(
        sql`insert into org_types (tenant_id, code, name) values (${t}, 'college', 'College') returning id`,
      ),
    ).id
    const classType = one<{ id: string }>(
      yield* runSql(
        sql`insert into org_types (tenant_id, code, name) values (${t}, 'class', 'Class') returning id`,
      ),
    ).id
    const root = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, name, path, depth)
        values (${t}, ${college}, 'Root', ${slug.replaceAll('-', '_')}, 0) returning id`),
    ).id
    const node = (parent: string, parentPath: string, type: string, name: string, label: string) =>
      runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${t}, ${type}, ${parent}, ${name}, ${sql.raw(`'${parentPath}.${label}'`)}, 1)
        returning id`)
    const base = slug.replaceAll('-', '_')
    const collegeA = one<{ id: string }>(yield* node(root, base, college, 'College A', 'a')).id
    const collegeB = one<{ id: string }>(yield* node(root, base, college, 'College B', 'b')).id
    const classA = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${t}, ${classType}, ${collegeA}, 'Class A1', ${sql.raw(`'${base}.a.a1'`)}, 2)
        returning id`),
    ).id
    const classB = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${t}, ${classType}, ${collegeB}, 'Class B1', ${sql.raw(`'${base}.b.b1'`)}, 2)
        returning id`),
    ).id
    const studentType = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, placement_mode)
        values (${t}, 'student', 'Student', 'unrestricted') returning id`),
    ).id
    const person = (name: string, at: string) =>
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${t}, ${name}, ${studentType}, ${at}) returning id`)
    const admin = one<{ id: string }>(yield* person('Admin', root)).id
    const s1 = one<{ id: string }>(yield* person('Zhang San', classA)).id
    const s2 = one<{ id: string }>(yield* person('Li Si', classA)).id
    const s3 = one<{ id: string }>(yield* person('Wang Wu', classB)).id
    const reviewer = one<{ id: string }>(yield* person('Reviewer', classA)).id
    const recorder = one<{ id: string }>(yield* person('Recorder', collegeA)).id
    const adminRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${t}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(
      sql`insert into role_grants (tenant_id, user_id, role_id) values (${t}, ${admin}, ${adminRole})`,
    )
    const reviewRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status)
        values (${t}, 'class-reviewer', 'Class reviewer', 'org', 'active') returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${t}, ${reviewer}, ${reviewRole}, ${classA}, 'self')`)
    // the recorder's role really carries entry.record, anchored on college A
    const recordRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status)
        values (${t}, 'recorder', 'Recorder', 'org', 'active') returning id`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      select ${t}, ${recordRole}, p.id from permissions p where p.code = 'assessment.entry.record'`)
    const recordGrant = one<{ id: string }>(
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${t}, ${recorder}, ${recordRole}, ${collegeA}, 'subtree') returning id`),
    ).id
    const principal = (userId: string): Principal => ({ tenantId: t, userId, sessionId: 's' })
    return {
      t,
      classType,
      classA,
      root,
      studentType,
      admin,
      s1,
      s2,
      s3,
      reviewer,
      recorder,
      reviewRole,
      recordGrant,
      principal,
    }
  })

type Seeded = Effect.Success<ReturnType<typeof seed>>

/** a running batch in its entry phase, one student item, roster imported */
const runningBatch = (f: Seeded) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const batch = yield* assessment.createBatch(
      f.t,
      {
        name: 'Round',
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
      },
      f.principal(f.admin),
    )
    yield* assessment.replacePlan(
      f.t,
      batch.id,
      {
        specs: [
          phase({ phaseKey: 'entry', permissionProfile: GATED }),
          phase({ phaseKey: 'archive' }),
        ],
      },
      f.principal(f.admin),
    )
    const groups = yield* assessment.replaceScoreGroups(
      f.t,
      batch.id,
      { groups: [{ name: '文体', cap: '10.00', floor: null }] },
      f.principal(f.admin),
    )
    const item = yield* assessment.createItem(
      f.t,
      batch.id,
      {
        itemType: 'evidence',
        title: '退役复学',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: 1,
        config: {
          entrySource: 'student',
          formConfig: { files: {} },
          scoringConfig: {
            calculator: { ref: 'fixed@1', config: { value: '3.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: {
            stages: [
              {
                selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                quorum: { type: 'any' },
              },
            ],
            normalTerminal: 0,
          },
        },
      },
      f.principal(f.admin),
    )
    const plan = yield* assessment.getPlan(f.t, batch.id, f.principal(f.admin))
    yield* assessment.schedulePhase(
      f.t,
      batch.id,
      plan[0]!.id,
      Date.now() + 3_600_000,
      f.principal(f.admin),
    )
    yield* assessment.advancePhase(
      f.t,
      batch.id,
      { to: plan[0]!.id, force: true, reason: 'test enters the phase' },
      f.principal(f.admin),
    )
    // creation already accepted the recorder's authority (the M1 inherit
    // flow); assert the acceptance is there rather than plant a duplicate
    const accepted = yield* runSql(sql`
      select 1 from batch_access_sources s
      join batch_access_source_permissions sp
        on sp.tenant_id = s.tenant_id and sp.source_id = s.id
      where s.batch_id = ${batch.id} and s.subject_id = ${f.recorder}
        and sp.permission_code = 'assessment.entry.record'`)
    if ((accepted as { rows: unknown[] }).rows.length === 0) {
      throw new Error('fixture: the recorder was not accepted at creation')
    }
    const participantOf = (userId: string) =>
      Effect.map(
        runSql(
          sql`select id from batch_participants where batch_id = ${batch.id} and user_id = ${userId}`,
        ),
        (result) => one<{ id: string }>(result).id,
      )
    return {
      batch,
      item,
      p1: yield* participantOf(f.s1),
      p2: yield* participantOf(f.s2),
      p3: yield* participantOf(f.s3),
    }
  })

/** a staged upload of this person's, through the real storage service */
const staged = (tenantId: string, ownerUserId: string, bytes = 128) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const ticket = yield* storage.prepareUpload({
      tenantId,
      ownerUserId,
      filename: 'proof.pdf',
      declaredMime: 'application/pdf',
      size: BigInt(bytes),
    })
    backend.put(`attachments/${tenantId}/${ticket.attachmentId}`, Buffer.alloc(bytes))
    const meta = yield* storage.completeUpload({
      tenantId,
      ownerUserId,
      reservationId: ticket.reservationId,
    })
    return meta.id
  })

describe.runIf(postgresAvailable)('the entry resource policy', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-entry-policy')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('derives who is speaking, and refuses filing as anyone else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-derive')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const own = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )
          const asAnother = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p2, payload: {} },
              f.principal(f.s1),
            ),
          )
          return { own, asAnother }
        }),
      ),
    )

    expect(result.own.status).toBe('draft')
    expect(result.own.source).toBe('self')
    expect(result.own.currentRevision?.source).toBe('self')
    expect(refusalOf(result.asAnother)?.reason).toBe('not-your-participant')
  })

  it('holds staff records to their accepted, anchored reach', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-record')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          // an administrative item beside the student one
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const deduction = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '违纪扣分',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: null,
              config: {
                entrySource: 'administrative',
                formConfig: {},
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  stages: [
                    {
                      selector: {
                        kind: 'roleAt',
                        nodeTypeId: f.classType,
                        roleIds: [f.reviewRole],
                      },
                      quorum: { type: 'any' },
                    },
                  ],
                  normalTerminal: 0,
                },
              },
            },
            admin,
          )
          const recorder = f.principal(f.recorder)
          const inReach = yield* assessment.createEntry(
            f.t,
            {
              itemId: deduction.id,
              participantId: g.p1,
              payload: {},
              note: '校发〔2026〕12 号',
            },
            recorder,
          )
          const outOfReach = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: deduction.id, participantId: g.p3, payload: {}, note: '同一份文件' },
              recorder,
            ),
          )
          const noBasis = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: deduction.id, participantId: g.p2, payload: {} },
              recorder,
            ),
          )
          const studentRecords = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: deduction.id, participantId: g.p1, payload: {} },
              f.principal(f.s1),
            ),
          )
          return { inReach, outOfReach, noBasis, studentRecords }
        }),
      ),
    )

    // recorded is decided, immediately and without a review instance
    expect(result.inReach.status).toBe('approved')
    expect(result.inReach.source).toBe('record')
    expect(result.inReach.currentReviewInstanceId).toBeNull()
    // the audit's case: record over college A says nothing about college B
    expect(refusalOf(result.outOfReach)?.reason).toBe('participant-out-of-reach')
    expect(refusalOf(result.noBasis)?.reason).toBe('basis-required')
    // a student does not hold record, whatever item they aim at
    expect(refusalOf(result.studentRecords)?.reason).toBe('permission-not-held')
  })

  it('lets a claim be worked while it is the owner’s to work, and only then', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-lifecycle')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const secondClaim = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: {} },
              s1,
            ),
          )
          const edited = yield* assessment.appendEntryRevision(
            f.t,
            entry.id,
            { payload: {}, note: 'clarified' },
            s1,
          )
          const editedByOther = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, f.principal(f.s2)),
          )
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const editWhileInReview = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1),
          )
          const doubleSubmit = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )
          const withdrawn = yield* assessment.setEntryStatus(f.t, entry.id, 'draft', s1)
          const resubmitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instances = yield* runSql(
            sql`select round_no, state, outcome from review_instances where entry_id = ${entry.id} order by round_no`,
          )
          const events = yield* runSql(
            sql`select kind from review_events re join review_instances ri on ri.id = re.review_instance_id
                where ri.entry_id = ${entry.id} order by re.created_at`,
          )
          return {
            entry,
            secondClaim,
            edited,
            editedByOther,
            submitted,
            editWhileInReview,
            doubleSubmit,
            withdrawn,
            resubmitted,
            instances: (instances as { rows: unknown[] }).rows,
            events: (events as { rows: { kind: string }[] }).rows.map((row) => row.kind),
          }
        }),
      ),
    )

    expect(refusalOf(result.secondClaim)?.reason).toBe('max-entries-reached')
    expect(result.edited.currentRevision?.revisionNo).toBe(2)
    expect(refusalOf(result.editedByOther)?.reason).toBe('not-your-entry')
    expect(result.submitted.status).toBe('in_review')
    expect(result.submitted.currentReviewInstanceId).not.toBeNull()
    expect(refusalOf(result.editWhileInReview)?.reason).toBe('entry-not-editable')
    expect(refusalOf(result.doubleSubmit)?.reason).toBe('entry-not-submittable')
    expect(result.withdrawn.status).toBe('draft')
    expect(result.withdrawn.currentReviewInstanceId).toBeNull()
    expect(result.resubmitted.status).toBe('in_review')
    // two rounds: the first completed as cancelled, the second open
    expect(result.instances).toEqual([
      { round_no: 1, state: 'completed', outcome: 'cancelled' },
      { round_no: 2, state: 'active', outcome: null },
    ])
    expect(result.events).toEqual(['submitted', 'cancelled-by-submitter', 'submitted'])
  })

  it('refuses to submit into a stage with nobody fit to judge it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-reviewer')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          // the only holder is revoked: nobody left at the class
          yield* runSql(
            sql`update role_grants set revoked_at = now() where user_id = ${f.reviewer}`,
          )
          const nobody = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )
          // the participant themselves picking up the role does not help:
          // nobody judges their own filing
          yield* runSql(sql`
            insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
            values (${f.t}, ${f.s1}, ${f.reviewRole}, ${f.classA}, 'self')`)
          const onlySelf = yield* Effect.exit(
            assessment.setEntryStatus(f.t, entry.id, 'in_review', s1),
          )
          return { nobody, onlySelf }
        }),
      ),
    )

    expect(refusalOf(result.nobody)?.reason).toBe('reviewer-not-found')
    expect(refusalOf(result.onlySelf)?.reason).toBe('reviewer-not-found')
  })

  it('binds cited files in the same breath as the revision, or not at all', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-attach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const mine = yield* staged(f.t, f.s1)
          const created = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [mine] } },
            s1,
          )
          const bound = yield* runSql(
            sql`select status from storage_attachments where id = ${mine}`,
          )
          // somebody else citing my bound file, on their own entry
          const theirs = yield* staged(f.t, f.s2)
          const crossEntry = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p2, payload: { files: [mine] } },
              f.principal(f.s2),
            ),
          )
          // citing somebody else's staged file
          const notYours = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, created.id, { payload: { files: [theirs] } }, s1),
          )
          // re-citing my own bound file in my own next revision is the point
          const recited = yield* assessment.appendEntryRevision(
            f.t,
            created.id,
            { payload: { files: [mine] } },
            s1,
          )
          // one good citation and one broken one leave nothing behind
          const fresh = yield* staged(f.t, f.s2, 64)
          const before = yield* runSql(
            sql`select count(*)::int as n from entries where tenant_id = ${f.t}`,
          )
          const half = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p2, payload: { files: [fresh, randomUUID()] } },
              f.principal(f.s2),
            ),
          )
          const after = yield* runSql(
            sql`select count(*)::int as n from entries where tenant_id = ${f.t}`,
          )
          const freshState = yield* runSql(
            sql`select status from storage_attachments where id = ${fresh}`,
          )
          return {
            created,
            bound: one<{ status: string }>(bound).status,
            crossEntry,
            notYours,
            recited,
            half,
            unchanged: one<{ n: number }>(before).n === one<{ n: number }>(after).n,
            freshState: one<{ status: string }>(freshState).status,
          }
        }),
      ),
    )

    expect(result.created.currentRevision?.attachments).toHaveLength(1)
    expect(result.bound).toBe('bound')
    const crossIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.crossEntry)
    expect(crossIssues?.issues.map((issue) => issue.reason)).toContain('attachment-cross-entry')
    const yoursIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.notYours)
    expect(yoursIssues?.issues.map((issue) => issue.reason)).toContain('attachment-not-yours')
    expect(result.recited.currentRevision?.attachments).toHaveLength(1)
    const halfIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.half)
    expect(halfIssues?.issues.map((issue) => issue.reason)).toContain('attachment-not-found')
    // the refused create left no entry, and the good file is still only staged
    expect(result.unchanged).toBe(true)
    expect(result.freshState).toBe('staged')
  })

  it('judges a submission by the configuration its revision cites, not today\u2019s', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-anchor')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          // the item moves on: a stricter form and a policy pointing at a
          // role nobody holds, saved after the student's revision existed
          const ghostRole = randomUUID()
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: {
                entrySource: 'student',
                formConfig: { required: ['certificate'], files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '3.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  stages: [
                    {
                      selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [ghostRole] },
                      quorum: { type: 'any' },
                    },
                  ],
                  normalTerminal: 0,
                },
              },
              reason: 'tightened after filing',
            },
            s1.userId === f.admin ? s1 : f.principal(f.admin),
          )
          // submitting the old revision: judged by ITS configuration - the
          // payload decodes under the old form, and the chain resolves to
          // the old role's holder, so this succeeds. Under today's config it
          // would fail both ways.
          const submitted = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          const instance = yield* runSql(
            sql`select effective_chain from review_instances where id = ${submitted.currentReviewInstanceId}`,
          )
          const chain = one<{ effective_chain: { stages: { selector: { roleIds: string[] } }[] } }>(
            instance,
          ).effective_chain
          return { submitted, chainRoles: chain.stages[0]!.selector.roleIds, ghostRole }
        }),
      ),
    )

    expect(result.submitted.status).toBe('in_review')
    expect(result.chainRoles).toEqual([expect.any(String)])
    expect(result.chainRoles).not.toContain(result.ghostRole)
  })

  it('lets one staged file into exactly one entry, however the requests race', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-race')
          const assessment = yield* Assessment
          const a = yield* runningBatch(f)
          const b = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1)
          const pOf = (batchId: string) =>
            Effect.map(
              runSql(
                sql`select id from batch_participants where batch_id = ${batchId} and user_id = ${f.s1}`,
              ),
              (result_) => one<{ id: string }>(result_).id,
            )
          const pa = yield* pOf(a.batch.id)
          const pb = yield* pOf(b.batch.id)
          // two rounds, one file, at the same moment: the batch locks do not
          // meet, only the attachment lock stands between this and a file
          // bound into two histories
          const [left, right] = yield* Effect.all(
            [
              Effect.exit(
                assessment.createEntry(
                  f.t,
                  { itemId: a.item.id, participantId: pa, payload: { files: [file] } },
                  s1,
                ),
              ),
              Effect.exit(
                assessment.createEntry(
                  f.t,
                  { itemId: b.item.id, participantId: pb, payload: { files: [file] } },
                  s1,
                ),
              ),
            ],
            { concurrency: 'unbounded' },
          )
          const relations = yield* runSql(
            sql`select count(distinct er.entry_id)::int as n
                from entry_revision_attachments era
                join entry_revisions er on er.id = era.revision_id
                where era.attachment_id = ${file}`,
          )
          return { left, right, families: one<{ n: number }>(relations).n }
        }),
      ),
    )

    const outcomes = [result.left, result.right]
    expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1)
    const refused = outcomes.find(Exit.isFailure)!
    const issues = errorOf<{ issues: readonly { reason: string }[] }>(refused)
    expect(issues?.issues.map((issue) => issue.reason)).toContain('attachment-cross-entry')
    expect(result.families).toBe(1)
  })

  it('refuses a participant of another round before anything reaches the database', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-xbatch')
          const assessment = yield* Assessment
          const a = yield* runningBatch(f)
          const b = yield* runningBatch(f)
          const pInB = one<{ id: string }>(
            yield* runSql(
              sql`select id from batch_participants where batch_id = ${b.batch.id} and user_id = ${f.s1}`,
            ),
          ).id
          // the same person, the wrong round's membership row: a policy
          // refusal, never a foreign-key surprise
          const crossed = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: a.item.id, participantId: pInB, payload: {} },
              f.principal(f.s1),
            ),
          )
          return { crossed }
        }),
      ),
    )

    expect(refusalOf(result.crossed)?._tag).toBe('ASSESSMENT_ENTRY_ACTION_REFUSED')
    expect(refusalOf(result.crossed)?.reason).toBe('participant-not-found')
  })

  it('refuses one file claiming to back two fields, and re-holds re-used files to current limits', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-dupes')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          const file = yield* staged(f.t, f.s1, 4096)
          // the test driver cites payload.files twice when asked twice; a
          // duplicate across fields is simulated by repeating the id, which
          // the driver leaves undeduplicated across ref entries
          const doubled = yield* Effect.exit(
            assessment.createEntry(
              f.t,
              { itemId: g.item.id, participantId: g.p1, payload: { files: [file, file] } },
              s1,
            ),
          )
          // bind it once, then tighten the field's limit under the file
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: { files: [file] } },
            s1,
          )
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: {
                entrySource: 'student',
                formConfig: { files: { maxFileBytes: 1024 } },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '3.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  stages: [
                    {
                      selector: {
                        kind: 'roleAt',
                        nodeTypeId: f.classType,
                        roleIds: [f.reviewRole],
                      },
                      quorum: { type: 'any' },
                    },
                  ],
                  normalTerminal: 0,
                },
              },
              reason: 'limit lowered mid-round',
            },
            admin,
          )
          const reusedOverLimit = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: { files: [file] } }, s1),
          )
          return { doubled, reusedOverLimit }
        }),
      ),
    )

    const doubledIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.doubled)
    expect(doubledIssues?.issues.map((issue) => issue.reason)).toContain('duplicate-attachment')
    const reuseIssues = errorOf<{ issues: readonly { reason: string }[] }>(result.reusedOverLimit)
    expect(reuseIssues?.issues.map((issue) => issue.reason)).toContain('attachment-too-large')
  })

  it('keeps reading rights and acting rights apart', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ep-read')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const stranger = yield* Effect.exit(assessment.getEntry(f.t, entry.id, f.principal(f.s2)))
          const admin = yield* assessment.getEntry(f.t, entry.id, f.principal(f.admin))
          // excluded: history stays readable, the pen is gone (§32.56)
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            'left the college',
            f.principal(f.admin),
          )
          const ownRead = yield* assessment.getEntry(f.t, entry.id, s1)
          const ownEdit = yield* Effect.exit(
            assessment.appendEntryRevision(f.t, entry.id, { payload: {} }, s1),
          )
          return { stranger, admin, ownRead, ownEdit }
        }),
      ),
    )

    // another student learns nothing, not even that it exists
    expect(refusalOf(result.stranger)?._tag).toBe('ASSESSMENT_ENTRY_NOT_FOUND')
    expect(result.admin.id).toBeDefined()
    expect(result.ownRead.capabilities).toEqual({
      canEdit: false,
      canSubmit: false,
      canWithdraw: false,
    })
    expect(refusalOf(result.ownEdit)?.reason).toBe('participant-not-active')
  })
})
