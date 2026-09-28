import { sql } from 'kysely'
import { Effect, Exit, Fiber, Schedule } from 'effect'
import { TestClock } from 'effect/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import type { CandidateFilter, RosterAccountsFilter } from '../src/server/db.ts'
import { ONE_SCORING, PAGE_SCORING } from '../src/scoring/service.ts'
import { probeGrantTest, probeHangs } from './support/catalogs.ts'
import { recordItem } from './support/administrative.ts'
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
    around: string
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
        ...(over.around === undefined ? {} : { around: over.around }),
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
          const by = (attention: 'any' | 'inReview' | 'toSupplement' | 'toRevise' | 'blocked') =>
            Effect.map(page(f, g.batch.id, { filter: { attention } }), names)
          return {
            waiting,
            filings: new Map(all.rows.map((row) => [row.id, row.filings])),
            inReview: yield* by('inReview'),
            toSupplement: yield* by('toSupplement'),
            toRevise: yield* by('toRevise'),
            blocked: yield* by('blocked'),
            any: yield* by('any'),
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
    // anything at all is everybody whose row shows a count, and nobody else
    expect(result.any).toEqual(['Li Si', 'Wang Wu', 'Zhang San'])
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

  it('draws the tree of units off the members the page beside it lists', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-units')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const unit = (name: string) =>
            Effect.map(
              runSql(sql`select id from org_nodes where tenant_id = ${f.t} and name = ${name}`),
              (found) => one<{ id: string }>(found).id,
            )
          const [collegeA, collegeB, classB] = [
            yield* unit('College A'),
            yield* unit('College B'),
            yield* unit('Class B1'),
          ]
          const units = (
            as: string,
            filter: {
              reading?: 'record' | 'accounts' | 'recordable'
              status?: 'active' | 'excluded' | 'all'
            },
          ) => assessment.listRosterUnits(f.t, g.batch.id, filter, f.principal(as))
          // recording over college A opens the accounts it covers
          // (assessment-design §30 #12)
          const recorderAccounts = yield* units(f.recorder, { reading: 'accounts' })
          // and re-determining over class B opens its people's
          yield* appointStaff(f, g.batch.id, {
            name: 'Class B inspector',
            at: classB,
            codes: ['assessment.entry.redetermine'],
            who: f.recorder,
          })
          const record = yield* units(f.recorder, {})
          const accounts = yield* units(f.recorder, { reading: 'accounts' })
          // what a finding recorded by unit reaches: recording alone
          const recordable = yield* units(f.recorder, { reading: 'recordable' })
          // and somebody who records on nobody has no such tree
          const reviewerRecordable = yield* Effect.exit(
            units(f.reviewer, { reading: 'recordable' }),
          )
          // Wang Wu is class B's only member; taken off, the unit is only
          // where the people taken off stand
          yield* assessment.setParticipantStatus(
            f.t,
            g.batch.id,
            g.p3,
            'excluded',
            '转专业',
            f.principal(f.admin),
          )
          return {
            ids: { collegeA, collegeB, classB },
            recorderAccounts,
            record,
            accounts,
            recordable,
            reviewerRecordable,
            active: yield* units(f.admin, { reading: 'accounts' }),
            everyone: yield* units(f.admin, { reading: 'accounts', status: 'all' }),
            excluded: yield* units(f.admin, { reading: 'accounts', status: 'excluded' }),
            f,
          }
        }),
      ),
    )
    const { f, ids } = result
    const idsOf = (found: { units: readonly { id: string }[] }) =>
      found.units.map((unit) => unit.id).sort()
    const sorted = (...units: string[]) => [...units].sort()
    expect(idsOf(result.recorderAccounts)).toEqual(sorted(f.root, ids.collegeA, f.classA))
    // the record page reads what recording covers, and nothing a reading
    // power lends (ruling of 2026-09-29)
    expect(idsOf(result.record)).toEqual(sorted(f.root, ids.collegeA, f.classA))
    // the results page reads what recording and re-determining cover
    // together: no unit whose list would be empty for this reader
    expect(idsOf(result.accounts)).toEqual(
      sorted(f.root, ids.collegeA, f.classA, ids.collegeB, ids.classB),
    )
    expect(idsOf(result.active)).toEqual(sorted(f.root, ids.collegeA, f.classA))
    expect(idsOf(result.everyone)).toEqual(
      sorted(f.root, ids.collegeA, f.classA, ids.collegeB, ids.classB),
    )
    expect(idsOf(result.excluded)).toEqual(sorted(f.root, ids.collegeB, ids.classB))
    // a finding recorded by unit reaches only whom recording covers, so the
    // tree to record by holds nothing re-determining alone would add
    expect(idsOf(result.recordable)).toEqual(sorted(f.root, ids.collegeA, f.classA))
    expect(errorOf<{ _tag: string }>(result.reviewerRecordable)?._tag).toBe('ACCESS_DENIED')
    // each unit carries its kind, and the kinds come named
    expect(result.recordable.units.find((unit) => unit.id === f.classA)?.orgTypeId).toBe(
      f.classType,
    )
    expect(result.recordable.orgTypes.map((kind) => kind.name).sort()).toEqual(['Class', 'College'])
    // the kinds of people come off the same members, as the round froze them
    expect(result.accounts.userTypes).toEqual([{ id: f.studentType, name: 'Student' }])
    expect(result.excluded.userTypes).toEqual([{ id: f.studentType, name: 'Student' }])
  })

  it('lists to a re-determiner and to a recorder only the people each covers', async () => {
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
          const recorder = yield* page(f, g.batch.id, {}, f.principal(f.recorder))
          // the record page lists the same people to the recorder
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
    expect(result.recordable).toEqual(
      expect.arrayContaining(['Zhang San', 'Li Si', 'Reviewer', 'Recorder']),
    )
    expect(result.recordable).not.toContain('Wang Wu')
    expect(names(result.recorder)).toEqual([...result.recordable].sort())
    expect(result.recorder.total).toBe(result.recordable.length)
  })

  // Walking the roster from an open account finds that person's page by
  // asking for it, whatever page the address still names: the page they are
  // on is the one that holds them, counted in the list's own order.
  it('answers the page somebody stands on, in each order the list is read in', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-around')
          const g = yield* runningBatch(f, { profile: OPEN })
          yield* runSql(sql`update users set business_no = 'S-001' where id = ${f.s3}`)
          const everyone = (yield* page(f, g.batch.id)).rows.map((row) => row.id)
          const placed: { order: string; holds: boolean; asPaged: boolean }[] = []
          for (const order of ['unit', 'name', 'business-no'] as const) {
            for (const id of everyone) {
              const found = yield* page(f, g.batch.id, { order, limit: 2, page: 1, around: id })
              const paged = yield* page(f, g.batch.id, { order, limit: 2, page: found.page })
              placed.push({
                order,
                holds: found.rows.some((row) => row.id === id),
                asPaged:
                  JSON.stringify(found.rows.map((row) => row.id)) ===
                  JSON.stringify(paged.rows.map((row) => row.id)),
              })
            }
          }
          return {
            everyone: everyone.length,
            placed,
            // Zhang San is sixth by name: the third page of two, the second of three
            byTwo: yield* page(f, g.batch.id, { limit: 2, page: 1, around: g.p1 }),
            byThree: yield* page(f, g.batch.id, { limit: 3, page: 1, around: g.p1 }),
            // asked about Li Si under a search that finds only Wang Wu: the page asked for
            narrowed: yield* page(f, g.batch.id, {
              filter: { q: 'S-00' },
              limit: 1,
              page: 1,
              around: g.p2,
            }),
            narrowedPlain: yield* page(f, g.batch.id, { filter: { q: 'S-00' }, limit: 1, page: 1 }),
          }
        }),
      ),
    )
    expect(result.everyone).toBe(6)
    // everybody, in every order, is on the page the answer names, and that
    // page is the same page asked for by its number
    expect(result.placed).toHaveLength(18)
    expect(result.placed.filter((one) => !one.holds || !one.asPaged)).toEqual([])
    expect(result.byTwo.page).toBe(3)
    expect(names(result.byTwo)).toEqual(['Wang Wu', 'Zhang San'])
    expect(result.byThree.page).toBe(2)
    expect(result.narrowed).toEqual(result.narrowedPlain)
  })

  // Asking where somebody stands says nothing about whether they exist:
  // somebody the reader cannot open, filtered out, or nobody at all, answers
  // exactly as the page alone would.
  it('answers as the page alone would for anybody the question does not hold', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('ra-around-reach')
          const g = yield* runningBatch(f, { profile: OPEN })
          const inspector = yield* appointStaff(f, g.batch.id, {
            name: 'Inspector',
            at: f.classA,
            codes: ['assessment.entry.redetermine'],
          })
          const as = f.principal(inspector.who)
          return {
            // Wang Wu stands outside the class the inspector covers
            outside: yield* page(f, g.batch.id, { limit: 1, page: 2, around: g.p3 }, as),
            plain: yield* page(f, g.batch.id, { limit: 1, page: 2 }, as),
            covered: yield* page(f, g.batch.id, { limit: 1, page: 1, around: g.p1 }, as),
            excluded: yield* page(f, g.batch.id, {
              filter: { status: 'excluded' },
              around: g.p1,
            }),
            excludedPlain: yield* page(f, g.batch.id, { filter: { status: 'excluded' } }),
            nobody: yield* page(f, g.batch.id, {
              limit: 2,
              page: 2,
              around: '0190a000-0000-7000-8000-000000000001',
            }),
            nobodyPlain: yield* page(f, g.batch.id, { limit: 2, page: 2 }),
          }
        }),
      ),
    )
    expect(result.outside).toEqual(result.plain)
    expect(names(result.plain)).toEqual(['Reviewer'])
    // the inspector's own list is Li Si, Reviewer and Zhang San
    expect(result.covered.page).toBe(3)
    expect(names(result.covered)).toEqual(['Zhang San'])
    expect(result.excluded).toEqual(result.excludedPlain)
    expect(result.nobody).toEqual(result.nobodyPlain)
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

  // On a clock of the suite's own, so the time a page may spend is spent by
  // moving the clock rather than by waiting: the question is forked, left
  // until the first account's arithmetic is known to hang, and then the
  // clock is moved past what the request may spend.
  it('hands the rest of a page back once its time is spent, and says a lone reading ran out', async () => {
    /** a reading of these people, with the clock moved past its time once it is stuck */
    const outlasted = <A, E, R>(reading: Effect.Effect<A, E, R>, millis: number) =>
      Effect.gen(function* () {
        const before = probeHangs.entered
        const fiber = yield* Effect.forkChild(reading)
        yield* TestClock.withLive(
          Effect.suspend(() =>
            probeHangs.entered > before ? Effect.void : Effect.fail('not stuck yet' as const),
          ).pipe(
            Effect.retry({ times: 500, schedule: Schedule.spaced('10 millis') }),
            Effect.orDie,
          ),
        )
        // a moment short of the budget is not the budget; the reading is
        // given real time to finish, should it wrongly think it may
        yield* TestClock.adjust(millis - 1)
        yield* TestClock.withLive(Effect.sleep('50 millis'))
        const early = fiber.pollUnsafe() === undefined ? 'still reading' : 'finished'
        yield* TestClock.adjust(1)
        return { early, found: yield* Fiber.join(fiber) }
      }).pipe(Effect.provide(TestClock.layer()))

    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rs-clock')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: OPEN })
          const item = yield* granted(f, g.batch.id)
          yield* breakGrant(item.id, 'hang')
          const admin = f.principal(f.admin)
          const page = yield* outlasted(
            assessment.listParticipantScores(f.t, g.batch.id, [g.p1, g.p2, g.p3], admin),
            PAGE_SCORING.millis,
          )
          const alone = yield* outlasted(
            assessment.listParticipantScores(f.t, g.batch.id, [g.p2], admin),
            ONE_SCORING.millis,
          )
          return { page, alone, g }
        }),
      ),
    )
    expect(result.page.early).toBe('still reading')
    // the account the time ran out in is not a failure on a page, and the
    // people after it are not reached at all
    expect(result.page.found).toEqual([
      { participantId: result.g.p1, state: 'deferred' },
      { participantId: result.g.p2, state: 'deferred' },
      { participantId: result.g.p3, state: 'deferred' },
    ])
    expect(result.alone.early).toBe('still reading')
    // asked about alone, the time was all this person's, and that is the answer
    expect(result.alone.found).toEqual([
      { participantId: result.g.p2, state: 'unavailable', reason: 'timed-out' },
    ])
  })

  it('hands back unscored whoever does not fit in the arithmetic one page may spend', async () => {
    /**
     * This many more approved findings like `first`, each determined
     * differently, written around the service: one reading evaluates each
     * of them once.
     */
    const findingsLike = (firstId: string, count: number) =>
      Effect.gen(function* () {
        const cloned = (yield* runSql(sql`
          insert into entries (tenant_id, batch_id, item_id, participant_id, source, status)
          select tenant_id, batch_id, item_id, participant_id, source, 'draft'
          from entries, generate_series(1, ${count}::int)
          where id = ${firstId}
          returning id`)) as unknown as { rows: { id: string }[] }
        const ids = cloned.rows.map((row) => row.id)
        yield* runSql(sql`
          insert into entry_revisions
            (tenant_id, entry_id, item_id, item_revision_id, revision_no, payload,
             actor_id, subject_id, source, note)
          select er.tenant_id, e.id, er.item_id, er.item_revision_id, 1, er.payload,
                 er.actor_id, er.subject_id, er.source, er.note
          from entry_revisions er
          join entries src on src.current_revision_id = er.id and src.id = ${firstId}
          cross join entries e
          where e.id = any(${ids}::uuid[])`)
        yield* runSql(sql`
          insert into entry_recognitions
            (tenant_id, batch_id, entry_id, entry_revision_id, item_id, item_revision_id,
             values, source, created_by)
          select rec.tenant_id, rec.batch_id, e.id, er.id, rec.item_id, rec.item_revision_id,
                 jsonb_build_object('n', row_number() over (order by e.id)), rec.source,
                 rec.created_by
          from entry_recognitions rec
          join entries src on src.current_recognition_id = rec.id and src.id = ${firstId}
          cross join entries e
          join entry_revisions er on er.entry_id = e.id
          where e.id = any(${ids}::uuid[])`)
        yield* runSql(sql`
          update entries e
          set status = 'approved',
              current_revision_id = (select id from entry_revisions where entry_id = e.id),
              last_submitted_revision_id = (select id from entry_revisions where entry_id = e.id),
              current_recognition_id = (select id from entry_recognitions where entry_id = e.id)
          where e.id = any(${ids}::uuid[])`)
      })

    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rs-budget')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const recorded = yield* recordItem(f, g.batch.id, { maxEntries: null })
          const admin = f.principal(f.admin)
          // two fifths of what a page may evaluate for each of the first
          // two people, and a quarter for the third: the third does not fit
          const share = [
            (PAGE_SCORING.evaluations * 2) / 5,
            (PAGE_SCORING.evaluations * 2) / 5,
            PAGE_SCORING.evaluations / 4,
          ]
          const people = [g.p1, g.p2, g.p3]
          for (const [index, participantId] of people.entries()) {
            const first = yield* assessment.createEntry(
              f.t,
              { itemId: recorded.id, participantId, payload: {}, note: '一' },
              admin,
            )
            yield* findingsLike(first.id, share[index]! - 1)
          }
          const page = yield* assessment.listParticipantScores(f.t, g.batch.id, people, admin)
          const alone = yield* assessment.listParticipantScores(f.t, g.batch.id, [g.p3], admin)
          return { page, alone, g }
        }),
      ),
    )
    expect(result.page.map((score) => score.state)).toEqual(['scored', 'scored', 'deferred'])
    // asked about alone, the third has the whole of one reading to spend
    expect(result.alone.map((score) => score.state)).toEqual(['scored'])
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
          // recording over the person reads their total too (§30 #12)
          const recorder = yield* Effect.exit(
            assessment.listParticipantScores(f.t, g.batch.id, [g.p1], f.principal(f.recorder)),
          )
          const recorderAcross = yield* Effect.exit(
            assessment.listParticipantScores(
              f.t,
              g.batch.id,
              [g.p1, g.p3],
              f.principal(f.recorder),
            ),
          )
          const nobody = yield* Effect.exit(
            assessment.listParticipantScores(
              f.t,
              g.batch.id,
              ['01a0b900-0000-7000-8000-00000000dead'],
              f.principal(f.admin),
            ),
          )
          return { within, across, recorder, recorderAcross, nobody }
        }),
      ),
    )
    expect(result.within.map((score) => score.state)).toEqual(['scored', 'scored'])
    expect(errorOf<{ _tag: string }>(result.across)?._tag).toBe('ACCESS_DENIED')
    expect(Exit.isSuccess(result.recorder) && result.recorder.value.map((s) => s.state)).toEqual([
      'scored',
    ])
    expect(errorOf<{ _tag: string }>(result.recorderAcross)?._tag).toBe('ACCESS_DENIED')
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
          return { everyone, searched, inClass, reviewer, classA: f.classA }
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
    // where each of them stands, for the picker to spell the way down to it
    expect(result.inClass.rows.map((row) => row.orgNodeId)).toEqual(
      result.inClass.rows.map(() => result.classA),
    )
    expect(errorOf<{ _tag: string }>(result.reviewer)?._tag).toBe('ACCESS_DENIED')
  })

  it('names the kinds of the units it offers to import from', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rc-kinds')
          const assessment = yield* Assessment
          return yield* assessment.scopeOptions(f.t, f.principal(f.admin))
        }),
      ),
    )
    // every kind a unit on offer is of, named, and none that is not
    expect(result.orgTypes.map((type) => type.name)).toEqual(['Class', 'College'])
    expect(new Set(result.nodes.map((node) => node.orgTypeId))).toEqual(
      new Set(result.orgTypes.map((type) => type.id)),
    )
  })
})
