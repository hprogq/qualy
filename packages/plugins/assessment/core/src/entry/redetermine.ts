import { Effect } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import {
  BatchNotFound,
  BatchReadOnly,
  DeterminationRefused,
  EntryActionRefused,
  EntryNotFound,
  EntryPayloadInvalid,
  ItemRevisionConflict,
  ScoringUnavailable,
} from '../errors.ts'
import { itemOf, revisionOf } from '../item/db.ts'
import { announce } from '../live/events.ts'
import { ScoringRuntimeCatalog } from '../plugin.ts'
import { readScoringPlan } from '../scoring/plan.ts'
import { provenRecognition } from '../scoring/proven-recognition.ts'
import { canonicalRecognition, recognitionHash } from '../scoring/recognition.ts'
import { currentRecognitionOf, insertRecognition } from '../scoring/recognition-db.ts'
import { ProbeNeeded, probeIdentity, settleWithProbe } from '../scoring/failure-boundary.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import type { RedeterminationKind } from '../review/conclusion.ts'
import {
  bumpParticipantAttention,
  cancelReviewInstance,
  entryOf,
  insertEntryEvent,
  insertReviewEvent,
  participantOf,
  setEntryState,
  staffReachesParticipant,
} from './db.ts'
import { openRoundOf } from '../review/db.ts'

// Re-determining a concluded claim (rulings of 2026-09-25).
//
// A power granted explicitly - a school's inspection group, say - and never
// derived from having judged at the end of a route. It walks no route: the
// person answers the same question a reviewer does, yes or no and when yes
// what the claim is recognised as, and the system compares that with where
// the claim stands. A new determination supersedes the old one; the old one
// is never touched. An answer that changes nothing writes nothing.
//
// A round still contesting the claim - an appeal, a staff reopening - ends
// in the same transaction, because a second conclusion arriving later from
// that round would overrule this one by accident of timing.

/** what the person re-determining says: the reviewer's question, asked outside a round */
export interface RedetermineInput {
  readonly decision: 'approve' | 'reject'
  readonly recognition?: { readonly values: unknown }
  readonly reason: string
}

export interface RedetermineResult {
  readonly kind: RedeterminationKind
  readonly status: 'approved' | 'rejected'
  /** whether a round contesting the claim was ended by it */
  readonly endedRound: boolean
}

export interface RedetermineDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the batch's authority and the phase gate, the door every staff act passes */
  readonly authorize: (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: { participantId?: string },
  ) => Effect.Effect<
    | { readonly allowed: true }
    | { readonly allowed: false; readonly layer: string; readonly reason: string },
    BatchNotFound
  >
  /** administrative reach over the batch, for deciding what a refusal may admit */
  readonly rosterReach: (as: Principal, tenantId: string, batchId: string) => Effect.Effect<boolean>
  readonly parseRange: (text: string) => { start: string; end: string }
}

const refuse = (reason: string) => new EntryActionRefused({ action: 'redetermine', reason })

