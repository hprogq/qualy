import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ok, phase, run, runningBatch, seed } from './support/round.ts'

// A supplementary stage that opens one question, or admits only some of the
// roster, is a fact the timeline has to carry: the stage progress on the
// overview and the stage plan both say it, and neither may ask the plan's
// own allowances, which name roster rows a participant has no business
// reading.

describe.runIf(postgresAvailable)('a stage allowance on the timeline', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-phase-scope-timeline')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('names the questions a stage alone opens, and only says that it limits people', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('scope-timeline')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          // a question still being composed: allowed in an allowance, but
          // nobody outside the office can see its name yet
          const composing = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '语言技能证书',
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
                  normal: {
                    stages: [
                      {
                        id: 'class',
                        selector: {
                          kind: 'roleAt',
                          nodeTypeId: f.classType,
                          roleIds: [f.reviewRole],
                        },
                        quorum: { type: 'any' },
                      },
                    ],
                  },
                  escalation: { stages: [] },
                },
              },
            },
            admin,
          )
          const plan = yield* assessment.getPlan(f.t, g.batch.id, admin)
          yield* assessment.replacePlan(
            f.t,
            g.batch.id,
            {
              specs: [
                { id: plan[0]!.id, phaseKey: plan[0]!.phaseKey, displayName: 'entry' },
                phase({
                  phaseKey: 'supplement',
                  permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
                  itemScope: [composing.id, g.item.id],
                  participantScope: [g.p1],
                }),
                { id: plan[1]!.id, phaseKey: plan[1]!.phaseKey, displayName: 'archive' },
              ],
            },
            admin,
          )
          const timeline = yield* assessment.timeline(f.t, g.batch.id)
          return { item: g.item, timeline }
        }),
      ),
    )
    const scopes = result.timeline.map((stage) => stage.scope)
    expect(result.timeline.map((stage) => stage.displayName)).toEqual([
      'entry',
      'supplement',
      'archive',
    ])
    // a stage that names nothing opens everything, to everybody
    expect(scopes[0]).toEqual({ items: null, participantsLimited: false })
    expect(scopes[2]).toEqual({ items: null, participantsLimited: false })
    // the question in the paper by name; the one being composed not at all
    expect(scopes[1]).toEqual({
      items: [{ id: result.item.id, title: result.item.title }],
      participantsLimited: true,
    })
  })

  // Each question's place is kept within its own section, so the rows the
  // server reads put every section's first question ahead of any second
  // one. The names a stage opens are read in the order the paper reads them.
  it('names the questions a stage opens section by section, as the paper reads', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('scope-order')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f)
          const tree = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const paper = tree.groups.find((group) => group.parentGroupId === null)!
          const grown = yield* assessment.replaceScoreGroups(
            f.t,
            g.batch.id,
            {
              groups: [
                {
                  id: paper.id,
                  parentGroupId: null,
                  name: paper.name,
                  cap: paper.cap,
                  floor: paper.floor,
                },
                { parentGroupId: paper.id, name: '学业', cap: null, floor: null, sortOrder: 0 },
                { parentGroupId: paper.id, name: '实践', cap: null, floor: null, sortOrder: 1 },
              ],
              expectedVersion: tree.version,
            },
            admin,
          )
          const section = (name: string) => grown.groups.find((group) => group.name === name)!.id
          const ask = (title: string, scoreGroupId: string, sortOrder: number) =>
            Effect.gen(function* () {
              const item = yield* assessment.createItem(
                f.t,
                g.batch.id,
                {
                  itemType: 'evidence',
                  title,
                  scoreGroupId,
                  maxEntries: 1,
                  sortOrder,
                  config: {
                    entryChannels: ['participant'],
                    formConfig: { files: {} },
                    scoringConfig: {
                      calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                      aggregator: { ref: 'sum@1', config: {} },
                    },
                    reviewPolicy: {
                      normal: {
                        stages: [
                          {
                            id: 'class',
                            selector: {
                              kind: 'roleAt',
                              nodeTypeId: f.classType,
                              roleIds: [f.reviewRole],
                            },
                            quorum: { type: 'any' },
                          },
                        ],
                      },
                      escalation: { stages: [] },
                    },
                  },
                },
                admin,
              )
              yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
              return item.id
            })
          // written in an order that is neither the paper's nor any one
          // section's: the later section's first question comes first
          const volunteering = yield* ask('志愿服务', section('实践'), 0)
          const grades = yield* ask('学业成绩', section('学业'), 0)
          const contests = yield* ask('学科竞赛', section('学业'), 1)
          const plan = yield* assessment.getPlan(f.t, g.batch.id, admin)
          yield* assessment.replacePlan(
            f.t,
            g.batch.id,
            {
              specs: [
                { id: plan[0]!.id, phaseKey: plan[0]!.phaseKey, displayName: 'entry' },
                phase({
                  phaseKey: 'supplement',
                  permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
                  itemScope: [volunteering, contests, grades],
                }),
                { id: plan[1]!.id, phaseKey: plan[1]!.phaseKey, displayName: 'archive' },
              ],
            },
            admin,
          )
          return yield* assessment.timeline(f.t, g.batch.id)
        }),
      ),
    )
    expect(result[1]!.scope.items?.map((item) => item.title)).toEqual([
      '学业成绩',
      '学科竞赛',
      '志愿服务',
    ])
  })
})
