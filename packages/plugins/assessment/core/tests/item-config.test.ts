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
import { assembledLayer } from '@qualy/api-kit/assembled'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { assessmentActions } from '../src/actions.ts'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../src/server/index.ts'
import { catalogLayers, storageForTest } from './support/catalogs.ts'

// The configuration gauntlet, end to end: a question is created with its
// first revision, every later save appends the next one, and a save that
// cites missing machinery - or that live entries could not survive - is
// refused with each problem named.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...entities,
  ...auditEntities,
] as const

const stack = (url: string) => {
  const services = booted(
    rbacLayer.pipe(
      // the writer the audited services record through, on the same database
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([
                { owner: 'rbac', actions: accessActions },
                { owner: 'assessment', actions: assessmentActions },
              ]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )
  return serviceLayer.pipe(
    Layer.provideMerge(services),
    Layer.provide(catalogLayers),
    // one services value on purpose: the layer memo map shares it, so the
    // storage stack runs on the same database as everything else
    Layer.provide(storageForTest().pipe(Layer.provide(services))),
    // the boot-hook registry the service registers its backfill into
    Layer.provide(assembledLayer),
  )
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Assessment | Rbac | Orm>) =>
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

const tagOf = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  (errorOf<{ _tag?: string }>(exit) ?? {})._tag

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

const seed = (slug: string) =>
  Effect.gen(function* () {
    const tenant = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const orgType = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_types (tenant_id, name)
        values (${tenant}, 'College') returning id`),
    ).id
    const node = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, name, path, depth)
        values (${tenant}, ${orgType}, 'College', ${slug.replaceAll('-', '_')}, 0) returning id`),
    ).id
    const studentType = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, placement_mode)
        values (${tenant}, 'student', 'Student', 'unrestricted') returning id`),
    ).id
    const admin = one<{ id: string }>(
      yield* runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${tenant}, 'Admin', ${studentType}, ${node}) returning id`),
    ).id
    const role = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id) values (${tenant}, ${admin}, ${role})`)
    const student = one<{ id: string }>(
      yield* runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${tenant}, 'Zhang San', ${studentType}, ${node}) returning id`),
    ).id
    const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
    return { tenant, node, studentType, admin, student, principal }
  })

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

/** a draft batch with one group, ready to hold items */
const draftBatch = (
  f: { tenant: string; node: string; studentType: string; principal: Principal },
  name: string,
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const batch = yield* assessment.createBatch(
      f.tenant,
      {
        name,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds: [f.node], userTypeIds: [f.studentType] },
      },
      f.principal,
    )
    yield* assessment.replacePlan(
      f.tenant,
      batch.id,
      { specs: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'archive' })] },
      f.principal,
    )
    const groups = yield* assessment.replaceScoreGroups(
      f.tenant,
      batch.id,
      {
        groups: [{ name: '文体', parentGroupId: null, cap: '10.00', floor: null }],
        expectedVersion: 1,
      },
      f.principal,
    )
    return { batch, groupId: groups.groups[0]!.id, groupsVersion: groups.version }
  })

const studentConfig = (over: Partial<Record<string, unknown>> = {}) => ({
  entrySource: 'student' as const,
  formConfig: { required: ['certificate'] },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: '3.00' } },
    aggregator: { ref: 'sum@1', config: {} },
  },
  reviewPolicy: {
    normal: {
      stages: [
        {
          id: 's1',
          selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
          quorum: { type: 'any' },
        },
      ],
    },
    escalation: { stages: [] },
  },
  ...over,
})

