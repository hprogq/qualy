import { sql } from 'kysely'
import { Effect, Exit, Fiber } from 'effect'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { probeHold, probeLevelScoring, probeScoring } from './support/catalogs.ts'
import {
  errorOf,
  GATED,
  ok,
  one,
  reasonsOf,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// A determination is proven against the question's arithmetic before it
// becomes a fact, and only then.
//
// Three doors write a determination - a reviewer's last word, the office
// recording one, the rule approving a claim nobody reviews - and each asks
// the calculator first, outside the transaction that would write. What the
// calculator says decides what the person gets back: a lawful refusal in the
// rule's own words, an outage to retry, or a defect that is nobody's to act
// on. Whichever it is, nothing was written. And the words on the way to the
// last one prove nothing: an opinion is not a fact.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

const at = (f: Seeded, id: string) => ({
  id,
  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
  quorum: { type: 'any' },
})

const recognitionsOf = (entryId: string) =>
  Effect.map(
    runSql(sql`select id from entry_recognitions where entry_id = ${entryId}`),
    (result) => (result as { rows: { id: string }[] }).rows,
  )

const entryOf = (entryId: string) =>
  Effect.map(
    runSql(
      sql`select status, current_recognition_id as "recognitionId" from entries where id = ${entryId}`,
    ),
    (result) => one<{ status: string; recognitionId: string | null }>(result),
  )

const roundOf = (instanceId: string) =>
  Effect.map(
    runSql(sql`
      select state, current_stage_id as "stageId",
             (select array_agg(kind order by created_at) from review_events where review_instance_id = ${instanceId}) as kinds
      from review_instances where id = ${instanceId}`),
    (result) => one<{ state: string; stageId: string; kinds: string[] | null }>(result),
  )

const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
  errorOf<{ _tag?: string; reason?: string; itemId?: string }>(exit)

/** whether the run died rather than failing with a word anybody chose */
const died = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) &&
  reasonsOf(exit).length > 0 &&
  reasonsOf(exit).every((reason) => (reason as { _tag?: string })._tag === 'Die')

/** the claim as filed, and the round it opened */
const claimed = (
  f: Seeded,
  g: { item: { id: string } },
  participantId: string,
  who: string = f.s1,
  level: 'national' | 'provincial' = 'national',
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const as = f.principal(who)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: g.item.id, participantId, payload: { 'claimed-level-slot': level } },
      as,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
    return { entryId: entry.id, instanceId: sent.currentReviewInstanceId! }
  })

const determination = (ordinal: number, level: 'national' | 'provincial' = 'national') => ({
  values: { 'rec-level': level, 'rec-ordinal': ordinal },
})

/** an accepted source carrying review.process, the way a sync would write it */
const accept = (t: string, batchId: string, subjectId: string, assignmentId: string) =>
  runSql(sql`
    with s as (
      insert into batch_access_sources (tenant_id, batch_id, role_assignment_id, subject_id, origin)
      values (${t}, ${batchId}, ${assignmentId}, ${subjectId}, 'explicit')
      returning tenant_id, id
    )
    insert into batch_access_source_permissions (tenant_id, source_id, permission_code)
    select tenant_id, id, 'assessment.review.process' from s`)

/** one more person holding a role at class A, accepted into the round */
const appoint = (f: Seeded, batchId: string, name: string, role: string) =>
  Effect.gen(function* () {
    const who = one<{ id: string }>(
      yield* runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${f.t}, ${name}, ${f.studentType}, ${f.classA}) returning id`),
    ).id
    const grant = one<{ id: string }>(
      yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${f.t}, ${who}, ${role}, ${f.classA}, 'self') returning id`),
    ).id
    yield* accept(f.t, batchId, who, grant)
    return who
  })

/** a question the office records against, scored by the probing rule */
const recordItem = (f: Seeded, batchId: string, over: { maxEntries: number | null }) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'evidence',
        title: '竞赛加分',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: over.maxEntries,
        config: {
          entrySource: 'administrative',
          formConfig: {},
          scoringConfig: probeScoring(),
          reviewPolicy: {
            normal: { stages: [at(f, 's1')] },
            escalation: { stages: [at(f, 'appeal')] },
          },
        },
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    return item
  })

/** holds every probe with ordinal 6 until the suite lets go */
const holding = () => {
  let release: () => void = () => undefined
  probeHold.until = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => release()
}

const settle = (ms: number) => Effect.promise(() => new Promise((r) => setTimeout(r, ms)))

