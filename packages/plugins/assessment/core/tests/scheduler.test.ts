import { inspect } from 'node:util'
import { sql } from 'kysely'
import { Clock, Duration, Effect, Exit, Layer, Schedule } from 'effect'
import { TestClock } from 'effect/testing'
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
import { assembledLayer, Assembled, runBootHooks } from '@qualy/api-kit/assembled'
import type { ActivePermission, Principal } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../src/db/entities.ts'
import { permissions as assessmentPermissions } from '../src/permissions.ts'
import { catalogLayers, storageForTest } from './support/catalogs.ts'
import { schedulerLayer, sweepSchedule } from '../src/phase/scheduler.ts'
import { Assessment, serviceLayer, type PhaseSpecInput } from '../src/server/index.ts'

// The scheduler under a clock the test moves.
//
// Everything here is about the split the design insists on: the clock decides
// what has taken effect and the fiber only writes it down. So the assertions
// come in pairs - what the gate already says before any sweep, and what the
// rows say after one - plus the two ways a scheduler goes wrong: doing the
// work twice, and doing work nobody asked for (a boundary past a manual one).

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment', permissions: assessmentPermissions },
])

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

/**
 * The plugin as the host builds it - service, barrier and the forked fiber -
 * on a clock this suite owns. TestClock provides Clock, so both the service's
 * reading of "now" and the fiber's own sleeps answer to `TestClock.adjust`.
 */
const stack = (url: string) => {
  const services = booted(
    rbacLayer.pipe(
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  ).pipe(Layer.provideMerge(assembledLayer), Layer.provideMerge(TestClock.layer()))
  return serviceLayer.pipe(
    Layer.provide(catalogLayers),
    Layer.provide(storageForTest().pipe(Layer.provide(services))),
    Layer.provideMerge(services),
    // exactly the composition the descriptor declares
    (assessment) => Layer.merge(assessment, schedulerLayer.pipe(Layer.provide(assessment))),
  )
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Assessment | Rbac | Orm | Assembled>) =>
  Effect.runPromiseExit(Effect.scoped(Effect.provide(effect, stack(url))))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 8 })}`)
}

/**
 * Waits for the forked fiber's write to land.
 *
 * The fiber wakes on the test clock but its transaction is a real round trip,
 * so "has it written yet" is a question about wall time, not test time -
 * `TestClock.withLive` is what lets this poll without the test clock
 * swallowing the sleep. It gives up loudly rather than passing on a timeout.
 */
const untilWritten = <A, E>(read: Effect.Effect<A, E>, done: (value: A) => boolean) =>
  TestClock.withLive(
    Effect.flatMap(read, (value) =>
      done(value) ? Effect.succeed(value) : Effect.fail('not written yet' as const),
    ).pipe(Effect.retry({ times: 200, schedule: Schedule.spaced('10 millis') }), Effect.orDie),
  )

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows

const MINUTE = 60_000
/** five and a half minutes in: between the fifth tick and the sixth */
const DUE_AT = 5 * MINUTE + 30_000

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

/** a tenant with one node, one student type and an administrator */
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
        values (${tenant}, ${orgType}, 'College', 'r', 0) returning id`),
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
    const principal: Principal = { tenantId: tenant, userId: admin, sessionId: 's' }
    return { tenant, node, studentType, principal }
  })

