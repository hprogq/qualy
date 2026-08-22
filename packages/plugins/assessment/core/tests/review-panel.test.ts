import { sql } from 'kysely'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { GATED, ok, one, run, runningBatch, seed, type Seeded } from './support/round.ts'

// The sitting (§32.66): an escalation middle step whose quorum is `all`.
//
// Constituted from whoever is independent when the round arrives, frozen at
// that size, replaceable seat by seat, resolved only when every seat has
// spoken - unanimous approval settles the round, anything else climbs with
// the opinions attached. Everything here attacks that constitution: the
// freeze, the blindness, the replacement rules, and the one dissolution
// (fresh evidence) that hands the same people the question again.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

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

/**
 * One round standing at a two-seat sitting: three holders of the panel
 * role, one of whom walked the ordinary route and escalated - which is what
 * shrinks the sitting to the two who have not yet judged.
 */
const panelWorld = (f: Seeded) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
    const admin = f.principal(f.admin)
    const panelRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'grade-panel', 'Grade panel', 'org', 'active', 'allow-list') returning id`),
    ).id
    const closerRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'closer', 'Closer', 'org', 'active', 'allow-list') returning id`),
    ).id
    for (const role of [panelRole, closerRole]) {
      yield* runSql(sql`
        insert into role_permissions (tenant_id, role_id, permission_id)
        select ${f.t}, ${role}, p.id from permissions p
        where p.code = 'assessment.review.process'`)
    }
    const appointAs = (name: string, role: string) =>
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
        yield* accept(f.t, g.batch.id, who, grant)
        return { who, grant }
      })
    const b1 = yield* appointAs('B1', panelRole)
    const b2 = yield* appointAs('B2', panelRole)
    const b3 = yield* appointAs('B3', panelRole)
    const closer = yield* appointAs('Closer', closerRole)
    const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
    const item = yield* assessment.createItem(
      f.t,
      g.batch.id,
      {
        itemType: 'evidence',
        title: '需合议的题',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: 1,
        config: {
          entrySource: 'student',
          formConfig: {},
          scoringConfig: {
            calculator: { ref: 'fixed@1', config: { value: '1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: {
            normal: {
              stages: [
                {
                  id: 'n1',
                  label: '初审',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [panelRole] },
                  quorum: { type: 'any' },
                },
              ],
            },
            escalation: {
              stages: [
                {
                  id: 'g1',
                  label: '合议复核',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [panelRole] },
                  quorum: { type: 'all' },
                },
                {
                  id: 'd2',
                  label: '终审',
                  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [closerRole] },
                  quorum: { type: 'any' },
                },
              ],
            },
          },
        },
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    const s1 = f.principal(f.s1)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: item.id, participantId: g.p1, payload: {} },
      s1,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
    const instanceId = sent.currentReviewInstanceId!
    // B1 walks the ordinary step and escalates: the sitting is the other two
    yield* assessment.decideReview(
      f.t,
      instanceId,
      { decision: 'escalate', comment: '拿不准，提请合议' },
      f.principal(b1.who),
    )
    return {
      batchId: g.batch.id,
      instanceId,
      entryId: entry.id,
      // the escalator: seated nowhere, spent for this round
      b1: b1.who,
      b2: b2.who,
      b3: b3.who,
      b2Grant: b2.grant,
      b3Grant: b3.grant,
      // the ladder's last rung
      closer: closer.who,
      panelRole,
      appoint: (name: string) => appointAs(name, panelRole),
    }
  })

