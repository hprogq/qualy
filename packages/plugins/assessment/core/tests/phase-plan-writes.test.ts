import { inspect } from 'node:util'
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
import {
  Assessment,
  serviceLayer,
  type PhaseSpecInput,
  type PlanPhase,
} from '../src/server/index.ts'
import { catalogLayers, storageForTest } from './support/catalogs.ts'

// A plan write states the plan it wants, and every caller states it by
// echoing back the plan it read. Two things follow, and both were wrong:
// where a submitted row is allowed to sit, and what a field the caller never
// mentioned means.

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

const stack = (url: string) => {
  const services = booted(
    rbacLayer.pipe(
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

/** the refusal reasons a PlanInvalid carried, or [] if the call succeeded */
const refusalsIn = (exit: Exit.Exit<unknown, unknown>): readonly string[] =>
  reasonsOf(exit)
    .flatMap(
      (entry) =>
        (entry.error as { refusals?: readonly { reason: string }[] } | undefined)?.refusals ?? [],
    )
    .map((entry) => entry.reason)

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

const HOUR = 3_600_000

/** one class of two students, and an administrator who runs the tenant */
const seed = (slug: string) =>
  Effect.gen(function* () {
    const tenant = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const classType = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_types (tenant_id, code, name)
        values (${tenant}, 'class', 'class') returning id`),
    ).id
    const root = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${tenant}, ${classType}, null, 'Class 1', 'r', 0) returning id`),
    ).id
    const userType = (code: string) =>
      Effect.map(
        runSql(sql`
          insert into user_types (tenant_id, code, name, placement_mode)
          values (${tenant}, ${code}, ${code}, 'unrestricted') returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const studentType = yield* userType('student')
    const staffType = yield* userType('staff')
    const person = (name: string, typeId: string) =>
      Effect.map(
        runSql(sql`
          insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, enabled)
          values (${tenant}, ${name}, ${typeId}, ${root}, true) returning id`),
        (result) => one<{ id: string }>(result).id,
      )
    const s1 = yield* person('S1', studentType)
    yield* person('S2', studentType)
    const admin = yield* person('Admin', staffType)
    const adminRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${tenant}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id)
      values (${tenant}, ${admin}, ${adminRole})`)
    const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
    return { tenant, root, studentType, s1, principal }
  })

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

/**
 * The plan as the stage editor sends it back: the six fields it renders, and
 * nothing else. The two allowances and, on the template path, the entry note
 * travel this way in production too.
 */
const toSpec = (row: PlanPhase): PhaseSpecInput => ({
  id: row.id,
  phaseKey: row.phaseKey,
  displayName: row.displayName,
  description: row.description,
  entryNote: row.entryNote,
  permissionProfile: row.permissionProfile,
})

const newBatch = (tenant: string, name: string, root: string, type: string, as: Principal) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    return yield* assessment.createBatch(
      tenant,
      {
        name,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds: [root], userTypeIds: [type] },
      },
      as,
    )
  })

/** the roster row a participant allowance names, which is not the user id */
const participantRow = (batchId: string, userId: string) =>
  Effect.map(
    runSql(sql`
      select id from batch_participants where batch_id = ${batchId} and user_id = ${userId}`),
    (result) => one<{ id: string }>(result).id,
  )

const scopedParticipants = (phaseId: string) =>
  Effect.map(
    runSql(sql`
      select participant_id from phase_participant_scopes where phase_id = ${phaseId}`),
    (result) => rowsOf<{ participant_id: string }>(result).map((row) => row.participant_id),
  )

