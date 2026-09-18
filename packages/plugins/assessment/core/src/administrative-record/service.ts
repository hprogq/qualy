import { Effect } from 'effect'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import {
  AdministrativeRecordFilesNotShareable,
  AdministrativeRecordNotFound,
  AdministrativeRecordRefused,
  AdministrativeRecordTargetsChanged,
  BatchNotFound,
  BatchReadOnly,
  DeterminationRefused,
  EntryActionRefused,
  EntryPayloadInvalid,
  ItemNotFound,
  ItemRevisionConflict,
  ScoringUnavailable,
} from '../errors.ts'
import { itemOf, revisionOf as itemRevisionOf } from '../item/db.ts'
import {
  ScoringRuntimeCatalog,
  type AttachmentRef,
  type BatchContext,
  type ItemTypeDriver,
} from '../plugin.ts'
import type { ActionDecision } from '../administrative-import/service.ts'
import { proveSettlements } from '../scoring/failure-boundary.ts'
import { readScoringPlan } from '../scoring/plan.ts'
import { canonicalRecognition } from '../scoring/recognition.ts'
import {
  recordAdministrativeEntryTx,
  voidAdministrativeEntryTx,
} from '../entry/administrative-write.ts'
import { announce } from '../live/events.ts'
import { effectiveEntryCounts } from '../administrative-import/db.ts'
import { lockBatch, oneBatch, resolveRecordTargets } from '../server/db.ts'
import {
  eventsOfOperation,
  operationRowsPage,
  insertRecordOperation,
  insertRecordOperationEvent,
  insertRecordOperationRows,
  operationOf,
  operationsOfBatchPage,
  reversalCandidatesOfOperation,
  standingOfOperations,
} from './db.ts'

// One administrative finding, settled on a group of people.
//
// The shape of the act, before any of it is written. Choosing is done
// against this round's own roster (§32.78), so what comes back here is
// already the population the caller may act on; what this adds is everything
// that can still refuse a particular person, and the one hash that says
// which people were confirmed.
//
// Two kinds of refusal, and they are not interchangeable. Something wrong
// with the ACT - a question that moved, a round closed, a determination the
// calculator will not take - refuses the whole thing, because no subset of
// the people fixes it. Something wrong with a PERSON - already at their
// limit for this question, the recorder themselves - is listed, and the
// caller may drop them and go on. Letting the first kind be dropped
// person-by-person would let somebody grind an invalid act through one
// exclusion at a time.
//
// The arithmetic is proven once. Every person here gets the same
// determination, so there is one thing to prove, and it is proven before a
// transaction rather than inside one.

/** how the targets were chosen; history once the act is written */
export type RecordTarget =
  | { readonly kind: 'people'; readonly participantIds: readonly string[] }
  | {
      readonly kind: 'organization'
      readonly orgNodeIds: readonly string[]
      readonly userTypeIds: readonly string[]
    }

/** a person this act cannot reach, and why */
export interface RecordTargetBlocker {
  readonly participantId: string
  readonly userId: string
  readonly displayName: string
  readonly businessNo: string | null
  readonly reason: string
}

export interface AdministrativeRecordPreview {
  readonly item: { readonly id: string; readonly title: string; readonly revisionId: string }
  /** how many the selection found before anything was refused */
  readonly requestedCount: number
  /** how many would be recorded if the blocked are dropped */
  readonly eligibleCount: number
  readonly blocked: readonly RecordTargetBlocker[]
  /**
   * The identity of the set the caller is being shown.
   *
   * A count cannot do this job: `A B C D` and `B C D E` are both four, and
   * only one of them is what somebody looked at. Hashing the sorted ids
   * makes the confirmation name the people rather than the number, and it
   * needs nothing stored - the set is recomputed at commit and compared.
   */
  readonly targetFingerprint: string
}

export interface AdministrativeRecordDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the recording authority and the phase gate, asked once per act */
  readonly recordGate: (
    principal: Principal,
    batchId: string,
    itemId: string,
  ) => Effect.Effect<(participantId: string) => ActionDecision, BatchNotFound>
  readonly holdsRecord: (
    tenantId: string,
    batchId: string,
    userId: string,
  ) => Effect.Effect<boolean>
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  readonly parseRange: (text: string) => { start: string; end: string }
}

