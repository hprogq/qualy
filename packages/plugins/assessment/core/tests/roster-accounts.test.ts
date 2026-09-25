import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import type { CandidateFilter, RosterAccountsFilter } from '../src/server/db.ts'
import { probeGrantTest } from './support/catalogs.ts'
import { appointStaff, collegeOf } from './support/correction.ts'
import {
  breakGrant,
  errorOf,
  GATED,
  ok,
  one,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// The roster as the results page walks it: by page number, filtered and
// sorted in sql, each row saying what that person's claims wait on and each
// page's totals computed on request, within what one request may spend.

const OPEN = [...GATED, 'assessment.review.process']

/** one page of the roster, as the administrator reads it */
const page = (
  f: Seeded,
  batchId: string,
  over: Partial<{
    filter: Omit<RosterAccountsFilter, 'reach'>
    order: 'unit' | 'name' | 'business-no'
    page: number
    limit: number
  }> = {},
  as = f.principal(f.admin),
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    return yield* assessment.listParticipantAccounts(
      f.t,
      batchId,
      {
        filter: over.filter ?? {},
        order: over.order ?? 'name',
        page: over.page ?? 1,
        limit: over.limit ?? 50,
      },
      as,
    )
  })

const names = (found: { rows: readonly { displayName: string }[] }) =>
  found.rows.map((row) => row.displayName)

