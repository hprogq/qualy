import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment, type PhaseSpecInput } from '../src/server/index.ts'
import { errorOf, GATED, ok, one, run, seed, type Seeded } from './support/round.ts'

// The one scorer, fed through the real flow: entries filed, reviewed and
// recorded the way the product does it, then read back as the provisional
// account. Every expected number is written as the exact string the wire
// must carry - "2.00" is the answer, 2 and 1.9999999 are both wrong.

const REVIEW_OPEN = [...GATED, 'assessment.review.process']

const phase = (over: Partial<PhaseSpecInput> & { phaseKey: string }): PhaseSpecInput => ({
  displayName: over.phaseKey,
  permissionProfile: [],
  ...over,
})

interface ItemSpec {
  title: string
  value: string
  group: number
  entrySource: 'student' | 'administrative'
}

/** a running round with the given groups and fixed-amount items */
const scoringBatch = (
  f: Seeded,
  spec: {
    groups: readonly { name: string; cap?: string | null; floor?: string | null }[]
    items: readonly ItemSpec[]
  },
  start: 'none' | 'scheduled' | 'entered' = 'entered',
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const batch = yield* assessment.createBatch(
      f.t,
      {
        name: 'Round',
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        import: { orgNodeIds: [f.root], userTypeIds: [f.studentType] },
      },
      admin,
    )
    yield* assessment.replacePlan(
      f.t,
      batch.id,
      {
        specs: [
          phase({ phaseKey: 'entry', permissionProfile: [...REVIEW_OPEN] }),
          phase({ phaseKey: 'archive' }),
        ],
      },
      admin,
    )
    const withPaper = yield* assessment.replaceScoreGroups(
      f.t,
      batch.id,
      {
        groups: [{ name: '本轮', parentGroupId: null, cap: null, floor: null }],
        expectedVersion: 1,
      },
      admin,
    )
    const paperId = withPaper.groups.find((row) => row.name === '本轮')!.id
    const saved = yield* assessment.replaceScoreGroups(
      f.t,
      batch.id,
      {
        groups: [
          { id: paperId, name: '本轮', parentGroupId: null, cap: null, floor: null },
          ...spec.groups.map((group) => ({
            name: group.name,
            parentGroupId: paperId,
            cap: group.cap ?? null,
            floor: group.floor ?? null,
          })),
        ],
        expectedVersion: withPaper.version,
      },
      admin,
    )
    const groupIds = spec.groups.map(
      (group) => saved.groups.find((row) => row.name === group.name)!.id,
    )
    const items: string[] = []
    for (const item of spec.items) {
      const created = yield* assessment.createItem(
        f.t,
        batch.id,
        {
          itemType: 'evidence',
          title: item.title,
          scoreGroupId: groupIds[item.group]!,
          maxEntries: 1,
          config: {
            entrySource: item.entrySource,
            formConfig: { files: {} },
            scoringConfig: {
              calculator: { ref: 'fixed@1', config: { value: item.value } },
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
        admin,
      )
      // composed as a draft, then asked: an account is only about live questions
      yield* assessment.setItemStatus(f.t, created.id, { status: 'active' }, admin)
      items.push(created.id)
    }
    const plan = yield* assessment.getPlan(f.t, batch.id, admin)
    if (start !== 'none') {
      yield* assessment.schedulePhase(f.t, batch.id, plan[0]!.id, Date.now() + 3_600_000, admin)
    }
    if (start === 'entered') {
      yield* assessment.advancePhase(
        f.t,
        batch.id,
        { to: plan[0]!.id, force: true, reason: 'test enters the phase' },
        admin,
      )
    }
    const pOf = (userId: string) =>
      Effect.map(
        runSql(
          sql`select id from batch_participants where batch_id = ${batch.id} and user_id = ${userId}`,
        ),
        (result) => one<{ id: string }>(result).id,
      )
    return {
      batch,
      paperId,
      version: saved.version,
      groupIds,
      items,
      planId: plan[0]!.id,
      lastPhaseId: plan[plan.length - 1]!.id,
      p1: yield* pOf(f.s1),
      p2: yield* pOf(f.s2),
    }
  })

/** file, submit and have the class reviewer approve one student entry */
const approved = (f: Seeded, itemId: string, participantId: string, who: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const as = f.principal(who)
    const entry = yield* assessment.createEntry(f.t, { itemId, participantId, payload: {} }, as)
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
    yield* assessment.decideReview(
      f.t,
      sent.currentReviewInstanceId!,
      { decision: 'approve' },
      f.principal(f.reviewer),
    )
    return entry.id
  })

describe.runIf(postgresAvailable)('the provisional account', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-provisional-scoring')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('adds the account up exactly, counts refusals at zero and drafts not at all', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sc-account')
          const assessment = yield* Assessment
          const g = yield* scoringBatch(f, {
            groups: [{ name: '文体', cap: '10.00' }],
            items: [
              { title: '退役复学', value: '3.00', group: 0, entrySource: 'student' },
              { title: '违纪扣分', value: '-1.00', group: 0, entrySource: 'administrative' },
              { title: '志愿服务', value: '2.00', group: 0, entrySource: 'student' },
              { title: '晨读打卡', value: '1.00', group: 0, entrySource: 'student' },
            ],
          })
          const s1 = f.principal(f.s1)
          const veteran = yield* approved(f, g.items[0]!, g.p1, f.s1)
          const deduction = yield* assessment.createEntry(
            f.t,
            { itemId: g.items[1]!, participantId: g.p1, payload: {}, note: '校纪字〔2026〕3号' },
            f.principal(f.recorder),
          )
          const volunteer = yield* assessment.createEntry(
            f.t,
            { itemId: g.items[2]!, participantId: g.p1, payload: {} },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, volunteer.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'reject', comment: 'no evidence attached' },
            f.principal(f.reviewer),
          )
          yield* assessment.createEntry(
            f.t,
            { itemId: g.items[3]!, participantId: g.p1, payload: {} },
            s1,
          )

          const first = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          const second = yield* assessment.getMyResult(f.t, g.batch.id, s1)

          const outsider = one<{ id: string }>(
            yield* runSql(sql`
              insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
              values (${f.t}, 'Latecomer', ${f.studentType}, ${f.classA}) returning id`),
          ).id
          const notInRound = yield* Effect.exit(
            assessment.getMyResult(f.t, g.batch.id, f.principal(outsider)),
          )
          return { first, second, veteran, deduction, volunteer, notInRound, groupIds: g.groupIds }
        }),
      ),
    )

    expect(result.first.mode).toBe('provisional')
    expect(result.first.total).toBe('2.00')
    const section = result.first.groups.find((group) => group.groupId === result.groupIds[0])!
    expect(section).toMatchObject({ itemsTotal: '2.00', final: '2.00' })
    // the paper adds up what its sections came to and has no ceiling of its own
    const wholePaper = result.first.groups.find((group) => group.parentGroupId === null)!
    expect(wholePaper).toMatchObject({ childrenTotal: '2.00', final: '2.00' })
    expect(result.first.lines.map((line) => [line.lineId, line.kind, line.value])).toEqual([
      [`entry:${result.veteran}`, 'entry', '3.00'],
      [`entry:${result.deduction.id}`, 'entry', '-1.00'],
      [`entry:${result.volunteer.id}`, 'excluded-evidence', '0.00'],
    ])
    const provenance = result.first.lines[0]!.provenance
    expect(provenance?.calculatorRef).toBe('fixed@1')
    expect(provenance?.entryId).toBe(result.veteran)
    expect(provenance?.entryRevisionId).toBeDefined()
    // byte-identical on the same facts
    expect(result.second).toEqual(result.first)
    // never on the roster, no authority: the round itself is not theirs to
    // see, which is a wider refusal than "not a participant"
    expect(errorOf<{ _tag: string }>(result.notInRound)?._tag).toBe('ACCESS_DENIED')
  })

  it('holds a group to its cap and lifts one to its floor, as visible adjustments', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sc-limits')
          const assessment = yield* Assessment
          const g = yield* scoringBatch(f, {
            groups: [
              { name: '加分', cap: '2.00' },
              { name: '扣分', floor: '0.00' },
            ],
            items: [
              { title: '获奖', value: '3.00', group: 0, entrySource: 'student' },
              { title: '违纪', value: '-1.00', group: 1, entrySource: 'administrative' },
            ],
          })
          const award = yield* approved(f, g.items[0]!, g.p1, f.s1)
          const penalty = yield* assessment.createEntry(
            f.t,
            { itemId: g.items[1]!, participantId: g.p1, payload: {}, note: '校纪字〔2026〕7号' },
            f.principal(f.recorder),
          )
          const account = yield* assessment.getMyResult(f.t, g.batch.id, f.principal(f.s1))
          return { account, award, penalty, groupIds: g.groupIds }
        }),
      ),
    )

    expect(result.account.total).toBe('2.00')
    expect(
      result.account.groups
        .filter((group) => group.parentGroupId !== null)
        .map((group) => [group.itemsTotal, group.final]),
    ).toEqual([
      ['3.00', '2.00'],
      ['-1.00', '0.00'],
    ])
    expect(result.account.lines.map((line) => [line.lineId, line.kind, line.value])).toEqual([
      [`entry:${result.award}`, 'entry', '3.00'],
      [`grp:${result.groupIds[0]}:cap`, 'group-adjustment', '-1.00'],
      [`entry:${result.penalty.id}`, 'entry', '-1.00'],
      [`grp:${result.groupIds[1]}:floor`, 'group-adjustment', '1.00'],
    ])
  })

  it('opens the account only when the round has, and keeps it open ever after', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sc-visible')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const s1 = f.principal(f.s1)
          // the roster is materialized at creation; being on it is not yet
          // being told about the round
          const g = yield* scoringBatch(
            f,
            {
              groups: [{ name: '文体', cap: '10.00' }],
              items: [{ title: '退役复学', value: '3.00', group: 0, entrySource: 'student' }],
            },
            'none',
          )
          const whileDraft = yield* Effect.exit(assessment.getMyResult(f.t, g.batch.id, s1))
          yield* assessment.schedulePhase(f.t, g.batch.id, g.planId, Date.now() + 3_600_000, admin)
          const whilePlanned = yield* Effect.exit(assessment.getMyResult(f.t, g.batch.id, s1))
          yield* assessment.advancePhase(
            f.t,
            g.batch.id,
            { to: g.planId, force: true, reason: 'test enters the phase' },
            admin,
          )
          yield* approved(f, g.items[0]!, g.p1, f.s1)
          const begun = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p1,
            'excluded',
            'moved away mid-term',
            admin,
          )
          const whileExcluded = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          // a batch archives from its last phase, so walk there first
          yield* assessment.advancePhase(
            f.t,
            g.batch.id,
            { to: g.lastPhaseId, force: true, reason: 'test reaches the end' },
            admin,
          )
          yield* assessment.setBatchStatus(
            f.t,
            g.batch.id,
            { status: 'archived', reason: 'term closed' },
            admin,
          )
          const archived = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          return { whileDraft, whilePlanned, begun, whileExcluded, archived }
        }),
      ),
    )

    expect(errorOf<{ _tag: string }>(result.whileDraft)?._tag).toBe('ACCESS_DENIED')
    expect(errorOf<{ _tag: string }>(result.whilePlanned)?._tag).toBe('ACCESS_DENIED')
    expect(result.begun.total).toBe('3.00')
    // exclusion takes back eligibility, never the account of having been in
    expect(result.whileExcluded.total).toBe('3.00')
    expect(result.archived.total).toBe('3.00')
  })

  it('applies a nested cap inside its parent cap, innermost first', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sc-nested')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          // the shape a real regulation has: sport capped at 4 inside
          // activities capped at 10 (assessment-design §8.5)
          const g = yield* scoringBatch(f, {
            groups: [{ name: '文体活动', cap: '10.00' }],
            items: [],
          })
          const saved = yield* assessment.replaceScoreGroups(
            f.t,
            g.batch.id,
            {
              groups: [
                { id: g.paperId, name: '本轮', parentGroupId: null, cap: null, floor: null },
                {
                  name: '文体活动',
                  id: g.groupIds[0]!,
                  parentGroupId: g.paperId,
                  cap: '10.00',
                  floor: null,
                },
                { name: '体育活动', cap: '4.00', floor: null, parentGroupId: g.groupIds[0]! },
                { name: '文艺活动', cap: '6.00', floor: null, parentGroupId: g.groupIds[0]! },
              ],
              expectedVersion: g.version,
              reason: 'the regulation nests these',
            },
            admin,
          )
          const sport = saved.groups.find((group) => group.name === '体育活动')!.id
          const arts = saved.groups.find((group) => group.name === '文艺活动')!.id
          const item = (title: string, value: string, groupId: string) =>
            assessment.createItem(
              f.t,
              g.batch.id,
              {
                itemType: 'evidence',
                title,
                scoreGroupId: groupId,
                maxEntries: 1,
                config: {
                  entrySource: 'student',
                  formConfig: { files: {} },
                  scoringConfig: {
                    calculator: { ref: 'fixed@1', config: { value } },
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
          // 2 + 3 + 2 = 7 under a cap of 4
          const a = yield* item('校运动会', '2.00', sport)
          const b = yield* item('篮球赛', '3.00', sport)
          const c = yield* item('志愿裁判', '2.00', sport)
          const d = yield* item('校园歌手赛', '2.00', arts)
          for (const created of [a, b, c, d]) {
            yield* assessment.setItemStatus(f.t, created.id, { status: 'active' }, admin)
            yield* approved(f, created.id, g.p1, f.s1)
          }
          const account = yield* assessment.getMyResult(f.t, g.batch.id, f.principal(f.s1))
          return { account, sport, arts, parent: g.groupIds[0]! }
        }),
      ),
    )

    const groupOf = (id: string) => result.account.groups.find((group) => group.groupId === id)!
    // the inner cap bites first: its own questions come to 7, it counts 4
    expect(groupOf(result.sport)).toMatchObject({
      itemsTotal: '7.00',
      childrenTotal: '0.00',
      raw: '7.00',
      final: '4.00',
      depth: 2,
    })
    expect(groupOf(result.arts)).toMatchObject({ itemsTotal: '2.00', final: '2.00' })
    // the parent has no questions of its own: it is worth what its children
    // came to after their own limits, and only then meets its own
    expect(groupOf(result.parent)).toMatchObject({
      itemsTotal: '0.00',
      childrenTotal: '6.00',
      raw: '6.00',
      final: '6.00',
      depth: 1,
    })
    // only the roots are counted once into the total - never the children again
    expect(result.account.total).toBe('6.00')
  })

  it('states a voided question to whoever has history on it, and to nobody else', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sc-voided')
          const assessment = yield* Assessment
          const g = yield* scoringBatch(f, {
            groups: [{ name: '文体', cap: '10.00' }],
            items: [{ title: '退役复学', value: '3.00', group: 0, entrySource: 'student' }],
          })
          yield* approved(f, g.items[0]!, g.p1, f.s1)
          // the void act itself is a later conversation; the scorer's answer
          // to a voided question is frozen now
          yield* runSql(sql`
            update assessment_items
            set status = 'voided', voided_at = now(), voided_by = ${f.admin},
                void_reason = 'policy withdrawn for the term'
            where id = ${g.items[0]}`)
          const withHistory = yield* assessment.getMyResult(f.t, g.batch.id, f.principal(f.s1))
          const without = yield* assessment.getMyResult(f.t, g.batch.id, f.principal(f.s2))
          return { withHistory, without, itemId: g.items[0]! }
        }),
      ),
    )

    expect(result.withHistory.total).toBe('0.00')
    expect(result.withHistory.lines.map((line) => [line.lineId, line.kind, line.value])).toEqual([
      [`item:${result.itemId}:voided`, 'item-voided', '0.00'],
    ])
    expect(result.without.total).toBe('0.00')
    expect(result.without.lines).toEqual([])
  })
})