/**
 * How many people one act may reach.
 *
 * Not a page size - the whole point is that the set is settled in one go -
 * but an act that would touch tens of thousands of people is a mistake being
 * made, not a batch being recorded, and it should be refused while it is
 * still arithmetic.
 */
export const MAX_RECORD_TARGETS = 5000

export interface AdministrativeRecordInput {
  readonly itemId: string
  readonly expectedItemRevisionId?: string
  readonly target: RecordTarget
  /** people the caller has knowingly dropped from the act */
  readonly excludedParticipantIds?: readonly string[]
  readonly payload: Record<string, unknown>
  readonly recognition?: { readonly values: Record<string, unknown> }
  readonly basis: string
}

/** the id set, spelled one way, so the same people always hash the same */
export const fingerprintOf = (participantIds: readonly string[]): string =>
  hashCanonicalJson([...participantIds].sort())

export const administrativeRecordService = (deps: AdministrativeRecordDeps) => {
  /**
   * A database that refused is not a refusal this api can express: nothing
   * the caller did caused it and nothing they can do fixes it, so it leaves
   * as a defect rather than as an error in every signature above.
   */
  const dieQuery = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Exclude<E, { _tag: 'QueryFailed' }>, R> =>
    effect.pipe(
      Effect.catchIf(
        (error): error is E & { _tag: 'QueryFailed' } =>
          typeof error === 'object' &&
          error !== null &&
          (error as { _tag?: string })._tag === 'QueryFailed',
        (error) => Effect.die(error),
      ),
    ) as never

  const withDb = <A, E, R>(effect: Effect.Effect<A, E, R>) => dieQuery(deps.withDb(effect))

  /**
   * Everything the act needs and everyone it would reach, or the reason it
   * cannot happen at all.
   *
   * Shared by the preview and the write, so the two can never disagree about
   * what a valid act is - the write asks again rather than trusting what the
   * preview said, and asking the same way is what makes that meaningful.
   */
  const shapeOf = Effect.fn('Assessment.administrativeRecord.shape')(function* (
    tenantId: string,
    batchId: string,
    input: AdministrativeRecordInput,
    as: Principal,
  ) {
    const batch = yield* withDb(oneBatch(tenantId, batchId))
    if (!batch) return yield* new BatchNotFound()
    if (batch.status === 'archived') return yield* new BatchReadOnly()
    if (!(yield* deps.holdsRecord(tenantId, batchId, as.userId))) {
      return yield* new AccessDenied({ reason: 'assessment.entry.record' })
    }

    const item = yield* withDb(itemOf(tenantId, input.itemId))
    if (item === null || item.batchId !== batchId) return yield* new ItemNotFound()
    if (item.status !== 'active' || item.currentRevisionId === null) {
      return yield* new ItemNotFound()
    }
    if (
      input.expectedItemRevisionId !== undefined &&
      input.expectedItemRevisionId !== item.currentRevisionId
    ) {
      return yield* new ItemRevisionConflict({
        itemId: item.id,
        currentRevisionId: item.currentRevisionId,
      })
    }
    const revision = yield* withDb(itemRevisionOf(tenantId, item.currentRevisionId))
    if (revision === null || revision.entrySource !== 'administrative') {
      return yield* new ItemNotFound()
    }

    const driver = deps.itemTypes.get(item.itemType)
    if (driver === undefined) return yield* new ItemNotFound()
    const context: BatchContext = { materialRange: deps.parseRange(String(batch.materialRange)) }
    const plan = yield* Effect.orDie(readScoringPlan(revision))

    // The same reading every other door does, so a payload that would be
    // refused one at a time is refused here too. The driver's own error is
    // an internal shape; on the wire this is the same refusal a single
    // filing gets, because it is the same problem.
    const decoded = yield* driver
      .decodePayload(revision.formConfig, input.payload, context)
      .pipe(
        Effect.catchTag('ASSESSMENT_ITEM_PAYLOAD_INVALID', (error) =>
          Effect.fail(new EntryPayloadInvalid({ issues: error.issues })),
        ),
      )

    // A finding settled on many people is one finding, and an attachment
    // belongs to exactly one entry (§5.14). Rather than loosen that - which
    // would make "whose file is this" unanswerable - an act carrying files
    // is refused above one person, and the screen says to record those one
    // at a time.
    const files = driver.attachmentRefs(revision.formConfig, decoded)

    const determination = canonicalRecognition(
      plan.recognitionSchemas,
      input.recognition === undefined ? {} : input.recognition.values,
    )

    return { batch, item, revision, plan, decoded, files, determination }
  })

  const preview = Effect.fn('Assessment.previewAdministrativeRecord')(function* (
    tenantId: string,
    batchId: string,
    input: AdministrativeRecordInput,
    as: Principal,
  ) {
    const runtime = yield* ScoringRuntimeCatalog
    const shape = yield* shapeOf(tenantId, batchId, input, as)

    // the arithmetic, proven before anything could be written and exactly
    // once: every person here gets the same determination
    const proven = yield* proveSettlements(
      runtime,
      {
        tenantId,
        batchId,
        itemId: shape.item.id,
        revisionId: shape.revision.id,
        plan: shape.plan,
      },
      [shape.determination],
    )
    const answer = proven.get(hashCanonicalJson(shape.determination))
    if (answer !== undefined && 'refused' in answer) {
      return yield* new DeterminationRefused({
        itemId: shape.item.id,
        reason: answer.refused.reason,
      })
    }

    const found = yield* withDb(
      resolveRecordTargets(
        tenantId,
        batchId,
        input.target,
        { userId: as.userId, permissionCode: 'assessment.entry.record' },
        MAX_RECORD_TARGETS + 1,
      ),
    )
    const dropped = new Set(input.excludedParticipantIds ?? [])
    const considered = found.filter((one) => !dropped.has(one.id))

    const gate = yield* deps.recordGate(as, batchId, shape.item.id)
    const held = yield* withDb(
      effectiveEntryCounts({
        tenantId,
        itemId: shape.item.id,
        participantIds: considered.map((one) => one.id),
      }),
    )

    const blocked: RecordTargetBlocker[] = []
    const eligible: string[] = []
    for (const person of considered) {
      const why = (reason: string) =>
        blocked.push({
          participantId: person.id,
          userId: person.userId,
          displayName: person.displayName,
          businessNo: person.businessNo,
          reason,
        })
      // a registrar who is also on the roster must not hand themselves a
      // finding nobody reviewed - the same rule one-at-a-time recording has
      if (person.userId === as.userId) {
        why('self-record-refused')
        continue
      }
      const admitted = gate(person.id)
      if (!admitted.allowed) {
        why(admitted.reason)
        continue
      }
      if (shape.item.maxEntries !== null && (held.get(person.id) ?? 0) >= shape.item.maxEntries) {
        why('max-entries-reached')
        continue
      }
      eligible.push(person.id)
    }

    return {
      item: { id: shape.item.id, title: shape.item.title, revisionId: shape.revision.id },
      requestedCount: considered.length,
      eligibleCount: eligible.length,
      blocked,
      targetFingerprint: fingerprintOf(eligible),
      /** the caller's business, not the wire's: used by the write */
      files: shape.files,
    }
  })

  /**
   * The act, written - all of it or none of it.
   *
   * Everything the preview decided is decided again here, because between
   * looking and pressing somebody can join the round, leave it, reach their
   * limit, or close the phase. Two different things are being checked and
   * they are not interchangeable:
   *
   * The fingerprint asks whether these are the same PEOPLE that were
   * confirmed. It is compared against the set resolved now, minus whoever
   * the caller knowingly dropped - which is why the exclusions travel with
   * the request. Without them the server could not tell a person the caller
   * removed from a person the roster removed, and a target that stopped
   * being blocked would quietly rejoin an act nobody confirmed them into.
   *
   * The per-person checks ask whether those people can still be recorded on
   * NOW. A set that is unchanged but no longer writable fails here rather
   * than at the hash, and fails whole: a partial act would leave the
   * recorder unable to say which half happened.
   */
  const record = Effect.fn('Assessment.recordAdministrativeBatch')(function* (
    tenantId: string,
    batchId: string,
    input: AdministrativeRecordInput & { readonly expectedTargetFingerprint: string },
    as: Principal,
  ) {
    const runtime = yield* ScoringRuntimeCatalog
    const shape = yield* shapeOf(tenantId, batchId, input, as)

    // proven outside the transaction and exactly once, as in the preview:
    // one determination reaches everybody here
    const proven = yield* proveSettlements(
      runtime,
      {
        tenantId,
        batchId,
        itemId: shape.item.id,
        revisionId: shape.revision.id,
        plan: shape.plan,
      },
      [shape.determination],
    )
    const answer = proven.get(hashCanonicalJson(shape.determination))
    if (answer !== undefined && 'refused' in answer) {
      return yield* new DeterminationRefused({
        itemId: shape.item.id,
        reason: answer.refused.reason,
      })
    }

    const found = yield* withDb(
      resolveRecordTargets(
        tenantId,
        batchId,
        input.target,
        { userId: as.userId, permissionCode: 'assessment.entry.record' },
        MAX_RECORD_TARGETS + 1,
      ),
    )
    const dropped = new Set(input.excludedParticipantIds ?? [])
    const targets = found.filter((one) => !dropped.has(one.id))
    const fingerprint = fingerprintOf(targets.map((one) => one.id))
    if (fingerprint !== input.expectedTargetFingerprint) {
      return yield* new AdministrativeRecordTargetsChanged({
        expected: input.expectedTargetFingerprint,
        actual: fingerprint,
        actualCount: targets.length,
      })
    }
    if (targets.length > MAX_RECORD_TARGETS) {
      return yield* new AdministrativeRecordRefused({
        blocked: [{ participantId: '', reason: 'too-many-targets' }],
      })
    }
    // one finding, one file, one entry: sharing an attachment across facts
    // is what §5.14 refuses, and this is the one door that could have done it
    if (shape.files.length > 0 && targets.length > 1) {
      return yield* new AdministrativeRecordFilesNotShareable({ targetCount: targets.length })
    }

    const gate = yield* deps.recordGate(as, batchId, shape.item.id)
    const written = yield* withDb(
      transaction(
        Effect.gen(function* () {
          // nothing read before the lock may be trusted: a batch can be
          // archived between the resolve and the write
          const locked = yield* lockBatch(tenantId, batchId)
          if (!locked) return yield* new BatchNotFound()
          if (locked.status === 'archived') return yield* new BatchReadOnly()

          const held = yield* effectiveEntryCounts({
            tenantId,
            itemId: shape.item.id,
            participantIds: targets.map((one) => one.id),
          })
          const refused: { participantId: string; reason: string }[] = []
          for (const person of targets) {
            if (person.userId === as.userId) {
              refused.push({ participantId: person.id, reason: 'self-record-refused' })
              continue
            }
            const admitted = gate(person.id)
            if (!admitted.allowed) {
              refused.push({ participantId: person.id, reason: admitted.reason })
              continue
            }
            if (
              shape.item.maxEntries !== null &&
              (held.get(person.id) ?? 0) >= shape.item.maxEntries
            ) {
              refused.push({ participantId: person.id, reason: 'max-entries-reached' })
            }
          }
          // one refusal and the transaction carries nothing: the act was
          // confirmed as a whole, so it happens as a whole
          if (refused.length > 0)
            return yield* new AdministrativeRecordRefused({ blocked: refused })

          const rows: { participantId: string; entryId: string }[] = []
          for (const person of targets) {
            const { entryId } = yield* recordAdministrativeEntryTx({
              tenantId,
              batchId,
              itemId: shape.item.id,
              itemRevisionId: shape.revision.id,
              participantId: person.id,
              subjectUserId: person.userId,
              actorUserId: as.userId,
              payload: shape.decoded,
              recognition: shape.determination,
              basis: input.basis.trim(),
              // settled in the product, not brought in on a file: the
              // number of people it reached does not change that (§32.78)
              source: 'record',
              attachments: shape.files,
            })
            rows.push({ participantId: person.id, entryId })
          }

          const operationId = yield* insertRecordOperation({
            tenantId,
            batchId,
            itemId: shape.item.id,
            itemRevisionId: shape.revision.id,
            targetKind: input.target.kind,
            // history, never resolved again - what it says is how these
            // people were found, not who the act applies to
            targetSpec:
              input.target.kind === 'people'
                ? { participantIds: [...input.target.participantIds] }
                : {
                    orgNodeIds: [...input.target.orgNodeIds],
                    userTypeIds: [...input.target.userTypeIds],
                  },
            actorId: as.userId,
            recordedCount: rows.length,
          })
          yield* insertRecordOperationRows(tenantId, operationId, rows)
          // One wake-up for the whole act, not one per person: the unread
          // marks are already on each subject's own row, written as each
          // fact was, so what is left to say is "this round changed", once.
          yield* announce(tenantId, batchId, [
            { kind: 'entries-changed' },
            { kind: 'result-changed' },
          ])
          return { operationId, rows }
        }),
      ),
    )

    return { operationId: written.operationId, recordedCount: written.rows.length }
  })

  /**
   * Taking a whole act back.
   *
   * It walks the rows this act actually wrote - never the selection that
   * found them. Resolving "class 1" again a month later would withdraw
   * findings from people who transferred in since and leave alone the ones
   * who left, which is precisely backwards (§32.78).
   *
   * All or nothing, with one exception that is not one: findings already
   * withdrawn singly are simply not candidates, exactly as an import's
   * reversal treats them. Everything still standing goes together or not at
   * all, and the authority asked is the authority of whoever is pressing
   * now, not of whoever recorded.
   */
  const reverse = Effect.fn('Assessment.reverseAdministrativeRecord')(function* (
    tenantId: string,
    operationId: string,
    input: { reason: string },
    as: Principal,
  ) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const act = yield* operationOf(tenantId, operationId)
          if (act === null) return yield* new AdministrativeRecordNotFound()
          const locked = yield* lockBatch(tenantId, act.batchId)
          if (!locked) return yield* new AdministrativeRecordNotFound()
          if (!(yield* deps.holdsRecord(tenantId, act.batchId, as.userId))) {
            return yield* new AdministrativeRecordNotFound()
          }
          if (locked.status === 'archived') return yield* new BatchReadOnly()
          const reason = input.reason.trim()
          if (reason === '') {
            return yield* new EntryActionRefused({ action: 'abandon', reason: 'reason-required' })
          }

          const linked = yield* reversalCandidatesOfOperation(tenantId, operationId, {
            batchId: act.batchId,
            userId: as.userId,
          })
          const candidates = linked.filter((one) => one.status !== 'voided')
          // withdrawn one by one already, or withdrawn whole before: there is
          // nothing left to say, and saying nothing is not an event
          if (candidates.length === 0) return { affectedCount: 0 }

          const gate = yield* deps
            .recordGate(as, act.batchId, act.itemId)
            .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', Effect.die))
          const refused: { participantId: string; reason: string }[] = []
          for (const one of candidates) {
            if (one.source !== 'record' && one.source !== 'import') {
              refused.push({ participantId: one.participantId, reason: 'entry-not-abandonable' })
              continue
            }
            if (!one.reached) {
              refused.push({ participantId: one.participantId, reason: 'participant-out-of-scope' })
              continue
            }
            if (one.participantUserId === as.userId) {
              refused.push({ participantId: one.participantId, reason: 'self-record-refused' })
              continue
            }
            const decision = gate(one.participantId)
            if (!decision.allowed) {
              refused.push({ participantId: one.participantId, reason: decision.reason })
            }
          }
          if (refused.length > 0)
            return yield* new AdministrativeRecordRefused({ blocked: refused })

          let cancelledReview = false
          for (const one of candidates) {
            const withdrawn = yield* voidAdministrativeEntryTx({
              tenantId,
              entryId: one.entryId,
              status: one.status,
              currentReviewInstanceId: one.currentReviewInstanceId,
              actorUserId: as.userId,
              reason,
            })
            if (!withdrawn.voided) {
              return yield* new AdministrativeRecordRefused({
                blocked: [{ participantId: one.participantId, reason: 'entry-not-abandonable' }],
              })
            }
            cancelledReview = cancelledReview || withdrawn.cancelledReview
          }
          // each entry's own event already says it was withdrawn; this is the
          // one line saying it was this act being taken back
          yield* insertRecordOperationEvent({
            tenantId,
            operationId,
            kind: 'reversed',
            actorId: as.userId,
            reason,
            affectedCount: candidates.length,
          })
          yield* announce(tenantId, act.batchId, [
            { kind: 'entries-changed' },
            { kind: 'result-changed' },
            ...(cancelledReview
              ? ([{ kind: 'review-inbox-changed' }, { kind: 'review-instance-changed' }] as const)
              : []),
          ])
          return { affectedCount: candidates.length }
        }),
      ),
    )
  })

  /** the acts of one round, newest first, with what each comes to now */
  const list = Effect.fn('Assessment.listAdministrativeRecords')(function* (
    tenantId: string,
    batchId: string,
    filter: { after?: readonly [string, string] | undefined; limit: number },
    as: Principal,
  ) {
    if (!(yield* deps.holdsRecord(tenantId, batchId, as.userId))) {
      return yield* new AccessDenied({ reason: 'assessment.entry.record' })
    }
    const rows = (yield* withDb(
      operationsOfBatchPage({ tenantId, batchId, after: filter.after, limit: filter.limit }),
    )) as unknown as Record<string, unknown>[]
    const standing = yield* withDb(
      standingOfOperations(
        tenantId,
        rows.map((row) => String(row['id'])),
      ),
    )
    return rows.map((row) => ({
      id: String(row['id']),
      itemId: String(row['itemId']),
      itemTitle: String(row['itemTitle'] ?? ''),
      targetKind: String(row['targetKind']),
      targetSpec: row['targetSpec'] as Record<string, unknown>,
      recordedCount: Number(row['recordedCount'] ?? 0),
      voidedCount: standing.get(String(row['id']))?.voided ?? 0,
      actorName: row['actorName'] == null ? null : String(row['actorName']),
      createdAt: String(row['createdAt']),
    }))
  })

  /** one act, what it came to, and what has been done to it */
  const detail = Effect.fn('Assessment.administrativeRecordDetail')(function* (
    tenantId: string,
    operationId: string,
    as: Principal,
  ) {
    const act = yield* withDb(operationOf(tenantId, operationId))
    if (act === null) return yield* new AdministrativeRecordNotFound()
    if (!(yield* deps.holdsRecord(tenantId, act.batchId, as.userId))) {
      return yield* new AdministrativeRecordNotFound()
    }
    const standing = yield* withDb(standingOfOperations(tenantId, [operationId]))
    const events = (yield* withDb(eventsOfOperation(tenantId, operationId))) as unknown as Record<
      string,
      unknown
    >[]
    // the question it settled, and the people it reached: a detail that says
    // only how many there were is a receipt, not a record
    const item = yield* withDb(itemOf(tenantId, act.itemId))
    const rows = (yield* withDb(
      operationRowsPage({ tenantId, operationId, limit: 500 }),
    )) as unknown as Record<string, unknown>[]
    return {
      ...act,
      itemTitle: item?.title ?? '',
      voidedCount: standing.get(operationId)?.voided ?? 0,
      rows: rows.map((row) => ({
        entryId: String(row['entryId']),
        participantId: String(row['participantId']),
        displayName: String(row['displayName'] ?? ''),
        businessNo: row['businessNo'] == null ? null : String(row['businessNo']),
        status: String(row['status']),
      })),
      events: events.map((row) => ({
        id: String(row['id']),
        kind: String(row['kind']),
        reason: row['reason'] == null ? null : String(row['reason']),
        affectedCount: Number(row['affectedCount'] ?? 0),
        actorName: row['actorName'] == null ? null : String(row['actorName']),
        createdAt: String(row['createdAt']),
      })),
    }
  })

  return { preview, record, reverse, list, detail, shapeOf }
}

export type { ScoringUnavailable }
