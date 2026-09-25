import { Effect } from 'effect'
import { db } from '../server/db.ts'
import { OPEN_REVIEW_STATES } from '../review/db.ts'
import {
  bumpParticipantAttention,
  cancelReviewInstance,
  insertReviewEvent,
  repointReviewRound,
  setEntryState,
} from './db.ts'

// What taking somebody off a round's roster does to the work still moving on
// their claims (§9, BatchParticipant). Membership is what a participant's every act is made
// of, so the moment it lapses nothing of theirs may stay in motion: a round
// nobody may answer or be told about would wait forever in a reviewer's
// queue, and an ask for more material would wait on a person who can no
// longer give it.

/** the outcome and the round event both say it: the subject left the roster */
export const SUBJECT_EXCLUDED = 'subject-excluded'

/** every round still open on this person's claims, with what each claim stands on */
const openRoundsOfParticipant = (tenantId: string, participantId: string) =>
  db.query((k) =>
    k
      .selectFrom('ReviewInstance as ri')
      .innerJoin('Entry as e', (join) =>
        join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
      )
      .select([
        'ri.id',
        'ri.entryId',
        'ri.roundNo',
        'ri.origin',
        'ri.currentRoute',
        'ri.currentStageId',
        'ri.appealedInstanceId',
        'ri.appealedRecognitionId',
        'ri.appealedEventId',
        'e.status as entryStatus',
        'e.currentRecognitionId',
      ])
      .where('ri.tenantId', '=', tenantId)
      .where('e.participantId', '=', participantId)
      .where('ri.state', 'in', [...OPEN_REVIEW_STATES])
      .orderBy('ri.id')
      .execute(),
  )

/**
 * The conclusion a claim stood on before a reconsidering round opened, when
 * the round itself does not name it: the latest round before it that
 * actually decided something. Continuation rounds and rounds that ended
 * without a verdict are passed over, because the claim never stood on them.
 */
const conclusionBefore = (tenantId: string, entryId: string, beforeRound: number) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select(['id', 'outcome'])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .where('roundNo', '<', beforeRound)
        .where('state', '=', 'completed')
        .where('outcome', 'in', ['approved', 'rejected'])
        .orderBy('roundNo', 'desc')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row ?? null))

/** how one completed round concluded, when it did */
const outcomeOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select('outcome')
        .where('tenantId', '=', tenantId)
        .where('id', '=', instanceId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.outcome ?? null))

/**
 * Ends every open round on an excluded person's claims, inside the
 * transaction that excludes them.
 *
 * Decided by what each round is (ruling of 2026-09-25 #12). A first review
 * is void: the claim goes back to a draft its owner may send again if they
 * are readmitted, as if it had never been handed on. A round reconsidering a
 * settled claim (an appeal, or one reopened by staff) is void too, and the
 * claim keeps exactly the standing it had before the round opened - the
 * same status and the same determination, and the pointer back on the
 * round that concluded it, or on none when it contested a determination or
 * a revocation no round made. Asks for more material close with their
 * round, a sitting panel is dissolved with it, and a round standing blocked
 * at a vacant step ends the same way. Returns the claims that moved, for
 * the caller's announcements.
 */
export const endRoundsOfExcluded = (input: {
  tenantId: string
  participantId: string
  actorId: string
}) =>
  Effect.gen(function* () {
    const { tenantId } = input
    const touched: string[] = []
    for (const round of yield* openRoundsOfParticipant(tenantId, input.participantId)) {
      const ended = yield* cancelReviewInstance({
        tenantId,
        instanceId: round.id,
        outcome: SUBJECT_EXCLUDED,
      })
      if (!ended) continue
      yield* insertReviewEvent({
        tenantId,
        reviewInstanceId: round.id,
        kind: SUBJECT_EXCLUDED,
        actorId: input.actorId,
        route: round.currentRoute as 'normal' | 'escalation',
        stageId: round.currentStageId,
      })
      // What the round was, not what the claim's status happens to say: a
      // round contests a conclusion when it is an appeal or a reopening, or
      // names what it contests (a re-routed one keeps its target), and then
      // the claim goes back to that conclusion. Before appeals stopped
      // moving the claim, a contested claim sat in review during the round,
      // so the status alone cannot tell the two apart.
      const contesting =
        round.origin === 'appeal' ||
        round.origin === 'reopen' ||
        round.appealedInstanceId !== null ||
        round.appealedRecognitionId !== null ||
        round.appealedEventId !== null
      if (!contesting) {
        // a first review, however re-routed: void, back to a draft its
        // owner may send again once readmitted
        yield* setEntryState({
          tenantId,
          entryId: round.entryId,
          from: ['in_review'],
          to: 'draft',
          currentReviewInstanceId: null,
          atRound: round.id,
        })
      } else {
        // the conclusion the round was contesting: the round it names; no
        // round at all for a determination or a revocation it names; and
        // for a round that names nothing, the latest round before it that
        // decided something
        const earlier =
          round.appealedInstanceId !== null ||
          round.appealedRecognitionId !== null ||
          round.appealedEventId !== null
            ? null
            : yield* conclusionBefore(tenantId, round.entryId, round.roundNo)
        const before = round.appealedInstanceId ?? earlier?.id ?? null
        if (round.entryStatus === 'in_review') {
          // a contested claim a round once moved into review: put it back
          // on what it stood as - never to a draft, which would unsay a
          // conclusion nobody reversed
          const stood =
            round.appealedRecognitionId !== null
              ? 'approved'
              : round.appealedEventId !== null
                ? 'rejected'
                : round.appealedInstanceId !== null
                  ? yield* outcomeOf(tenantId, round.appealedInstanceId)
                  : (earlier?.outcome ?? null)
          // an approval stands on a determination, so one without it is
          // left where it is rather than written into a shape the table
          // refuses
          if (
            stood === 'rejected' ||
            (stood === 'approved' && round.currentRecognitionId !== null)
          ) {
            yield* setEntryState({
              tenantId,
              entryId: round.entryId,
              from: ['in_review'],
              to: stood,
              currentReviewInstanceId: before,
              atRound: round.id,
            })
          } else {
            yield* repointReviewRound({
              tenantId,
              entryId: round.entryId,
              from: round.id,
              to: before,
            })
          }
        } else {
          // a claim that is not standing on this round keeps its pointer:
          // the compare-and-set on the pointer leaves it alone
          yield* repointReviewRound({
            tenantId,
            entryId: round.entryId,
            from: round.id,
            to: before,
          })
        }
      }
      yield* bumpParticipantAttention(tenantId, round.entryId)
      touched.push(round.entryId)
    }
    return touched
  })