describe.runIf(postgresAvailable)('the phase scheduler', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-scheduler')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('writes down the boundaries the clock crossed, once, and never past a manual one', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        // a realistic instant, so the rows this writes read like rows
        yield* TestClock.setTime(Date.parse('2026-09-01T00:00:00Z'))
        const f = yield* seed('sched')
        const assessment = yield* Assessment
        const start = yield* Clock.currentTimeMillis

        const batch = yield* assessment.createBatch(
          f.tenant,
          {
            name: 'Scheduled',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [f.node], userTypeIds: [f.studentType] },
          },
          f.principal,
        )
        yield* assessment.replacePlan(
          f.tenant,
          batch.id,
          {
            specs: [
              // Due between two ticks on purpose - the sweep runs on the
              // minute, this boundary does not. That gap is where the design
              // lives: the phase is in effect from 5m30, and the row saying
              // so is written at 6m.
              phase({
                phaseKey: 'entry',
                permissionProfile: ['assessment.entry.submit'],
              }),
              // a review wrap-up that only a human ends...
              phase({ phaseKey: 'review', permissionProfile: ['assessment.review.process'] }),
              // ...so this one must not self-ignite, however far the clock goes
              phase({ phaseKey: 'appeal' }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          f.principal,
        )
        const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        // the entry boundary is the only one committed to a time; everything
        // behind it stays unscheduled and therefore cannot self-ignite
        yield* assessment.schedulePhase(
          f.tenant,
          batch.id,
          plan[0]!.id,
          start + DUE_AT,
          f.principal,
        )

        // First, with no fiber running at all: one minute in, nothing is due.
        yield* TestClock.adjust('1 minute')
        const early = {
          gate: yield* assessment.gate(f.tenant, batch.id, 'assessment.entry.submit'),
          actual: (yield* assessment.getPlan(f.tenant, batch.id, f.principal))[0]!.actualEntryAt,
        }

        // Past the boundary, still with nothing sweeping: the gate is already
        // open and not one row has moved. This is the whole claim - the clock
        // decides, materialization is bookkeeping - and it is worth asserting
        // where no scheduler can race it.
        yield* TestClock.adjust('280 seconds')
        const crossed = {
          gate: yield* assessment.gate(f.tenant, batch.id, 'assessment.entry.submit'),
          actual: (yield* assessment.getPlan(f.tenant, batch.id, f.principal))[0]!.actualEntryAt,
        }

        // Now start the fiber, exactly as the barrier does. `Effect.repeat`
        // runs its action before its first delay, so this is also the boot
        // catch-up path: a process that starts after a boundary came due
        // writes it down immediately rather than a minute later.
        yield* runBootHooks
        const recorded = yield* untilWritten(
          assessment.getPlan(f.tenant, batch.id, f.principal),
          (rows) => rows[0]!.actualEntryAt !== null,
        )
        const events = rowsOf<{ kind: string; at: number; processed: number }>(
          yield* runSql(sql`
            select kind,
                   (extract(epoch from actual_at) * 1000)::float8 as at,
                   (extract(epoch from processed_at) * 1000)::float8 as processed
              from phase_events where phase_id = ${plan[0]!.id} and kind = 'entered'`),
        )

        // ten more minutes of ticks: the manual boundary holds the queue, and
        // the boundary already written is not written again
        yield* TestClock.adjust('10 minutes')
        const settled = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
        const eventsAfter = rowsOf<{ kind: string }>(
          yield* runSql(sql`
            select kind from phase_events where phase_id = ${plan[0]!.id} and kind = 'entered'`),
        )
        const current = one<{ current_phase_id: string }>(
          yield* runSql(sql`
            select current_phase_id from assessment_batches where id = ${batch.id}`),
        )
        return { start, early, crossed, recorded, events, settled, eventsAfter, current, plan }
      }),
    )
    const { start, early, crossed, recorded, events, settled, eventsAfter, current, plan } =
      ok(exit)

    // before the boundary: no phase in effect, nothing written
    expect(early.gate).toEqual({ allowed: false, reason: 'no-active-phase' })
    expect(early.actual).toBeNull()

    // after the boundary, before the sweep: open by the clock alone
    expect(crossed.gate).toEqual({ allowed: true })
    expect(crossed.actual).toBeNull()

    // the sweep writes the planned instant, not the instant it ran
    expect(recorded[0]!.actualEntryAt).toBe(start + DUE_AT)
    expect(events).toHaveLength(1)
    expect(events[0]!.at).toBe(start + DUE_AT)
    // and separately records when the machine got to it, which is later
    expect(events[0]!.processed).toBeGreaterThan(events[0]!.at)
    expect(current.current_phase_id).toBe(plan[0]!.id)

    // idempotent, and the manual boundary is still holding the queue
    expect(eventsAfter).toHaveLength(1)
    expect(settled[1]!.actualEntryAt).toBeNull()
    expect(settled[2]!.actualEntryAt).toBeNull()
    // the offset behind the manual boundary has no anchor yet either
    expect(settled[2]!.plannedEntryAt).toBeNull()
  })

  it('sweeps every tenant, and reports what it wrote', async () => {
    const exit = await run(
      db.url,
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse('2026-09-01T00:00:00Z'))
        const assessment = yield* Assessment
        const start = yield* Clock.currentTimeMillis

        const activate = Effect.fn(function* (slug: string) {
          const f = yield* seed(slug)
          const batch = yield* assessment.createBatch(
            f.tenant,
            {
              name: slug,
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              import: { orgNodeIds: [f.node], userTypeIds: [f.studentType] },
            },
            f.principal,
          )
          yield* assessment.replacePlan(
            f.tenant,
            batch.id,
            {
              specs: [
                phase({
                  phaseKey: 'entry',
                }),
                phase({ phaseKey: 'archive' }),
              ],
            },
            f.principal,
          )
          const plan = yield* assessment.getPlan(f.tenant, batch.id, f.principal)
          yield* assessment.schedulePhase(
            f.tenant,
            batch.id,
            plan[0]!.id,
            start + 60_000,
            f.principal,
          )
          return { f, batch }
        })
        // two tenants, so the sweep has to be the system rather than a caller
        const a = yield* activate('sweep-a')
        const b = yield* activate('sweep-b')
        // and a draft, which no sweep may touch
        const c = yield* seed('sweep-c')
        const draft = yield* assessment.createBatch(
          c.tenant,
          {
            name: 'still drafting',
            materialRange: { start: '2026-03-01', end: '2026-09-01' },
            import: { orgNodeIds: [c.node], userTypeIds: [c.studentType] },
          },
          c.principal,
        )
        yield* assessment.replacePlan(
          c.tenant,
          draft.id,
          {
            specs: [
              phase({
                phaseKey: 'entry',
              }),
              phase({ phaseKey: 'archive' }),
            ],
          },
          c.principal,
        )

        yield* TestClock.adjust('2 minutes')
        const first = yield* assessment.sweepDueBoundaries
        const second = yield* assessment.sweepDueBoundaries
        return {
          first,
          second,
          a: (yield* assessment.getPlan(a.f.tenant, a.batch.id, a.f.principal))[0]!.actualEntryAt,
          b: (yield* assessment.getPlan(b.f.tenant, b.batch.id, b.f.principal))[0]!.actualEntryAt,
          draft: (yield* assessment.getPlan(c.tenant, draft.id, c.principal))[0]!.actualEntryAt,
          start,
        }
      }),
    )
    const result = ok(exit)
    // both tenants' boundaries, in one sweep, by one fiber holding no principal
    expect(result.first).toEqual({ scanned: 2, ratified: 2 })
    // and nothing left for the next one
    expect(result.second).toEqual({ scanned: 0, ratified: 0 })
    expect(result.a).toBe(result.start + MINUTE)
    expect(result.b).toBe(result.start + MINUTE)
    // a draft batch has no boundaries to cross
    expect(result.draft).toBeNull()
  })
})

// The cadence on its own, driven by hand. `Schedule.toStep` answers with the
// delay the loop would sleep for given the instant a sweep finished, which is
// the only way to ask what an overrun does without writing a sweep that
// really takes minutes.
describe('the sweep cadence', () => {
  const delaysAfter = (finished: readonly number[]) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const step = yield* Schedule.toStep(sweepSchedule)
        const delays: number[] = []
        for (const now of finished) {
          const [, delay] = yield* step(now, undefined)
          delays.push(Duration.toMillis(delay))
        }
        return delays
      }),
    )

  it('stays on the minute grid after a quick sweep', async () => {
    // forked at 0, the first sweep runs at 1m and is done ten seconds later:
    // the next one belongs to the second minute, not a minute after this one
    expect(await delaysAfter([0, MINUTE + 10_000])).toEqual([MINUTE, 50_000])
  })

  it('waits for the next minute after a sweep that overran its own', async () => {
    // a sweep that took two and a half minutes. Bare `Schedule.fixed` answers
    // zero here and goes on answering zero, so the loop never lets go of the
    // pool again; the boundaries it ran past are dropped, not replayed
    expect(await delaysAfter([0, MINUTE + 150_000])).toEqual([MINUTE, 30_000])
  })
})