/** a question nobody files: it grants its amount to everybody on the roster */
const granted = (f: Seeded, batchId: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'constant',
        title: '固定加分',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: null,
        config: {
          entryChannels: [] as const,
          formConfig: {},
          scoringConfig: {
            calculator: { ref: probeGrantTest.ref, config: { amount: '1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: { mode: 'none' },
        },
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    return item
  })

describe.runIf(postgresAvailable)('the roster, as the results page reads it', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-roster-accounts')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('pages by number, lands past the end on the last page, and filters in sql', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-pages')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p2,
            'excluded',
            '转专业',
            f.principal(f.admin),
          )
          yield* runSql(sql`update users set business_no = 'S-001' where id = ${f.s3}`)
          const college = yield* collegeOf(f)
          return {
            first: yield* page(f, g.batch.id, { limit: 2 }),
            second: yield* page(f, g.batch.id, { limit: 2, page: 2 }),
            beyond: yield* page(f, g.batch.id, { limit: 2, page: 99 }),
            searched: yield* page(f, g.batch.id, { filter: { q: 'li s' } }),
            numbered: yield* page(f, g.batch.id, { filter: { q: 'S-00' } }),
            underClass: yield* page(f, g.batch.id, {
              filter: { orgNodeIds: [f.classA], orgScope: 'subtree' },
            }),
            atCollege: yield* page(f, g.batch.id, {
              filter: { orgNodeIds: [college], orgScope: 'self' },
            }),
            underCollege: yield* page(f, g.batch.id, {
              filter: { orgNodeIds: [college], orgScope: 'subtree' },
            }),
            excluded: yield* page(f, g.batch.id, { filter: { status: 'excluded' } }),
            byNumber: yield* page(f, g.batch.id, { order: 'business-no', limit: 1 }),
          }
        }),
      ),
    )
    // six people, two to a page, sorted by name with the id breaking ties
    expect(result.first.total).toBe(6)
    expect(result.first.page).toBe(1)
    expect(names(result.first)).toEqual(['Admin', 'Li Si'])
    expect(names(result.second)).toEqual(['Recorder', 'Reviewer'])
    // a page past the end is the last page, not an empty screen
    expect(result.beyond.page).toBe(3)
    expect(names(result.beyond)).toEqual(['Wang Wu', 'Zhang San'])
    expect(names(result.searched)).toEqual(['Li Si'])
    expect(names(result.numbered)).toEqual(['Wang Wu'])
    expect(names(result.underClass)).toEqual(['Li Si', 'Reviewer', 'Zhang San'])
    expect(names(result.atCollege)).toEqual(['Recorder'])
    expect(names(result.underCollege)).toEqual(['Li Si', 'Recorder', 'Reviewer', 'Zhang San'])
    expect(names(result.excluded)).toEqual(['Li Si'])
    expect(result.excluded.total).toBe(1)
    // the one business number sorts first; the rest follow with none
    expect(names(result.byNumber)).toEqual(['Wang Wu'])
  })

  it('says what each person’s claims wait on, and lists by it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-filings')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const file = (userId: string, participantId: string) =>
            Effect.gen(function* () {
              const who = f.principal(userId)
              const entry = yield* assessment.createEntry(
                f.t,
                { itemId: g.item.id, participantId, payload: {} },
                who,
              )
              return yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', who)
            })
          // under review; asked for more; sent back
          yield* file(f.s3, g.p3)
          const asked = yield* file(f.s1, g.p1)
          yield* assessment.requestSupplement(
            f.t,
            asked.currentReviewInstanceId!,
            {
              instructions: '请补充现场照片',
              requirements: [{ label: '照片', kind: 'file', required: true }],
            },
            f.principal(f.reviewer),
          )
          const returned = yield* file(f.s2, g.p2)
          yield* assessment.interveneOnEntry(
            f.t,
            returned.id,
            { kind: 'return-for-revision', reason: '证书需要重新上传' },
            f.principal(f.admin),
          )
          const waiting = one<{ state: string }>(
            yield* runSql(sql`
              select ri.state from review_instances ri
              join entries e on e.id = ri.entry_id
              where e.participant_id = ${g.p3}`),
          ).state
          const all = yield* page(f, g.batch.id)
          const by = (attention: 'inReview' | 'toSupplement' | 'toRevise' | 'blocked') =>
            Effect.map(page(f, g.batch.id, { filter: { attention } }), names)
          return {
            waiting,
            filings: new Map(all.rows.map((row) => [row.id, row.filings])),
            inReview: yield* by('inReview'),
            toSupplement: yield* by('toSupplement'),
            toRevise: yield* by('toRevise'),
            blocked: yield* by('blocked'),
            g,
          }
        }),
      ),
    )
    // nobody holds the review role at the second college's class
    expect(result.waiting).toBe('blocked')
    expect(result.filings.get(result.g.p3)).toEqual({
      inReview: 1,
      toSupplement: 0,
      reconsidering: 0,
      toRevise: 0,
      blocked: 1,
    })
    expect(result.filings.get(result.g.p1)).toEqual({
      inReview: 0,
      toSupplement: 1,
      reconsidering: 0,
      toRevise: 0,
      blocked: 0,
    })
    expect(result.filings.get(result.g.p2)).toEqual({
      inReview: 0,
      toSupplement: 0,
      reconsidering: 0,
      toRevise: 1,
      blocked: 0,
    })
    expect(result.inReview).toEqual(['Wang Wu'])
    expect(result.toSupplement).toEqual(['Zhang San'])
    expect(result.toRevise).toEqual(['Li Si'])
    expect(result.blocked).toEqual(['Wang Wu'])
  })

  it('orders the people of one unit by name when the roster is ordered by unit', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-unit-order')
          const g = yield* runningBatch(f, { profile: OPEN })
          // named against the order they were admitted in, so an order that
          // falls back on admission reads backwards
          const admitted = (yield* runSql(sql`
            select user_id from batch_participants
             where batch_id = ${g.batch.id} and assessment_anchor_node_id = ${f.classA}
             order by id`)) as unknown as { rows: { user_id: string }[] }
          const renamed = ['Zulu', 'Yankee', 'Xray']
          for (const [index, row] of admitted.rows.entries()) {
            yield* runSql(
              sql`update users set display_name = ${renamed[index]!} where id = ${row.user_id}`,
            )
          }
          return yield* page(f, g.batch.id, {
            order: 'unit',
            filter: { orgNodeIds: [f.classA], orgScope: 'self' },
          })
        }),
      ),
    )
    expect(names(result)).toEqual(['Xray', 'Yankee', 'Zulu'])
  })

  it('lists to a re-determiner only the people it covers, and to a recorder nobody', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-reach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const inspector = yield* appointStaff(f, g.batch.id, {
            name: 'Inspector',
            at: f.classA,
            codes: ['assessment.entry.redetermine'],
          })
          const covered = yield* page(f, g.batch.id, {}, f.principal(inspector.who))
          const recorder = yield* Effect.exit(page(f, g.batch.id, {}, f.principal(f.recorder)))
          // the record page's own reading is untouched
          const recordable = yield* assessment.listParticipants(
            f.t,
            g.batch.id,
            { limit: 50 },
            f.principal(f.recorder),
          )
          return { covered, recorder, recordable: recordable.map((row) => row.displayName) }
        }),
      ),
    )
    expect(names(result.covered)).toEqual(['Li Si', 'Reviewer', 'Zhang San'])
    expect(result.covered.total).toBe(3)
    expect(errorOf<{ _tag: string }>(result.recorder)?._tag).toBe('ACCESS_DENIED')
    expect(result.recordable).toEqual(
      expect.arrayContaining(['Zhang San', 'Li Si', 'Reviewer', 'Recorder']),
    )
    expect(result.recordable).not.toContain('Wang Wu')
  })
})