describe.runIf(postgresAvailable).concurrent('plan writes', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-plan-writes')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('refuses to lift an unscheduled phase above one that has been entered', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('lift-entered')
        const assessment = yield* Assessment
        const batch = yield* newBatch(f.tenant, 'Entered', f.root, f.studentType, f.principal)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'review' })] },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)

        const swapped = yield* Effect.exit(
          assessment.replacePlan(
            f.tenant,
            batch.id,
            { specs: [toSpec(plan[1]!), toSpec(plan[0]!)] },
            f.principal,
          ),
        )
        const after = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        // the plan still reads: a corrupt order takes every read of the batch
        // down with it, including the list page it appears in
        const timeline = yield* assessment.timeline(f.tenant, batch.id)
        return { swapped, after, timeline }
      }),
    )
    const { swapped, after, timeline } = ok(exit)
    expect(refusalsIn(swapped)).toContain('reorder-not-allowed')
    expect(after.map((row) => row.phaseKey)).toEqual(['entry', 'review'])
    expect(after[0]!.actualEntryAt).not.toBeNull()
    expect(timeline).toHaveLength(2)
  })

  it('refuses to lift an unscheduled phase above one that only has a time', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('lift-scheduled')
        const assessment = yield* Assessment
        const batch = yield* newBatch(f.tenant, 'Scheduled', f.root, f.studentType, f.principal)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { specs: [phase({ phaseKey: 'entry' }), phase({ phaseKey: 'review' })] },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        // committing the first time is what starts the batch; nothing has
        // been entered yet, which is the ordinary shape of a running round
        yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[0]!.id,
          Date.now() + HOUR,
          f.principal,
        )

        const swapped = yield* Effect.exit(
          assessment.replacePlan(
            f.tenant,
            batch.id,
            { specs: [toSpec(plan[1]!), toSpec(plan[0]!)] },
            f.principal,
          ),
        )
        const after = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        const timeline = yield* assessment.timeline(f.tenant, batch.id)
        return { swapped, after, timeline }
      }),
    )
    const { swapped, after, timeline } = ok(exit)
    expect(refusalsIn(swapped)).toContain('reorder-not-allowed')
    expect(after.map((row) => row.phaseKey)).toEqual(['entry', 'review'])
    expect(after[0]!.plannedEntryAt).not.toBeNull()
    expect(timeline).toHaveLength(2)
  })

  it('keeps an allowance the stage editor never renders when the plan is saved', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('keep-allowance')
        const assessment = yield* Assessment
        const batch = yield* newBatch(f.tenant, 'Allowance', f.root, f.studentType, f.principal)
        const only = yield* participantRow(batch.id, f.s1)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry' }),
              phase({ phaseKey: 'supplement', participantScope: [only] }),
            ],
          },
          f.principal,
        )
        let plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        yield* assessment.advancePhase(f.tenant, batch.id, { to: plan[0]!.id }, f.principal)
        plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)

        // an edit to an unrelated stage, sent the only way the editor can
        // send it: a projection with no allowance in it
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [toSpec(plan[0]!), { ...toSpec(plan[1]!), displayName: 'Supplementary window' }],
          },
          f.principal,
        )
        return {
          only,
          scoped: yield* scopedParticipants(plan[1]!.id),
          renamed: (yield* assessment.getPlan(f.tenant, batch.id, f.principal))[1]!.displayName,
        }
      }),
    )
    const { only, scoped, renamed } = ok(exit)
    expect(renamed).toBe('Supplementary window')
    // the allowance is what decides who the phase admits; emptied, it admits
    // the whole roster
    expect(scoped).toEqual([only])
  })

  it('leaves the phases already in the plan alone when a timeline template is appended', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        const f = yield* seed('append-template')
        const assessment = yield* Assessment
        const batch = yield* newBatch(f.tenant, 'Append', f.root, f.studentType, f.principal)
        const only = yield* participantRow(batch.id, f.s1)
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              phase({ phaseKey: 'entry' }),
              phase({
                phaseKey: 'supplement',
                entryNote: 'waiting on the college',
                participantScope: [only],
              }),
            ],
          },
          f.principal,
        )
        const before = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        const template = yield* assessment.createTemplate(
          f.tenant,
          { name: 'tail', phases: [phase({ phaseKey: 'review' }), phase({ phaseKey: 'archive' })] },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          { fromTemplateId: template.id },
          f.principal,
        )
        return {
          only,
          after: yield* assessment.getPlan(f.tenant, batch.id, f.principal),
          scoped: yield* scopedParticipants(before[1]!.id),
        }
      }),
    )
    const { only, after, scoped } = ok(exit)
    expect(after.map((row) => row.phaseKey)).toEqual(['entry', 'supplement', 'review', 'archive'])
    expect(after[1]!.entryNote).toBe('waiting on the college')
    expect(scoped).toEqual([only])
  })
})
