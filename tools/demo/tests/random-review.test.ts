import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { REJECTIONS } from '../catalog.ts'
import { randomOf } from '../seed/context.ts'
import { reviewAtRandom, type Later, type RoundSeen } from '../seed/random-review.ts'

// A claim moved onto a changed route is looked at both by the review
// scheduled when it was sent and by the one the move schedules. Twice a full
// seeding run stopped in its last term because the second found the claim
// passed up, refused it as a first-route claim and queued it to be filed
// again, which the product refused. These drive one turn of the random review
// with a queue and chance of their own.

const NOW = new Date('2025-03-05T20:00:00+08:00')
const HOUR = 3_600_000

interface Judge {
  readonly as: string
  readonly round: RoundSeen
}

const judgeOn = (route: RoundSeen['chain']['route']): Judge => ({
  as: 'class-lead',
  round: { chain: { route } },
})

/**
 * One turn, with `draws` as the only chance there is, a claim standing as
 * `status` says whenever a queued resubmission looks, and a record of what the
 * turn did.
 */
const turnOf = (input: {
  judge: Judge | null
  draws: number[]
  now?: Date
  /** when filing closes; three days on unless given */
  deadline?: Date
}) => {
  const draws = [...input.draws]
  const now = input.now ?? NOW
  const did = {
    refused: [] as { judge: Judge; reason: string }[],
    otherwise: [] as { judge: Judge; roll: number }[],
    queued: [] as { at: Date; label: string; run: () => Effect.Effect<void, unknown, unknown> }[],
    refiled: 0,
    status: 'rejected' as string | undefined,
    /** the draws the turn left untaken */
    draws,
  }
  const queue: Later = {
    now,
    at: (at, label, run) => {
      did.queued.push({ at, label, run })
    },
  }
  const effect = reviewAtRandom({
    judge: Effect.succeed(input.judge),
    random: randomOf(() => {
      const next = draws.shift()
      if (next === undefined) throw new Error('the turn drew more than the script holds')
      return next
    }),
    queue,
    deadline: input.deadline ?? new Date(now.getTime() + 72 * HOUR),
    refuse: (judge, rejection) =>
      Effect.sync(() => {
        did.refused.push({ judge, reason: rejection.reason })
      }),
    standing: () => Effect.sync(() => did.status),
    refile: () =>
      Effect.sync(() => {
        did.refiled++
      }),
    otherwise: (judge, roll) =>
      Effect.sync(() => {
        did.otherwise.push({ judge, roll })
      }),
  })
  return { effect, did }
}

const run = (effect: Effect.Effect<void, unknown, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<void>)

describe('one turn of the random review', () => {
  it('leaves a round passed up to the escalation route to its own walk', async () => {
    // a refusal there is one step's opinion, and the claim stays under review
    const { effect, did } = turnOf({ judge: judgeOn('escalation'), draws: [0.01, 0, 0, 0] })
    await run(effect)
    expect(did.refused).toEqual([])
    expect(did.otherwise).toEqual([])
    expect(did.queued).toEqual([])
    expect(did.draws, 'no chance is drawn for it').toHaveLength(4)
  })

  it('does nothing when nobody at the round’s step may decide it', async () => {
    const { effect, did } = turnOf({ judge: null, draws: [0.01] })
    await run(effect)
    expect([did.refused, did.otherwise, did.queued]).toEqual([[], [], []])
    expect(did.draws).toHaveLength(1)
  })

  it('refuses a first-route round now and then, and queues it filed again before filing closes', async () => {
    const judge = judgeOn('normal')
    // refused, the second reason, filed again, two hours on
    const { effect, did } = turnOf({ judge, draws: [0.01, 0.45, 0.1, 0] })
    await run(effect)
    expect(did.refused).toEqual([{ judge, reason: REJECTIONS[1].reason }])
    expect(did.otherwise).toEqual([])
    expect(did.queued.map(({ at, label }) => ({ at, label }))).toEqual([
      { at: new Date(NOW.getTime() + 2 * HOUR), label: 'revise' },
    ])
    expect(did.draws).toEqual([])
  })

  it('files the claim again only while it still stands refused', async () => {
    const { effect, did } = turnOf({ judge: judgeOn('normal'), draws: [0.01, 0, 0.1, 0] })
    await run(effect)
    const [queued] = did.queued
    for (const status of ['in_review', 'approved', 'needs_revision', 'draft', undefined]) {
      did.status = status
      await run(queued!.run())
      expect(did.refiled, String(status)).toBe(0)
    }
    did.status = 'rejected'
    await run(queued!.run())
    expect(did.refiled).toBe(1)
  })

  it('queues nothing once filing is too close to closing', async () => {
    const deadline = new Date(NOW.getTime() + 5 * HOUR)
    const { effect, did } = turnOf({ judge: judgeOn('normal'), draws: [0.01, 0, 0.1, 0], deadline })
    await run(effect)
    expect(did.refused).toHaveLength(1)
    expect(did.queued).toEqual([])
    expect(did.draws, 'nor draws whether it would be filed again').toHaveLength(2)
  })

  it('queues nothing that would land after filing closes', async () => {
    const deadline = new Date(NOW.getTime() + 7 * HOUR)
    // filed again some twenty-five hours on
    const { effect, did } = turnOf({
      judge: judgeOn('normal'),
      draws: [0.01, 0, 0.1, 0.99],
      deadline,
    })
    await run(effect)
    expect(did.refused).toHaveLength(1)
    expect(did.queued).toEqual([])
  })

  it('leaves a round kept from refusal to the rest of the review, with its roll', async () => {
    const judge = judgeOn('normal')
    const { effect, did } = turnOf({ judge, draws: [0.5, 0] })
    await run(effect)
    expect(did.refused).toEqual([])
    expect(did.otherwise).toEqual([{ judge, roll: 0.5 }])
    expect(did.queued).toEqual([])
    expect(did.draws).toHaveLength(1)
  })
})