describe.runIf(postgresAvailable)('item configuration', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-item-config')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('creates an item with its first revision, and appends the next on save', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-create')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const created = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: '退役复学',
              scoreGroupId: groupId,
              maxEntries: 1,
              config: studentConfig(),
            },
            f.principal,
          )
          const revised = yield* assessment.updateItem(
            f.tenant,
            created.id,
            {
              config: studentConfig({ formConfig: { required: [] } }),
              reason: 'loosened the form',
            },
            f.principal,
          )
          const listed = yield* assessment.listItems(f.tenant, batch.id, f.principal)
          return { created, revised, listed }
        }),
      ),
    )

    expect(result.created.currentRevision?.revisionNo).toBe(1)
    // composed as a draft; asking it of the round is a separate, deliberate act
    expect(result.created.status).toBe('draft')
    expect(result.revised.currentRevision?.revisionNo).toBe(2)
    expect(result.revised.currentRevision?.reason).toBe('loosened the form')
    // the first revision is untouched history, not an edit in place
    const first = await db.row<{ form_config: unknown }>(
      `select form_config from assessment_item_revisions where item_id = $1 and revision_no = 1`,
      [result.created.id],
    )
    expect(first.form_config).toEqual({ required: ['certificate'] })
    expect(result.listed.items).toHaveLength(1)
    expect(result.listed.capabilities.canManage).toBe(true)
  })

  it('refuses a configuration citing machinery nobody installed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-refuse')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const create = (config: Record<string, unknown>) =>
            Effect.exit(
              assessment.createItem(
                f.tenant,
                batch.id,
                {
                  itemType: (config['itemType'] as string) ?? 'evidence',
                  title: 'strayed',
                  scoreGroupId: (config['scoreGroupId'] as string) ?? groupId,
                  maxEntries: null,
                  config: studentConfig(config),
                },
                f.principal,
              ),
            )
          return {
            unknownDriver: yield* create({ itemType: 'telepathy' }),
            unknownCalculator: yield* create({
              scoringConfig: {
                calculator: { ref: 'magic@1', config: {} },
                aggregator: { ref: 'sum@1', config: {} },
              },
            }),
            floatAmount: yield* create({
              scoringConfig: {
                calculator: { ref: 'fixed@1', config: { value: 3 } },
                aggregator: { ref: 'sum@1', config: {} },
              },
            }),
            badPolicy: yield* create({
              reviewPolicy: { normal: { stages: [] }, escalation: { stages: [] } },
            }),
            strayGroup: yield* create({ scoreGroupId: randomUUID() }),
          }
        }),
      ),
    )

    const issuesOf = (exit: Exit.Exit<unknown, unknown>) =>
      (errorOf<{ issues?: readonly { path: string; reason: string }[] }>(exit)?.issues ?? []).map(
        (issue) => issue.reason,
      )
    expect(issuesOf(result.unknownDriver)).toContain('item-type-not-installed')
    expect(issuesOf(result.unknownCalculator)).toContain('calculator-not-installed')
    expect(issuesOf(result.floatAmount)).toContain('calculator-config-invalid')
    expect(issuesOf(result.badPolicy)).toContain('policy-stages-required')
    expect(issuesOf(result.strayGroup)).toContain('group-not-in-batch')
  })

  it('takes the whole chain grammar, and refuses what is outside it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-policy')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const create = (reviewPolicy: unknown, entrySource: 'student' | 'administrative') =>
            Effect.exit(
              assessment.createItem(
                f.tenant,
                batch.id,
                {
                  itemType: 'evidence',
                  title: 'policy probe',
                  scoreGroupId: groupId,
                  maxEntries: null,
                  config: studentConfig({ entrySource, reviewPolicy }),
                },
                f.principal,
              ),
            )
          const stage = (id: string) => ({
            id,
            selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
            quorum: { type: 'any' },
          })
          const routes = (normal: unknown[], escalation: unknown[] = []) => ({
            normal: { stages: normal },
            escalation: { stages: escalation },
          })
          return {
            twoRoutes: yield* create(routes([stage('n1'), stage('n2')], [stage('d1')]), 'student'),
            unknownSelector: yield* create(
              routes([
                { id: 'n1', selector: { kind: 'whoeverIsAround' }, quorum: { type: 'any' } },
              ]),
              'student',
            ),
            nearestRole: yield* create(
              routes([
                {
                  id: 'n1',
                  selector: { kind: 'nearestRole', roleId: randomUUID() },
                  quorum: { type: 'any' },
                },
              ]),
              'student',
            ),
            quorumAll: yield* create(
              routes([{ ...stage('n1'), quorum: { type: 'all' } }]),
              'student',
            ),
            unnamedStage: yield* create(
              routes([{ selector: stage('n1').selector, quorum: { type: 'any' } }]),
              'student',
            ),
            oneListWithAMarker: yield* create(
              { stages: [stage('n1')], normalTerminal: 0 },
              'student',
            ),
            // the trusted path never walks the chain on the way in, but an
            // appeal resolves it from this very revision: it must be there
            administrativeChain: yield* create(routes([stage('n1')]), 'administrative'),
            administrativeEmpty: yield* create({}, 'administrative'),
          }
        }),
      ),
    )

    const issuesOf = (exit: Exit.Exit<unknown, unknown>) =>
      (errorOf<{ issues?: readonly { path: string; reason: string }[] }>(exit)?.issues ?? []).map(
        (issue) => issue.reason,
      )
    // the two routes the domain describes are stored as written
    expect(Exit.isSuccess(result.twoRoutes)).toBe(true)
    expect(Exit.isSuccess(result.nearestRole)).toBe(true)
    // a panel is an escalation middle step's shape; the ordinary route
    // refuses it by that name (§32.66)
    expect(issuesOf(result.quorumAll)).toContain('policy-quorum-all-normal')
    // and what is outside the grammar is still named and refused
    expect(issuesOf(result.unknownSelector)).toContain('policy-selector-kind')
    expect(issuesOf(result.unnamedStage)).toContain('policy-stage-id-required')
    // one list with a marker in it is read forever and written never again
    expect(issuesOf(result.oneListWithAMarker)).toEqual(['policy-version-legacy'])
    expect(Exit.isSuccess(result.administrativeChain)).toBe(true)
    expect(issuesOf(result.administrativeEmpty)).toContain('policy-stages-required')
  })

  it('hands back what a save would disturb, and carries out the answer', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-compat')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: '退役复学',
              scoreGroupId: groupId,
              maxEntries: 1,
              config: studentConfig({ formConfig: { required: [] } }),
            },
            f.principal,
          )
          // a live entry whose payload has no certificate, written directly:
          // the entry api arrives later, the impact rule is now. The student
          // is already on the roster - creation imported the node
          const participant = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${batch.id} and user_id = ${f.student}`),
          ).id
          const entry = one<{ id: string }>(
            yield* runSql(sql`
              insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
              values (${f.tenant}, ${batch.id}, ${item.id}, ${participant}, 'self', 'in_review')
              returning id`),
          ).id
          const revision = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
              values (${f.tenant}, ${entry}, ${item.id}, ${item.currentRevision!.id}, 1,
                      '{"note":"no certificate here"}', ${f.student}, ${f.student}, 'self')
              returning id`),
          ).id
          yield* runSql(
            sql`update entries set current_revision_id = ${revision} where id = ${entry}`,
          )

          const tighter = studentConfig({ formConfig: { required: ['certificate'] } })
          // first pass, no answer: the save comes back with what it would do
          const asked = yield* Effect.exit(
            assessment.updateItem(f.tenant, item.id, { config: tighter }, f.principal),
          )
          const report = errorOf<{
            impactToken: string
            form: { inReview: { total: number; incompatible: number } }
          }>(asked)!
          // nothing was half done while the question was being asked
          const untouched = one<{ status: string; revision_no: number }>(
            yield* runSql(sql`
              select e.status, r.revision_no from entries e
              join assessment_items i on i.id = e.item_id
              join assessment_item_revisions r on r.id = i.current_revision_id
              where e.id = ${entry}`),
          )
          // an answer drawn from a state that has moved is not carried out
          const stale = yield* Effect.exit(
            assessment.updateItem(
              f.tenant,
              item.id,
              {
                config: tighter,
                effects: {
                  impactToken: 'counted-something-else',
                  form: { inReview: 'return', approved: 'keep' },
                },
              },
              f.principal,
            ),
          )
          const saved = yield* assessment.updateItem(
            f.tenant,
            item.id,
            {
              config: tighter,
              reason: '新增证书编号',
              effects: {
                impactToken: report.impactToken,
                form: { inReview: 'return', approved: 'keep' },
              },
            },
            f.principal,
          )
          const after = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${entry}`),
          )
          const logged = one<{ kind: string; cause_revision_id: string }>(
            yield* runSql(sql`
              select kind, cause_revision_id from entry_events where entry_id = ${entry}`),
          )
          return { asked, report, untouched, stale, saved, after, logged }
        }),
      ),
    )

    expect(tagOf(result.asked)).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(result.report.form.inReview).toEqual({ total: 1, incompatible: 1 })
    expect(result.untouched).toEqual({ status: 'in_review', revision_no: 1 })
    expect(tagOf(result.stale)).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    // the answered save goes through, and the claim is asked for more rather
    // than rejected by anybody
    expect(result.saved.currentRevision?.revisionNo).toBe(2)
    expect(result.after.status).toBe('needs_revision')
    expect(result.logged.kind).toBe('revision-required')
    expect(result.logged.cause_revision_id).toBe(result.saved.currentRevision!.id)
  })

  it('saves without asking when the change disturbs nothing', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-quiet')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: '退役复学',
              scoreGroupId: groupId,
              maxEntries: 1,
              config: studentConfig({ formConfig: { required: ['certificate'] } }),
            },
            f.principal,
          )
          // a live entry that the looser form reads perfectly well
          const participant = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${batch.id} and user_id = ${f.student}`),
          ).id
          const entry = one<{ id: string }>(
            yield* runSql(sql`
              insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
              values (${f.tenant}, ${batch.id}, ${item.id}, ${participant}, 'self', 'draft')
              returning id`),
          ).id
          const revision = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
              values (${f.tenant}, ${entry}, ${item.id}, ${item.currentRevision!.id}, 1,
                      '{"certificate":"yes"}', ${f.student}, ${f.student}, 'self')
              returning id`),
          ).id
          // approved the way the service approves: a determination first,
          // then one statement that carries both the pointer and the status
          const recognition = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_recognitions
                (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id, values, source)
              values (${f.tenant}, ${batch.id}, ${entry}, ${revision}, ${item.id},
                      ${item.currentRevision!.id}, '{}'::jsonb, 'system')
              returning id`),
          ).id
          yield* runSql(
            sql`update entries
                set current_revision_id = ${revision},
                    current_recognition_id = ${recognition},
                    status = 'approved'
                where id = ${entry}`,
          )
          const loosened = yield* assessment.updateItem(
            f.tenant,
            item.id,
            { config: studentConfig({ formConfig: { required: [] } }) },
            f.principal,
          )
          // and an edit composed against a version somebody else replaced
          const conflicting = yield* Effect.exit(
            assessment.updateItem(
              f.tenant,
              item.id,
              {
                config: studentConfig({ formConfig: { required: ['note'] } }),
                expectedRevisionId: item.currentRevision!.id,
              },
              f.principal,
            ),
          )
          const still = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${entry}`),
          )
          return { loosened, conflicting, still }
        }),
      ),
    )

    expect(result.loosened.currentRevision?.revisionNo).toBe(2)
    expect(result.still.status).toBe('approved')
    expect(
      errorOf<{ issues: readonly { reason: string }[] }>(result.conflicting)!.issues.map(
        (issue) => issue.reason,
      ),
    ).toContain('item-revision-conflict')
  })

  it('moves the config revision and appends an event only once the batch is active', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-events')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'draft-time question',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig(),
            },
            f.principal,
          )
          const draft = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
          // start the round: config changes now leave an audit trail
          const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
          yield* assessment.schedulePhase(
            f.tenant,
            batch.id,
            plan[0]!.id,
            Date.now() + 3_600_000,
            f.principal,
          )
          yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'active-time question',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig(),
            },
            f.principal,
          )
          const active = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
          return {
            draftRevision: draft.configRevision,
            activeRevision: active.configRevision,
            batchId: batch.id,
            tenant: f.tenant,
          }
        }),
      ),
    )

    expect(result.draftRevision).toBe(0)
    expect(result.activeRevision).toBeGreaterThan(result.draftRevision)
    const events = await db.query<{ diff: Record<string, unknown> }>(
      `select diff from batch_config_revisions where tenant_id = $1 and batch_id = $2`,
      [result.tenant, result.batchId],
    )
    expect(
      events.rows.some((row) => JSON.stringify(row.diff).includes('active-time question')),
    ).toBe(true)
    expect(
      events.rows.some((row) => JSON.stringify(row.diff).includes('draft-time question')),
    ).toBe(false)
  })

  it('replaces the score tree flat, and refuses what would strand or contradict', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-groups')
          const assessment = yield* Assessment
          const { batch, groupId, groupsVersion } = yield* draftBatch(f, 'Round')
          yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'holds its group',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig(),
            },
            f.principal,
          )
          const renamed = yield* assessment.replaceScoreGroups(
            f.tenant,
            batch.id,
            {
              groups: [
                { id: groupId, name: '文体活动', parentGroupId: null, cap: '10.00', floor: '0.00' },
                // a section joins the paper rather than standing beside it:
                // a round has one outermost group
                { name: '品德', parentGroupId: groupId, cap: null, floor: '0.00' },
              ],
              expectedVersion: groupsVersion,
            },
            f.principal,
          )
          // a save composed against the tree as it was before the rename:
          // refused whatever else it says
          const stale = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              {
                groups: [
                  { id: groupId, name: '文体活动', parentGroupId: null, cap: null, floor: null },
                ],
                expectedVersion: groupsVersion,
              },
              f.principal,
            ),
          )
          const orphaning = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              {
                groups: [{ name: 'only the new one', parentGroupId: null, cap: null, floor: null }],
                expectedVersion: renamed.version,
              },
              f.principal,
            ),
          )
          const contradiction = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              {
                groups: [
                  {
                    id: groupId,
                    name: '文体活动',
                    parentGroupId: null,
                    cap: '5.00',
                    floor: '10.00',
                  },
                ],
                expectedVersion: renamed.version,
              },
              f.principal,
            ),
          )
          const stray = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              {
                groups: [
                  { id: randomUUID(), name: 'ghost', parentGroupId: null, cap: null, floor: null },
                ],
                expectedVersion: renamed.version,
              },
              f.principal,
            ),
          )
          return { renamed, stale, orphaning, contradiction, stray, groupId }
        }),
      ),
    )

    expect(result.renamed.groups.map((group) => group.name)).toEqual(['文体活动', '品德'])
    // the count is the questions the group asks, and this one is still being
    // composed; that it is nonetheless held is what the refusal below says
    expect(result.renamed.groups[0]!.itemCount).toBe(0)
    const refusalsOf = (exit: Exit.Exit<unknown, unknown>) =>
      (
        errorOf<{ refusals?: readonly { reason: string; groupId: string | null }[] }>(exit)
          ?.refusals ?? []
      ).map((refusal) => refusal.reason)
    expect(tagOf(result.stale)).toBe('ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT')
    expect(errorOf<{ currentVersion?: number }>(result.stale)?.currentVersion).toBe(
      result.renamed.version,
    )
    expect(refusalsOf(result.orphaning)).toContain('group-has-items')
    expect(refusalsOf(result.contradiction)).toContain('floor-above-cap')
    expect(refusalsOf(result.stray)).toContain('group-not-found')
  })

  it('demands a reason for scoring-semantic changes on a running round, and only those', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-reason')
          const assessment = yield* Assessment
          const { batch, groupId, groupsVersion } = yield* draftBatch(f, 'Round')
          // the round runs before anything is composed: a draft round asks
          // nobody for a reason, so an exemption tested under one would be
          // carried by the round's status instead of the question's
          const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
          yield* assessment.schedulePhase(
            f.tenant,
            batch.id,
            plan[0]!.id,
            Date.now() + 3_600_000,
            f.principal,
          )
          const running = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'worth three',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig(),
            },
            f.principal,
          )
          // the rule is about a question the round has already asked: one
          // still being composed has promised nobody anything (§32.60).
          // Worth three becomes worth four with nothing said.
          const composing = yield* Effect.exit(
            assessment.updateItem(
              f.tenant,
              item.id,
              {
                config: studentConfig({
                  scoringConfig: {
                    calculator: { ref: 'fixed@1', config: { value: '4.00' } },
                    aggregator: { ref: 'sum@1', config: {} },
                  },
                }),
              },
              f.principal,
            ),
          )
          yield* assessment.setItemStatus(f.tenant, item.id, { status: 'active' }, f.principal)
          // worth four becomes worth five, silently: refused
          const silent = yield* Effect.exit(
            assessment.updateItem(
              f.tenant,
              item.id,
              {
                config: studentConfig({
                  scoringConfig: {
                    calculator: { ref: 'fixed@1', config: { value: '5.00' } },
                    aggregator: { ref: 'sum@1', config: {} },
                  },
                }),
              },
              f.principal,
            ),
          )
          // the same change with a sentence attached: accepted
          const spoken = yield* assessment.updateItem(
            f.tenant,
            item.id,
            {
              config: studentConfig({
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '5.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
              }),
              reason: 'college adjusted the standard',
            },
            f.principal,
          )
          // a title is decoration; no reason needed even on a running round
          const renamed = yield* assessment.updateItem(
            f.tenant,
            item.id,
            { title: 'worth five' },
            f.principal,
          )
          // a cap moving on a running round without a reason: refused
          const capSilent = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              {
                groups: [
                  { id: groupId, name: '文体', parentGroupId: null, cap: '6.00', floor: null },
                ],
                expectedVersion: groupsVersion,
              },
              f.principal,
            ),
          )
          const capSpoken = yield* assessment.replaceScoreGroups(
            f.tenant,
            batch.id,
            {
              groups: [
                { id: groupId, name: '文体', parentGroupId: null, cap: '6.00', floor: null },
              ],
              expectedVersion: groupsVersion,
              reason: 'ceiling lowered by the college',
            },
            f.principal,
          )
          return { running, composing, silent, spoken, renamed, capSilent, capSpoken }
        }),
      ),
    )

    const issuesOf = (exit: Exit.Exit<unknown, unknown>) =>
      (errorOf<{ issues?: readonly { reason: string }[] }>(exit)?.issues ?? []).map(
        (issue) => issue.reason,
      )
    // the exemption belongs to the question, so the round has to have been
    // running when the composing edit went through
    expect(result.running.status).toBe('active')
    // composing an unpublished question needs no explanation
    expect(result.composing._tag).toBe('Success')
    expect(issuesOf(result.silent)).toContain('reason-required')
    // the composing edit appended its own revision, so the spoken one is third
    expect(result.spoken.currentRevision?.revisionNo).toBe(3)
    expect(result.renamed.title).toBe('worth five')
    const refusalsOf = (exit: Exit.Exit<unknown, unknown>) =>
      (errorOf<{ refusals?: readonly { reason: string }[] }>(exit)?.refusals ?? []).map(
        (refusal) => refusal.reason,
      )
    expect(refusalsOf(result.capSilent)).toContain('reason-required')
    expect(result.capSpoken.groups[0]!.cap).toBe('6.0000')
  })

  it('freezes who may file once anything has been filed', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-source')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'student question',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig(),
            },
            f.principal,
          )
          // with no entries, the source may still change
          const beforeEntries = yield* assessment.updateItem(
            f.tenant,
            item.id,
            { config: studentConfig({ entrySource: 'administrative' }) },
            f.principal,
          )
          yield* assessment.updateItem(f.tenant, item.id, { config: studentConfig() }, f.principal)
          // one draft entry exists now - even a draft freezes the source,
          // because the policy layer reads it to decide who may act
          const participant = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${batch.id} and user_id = ${f.student}`),
          ).id
          yield* runSql(sql`
            insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
            values (${f.tenant}, ${batch.id}, ${item.id}, ${participant}, 'self', 'draft')`)
          const frozen = yield* Effect.exit(
            assessment.updateItem(
              f.tenant,
              item.id,
              { config: studentConfig({ entrySource: 'administrative' }) },
              f.principal,
            ),
          )
          return { beforeEntries, frozen }
        }),
      ),
    )

    expect(result.beforeEntries.currentRevision?.entrySource).toBe('administrative')
    const issues = errorOf<{ issues?: readonly { reason: string }[] }>(result.frozen)
    expect((issues?.issues ?? []).map((issue) => issue.reason)).toContain('entry-source-frozen')
  })

  it('writes nothing down for a change that changed nothing', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-noop')
          const assessment = yield* Assessment
          const { batch, groupId, groupsVersion } = yield* draftBatch(f, 'Round')
          // one config value, used for both saves: the helper mints fresh
          // role ids per call, and "identical" must actually mean identical
          const config = studentConfig()
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'stable question',
              scoreGroupId: groupId,
              maxEntries: null,
              config,
            },
            f.principal,
          )
          const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
          yield* assessment.schedulePhase(
            f.tenant,
            batch.id,
            plan[0]!.id,
            Date.now() + 3_600_000,
            f.principal,
          )
          const activated = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
          // the same configuration again, and the same groups again
          const resaved = yield* assessment.updateItem(f.tenant, item.id, { config }, f.principal)
          yield* assessment.replaceScoreGroups(
            f.tenant,
            batch.id,
            {
              groups: [
                { id: groupId, name: '文体', parentGroupId: null, cap: '10.00', floor: null },
              ],
              expectedVersion: groupsVersion,
            },
            f.principal,
          )
          const after = yield* assessment.getBatch(f.tenant, batch.id, f.principal)
          return { activated, resaved, after }
        }),
      ),
    )

    // no new revision, no counter movement, no event: nothing happened, and
    // the record says so by staying quiet
    expect(result.resaved.currentRevision?.revisionNo).toBe(1)
    expect(result.after.configRevision).toBe(result.activated.configRevision)
  })

  it('refuses to shrink the material window over what could not live inside it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-range')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'dated evidence',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig({ formConfig: { validFrom: '2026-08-01' } }),
            },
            f.principal,
          )
          // live means published: a draft question is outside every window check
          yield* assessment.setItemStatus(f.tenant, item.id, { status: 'active' }, f.principal)
          // a live entry that the current form still reads
          const participant = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${batch.id} and user_id = ${f.student}`),
          ).id
          const entry = one<{ id: string }>(
            yield* runSql(sql`
              insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
              values (${f.tenant}, ${batch.id}, ${item.id}, ${participant}, 'self', 'draft')
              returning id`),
          ).id
          const revision = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
              values (${f.tenant}, ${entry}, ${item.id}, ${item.currentRevision!.id}, 1,
                      '{}', ${f.student}, ${f.student}, 'self')
              returning id`),
          ).id
          // approved the way the service approves: a determination first,
          // then one statement that carries both the pointer and the status
          const recognition = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_recognitions
                (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id, values, source)
              values (${f.tenant}, ${batch.id}, ${entry}, ${revision}, ${item.id},
                      ${item.currentRevision!.id}, '{}'::jsonb, 'system')
              returning id`),
          ).id
          yield* runSql(
            sql`update entries
                set current_revision_id = ${revision},
                    current_recognition_id = ${recognition},
                    status = 'approved'
                where id = ${entry}`,
          )

          // the item's own window dies before any payload does: a form that
          // needs days from august cannot live in a round that ends in july
          const emptied = yield* Effect.exit(
            assessment.updateBatch(
              f.tenant,
              batch.id,
              { materialRange: { start: '2026-03-01', end: '2026-07-01' } },
              f.principal,
            ),
          )
          // a shrink both the form and the payloads survive goes through
          const survivable = yield* assessment.updateBatch(
            f.tenant,
            batch.id,
            { materialRange: { start: '2026-03-02', end: '2026-09-01' } },
            f.principal,
          )
          // an item whose driver this assembly does not carry proves nothing
          // about any window, so the change is refused rather than waved past
          const ghostGroup = groupId
          const ghostItem = one<{ id: string }>(
            yield* runSql(sql`
              insert into assessment_items
                (tenant_id, batch_id, item_type, title, score_group_id, status)
              values (${f.tenant}, ${batch.id}, 'ghost', 'orphaned question', ${ghostGroup}, 'active')
              returning id`),
          ).id
          yield* runSql(sql`
            insert into assessment_item_revisions
              (tenant_id, item_id, revision_no, entry_source, form_config, scoring_config, review_policy, display_config, created_by)
            values (${f.tenant}, ${ghostItem}, 1, 'student', '{}', '{}', '{}', '{}', ${f.principal.userId})`)
          yield* runSql(sql`
            update assessment_items set current_revision_id =
              (select id from assessment_item_revisions where item_id = ${ghostItem})
            where id = ${ghostItem}`)
          const unprovable = yield* Effect.exit(
            assessment.updateBatch(
              f.tenant,
              batch.id,
              { materialRange: { start: '2026-03-03', end: '2026-09-01' } },
              f.principal,
            ),
          )
          return { item: item.id, ghostItem, emptied, survivable, unprovable }
        }),
      ),
    )

    expect(tagOf(result.emptied)).toBe('ASSESSMENT_MATERIAL_RANGE_INVALID')
    const emptiedError = errorOf<{ items: readonly { itemId: string; reason: string }[] }>(
      result.emptied,
    )!
    expect(emptiedError.items).toContainEqual({
      itemId: result.item,
      reason: 'date-window-empty',
    })
    expect(result.survivable.materialRange.start).toBe('2026-03-02')
    const unprovableError = errorOf<{ items: readonly { itemId: string; reason: string }[] }>(
      result.unprovable,
    )!
    expect(unprovableError.items).toContainEqual({
      itemId: result.ghostItem,
      reason: 'item-type-not-installed',
    })
  })

  it('keeps configuration management inside the batch boundary', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('item-authz')
          const stranger = yield* seed('item-authz-stranger')
          const assessment = yield* Assessment
          const { batch, groupId } = yield* draftBatch(f, 'Round')
          const foreign = yield* Effect.exit(
            assessment.createItem(
              stranger.tenant,
              batch.id,
              {
                itemType: 'evidence',
                title: 'across the fence',
                scoreGroupId: groupId,
                maxEntries: null,
                config: studentConfig(),
              },
              stranger.principal,
            ),
          )
          const item = yield* assessment.createItem(
            f.tenant,
            batch.id,
            {
              itemType: 'evidence',
              title: 'voidable',
              scoreGroupId: groupId,
              maxEntries: null,
              config: studentConfig(),
            },
            f.principal,
          )
          yield* runSql(sql`
            update assessment_items
            set status = 'voided', voided_at = now(), voided_by = ${f.principal.userId},
                void_reason = 'configured against the wrong rule'
            where id = ${item.id}`)
          const editVoided = yield* Effect.exit(
            assessment.updateItem(f.tenant, item.id, { title: 'renamed anyway' }, f.principal),
          )
          return { foreign, editVoided }
        }),
      ),
    )

    // another tenant's batch answers not-found, not forbidden: its existence
    // is nobody else's business
    expect(tagOf(result.foreign)).toBe('ASSESSMENT_BATCH_NOT_FOUND')
    const issues = errorOf<{ issues?: readonly { reason: string }[] }>(result.editVoided)
    expect((issues?.issues ?? []).map((issue) => issue.reason)).toContain('item-voided')
  })
})
