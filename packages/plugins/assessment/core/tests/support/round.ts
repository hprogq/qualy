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
import { entities } from '../../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../../src/permissions.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../../src/server/index.ts'
import { catalogLayers, storageForTest } from './catalogs.ts'

// The round every policy suite stands in: two colleges, two classes, a
// student and their neighbours, a reviewer holding the review role at
// exactly one class, and a recorder whose accepted authority covers one
// college. Exported so the entry and review suites attack the same world.

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

export const backend = memoryBackend()

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

export const run = <A, E>(
  url: string,
  effect: Effect.Effect<A, E, Assessment | Storage | Rbac | Orm>,
) => Effect.runPromiseExit(Effect.provide(effect, stack(url)))

export const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

export const reasonsOf = (exit: Exit.Exit<unknown, unknown>): readonly { error?: unknown }[] =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: unknown }[] }).reasons ?? [])
    : []

export const errorOf = <T>(exit: Exit.Exit<unknown, unknown>): T | undefined =>
  reasonsOf(exit)
    .map((entry) => entry.error as T | undefined)
    .find((error) => error !== undefined)

export const refusalOf = (exit: Exit.Exit<unknown, unknown>) =>
  errorOf<{ _tag?: string; reason?: string }>(exit)

export const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

export const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

export const GATED = [
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
export const seed = (slug: string) =>
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
    // the role really carries the authority to judge: standing at the stage
    // node is only half of the reviewer definition, the batch must also have
    // accepted assessment.review.process from this assignment
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      select ${t}, ${reviewRole}, p.id from permissions p where p.code = 'assessment.review.process'`)
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

export type Seeded = Effect.Success<ReturnType<typeof seed>>

/** a running batch in its entry phase, one student item, roster imported */
export const runningBatch = (f: Seeded, over?: { profile?: readonly string[] }) =>
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
    // a fresh batch ships with the system's default review reasons; these
    // rounds are about everything else, so the presets are switched off and
    // the tests about reasons configure their own lists
    yield* assessment.updateBatch(
      f.t,
      batch.id,
      { reviewReasons: { reject: [], escalate: [] } },
      f.principal(f.admin),
    )
    yield* assessment.replacePlan(
      f.t,
      batch.id,
      {
        specs: [
          phase({ phaseKey: 'entry', permissionProfile: [...(over?.profile ?? GATED)] }),
          phase({ phaseKey: 'archive' }),
        ],
      },
      f.principal(f.admin),
    )
    const groups = yield* assessment.replaceScoreGroups(
      f.t,
      batch.id,
      {
        groups: [{ name: '文体', parentGroupId: null, cap: '10.00', floor: null }],
        expectedVersion: 1,
      },
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
            normal: {
              stages: [
                {
                  id: 'class',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                  quorum: { type: 'any' },
                },
              ],
            },
            escalation: { stages: [] },
          },
        },
      },
      f.principal(f.admin),
    )
    // a question is composed as a draft and asked on purpose; a round under
    // test is one whose questions have been published
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, f.principal(f.admin))
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
export const staged = (tenantId: string, ownerUserId: string, bytes = 128) =>
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