describe.runIf(postgresAvailable)('the totals on a page of the roster', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-roster-scores')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('gives each person the total their own account gives', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rs-totals')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const owner = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            owner,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', owner)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const admin = f.principal(f.admin)
          const scores = yield* assessment.listParticipantScores(
            f.t,
            g.batch.id,
            [g.p1, g.p2],
            admin,
          )
          const accounts = yield* Effect.forEach([g.p1, g.p2], (id) =>
            assessment.getParticipantResult(f.t, g.batch.id, id, admin),
          )
          return { scores, totals: accounts.map((account) => account.total), g }
        }),
      ),
    )
    expect(result.scores).toEqual([
      { participantId: result.g.p1, state: 'scored', total: result.totals[0] },
      { participantId: result.g.p2, state: 'scored', total: result.totals[1] },
    ])
    expect(result.totals[0]).toBe('3.00')
  })

  it('stops at an outage, says so on the row, and leaves the rest to be asked alone', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rs-outage')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const item = yield* granted(f, g.batch.id)
          yield* breakGrant(item.id, 'unavailable')
          const admin = f.principal(f.admin)
          const page = yield* assessment.listParticipantScores(f.t, g.batch.id, [g.p1, g.p2], admin)
          const alone = yield* assessment.listParticipantScores(f.t, g.batch.id, [g.p2], admin)
          return { page, alone, g }
        }),
      ),
    )
    expect(result.page).toEqual([
      {
        participantId: result.g.p1,
        state: 'unavailable',
        reason: 'scoring-unavailable',
      },
      { participantId: result.g.p2, state: 'deferred' },
    ])
    expect(result.alone).toEqual([
      {
        participantId: result.g.p2,
        state: 'unavailable',
        reason: 'scoring-unavailable',
      },
    ])
  })

  it('refuses a page with anybody on it the reader may not open', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rs-reach')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const inspector = yield* appointStaff(f, g.batch.id, {
            name: 'Inspector',
            at: f.classA,
            codes: ['assessment.entry.redetermine'],
          })
          const as = f.principal(inspector.who)
          const within = yield* assessment.listParticipantScores(f.t, g.batch.id, [g.p1, g.p2], as)
          const across = yield* Effect.exit(
            assessment.listParticipantScores(f.t, g.batch.id, [g.p1, g.p3], as),
          )
          const recorder = yield* Effect.exit(
            assessment.listParticipantScores(f.t, g.batch.id, [g.p1], f.principal(f.recorder)),
          )
          const nobody = yield* Effect.exit(
            assessment.listParticipantScores(
              f.t,
              g.batch.id,
              ['01a0b900-0000-7000-8000-00000000dead'],
              f.principal(f.admin),
            ),
          )
          return { within, across, recorder, nobody }
        }),
      ),
    )
    expect(result.within.map((score) => score.state)).toEqual(['scored', 'scored'])
    expect(errorOf<{ _tag: string }>(result.across)?._tag).toBe('ACCESS_DENIED')
    expect(errorOf<{ _tag: string }>(result.recorder)?._tag).toBe('ACCESS_DENIED')
    expect(Exit.isFailure(result.nobody)).toBe(true)
    expect(errorOf<{ _tag: string }>(result.nobody)?._tag).toBe('ASSESSMENT_PARTICIPANT_NOT_FOUND')
  })
})

describe.runIf(postgresAvailable)('the people an administrator could add', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-roster-candidates')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('offers who the reader manages, and says who is on the roster already', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rc-offer')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const admin = f.principal(f.admin)
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
            values (${f.t}, 'Newcomer', ${f.studentType}, ${f.classA})`)
          yield* runSql(sql`
            insert into users (tenant_id, display_name, user_type_id, primary_org_node_id, enabled)
            values (${f.t}, 'Dormant', ${f.studentType}, ${f.classA}, false)`)
          yield* assessment.setParticipantStatus(f.t, g.batch.id, g.p2, 'excluded', '转专业', admin)
          const list = (filter: CandidateFilter, at = 1) =>
            assessment.listParticipantCandidates(
              f.t,
              g.batch.id,
              { filter, page: at, limit: 50 },
              admin,
            )
          const everyone = yield* list({})
          const searched = yield* list({ q: 'new' })
          const inClass = yield* list({ orgNodeId: f.classA, orgScope: 'self' })
          const reviewer = yield* Effect.exit(
            assessment.listParticipantCandidates(
              f.t,
              g.batch.id,
              { filter: {}, page: 1, limit: 50 },
              f.principal(f.reviewer),
            ),
          )
          return { everyone, searched, inClass, reviewer }
        }),
      ),
    )
    const standing = new Map(result.everyone.rows.map((row) => [row.displayName, row.roster]))
    // nobody disabled is offered: the write would not admit them
    expect(standing.has('Dormant')).toBe(false)
    expect(standing.get('Newcomer')).toBeNull()
    expect(standing.get('Li Si')).toBe('excluded')
    expect(standing.get('Zhang San')).toBe('active')
    expect(result.everyone.total).toBe(7)
    expect(result.searched.rows.map((row) => row.displayName)).toEqual(['Newcomer'])
    expect(result.inClass.rows.map((row) => row.displayName)).toEqual([
      'Li Si',
      'Newcomer',
      'Reviewer',
      'Zhang San',
    ])
    expect(errorOf<{ _tag: string }>(result.reviewer)?._tag).toBe('ACCESS_DENIED')
  })
})
