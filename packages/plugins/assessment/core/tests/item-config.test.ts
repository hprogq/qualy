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
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../src/server/index.ts'
import { catalogLayers } from './support/catalogs.ts'

// The configuration gauntlet, end to end: a question is created with its
// first revision, every later save appends the next one, and a save that
// cites missing machinery - or that live entries could not survive - is
// refused with each problem named.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

const stack = (url: string) =>
  serviceLayer.pipe(
    Layer.provideMerge(
      booted(
        rbacLayer.pipe(
          Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
        ),
        { catalog },
      ),
    ),
    Layer.provide(catalogLayers),
  )

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
        insert into org_types (tenant_id, code, name)
        values (${tenant}, 'college', 'College') returning id`),
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
      { groups: [{ name: '文体', cap: '10.00', floor: null }] },
      f.principal,
    )
    return { batch, groupId: groups.groups[0]!.id }
  })

const studentConfig = (over: Partial<Record<string, unknown>> = {}) => ({
  entrySource: 'student' as const,
  formConfig: { required: ['certificate'] },
  scoringConfig: {
    calculator: { ref: 'fixed@1', config: { value: '3.00' } },
    aggregator: { ref: 'sum@1', config: {} },
  },
  reviewPolicy: {
    stages: [
      {
        selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
        quorum: { type: 'any' },
      },
    ],
    normalTerminal: 0,
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
    expect(result.created.status).toBe('active')
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
              reviewPolicy: { stages: [], normalTerminal: 0 },
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
    expect(issuesOf(result.badPolicy)).toContain('policy-single-stage')
    expect(issuesOf(result.strayGroup)).toContain('group-not-in-batch')
  })

  it('refuses the policy shapes the engine does not implement', async () => {
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
          const stage = {
            selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
            quorum: { type: 'any' },
          }
          return {
            twoStages: yield* create({ stages: [stage, stage], normalTerminal: 0 }, 'student'),
            nearestRole: yield* create(
              {
                stages: [
                  {
                    selector: { kind: 'nearestRole', roleId: randomUUID() },
                    quorum: { type: 'any' },
                  },
                ],
                normalTerminal: 0,
              },
              'student',
            ),
            quorumAll: yield* create(
              { stages: [{ ...stage, quorum: { type: 'all' } }], normalTerminal: 0 },
              'student',
            ),
            laterTerminal: yield* create({ stages: [stage], normalTerminal: 1 }, 'student'),
            // the trusted path never walks the chain on the way in, but an
            // appeal resolves it from this very revision: it must be there
            administrativeChain: yield* create(
              { stages: [stage], normalTerminal: 0 },
              'administrative',
            ),
            administrativeEmpty: yield* create({}, 'administrative'),
          }
        }),
      ),
    )

    const issuesOf = (exit: Exit.Exit<unknown, unknown>) =>
      (errorOf<{ issues?: readonly { path: string; reason: string }[] }>(exit)?.issues ?? []).map(
        (issue) => issue.reason,
      )
    expect(issuesOf(result.twoStages)).toContain('policy-single-stage')
    expect(issuesOf(result.nearestRole)).toContain('policy-selector-role-at')
    expect(issuesOf(result.quorumAll)).toContain('policy-quorum-any')
    expect(issuesOf(result.laterTerminal)).toContain('policy-terminal-first')
    expect(Exit.isSuccess(result.administrativeChain)).toBe(true)
    expect(issuesOf(result.administrativeEmpty)).toContain('policy-single-stage')
  })

  it('refuses a save that live entries could not survive, naming them', async () => {
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
          // the entry api arrives later, the compatibility rule is now. The
          // student is already on the roster - creation imported the node
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

          const tightened = yield* Effect.exit(
            assessment.updateItem(
              f.tenant,
              item.id,
              { config: studentConfig({ formConfig: { required: ['certificate'] } }) },
              f.principal,
            ),
          )
          // a draft entry is outside the trial: it re-enters through the new form
          yield* runSql(sql`update entries set status = 'draft' where id = ${entry}`)
          const afterDraft = yield* assessment.updateItem(
            f.tenant,
            item.id,
            { config: studentConfig({ formConfig: { required: ['certificate'] } }) },
            f.principal,
          )
          return { entry, tightened, afterDraft }
        }),
      ),
    )

    expect(tagOf(result.tightened)).toBe('ASSESSMENT_ITEM_CONFIG_INVALID')
    const issues = errorOf<{ issues: readonly { path: string; reason: string }[] }>(
      result.tightened,
    )!.issues
    expect(issues).toEqual([{ path: `entries.${result.entry}`, reason: 'incompatible-entry' }])
    // the refused save appended nothing: the successful one is revision 2
    expect(result.afterDraft.currentRevision?.revisionNo).toBe(2)
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
          const { batch, groupId } = yield* draftBatch(f, 'Round')
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
                { id: groupId, name: '文体活动', cap: '10.00', floor: '0.00' },
                { name: '品德', cap: null, floor: '0.00' },
              ],
            },
            f.principal,
          )
          const orphaning = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              { groups: [{ name: 'only the new one', cap: null, floor: null }] },
              f.principal,
            ),
          )
          const contradiction = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              { groups: [{ id: groupId, name: '文体活动', cap: '5.00', floor: '10.00' }] },
              f.principal,
            ),
          )
          const stray = yield* Effect.exit(
            assessment.replaceScoreGroups(
              f.tenant,
              batch.id,
              { groups: [{ id: randomUUID(), name: 'ghost', cap: null, floor: null }] },
              f.principal,
            ),
          )
          return { renamed, orphaning, contradiction, stray, groupId }
        }),
      ),
    )

    expect(result.renamed.groups.map((group) => group.name)).toEqual(['文体活动', '品德'])
    expect(result.renamed.groups[0]!.itemCount).toBe(1)
    const refusalsOf = (exit: Exit.Exit<unknown, unknown>) =>
      (
        errorOf<{ refusals?: readonly { reason: string; groupId: string | null }[] }>(exit)
          ?.refusals ?? []
      ).map((refusal) => refusal.reason)
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
          const { batch, groupId } = yield* draftBatch(f, 'Round')
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
          const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
          yield* assessment.schedulePhase(
            f.tenant,
            batch.id,
            plan[0]!.id,
            Date.now() + 3_600_000,
            f.principal,
          )
          // worth three becomes worth five, silently: refused
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
              { groups: [{ id: groupId, name: '文体', cap: '6.00', floor: null }] },
              f.principal,
            ),
          )
          const capSpoken = yield* assessment.replaceScoreGroups(
            f.tenant,
            batch.id,
            {
              groups: [{ id: groupId, name: '文体', cap: '6.00', floor: null }],
              reason: 'ceiling lowered by the college',
            },
            f.principal,
          )
          return { silent, spoken, renamed, capSilent, capSpoken }
        }),
      ),
    )

    const issuesOf = (exit: Exit.Exit<unknown, unknown>) =>
      (errorOf<{ issues?: readonly { reason: string }[] }>(exit)?.issues ?? []).map(
        (issue) => issue.reason,
      )
    expect(issuesOf(result.silent)).toContain('reason-required')
    expect(result.spoken.currentRevision?.revisionNo).toBe(2)
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
          const { batch, groupId } = yield* draftBatch(f, 'Round')
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
            { groups: [{ id: groupId, name: '文体', cap: '10.00', floor: null }] },
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
          // a live entry that the current form still reads
          const participant = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${batch.id} and user_id = ${f.student}`),
          ).id
          const entry = one<{ id: string }>(
            yield* runSql(sql`
              insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
              values (${f.tenant}, ${batch.id}, ${item.id}, ${participant}, 'self', 'approved')
              returning id`),
          ).id
          const revision = one<{ id: string }>(
            yield* runSql(sql`
              insert into entry_revisions (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload, actor_id, subject_id, source)
              values (${f.tenant}, ${entry}, ${item.id}, ${item.currentRevision!.id}, 1,
                      '{}', ${f.student}, ${f.student}, 'self')
              returning id`),
          ).id
          yield* runSql(
            sql`update entries set current_revision_id = ${revision} where id = ${entry}`,
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
              insert into assessment_items (tenant_id, batch_id, item_type, title, score_group_id)
              values (${f.tenant}, ${batch.id}, 'ghost', 'orphaned question', ${ghostGroup})
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