describe.runIf(postgresAvailable)('the sitting', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-review-panel')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('constitutes itself from the independent, freezes its size, and seals its ballots', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-constitute')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          const panel = one<{ id: string; seat_count: number; state: string }>(
            yield* runSql(sql`
              select id, seat_count, state from review_panels
              where review_instance_id = ${w.instanceId} and state = 'open'`),
          )
          const queueOf = (who: string) =>
            Effect.map(
              assessment.listReviewInbox(f.t, { batchId: w.batchId }, f.principal(who)),
              (page) => ({
                ids: page.items.map((row) => row.instanceId),
                handledToday: page.handledToday,
              }),
            )
          const b1Before = yield* queueOf(w.b1)
          const b2Before = yield* queueOf(w.b2)
          const b3Before = yield* queueOf(w.b3)
          // one ballot goes in: the round stands, the voter's turn ends
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b2),
          )
          const b2After = yield* queueOf(w.b2)
          const b3After = yield* queueOf(w.b3)
          const still = one<{ state: string }>(
            yield* runSql(sql`select state from review_instances where id = ${w.instanceId}`),
          )
          // the unvoted member reads the round and learns nothing of the ballot
          const asB3 = yield* assessment.getReviewInstance(f.t, w.instanceId, f.principal(w.b3))
          return { panel, b1Before, b2Before, b3Before, b2After, b3After, still, asB3 }
        }),
      ),
    )

    // three hold the role; the escalator is spent; two seats sit
    expect(result.panel.seat_count).toBe(2)
    expect(result.b1Before.ids).toEqual([])
    expect(result.b2Before.ids).toContain(result.asB3.id)
    expect(result.b3Before.ids).toContain(result.asB3.id)
    // a ballot ends its voter's turn without moving the round
    expect(result.b2After.ids).toEqual([])
    expect(result.b3After.ids).toContain(result.asB3.id)
    expect(result.still.state).toBe('active')
    // and the day counted it, though no event exists yet
    expect(result.b2After.handledToday).toBe(1)
    // the sealed ballot: no opinion on the chain, no event in the trail
    const g1 = result.asB3.chain.escalation.find((stage) => stage.id === 'g1')
    expect(g1?.label).toBe('合议复核')
    expect(g1?.opinions).toBeNull()
    expect(result.asB3.events.map((event) => event.kind)).toEqual(['submitted', 'escalated'])
  })

  it('approves only when every seat agrees, and the round itself says so', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-unanimous')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve', comment: '材料充分' },
            f.principal(w.b2),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b3),
          )
          const entry = one<{ status: string }>(
            yield* runSql(sql`select status from entries where id = ${w.entryId}`),
          )
          const votes = yield* runSql(sql`
            select decision from review_votes v
            join review_panels p on p.id = v.panel_id
            where p.review_instance_id = ${w.instanceId} order by v.created_at`)
          // the vote is the voter's own act, so it is their feed's to tell
          const feed = yield* assessment.listMyActivity(f.t, w.batchId, {}, f.principal(w.b2))
          return {
            settled,
            entry,
            votes: (votes as { rows: { decision: string }[] }).rows.map((row) => row.decision),
            feed: feed.items,
          }
        }),
      ),
    )

    expect(result.settled.state).toBe('completed')
    expect(result.settled.outcome).toBe('approved')
    expect(result.entry.status).toBe('approved')
    expect(result.votes).toEqual(['approve', 'approve'])
    // the conclusion belongs to the sitting, not to whoever voted last
    const conclusion = result.settled.events[result.settled.events.length - 1]!
    expect(conclusion.kind).toBe('approved')
    expect(conclusion.actorId).toBeNull()
    // the voter's feed tells the vote as a vote, never as the verdict, and
    // hands out no door into the finished round (§32.74)
    expect(result.feed.map((one) => one.kind)).toEqual(['review-vote-approved'])
    expect(result.feed[0]!.perspective).toBe('reviewer')
    expect(result.feed[0]!.instanceId).toBeNull()
  })

  it('climbs on any dissent, with every opinion attached for the next judge', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-split')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve', comment: '我认为可以认定' },
            f.principal(w.b2),
          )
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'reject', comment: '日期超出认定范围' },
            f.principal(w.b3),
          )
          // the last rung reads both minds before making up its own
          const asCloser = yield* assessment.getReviewInstance(
            f.t,
            w.instanceId,
            f.principal(w.closer),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'reject', comment: '采纳异议，不予认定' },
            f.principal(w.closer),
          )
          return { asCloser, settled }
        }),
      ),
    )

    expect(result.asCloser.chain.stageId).toBe('d2')
    const g1 = result.asCloser.chain.escalation.find((stage) => stage.id === 'g1')
    expect(g1?.opinions?.map((opinion) => opinion.decision).sort()).toEqual(['approve', 'reject'])
    expect(g1?.opinions?.map((opinion) => opinion.comment)).toContain('日期超出认定范围')
    // the climb is the sitting's own word
    const climbed = result.asCloser.events[result.asCloser.events.length - 1]!
    expect(climbed.kind).toBe('escalated')
    expect(climbed.actorId).toBeNull()
    expect(result.settled.outcome).toBe('rejected')
  })

  it('lets one member pull the matter up, ending the sitting at once', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-pull-up')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b2),
          )
          const pulled = yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'escalate', comment: '超出本环节判断范围' },
            f.principal(w.b3),
          )
          const panel = one<{ state: string; resolution: string }>(
            yield* runSql(sql`
              select state, resolution from review_panels
              where review_instance_id = ${w.instanceId}`),
          )
          const b2Gone = yield* Effect.exit(
            assessment.getReviewInstance(f.t, w.instanceId, f.principal(w.b2)),
          )
          return { pulled, panel, b2Gone }
        }),
      ),
    )

    expect(result.pulled.chain.stageId).toBe('d2')
    expect(result.panel).toEqual({ state: 'resolved', resolution: 'escalated' })
    // the other member's turn ended with the sitting
    expect(result.b2Gone._tag).toBe('Failure')
  })

  it('keeps a cast vote through its voter’s fall, refills only empty seats, and never widens', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-seats')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b2),
          )
          // the voter falls: the ballot stands, nothing blocks
          yield* runSql(sql`update role_grants set revoked_at = now() where id = ${w.b2Grant}`)
          yield* assessment.patrolReviewRounds
          const afterVoterFell = one<{ state: string }>(
            yield* runSql(sql`select state from review_instances where id = ${w.instanceId}`),
          )
          // the unvoted member falls too: the seat empties and nobody is left
          yield* runSql(sql`update role_grants set revoked_at = now() where id = ${w.b3Grant}`)
          yield* assessment.patrolReviewRounds
          const parked = one<{ state: string; blocked_reason: string }>(
            yield* runSql(sql`
              select state, blocked_reason from review_instances where id = ${w.instanceId}`),
          )
          // a fresh judge takes the empty seat; the sitting stays two seats
          const b4 = yield* w.appoint('B4')
          yield* assessment.patrolReviewRounds
          const healed = one<{ state: string; blocked_reason: string | null }>(
            yield* runSql(sql`
              select state, blocked_reason from review_instances where id = ${w.instanceId}`),
          )
          const b4Queue = yield* Effect.map(
            assessment.listReviewInbox(f.t, { batchId: w.batchId }, f.principal(b4.who)),
            (page) => page.items.map((row) => row.instanceId),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(b4.who),
          )
          const seats = yield* runSql(sql`
            select pa.seat_no, u.display_name as who, pa.ended_reason
            from review_panel_assignments pa
            join review_panels p on p.id = pa.panel_id
            join users u on u.id = pa.user_id
            where p.review_instance_id = ${w.instanceId}
            order by pa.assigned_at`)
          const size = one<{ seat_count: number }>(
            yield* runSql(sql`
              select seat_count from review_panels where review_instance_id = ${w.instanceId}`),
          )
          return {
            afterVoterFell,
            parked,
            healed,
            b4Queue,
            settled,
            size,
            seats: (
              seats as { rows: { seat_no: number; who: string; ended_reason: string | null }[] }
            ).rows,
          }
        }),
      ),
    )

    // permission answers new acts, never past lawful ones
    expect(result.afterVoterFell.state).toBe('active')
    expect(result.parked).toEqual({ state: 'blocked', blocked_reason: 'panel-seat-unfilled' })
    expect(result.healed).toEqual({ state: 'active', blocked_reason: null })
    expect(result.b4Queue).toContain(result.settled.id)
    // two of the sitting's judgments: the fallen voter's and the newcomer's
    expect(result.settled.outcome).toBe('approved')
    expect(result.size.seat_count).toBe(2)
    // the seat's story: constituted, emptied for cause, taken over
    expect(result.seats.map((seat) => [seat.who, seat.ended_reason])).toEqual([
      ['B2', null],
      ['B3', 'eligibility-lost'],
      ['B4', null],
    ])
  })

  it('admits no newcomer while every seat is held', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-no-widen')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          const b4 = yield* w.appoint('B4')
          const b4Queue = yield* Effect.map(
            assessment.listReviewInbox(f.t, { batchId: w.batchId }, f.principal(b4.who)),
            (page) => page.items.map((row) => row.instanceId),
          )
          const b4Tried = yield* Effect.exit(
            assessment.decideReview(
              f.t,
              w.instanceId,
              { decision: 'approve' },
              f.principal(b4.who),
            ),
          )
          return { b4Queue, b4Tried }
        }),
      ),
    )

    // the sitting was constituted without them and has no empty seat: the
    // case is not theirs, however valid their role
    expect(result.b4Queue).toEqual([])
    expect(result.b4Tried._tag).toBe('Failure')
  })

  it('dissolves over fresh evidence and asks everyone again; a cancelled ask changes nothing', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pn-supplement')
          const assessment = yield* Assessment
          const w = yield* panelWorld(f)
          const s1 = f.principal(f.s1)
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b2),
          )
          const firstPanel = one<{ id: string }>(
            yield* runSql(sql`
              select id from review_panels
              where review_instance_id = ${w.instanceId} and state = 'open'`),
          ).id
          // an ask taken back returns the round exactly as it stood
          yield* assessment.requestSupplement(
            f.t,
            w.instanceId,
            {
              instructions: '请补充获奖证书原件',
              requirements: [{ label: '证书原件', kind: 'text', required: true }],
            },
            f.principal(w.b3),
          )
          const asked = yield* assessment.getReviewInstance(f.t, w.instanceId, f.principal(w.b3))
          const openAsk = asked.supplements.find((ask) => ask.status === 'open')!
          yield* assessment.cancelSupplement(f.t, openAsk.id, f.principal(w.b3))
          const afterCancel = one<{ id: string }>(
            yield* runSql(sql`
              select id from review_panels
              where review_instance_id = ${w.instanceId} and state = 'open'`),
          ).id
          const b2StillSpent = yield* Effect.map(
            assessment.listReviewInbox(f.t, { batchId: w.batchId }, f.principal(w.b2)),
            (page) => page.items.map((row) => row.instanceId),
          )
          // an ask answered changes the evidence: the sitting dissolves and
          // the same people are asked again, ballots and all
          yield* assessment.requestSupplement(
            f.t,
            w.instanceId,
            {
              instructions: '请补充说明获奖时间',
              requirements: [{ label: '说明', kind: 'text', required: true }],
            },
            f.principal(w.b3),
          )
          const askedAgain = yield* assessment.getReviewInstance(
            f.t,
            w.instanceId,
            f.principal(w.b3),
          )
          const secondAsk = askedAgain.supplements.find((ask) => ask.status === 'open')!
          yield* assessment.answerSupplement(
            f.t,
            secondAsk.id,
            { payload: { f1: '2026 年 5 月获奖' } },
            s1,
          )
          const panels = yield* runSql(sql`
            select id, state, seat_count from review_panels
            where review_instance_id = ${w.instanceId} order by created_at`)
          const b2Again = yield* Effect.map(
            assessment.listReviewInbox(f.t, { batchId: w.batchId }, f.principal(w.b2)),
            (page) => page.items.map((row) => row.instanceId),
          )
          yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b2),
          )
          const settled = yield* assessment.decideReview(
            f.t,
            w.instanceId,
            { decision: 'approve' },
            f.principal(w.b3),
          )
          return {
            firstPanel,
            afterCancel,
            b2StillSpent,
            panels: (panels as { rows: { id: string; state: string; seat_count: number }[] }).rows,
            b2Again,
            settled,
          }
        }),
      ),
    )

    // cancelling restored the very same sitting, ballots intact
    expect(result.afterCancel).toBe(result.firstPanel)
    expect(result.b2StillSpent).toEqual([])
    // answering dissolved it and constituted a fresh one, same size
    expect(result.panels.map((panel) => panel.state).sort()).toEqual(['open', 'superseded'])
    expect(result.panels.every((panel) => panel.seat_count === 2)).toBe(true)
    // the earlier voter is asked again, and this time it settles
    expect(result.b2Again).toContain(result.settled.id)
    expect(result.settled.outcome).toBe('approved')
  })
})
