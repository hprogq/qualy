import { Effect } from 'effect'
import { REJECTIONS } from '../catalog.ts'
import { addMinutes, type Random } from './context.ts'

// The random review of a claim's first route, as far as refusing it: which
// round it takes up, how often it refuses, and whether the student files the
// claim again before filing closes. Twice a full seeding run stopped in its
// last term because this went wrong on a claim moved onto a changed route
// (see `takenUpAtRandom`), so it stands on its own where a test can drive it
// with a queue and chance of its own.

/** as much of a round as the random review reads */
export interface RoundSeen {
  readonly chain: { readonly route: 'normal' | 'escalation' }
}

/** where the random review puts what it does later */
export interface Later {
  readonly now: Date
  at(at: Date, label: string, run: () => Effect.Effect<void, unknown, unknown>): void
}

export type Rejection = (typeof REJECTIONS)[number]

/**
 * Whether the random review scheduled when a claim was sent takes up the
 * round it finds. A claim moved onto a changed route is looked at both by
 * that review and by the one the move schedules, so one of them can find it
 * already passed up. The escalation route is walked by its own schedule
 * (`decideEscalated` in term.ts): a refusal there is one step's opinion, the
 * claim stays under review, and judging it as a first-route refusal would
 * queue it to be filed again while it cannot be edited.
 */
const takenUpAtRandom = (round: RoundSeen) => round.chain.route === 'normal'

/**
 * Whether a resubmission queued after a refusal goes ahead: only while the
 * claim still stands refused when its moment comes, whatever happened to it
 * in between.
 */
const refilesNow = (status: string | undefined) => status === 'rejected'

/** the share of the rounds taken up that are refused */
const REFUSED = 0.07
/** of the claims refused with time left, the share filed again */
const FILED_AGAIN = 0.65
/** how long before filing closes a refused claim is still filed again */
const TIME_LEFT_MS = 6 * 3_600_000

/**
 * One turn of the random review on a claim's first route. The judge found
 * takes up the round (`takenUpAtRandom`), refuses it now and then and, while
 * filing has time left, queues the student filing it again, which goes ahead
 * only if the claim still stands refused then (`refilesNow`). Whatever else
 * the judge does with the round is `otherwise`, given the roll that decided
 * against refusing.
 */
export const reviewAtRandom = <J extends { readonly round: RoundSeen }>(turn: {
  /** the first person at the round's step who may decide it, or null */
  readonly judge: Effect.Effect<J | null, unknown, unknown>
  readonly random: Random
  readonly queue: Later
  /** when filing closes */
  readonly deadline: Date
  readonly refuse: (judge: J, rejection: Rejection) => Effect.Effect<void, unknown, unknown>
  /** the claim's status as it stands when the resubmission's moment comes */
  readonly standing: () => Effect.Effect<string | undefined, unknown, unknown>
  readonly refile: () => Effect.Effect<void, unknown, unknown>
  readonly otherwise: (judge: J, roll: number) => Effect.Effect<void, unknown, unknown>
}): Effect.Effect<void, unknown, unknown> =>
  Effect.gen(function* () {
    const { random, queue, deadline } = turn
    const judge = yield* turn.judge
    if (judge === null || !takenUpAtRandom(judge.round)) return
    const roll = random.next()
    if (roll >= REFUSED) return yield* turn.otherwise(judge, roll)
    yield* turn.refuse(judge, random.weighted(REJECTIONS))
    const timeLeft = queue.now.getTime() < deadline.getTime() - TIME_LEFT_MS
    if (!timeLeft || !random.chance(FILED_AGAIN)) return
    const when = addMinutes(queue.now, random.int(120, 26 * 60))
    if (when >= deadline) return
    queue.at(when, 'revise', () =>
      Effect.gen(function* () {
        if (refilesNow(yield* turn.standing())) yield* turn.refile()
      }),
    )
  })
