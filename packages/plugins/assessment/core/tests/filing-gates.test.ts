import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, run, runningBatch, seed } from './support/round.ts'

// What the phase gate says about filing before any claim exists, delivered
// with the entries read so the paper's buttons wear the refusal instead of
// discovering it after the dialog. Per item, because a scoped supplementary
// phase admits some questions and not others - and the per-claim capability
// block rides the same per-item answers, which is what keeps a scoped phase
// from shutting the very questions it admits.

describe.runIf(postgresAvailable)('filing gates on the entries read', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-filing-gates')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('reports submit shut while create stays open, on the rows and the claims alike', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fg-half-open')
          const assessment = yield* Assessment
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f, {
            profile: GATED.filter((code) => code !== 'assessment.entry.submit'),
          })
          const draft = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const page = yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)
          return {
            itemId: g.item.id,
            filing: page.filing,
            draft: page.entries.find((one) => one.id === draft.id)?.capabilities,
          }
        }),
      ),
    )
    const row = result.filing.find((one) => one.itemId === result.itemId)
    expect(row?.create).toEqual({ state: 'available', reason: null })
    expect(row?.submit).toEqual({ state: 'blocked', reason: 'phase-closed' })
    // the claim's own card tells the same story as the filing row
    expect(result.draft?.edit).toEqual({ state: 'available', reason: null })
    expect(result.draft?.submit).toEqual({ state: 'blocked', reason: 'phase-closed' })
  })

  it('answers per item under a scoped phase instead of shutting everything', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fg-scoped')
          const assessment = yield* Assessment
          const s1 = f.principal(f.s1)
          const g = yield* runningBatch(f)
          const second = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '补充材料',
              scoreGroupId: g.item.scoreGroupId,
              maxEntries: 1,
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: {
                  calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                  aggregator: { ref: 'sum@1', config: {} },
                },
                reviewPolicy: {
                  normal: {
                    stages: [
                      {
                        id: 's1',
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
            f.principal(f.admin),
          )
          yield* assessment.setItemStatus(
            f.t,
            second.id,
            { status: 'active' },
            f.principal(f.admin),
          )
          const onFirst = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            s1,
          )
          const onSecond = yield* assessment.createEntry(
            f.t,
            { itemId: second.id, participantId: g.p1, payload: {} },
            s1,
          )
          // the running phase narrows to the second question only
          const plan = yield* assessment.getPlan(f.t, g.batch.id, f.principal(f.admin))
          yield* runSql(
            sql`insert into phase_item_scopes (tenant_id, phase_id, item_id)
                values (${f.t}, ${plan[0]!.id}, ${second.id})`,
          )
          const page = yield* assessment.listMyEntries(f.t, g.batch.id, {}, s1)
          return {
            first: g.item.id,
            second: second.id,
            filing: page.filing,
            onFirst: page.entries.find((one) => one.id === onFirst.id)?.capabilities,
            onSecond: page.entries.find((one) => one.id === onSecond.id)?.capabilities,
          }
        }),
      ),
    )
    const first = result.filing.find((one) => one.itemId === result.first)
    const second = result.filing.find((one) => one.itemId === result.second)
    expect(first?.create).toEqual({ state: 'blocked', reason: 'item-out-of-scope' })
    expect(second?.create).toEqual({ state: 'available', reason: null })
    expect(second?.submit).toEqual({ state: 'available', reason: null })
    // the claims follow their own items: the admitted question stays open
    expect(result.onFirst?.edit).toEqual({ state: 'blocked', reason: 'item-out-of-scope' })
    expect(result.onSecond?.edit).toEqual({ state: 'available', reason: null })
    expect(result.onSecond?.submit).toEqual({ state: 'available', reason: null })
  })
})