export const makeRedetermineMethods = (deps: RedetermineDeps) => {
  const redetermineEntry = Effect.fn('Assessment.redetermineEntry')(function* (
    tenantId: string,
    entryId: string,
    input: RedetermineInput,
    as: Principal,
  ) {
    const runtime = yield* ScoringRuntimeCatalog
    const attempt = (proven: string | null) =>
      deps.withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* entryOf(tenantId, entryId)
            if (located === null) return yield* new EntryNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            // authority on the locked connection; somebody who holds nothing
            // here and cannot see the batch learns nothing about the claim
            const decision = yield* deps
              .authorize(as, 'assessment.entry.redetermine', located.batchId, {
                participantId: located.participantId,
              })
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
            if (!decision.allowed) {
              if (
                decision.layer === 'authority' &&
                !(yield* deps.rosterReach(as, tenantId, located.batchId))
              ) {
                return yield* new EntryNotFound()
              }
              return yield* refuse(decision.reason)
            }
            const entry = (yield* entryOf(tenantId, entryId))!
            const participant = yield* participantOf(tenantId, entry.batchId, entry.participantId)
            if (participant === null) return yield* new EntryNotFound()
            // the same two-people rule as recording: the power over others'
            // claims is not a way to settle one's own
            if (participant.userId === as.userId) return yield* refuse('self-redetermine-refused')
            const reaches = yield* staffReachesParticipant({
              tenantId,
              batchId: entry.batchId,
              userId: as.userId,
              permissionCode: 'assessment.entry.redetermine',
              participant,
            })
            if (!reaches) return yield* refuse('participant-out-of-reach')
            const reason = input.reason.trim()
            if (reason === '') return yield* refuse('reason-required')
            // a conclusion to correct: a claim still being filed, first
            // reviewed or given up has none
            if (entry.status !== 'approved' && entry.status !== 'rejected') {
              return yield* refuse('nothing-to-redetermine')
            }
            if (entry.currentRevisionId === null) return yield* refuse('nothing-to-redetermine')
            const item = yield* itemOf(tenantId, entry.itemId)
            if (item === null || item.currentRevisionId === null) {
              return yield* refuse('item-not-configured')
            }
            if (item.status !== 'active') return yield* refuse('item-not-active')
            const live = yield* revisionOf(tenantId, item.currentRevisionId)
            if (live === null) return yield* refuse('item-not-configured')

            const batch = (yield* oneBatch(tenantId, entry.batchId))!
            const standing = yield* currentRecognitionOf(tenantId, entryId)
            // the round still contesting the claim, locked with the claim
            const open = yield* openRoundOf(tenantId, entryId)
            const was = entry.status

            // What the answer amounts to, against where the claim stands.
            let determined: Record<string, unknown> | null = null
            if (input.decision === 'approve') {
              const plan = yield* Effect.orDie(readScoringPlan(live))
              // a determination is made, never assumed: only a question that
              // asks for nothing may be answered by omission
              if (
                input.recognition === undefined &&
                Object.keys(plan.recognitionSchemas).length > 0
              ) {
                return yield* new EntryPayloadInvalid({
                  issues: [{ field: 'recognition', reason: 'required' }],
                })
              }
              determined = yield* provenRecognition(
                plan,
                input.recognition === undefined ? {} : input.recognition.values,
                deps.parseRange(String(batch.materialRange)),
              )
              const unchanged =
                was === 'approved' &&
                standing !== null &&
                recognitionHash(canonicalRecognition(plan.recognitionSchemas, standing.values)) ===
                  recognitionHash(determined)
              if (unchanged) return yield* refuse('redetermination-unchanged')
              // proven against the question as it stands, outside the lock,
              // the same way a round's concluding word is
              const identity = probeIdentity({
                point: 'redetermination',
                revisionId: live.id,
                planHash: plan.planHash,
                status: was,
                standing: standing?.id ?? null,
                open: open?.id ?? null,
                recognition: recognitionHash(determined),
              })
              if (proven !== identity) {
                return yield* new ProbeNeeded({
                  probe: {
                    identity,
                    revisionId: live.id,
                    tenantId,
                    batchId: entry.batchId,
                    itemId: entry.itemId,
                    plan,
                    recognition: determined,
                  },
                })
              }
            } else if (was === 'rejected') {
              return yield* refuse('redetermination-unchanged')
            }
            const kind: RedeterminationKind =
              input.decision === 'reject'
                ? 'approval-revoked'
                : was === 'rejected'
                  ? 'rejection-overturned'
                  : 'recognition-corrected'

            // A round contesting the claim ends here, on the record, with
            // whatever it was still waiting for: a conclusion it reached
            // later would overrule this one by accident of timing.
            let endedRound = false
            if (open !== null) {
              endedRound = yield* cancelReviewInstance({
                tenantId,
                instanceId: open.id,
                outcome: 'superseded-by-redetermination',
              })
              if (endedRound) {
                yield* insertReviewEvent({
                  tenantId,
                  reviewInstanceId: open.id,
                  kind: 'superseded-by-redetermination',
                  actorId: as.userId,
                  comment: reason,
                })
              }
            }

            // The claim no longer stands on any round: the conclusion is this
            // one, told by the entry's own log (and, when approved, by the
            // determination that supersedes the last).
            if (determined !== null) {
              const recognitionId = yield* insertRecognition({
                tenantId,
                batchId: entry.batchId,
                entryId,
                entryRevisionId: entry.currentRevisionId,
                itemId: entry.itemId,
                itemRevisionId: live.id,
                values: determined,
                source: 'redetermination',
                createdBy: as.userId,
                ...(standing === null ? {} : { supersedesId: standing.id }),
              })
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: [was],
                to: 'approved',
                currentRecognitionId: recognitionId,
                currentReviewInstanceId: null,
              })
              if (!moved) return yield* refuse('entry-changed')
            } else {
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: ['approved'],
                to: 'rejected',
                currentReviewInstanceId: null,
              })
              if (!moved) return yield* refuse('entry-changed')
            }
            yield* insertEntryEvent({ tenantId, entryId, kind, actorId: as.userId, reason })
            yield* bumpParticipantAttention(tenantId, entryId)
            yield* announce(tenantId, entry.batchId, [
              { kind: 'entries-changed', subjectUserId: participant.userId },
              { kind: 'result-changed', subjectUserId: participant.userId },
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
            ])
            return {
              kind,
              status: determined === null ? 'rejected' : 'approved',
              endedRound,
            } satisfies RedetermineResult
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    return yield* settleWithProbe(runtime, attempt, (first, again) =>
      again.revisionId !== first.revisionId
        ? new ItemRevisionConflict({ itemId: first.itemId, currentRevisionId: again.revisionId })
        : refuse('entry-changed'),
    )
  })

  return { redetermineEntry }
}

export type RedetermineMethods = ReturnType<typeof makeRedetermineMethods>

/** the errors a re-determination answers with, for the service interface */
export type RedetermineError =
  | EntryNotFound
  | BatchReadOnly
  | EntryActionRefused
  | EntryPayloadInvalid
  | ItemRevisionConflict
  | DeterminationRefused
  | ScoringUnavailable