describe.runIf(postgresAvailable)('proving a determination before it is a fact', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-determination-probe')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })
  afterEach(() => {
    probeHold.until = Promise.resolve()
  })

  it("refuses a last word the rule will not score, in the rule's words, and writes nothing", async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-terminal')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          const decide = (ordinal: number) =>
            Effect.exit(
              assessment.decideReview(
                f.t,
                instanceId,
                { decision: 'approve', recognition: determination(ordinal) },
                f.principal(f.reviewer),
              ),
            )
          const refused = yield* decide(7)
          const afterRefusal = {
            round: yield* roundOf(instanceId),
            entry: yield* entryOf(entryId),
            rows: yield* recognitionsOf(entryId),
          }
          const outage = yield* decide(8)
          const broken = yield* decide(9)
          const afterAll = { entry: yield* entryOf(entryId), rows: yield* recognitionsOf(entryId) }
          // and a determination the rule accepts settles as before
          const settled = yield* decide(3)
          return {
            refused: tagOf(refused),
            afterRefusal,
            outage: tagOf(outage),
            brokenDied: died(broken),
            afterAll,
            settled: Exit.isSuccess(settled),
            after: { entry: yield* entryOf(entryId), rows: yield* recognitionsOf(entryId) },
            itemId: g.item.id,
          }
        }),
      ),
    )

    // the rule's own sentence, for the person who tried to determine
    expect(result.refused?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    expect(result.refused?.reason).toBe('only the first 5 are recognised')
    expect(result.refused?.itemId).toBe(result.itemId)
    // the round stands where it stood, the claim is still in review, and
    // no word was written - not the approval, not the determination
    expect(result.afterRefusal.round.state).toBe('active')
    expect(result.afterRefusal.round.kinds).toEqual(['submitted'])
    expect(result.afterRefusal.entry.status).toBe('in_review')
    expect(result.afterRefusal.rows).toEqual([])
    // an outage is said as one, and a broken program is nobody's decision
    expect(result.outage?._tag).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
    expect(result.brokenDied).toBe(true)
    expect(result.afterAll.entry.status).toBe('in_review')
    expect(result.afterAll.rows).toEqual([])
    expect(result.settled).toBe(true)
    expect(result.after.entry.status).toBe('approved')
    expect(result.after.rows).toHaveLength(1)
  }, 120_000)

  it('lets an opinion on the way carry what the rule refuses, and holds the last word to it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-opinion')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            scoring: probeScoring(),
            stages: [at(f, 'class'), at(f, 'dept')],
          })
          const second = yield* appoint(f, g.batch.id, 'Second reader', f.reviewRole)
          const { entryId, instanceId } = yield* claimed(f, g, g.p1)
          // the first reader's opinion: the rule would refuse it, and that is
          // the next reader's to correct - an opinion decides nothing
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve', recognition: determination(7) },
            f.principal(f.reviewer),
          )
          const moved = yield* roundOf(instanceId)
          // the last word carrying the same determination is held to the rule
          const refused = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              {
                decision: 'approve',
                recognition: { values: determination(7).values, reason: '同意' },
              },
              f.principal(second),
            ),
          )
          return {
            moved,
            refused: tagOf(refused),
            round: yield* roundOf(instanceId),
            rows: yield* recognitionsOf(entryId),
          }
        }),
      ),
    )

    expect(result.moved.stageId).toBe('dept')
    expect(result.moved.kinds).toEqual(['submitted', 'approved'])
    expect(result.refused?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    expect(result.round.state).toBe('active')
    expect(result.round.stageId).toBe('dept')
    expect(result.rows).toEqual([])
  }, 120_000)

  it('refuses an office record the rule will not score, before there is a row', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-record')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const item = yield* recordItem(f, g.batch.id, { maxEntries: null })
          const record = (ordinal: number) =>
            Effect.exit(
              assessment.createEntry(
                f.t,
                {
                  itemId: item.id,
                  participantId: g.p1,
                  payload: {},
                  note: 'the register, page 3',
                  recognition: determination(ordinal),
                },
                f.principal(f.recorder),
              ),
            )
          const refused = yield* record(7)
          const outage = yield* record(8)
          const broken = yield* record(9)
          const count = one<{ count: string }>(
            yield* runSql(
              sql`select count(*)::text as "count" from entries where item_id = ${item.id}`,
            ),
          ).count
          const recorded = yield* record(2)
          return {
            refused: tagOf(refused),
            outage: tagOf(outage),
            brokenDied: died(broken),
            count,
            recorded: Exit.isSuccess(recorded),
          }
        }),
      ),
    )
    expect(result.refused?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    expect(result.outage?._tag).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
    expect(result.brokenDied).toBe(true)
    // no row of any kind: the record never began
    expect(result.count).toBe('0')
    expect(result.recorded).toBe(true)
  }, 120_000)

  it('refuses to approve by rule a claim the rule will not score', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-by-rule')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const ask = (title: string, scoring: unknown) =>
            Effect.gen(function* () {
              const item = yield* assessment.createItem(
                f.t,
                g.batch.id,
                {
                  itemType: 'evidence',
                  title,
                  scoreGroupId: groups.groups[0]!.id,
                  maxEntries: null,
                  config: {
                    entrySource: 'student',
                    formConfig: {},
                    scoringConfig: scoring,
                    reviewPolicy: { mode: 'none' },
                  },
                },
                admin,
              )
              yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
              return item
            })
          const refusing = yield* ask('省级不认', probeLevelScoring({ refuseLevel: 'provincial' }))
          const outAt = yield* ask('省级暂停', probeLevelScoring({ outageLevel: 'provincial' }))
          const as = f.principal(f.s1)
          const file = (itemId: string, level: string) =>
            Effect.gen(function* () {
              const entry = yield* assessment.createEntry(
                f.t,
                { itemId, participantId: g.p1, payload: { 'claimed-level-slot': level } },
                as,
              )
              const sent = yield* Effect.exit(
                assessment.setEntryStatus(f.t, entry.id, 'in_review', as),
              )
              return {
                sent,
                entry: yield* entryOf(entry.id),
                rows: yield* recognitionsOf(entry.id),
              }
            })
          const refused = yield* file(refusing.id, 'provincial')
          const outage = yield* file(outAt.id, 'provincial')
          const accepted = yield* file(outAt.id, 'national')
          return { refused, outage, accepted }
        }),
      ),
    )
    // the claim stays a draft with nothing determined: no approval by a
    // rule that would not score it
    expect(tagOf(result.refused.sent)?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    expect(result.refused.entry.status).toBe('draft')
    expect(result.refused.rows).toEqual([])
    expect(tagOf(result.outage.sent)?._tag).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
    expect(result.outage.entry.status).toBe('draft')
    expect(result.outage.rows).toEqual([])
    expect(Exit.isSuccess(result.accepted.sent)).toBe(true)
    expect(result.accepted.entry.status).toBe('approved')
    expect(result.accepted.rows).toHaveLength(1)
  }, 120_000)

  it('holds the settlement to the question and the round the proof was made under', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-moved')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const first = yield* claimed(f, g, g.p1)

          // the question moves while the proof is being made
          let release = holding()
          const deciding = yield* Effect.forkChild(
            Effect.exit(
              assessment.decideReview(
                f.t,
                first.instanceId,
                { decision: 'approve', recognition: determination(6) },
                f.principal(f.reviewer),
              ),
            ),
          )
          yield* settle(400)
          yield* assessment.updateItem(
            f.t,
            g.item.id,
            {
              config: {
                entrySource: 'student',
                formConfig: { files: {} },
                scoringConfig: probeScoring({ maxOrdinal: 7 }),
                reviewPolicy: {
                  normal: { stages: [at(f, 'class')] },
                  escalation: { stages: [] },
                },
              },
              reason: 'the window widens',
            },
            admin,
          )
          release()
          const questionMoved = yield* Fiber.join(deciding)
          const afterQuestion = {
            round: yield* roundOf(first.instanceId),
            rows: yield* recognitionsOf(first.entryId),
          }

          // the round moves while the proof is being made
          const second = yield* claimed(f, g, g.p2, f.s2)
          release = holding()
          const decidingAgain = yield* Effect.forkChild(
            Effect.exit(
              assessment.decideReview(
                f.t,
                second.instanceId,
                { decision: 'approve', recognition: determination(6) },
                f.principal(f.reviewer),
              ),
            ),
          )
          yield* settle(400)
          yield* assessment.interveneOnEntry(
            f.t,
            second.entryId,
            { kind: 'return-for-revision', reason: 'sent back by the office' },
            admin,
          )
          release()
          const roundMoved = yield* Fiber.join(decidingAgain)
          return {
            questionMoved: tagOf(questionMoved),
            afterQuestion,
            roundMoved: tagOf(roundMoved),
            afterRound: yield* recognitionsOf(second.entryId),
          }
        }),
      ),
    )

    // a proof made under the old rule is no proof under the new one: the
    // question is named as having moved, and nothing was written
    expect(result.questionMoved?._tag).toBe('ASSESSMENT_ITEM_REVISION_CONFLICT')
    expect(result.afterQuestion.round.state).toBe('active')
    expect(result.afterQuestion.rows).toEqual([])
    // and a round that concluded under the proof takes no more words
    expect(result.roundMoved?._tag).toBe('ASSESSMENT_REVIEW_CONFLICT')
    expect(result.afterRound).toEqual([])
  }, 120_000)

  it('lets a record land beside one that arrived while it was being proven', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-beside')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const item = yield* recordItem(f, g.batch.id, { maxEntries: 5 })
          const record = (ordinal: number) =>
            assessment.createEntry(
              f.t,
              {
                itemId: item.id,
                participantId: g.p1,
                payload: {},
                note: 'the register',
                recognition: determination(ordinal),
              },
              f.principal(f.recorder),
            )
          const release = holding()
          const slow = yield* Effect.forkChild(Effect.exit(record(6)))
          yield* settle(400)
          // another record for the same person lands in the meantime: the
          // count the first one read is stale, and still nowhere near the
          // limit - a fact that moved without touching the proof
          const quick = yield* record(2)
          release()
          const landed = yield* Fiber.join(slow)
          const count = one<{ count: string }>(
            yield* runSql(
              sql`select count(*)::text as "count" from entries where item_id = ${item.id} and status = 'approved'`,
            ),
          ).count
          return {
            quick: quick.status,
            landed: Exit.isSuccess(landed),
            landedWith: tagOf(landed),
            count,
          }
        }),
      ),
    )
    expect(result.quick).toBe('approved')
    expect(result.landedWith).toBeUndefined()
    expect(result.landed).toBe(true)
    expect(result.count).toBe('2')
  }, 120_000)

  it('proves a sitting on its first ballot and again on the one that concludes it', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('dp-panel')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const panelRole = one<{ id: string }>(
            yield* runSql(sql`
              insert into roles (tenant_id, code, name, kind, status, anchor_mode)
              values (${f.t}, 'grade-panel', 'Grade panel', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`
            insert into role_permissions (tenant_id, role_id, permission_id)
            select ${f.t}, ${panelRole}, p.id from permissions p
            where p.code = 'assessment.review.process'`)
          const b1 = yield* appoint(f, g.batch.id, 'B1', panelRole)
          const b2 = yield* appoint(f, g.batch.id, 'B2', panelRole)
          const b3 = yield* appoint(f, g.batch.id, 'B3', panelRole)
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const config = (scoring: unknown) => ({
            entrySource: 'student' as const,
            formConfig: {},
            scoringConfig: scoring,
            reviewPolicy: {
              normal: {
                stages: [
                  {
                    id: 'n1',
                    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [panelRole] },
                    quorum: { type: 'any' },
                  },
                ],
              },
              escalation: {
                stages: [
                  {
                    id: 'g1',
                    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [panelRole] },
                    quorum: { type: 'all' },
                  },
                  {
                    id: 'd2',
                    selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
                    quorum: { type: 'any' },
                  },
                ],
              },
            },
          })
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '需合议的题',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: config(probeScoring()),
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
          const { entryId, instanceId } = yield* claimed(f, { item }, g.p1)
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'escalate', comment: '提请合议' },
            f.principal(b1),
          )
          const ballots = () =>
            Effect.map(
              runSql(sql`
                select count(*)::text as "count" from review_votes v
                join review_panels p on p.id = v.panel_id
                where p.review_instance_id = ${instanceId}`),
              (rows) => one<{ count: string }>(rows).count,
            )
          const frozen = () =>
            Effect.map(
              runSql(sql`
                select recognition_locked_at is not null as "locked" from review_panels
                where review_instance_id = ${instanceId} and state = 'open'`),
              (rows) => one<{ locked: boolean }>(rows).locked,
            )

          // the first approving ballot would fix a text the rule refuses:
          // no text is fixed, and the ballot itself is not cast
          const firstRefused = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve', recognition: determination(7) },
              f.principal(b2),
            ),
          )
          const afterFirst = { ballots: yield* ballots(), frozen: yield* frozen() }
          // a text the rule accepts is fixed by the first ballot
          yield* assessment.decideReview(
            f.t,
            instanceId,
            { decision: 'approve', recognition: determination(3) },
            f.principal(b2),
          )
          const afterFixed = { ballots: yield* ballots(), frozen: yield* frozen() }
          // the rule tightens under the sitting
          yield* assessment.updateItem(
            f.t,
            item.id,
            { config: config(probeScoring({ maxOrdinal: 2 })), reason: 'the window narrows' },
            admin,
          )
          // the ballot that would conclude the sitting is proven against the
          // rule as it stands now, not the one the text was fixed under
          const lastRefused = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              instanceId,
              { decision: 'approve', recognition: determination(3) },
              f.principal(b3),
            ),
          )
          return {
            firstRefused: tagOf(firstRefused),
            afterFirst,
            afterFixed,
            lastRefused: tagOf(lastRefused),
            after: {
              ballots: yield* ballots(),
              round: yield* roundOf(instanceId),
              rows: yield* recognitionsOf(entryId),
            },
          }
        }),
      ),
    )

    expect(result.firstRefused?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    expect(result.afterFirst).toEqual({ ballots: '0', frozen: false })
    expect(result.afterFixed).toEqual({ ballots: '1', frozen: true })
    expect(result.lastRefused?._tag).toBe('ASSESSMENT_DETERMINATION_REFUSED')
    // the sitting stands open with its one ballot; the round concluded nothing
    expect(result.after.ballots).toBe('1')
    expect(result.after.round.state).toBe('active')
    expect(result.after.rows).toEqual([])
  }, 120_000)
})
