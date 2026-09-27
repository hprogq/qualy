import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import {
  enterableFrom,
  resolvePolicy,
  routeReaches,
  type PolicyStage,
  type ReviewPolicy,
} from '../src/review/chain.ts'
import type { EntryChannel } from '../src/item/channels.ts'
import { errorOf, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// A route whose every step asks for a kind of unit somebody sits under none
// of has nowhere to stand for them: their submission is refused, and no
// appointment mends it. The batch says so before anybody files, from the
// frozen roster and the questions' current routes, with no patrol behind it.

describe.runIf(postgresAvailable)('routes with nowhere to stand', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-reach')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  const classStep = (f: Seeded, id = 'class'): PolicyStage => ({
    id,
    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
    quorum: { type: 'any' },
  })

  const lineageOf = (batchId: string, userId: string) =>
    Effect.map(
      runSql(sql`
        select anchor_lineage from batch_participants
        where batch_id = ${batchId} and user_id = ${userId}`),
      (result) =>
        (result as { rows: { anchor_lineage: { nodeId: string; nodeTypeId: string }[] }[] })
          .rows[0]!.anchor_lineage,
    )

  // The screens read reachability off the configuration without resolving
  // it; the write resolves it. The two must agree on every route and every
  // lineage, or a key is offered that the write refuses.
  it('answers exactly as resolving the route would, lineage by lineage', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-agree')
          const g = yield* runningBatch(f)
          const college = one<{ id: string }>(
            yield* runSql(sql`select org_type_id as id from org_nodes where id = ${f.root}`),
          ).id
          const collegeStep: PolicyStage = {
            id: 'college',
            selector: { kind: 'roleAt', nodeTypeId: college, roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          }
          const nearest: PolicyStage = {
            id: 'nearest',
            selector: { kind: 'nearestRole', roleId: f.reviewRole },
            quorum: { type: 'any' },
          }
          const nowhere: PolicyStage = {
            id: 'nowhere',
            selector: { kind: 'roleAt', nodeTypeId: crypto.randomUUID(), roleIds: [f.reviewRole] },
            quorum: { type: 'any' },
          }
          const routes: readonly (readonly PolicyStage[])[] = [
            [classStep(f)],
            [collegeStep],
            [classStep(f), collegeStep],
            [nowhere],
            [nowhere, classStep(f)],
            [nearest],
            [nowhere, nearest],
            [],
          ]
          const answers: { reads: boolean; resolves: boolean }[] = []
          for (const userId of [f.admin, f.recorder, f.s1, f.s3]) {
            const lineage = yield* lineageOf(g.batch.id, userId)
            for (const stages of routes) {
              const policy: ReviewPolicy = { normal: stages, escalation: stages }
              const resolved = yield* resolvePolicy({
                tenantId: f.t,
                batchId: g.batch.id,
                policy,
                lineage,
              })
              answers.push({
                reads: routeReaches(stages, lineage),
                resolves: enterableFrom(resolved, 'normal', 0) !== null,
              })
              answers.push({
                reads: routeReaches(stages, lineage),
                resolves: enterableFrom(resolved, 'escalation', 0) !== null,
              })
            }
          }
          return answers
        }),
      ),
    )
    // both answers occur, so the agreement is not an agreement about one of them
    expect(result.some((answer) => answer.reads)).toBe(true)
    expect(result.some((answer) => !answer.reads)).toBe(true)
    for (const answer of result) expect(answer.reads).toBe(answer.resolves)
  })

  it('names the questions and counts the people a route has nowhere to stand for', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-alerts')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          // the class step reaches the four people in classes; the
          // administrator at the root and the recorder at a college sit
          // under no class at all
          const g = yield* runningBatch(f)
          const create = (
            title: string,
            config: { entryChannels: readonly EntryChannel[]; reviewPolicy: unknown },
          ) =>
            Effect.gen(function* () {
              const item = yield* assessment.createItem(
                f.t,
                g.batch.id,
                {
                  itemType: 'evidence',
                  title,
                  scoreGroupId: g.item.scoreGroupId,
                  maxEntries: 1,
                  config: {
                    formConfig: { files: {} },
                    scoringConfig: {
                      calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                      aggregator: { ref: 'sum@1', config: {} },
                    },
                    ...config,
                  },
                },
                admin,
              )
              yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
              return item.id
            })
          // nobody reviews it: nothing to reach
          yield* create('无需审核', {
            entryChannels: ['participant'],
            reviewPolicy: { mode: 'none' },
          })
          // recorded by the office: only an appeal walks a route, the
          // escalation one
          const recorded = yield* create('行政认定', {
            entryChannels: ['administrative'],
            reviewPolicy: {
              normal: { stages: [classStep(f, 'n1')] },
              escalation: { stages: [classStep(f, 'e1')] },
            },
          })
          const before = yield* assessment.reviewAlerts(f.t, g.batch.id, admin)
          // a step that finds its person wherever they sit reaches everybody
          yield* runSql(sql`
            update assessment_item_revisions
            set review_policy = jsonb_set(
              review_policy,
              '{normal,stages}',
              review_policy->'normal'->'stages' || ${JSON.stringify([
                {
                  id: 'nearest',
                  selector: { kind: 'nearestRole', roleId: f.reviewRole },
                  quorum: { type: 'any' },
                },
              ])}::jsonb)
            where id = (select current_revision_id from assessment_items where id = ${g.item.id})`)
          const after = yield* assessment.reviewAlerts(f.t, g.batch.id, admin)
          return { item: g.item.id, recorded, before, after }
        }),
      ),
    )
    expect(result.before.unreachable.routes).toEqual([
      {
        itemId: result.item,
        itemTitle: '退役复学',
        route: 'normal',
        participants: 2,
        levelNames: ['Class'],
      },
      {
        itemId: result.recorded,
        itemTitle: '行政认定',
        route: 'escalation',
        participants: 2,
        levelNames: ['Class'],
      },
    ])
    expect(result.before.unreachable.cannotSubmit).toBe(2)
    expect(result.before.unreachable.cannotAppeal).toBe(2)
    // the ordinary route of the first question now reaches everybody
    expect(result.after.unreachable.routes.map((route) => [route.itemId, route.route])).toEqual([
      [result.recorded, 'escalation'],
    ])
    expect(result.after.unreachable.cannotSubmit).toBe(0)
  })

  it('counts nobody twice, and nobody who has left the roster', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-distinct')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          // a second question with the same class step misses the same two
          const second = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '第二题',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: {
                entryChannels: ['participant'],
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: { stages: [classStep(f)] },
                  escalation: { stages: [] },
                },
              },
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, second.id, { status: 'active' }, admin)
          const both = yield* assessment.reviewAlerts(f.t, g.batch.id, admin)
          yield* runSql(sql`
            update batch_participants set status = 'excluded', excluded_at = now()
            where batch_id = ${g.batch.id} and user_id = ${f.recorder}`)
          const fewer = yield* assessment.reviewAlerts(f.t, g.batch.id, admin)
          return { both, fewer }
        }),
      ),
    )
    expect(result.both.unreachable.routes.map((route) => route.participants)).toEqual([2, 2])
    expect(result.both.unreachable.cannotSubmit).toBe(2)
    expect(result.fewer.unreachable.cannotSubmit).toBe(1)
  })

  // Putting people on the roster is never refused for this (§32.93): what
  // they leave it with is said beside the count - how many of them some
  // question's ordinary route finds nowhere, and how many are system
  // accounts - before an import, and by the write itself.
  it('says what the people it admits leave the roster with, and admits them anyway', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-admit')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const system = one<{ id: string }>(
            yield* runSql(sql`
              insert into user_types (tenant_id, code, name, placement_mode, is_system)
              values (${f.t}, 'system-account', 'System', 'unrestricted', true) returning id`),
          ).id
          const operator = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Operator', ${system}, ${f.root}) returning id`),
          ).id
          const late = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Late', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          // an import of the system kind from the root, counted before it runs
          const preview = yield* assessment.previewImport(
            f.t,
            g.batch.id,
            { orgNodeIds: [f.root], userTypeIds: [system] },
            admin,
          )
          const imported = yield* assessment.importParticipants(
            f.t,
            g.batch.id,
            { orgNodeIds: [f.root], userTypeIds: [system] },
            admin,
          )
          // somebody in a class, whom the class step reaches, added by name
          const reached = yield* assessment.addParticipants(f.t, g.batch.id, [late], admin)
          // the recorder, at a college under no class, taken off and let back in
          const recorder = one<{ id: string }>(
            yield* runSql(sql`
              select id from batch_participants
              where batch_id = ${g.batch.id} and user_id = ${f.recorder}`),
          ).id
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            recorder,
            'excluded',
            undefined,
            admin,
          )
          const readded = yield* assessment.addParticipants(f.t, g.batch.id, [f.recorder], admin)
          const onRoster = one<{ n: string }>(
            yield* runSql(sql`
              select count(*) as n from batch_participants
              where batch_id = ${g.batch.id} and user_id = ${operator} and status = 'active'`),
          )
          return { preview, imported, reached, readded, onRoster: Number(onRoster.n) }
        }),
      ),
    )
    expect(result.preview).toEqual({ candidates: 1, cannotSubmit: 1, systemAccounts: 1 })
    expect(result.imported).toEqual({ added: 1, cannotSubmit: 1, systemAccounts: 1 })
    // warned about, and on the roster all the same
    expect(result.onRoster).toBe(1)
    expect(result.reached).toEqual({ added: 1, skipped: 0, cannotSubmit: 0, systemAccounts: 0 })
    expect(result.readded).toEqual({ added: 1, skipped: 0, cannotSubmit: 1, systemAccounts: 0 })
  })

  // What they leave the roster with is read once the write has happened. A
  // reading that fails then is left unsaid: answered as a failure, a write
  // that did happen would send the reader to add the same people again.
  it('admits them and leaves unsaid what it could not read after the write', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-unread')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const late = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Late', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          // a step that does not say where it looks: what the routes ask
          // for cannot be read, and nothing about the write reads it
          yield* runSql(sql`
            update assessment_item_revisions
            set review_policy = ${JSON.stringify({
              normal: { stages: [{ id: 'unreadable' }] },
              escalation: { stages: [] },
            })}::jsonb
            where id = (select current_revision_id from assessment_items where id = ${g.item.id})`)
          const added = yield* assessment.addParticipants(f.t, g.batch.id, [late], admin)
          const onRoster = one<{ n: string }>(
            yield* runSql(sql`
              select count(*) as n from batch_participants
              where batch_id = ${g.batch.id} and user_id = ${late} and status = 'active'`),
          )
          return { added, onRoster: Number(onRoster.n) }
        }),
      ),
    )
    expect(result.added).toEqual({
      added: 1,
      skipped: 0,
      cannotSubmit: null,
      systemAccounts: null,
    })
    expect(result.onRoster).toBe(1)
  })

  // Taking in where the organization has somebody now can leave them under
  // no unit a question's ordinary route asks for; the difference says so
  // before anybody decides, by the same rule the roster is counted by.
  it('says what taking in a new placement would cost, where the placement is shown', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-placement')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const collegeA = one<{ id: string }>(
            yield* runSql(sql`select parent_id as id from org_nodes where id = ${f.classA}`),
          ).id
          const classB = one<{ id: string }>(
            yield* runSql(sql`
              select primary_org_node_id as id from users where id = ${f.s3}`),
          ).id
          const collegeB = one<{ id: string }>(
            yield* runSql(sql`select parent_id as id from org_nodes where id = ${classB}`),
          ).id
          // one moves up to the college, out of every class; one moves to
          // the other class, where the class step still finds them; and one
          // who sat under no class moves to another college under none
          yield* runSql(sql`update users set primary_org_node_id = ${collegeA} where id = ${f.s1}`)
          yield* runSql(sql`update users set primary_org_node_id = ${classB} where id = ${f.s2}`)
          yield* runSql(
            sql`update users set primary_org_node_id = ${collegeB} where id = ${f.recorder}`,
          )
          return {
            page: yield* assessment.listParticipantPlacements(f.t, g.batch.id, {}, admin),
            people: { s1: f.s1, s2: f.s2 },
          }
        }),
      ),
    )
    const byPerson = new Map(
      result.page.items.map((row) => [row.displayName, row.closedBySync] as const),
    )
    expect(byPerson.get('Zhang San')).toBe(1)
    expect(byPerson.get('Li Si')).toBe(0)
    // what they could not file before the move is not the move's doing
    expect(byPerson.get('Recorder')).toBe(0)
  })

  // Who they are, for the administrator deciding whether to move the route
  // or the people: a question's saved route, or the unit kinds a route still
  // being composed asks for, read a page at a time and to the same door as
  // the panel that counts them.
  it('lists them by page, for a saved route or a composed one, to its administrators only', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('reach-list')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const list = (
            route:
              | { kind: 'item'; itemId: string; route: 'normal' | 'escalation' }
              | { kind: 'levels'; nodeTypeIds: readonly string[] },
            page = 1,
            as = admin,
          ) =>
            Effect.exit(
              assessment.listUnreachableParticipants(
                f.t,
                g.batch.id,
                { route, page, limit: 1 },
                as,
              ),
            )
          return {
            first: yield* list({ kind: 'item', itemId: g.item.id, route: 'normal' }),
            // asked past the end, the last page rather than an empty one
            past: yield* list({ kind: 'item', itemId: g.item.id, route: 'normal' }, 9),
            // this question has no escalation route: nobody is missed there
            escalation: yield* list({ kind: 'item', itemId: g.item.id, route: 'escalation' }),
            composed: yield* list({ kind: 'levels', nodeTypeIds: [f.classType] }),
            stranger: yield* list(
              { kind: 'item', itemId: g.item.id, route: 'normal' },
              1,
              f.principal(f.s1),
            ),
            unknown: yield* list({
              kind: 'item',
              itemId: '00000000-0000-4000-8000-000000000000',
              route: 'normal',
            }),
            people: { admin: f.admin, recorder: f.recorder },
          }
        }),
      ),
    )
    const first = ok(result.first)
    expect(first.total).toBe(2)
    expect(first.rows).toHaveLength(1)
    const past = ok(result.past)
    expect(past.page).toBe(2)
    expect(new Set([first.rows[0]!.userId, past.rows[0]!.userId])).toEqual(
      new Set([result.people.admin, result.people.recorder]),
    )
    // the units they were drawn from, the root first
    expect(past.rows[0]!.unitPath[0]).toBe('Root')
    expect(ok(result.escalation)).toEqual({ rows: [], total: 0, page: 1 })
    expect(ok(result.composed).total).toBe(2)
    expect(errorOf<{ _tag: string }>(result.stranger)?._tag).toBe('ACCESS_DENIED')
    expect(errorOf<{ _tag: string }>(result.unknown)?._tag).toBe('ASSESSMENT_ITEM_NOT_FOUND')
  })
})
