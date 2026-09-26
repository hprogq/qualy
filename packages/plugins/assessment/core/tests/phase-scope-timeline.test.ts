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
})
