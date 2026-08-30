import { Effect, Result } from 'effect'
import { insertRecognition, currentRecognitionOf } from '../scoring/recognition-db.ts'
import {
  canonicalRecognition,
  judgeRecognition,
  seedFromEvidence,
} from '../scoring/recognition.ts'
import { readScoringPlan } from '../scoring/plan.ts'
import type { ScoringPlan } from '../scoring/plan.ts'

/**
 * The compiled arithmetic a revision carries.
 *
 * Every revision saved since plans existed has one, and the assembly
 * compiles the older ones at its barrier before the port opens. Reaching a
 * null here is an operational fault - it dies naming the revision instead of
 * writing a determination against a contract nobody knows.
 */

import { boundedCounter } from '@qualy/telemetry/metrics'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import type { AttachmentMeta } from '@qualy/plugin-storage/server'
import type { AttachmentRef, ItemTypeDriver } from '../plugin.ts'
import type { GateContext } from '../phase/gate.ts'
import {
  BatchNotFound,
  BatchReadOnly,
  EntryActionRefused,
  EntryNotFound,
  EntryPayloadInvalid,
  ItemNotFound,
  ItemRevisionConflict,
  ParticipantNotFound,
} from '../server/errors.ts'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { cursorUnusable, type BadRequest, pageSize } from '@qualy/api-kit/schema'
import { participantRowByUser } from '../scoring/db.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { announce } from '../live/events.ts'
import {
  bumpParticipantAttention,
  markMyEntryReads,
  unreadItemIdsOf,
  myActionRowsOf,
} from './db.ts'
import { itemOf, revisionOf, type ItemRevisionRow, type ItemRow } from '../item/db.ts'
import {
  activeItemIdsOf,
  attachmentsOfRevisions,
  latestRefusalOf,
  cancelReviewInstance,
  entriesOfParticipantPage,
  entryAttachmentHistory,
  entryCreatedIso,
  entryEventsOf,
  entryRevisionsOf,
  eventsOfRounds,
  roundsOfEntry,
  lockAttachments,
  entryCountOf,
  entryOf,
  entryRevisionOf,
  insertEntry,
  insertEntryEvent,
  insertEntryRevision,
  insertReviewEvent,
  insertReviewInstance,
  insertRevisionAttachments,
  nextEntryRevisionNo,
  nextRoundNo,
  nodePathOf,
  participantOf,
  revisionAttachmentsOf,
  setEntryState,
  staffReachesParticipant,
  type EntryRow,
  type ParticipantAnchor,
} from './db.ts'
import {
  enterableFrom,
  stageArrival,
  policyModeOf,
  readPolicy,
  resolvePolicy,
} from '../review/chain.ts'
import {
  openSupplementsOfEntries,
  supplementsOfInstances,
  type OpenSupplementRow,
  type SupplementRequirement,
  type SupplementRow,
  withdrawStandingsOf,
} from '../review/db.ts'

// One person's claim on one question: created, revised, submitted, withdrawn.
//
// Everything here answers to one rule: the server decides who is speaking.
// The client never submits a source, an actor or a subject - the route, the
// item's entry source and the caller's own standing derive all three - and
// the resource policy below is the third authorization layer, asked after
// authority (is this person anyone here) and the phase gate (is this act
// open now).
//
// Attachments cross into storage inside the same transaction that writes the
// revision: a payload that cites a file and the row that binds the file are
// one fact, or neither is.

export interface EntryRevisionView {
  readonly id: string
  readonly revisionNo: number
  readonly itemRevisionId: string
  readonly payload: unknown
  readonly note: string | null
  readonly source: string
  readonly actorId: string
  readonly subjectId: string
  readonly attachments: readonly { attachmentId: string; position: number }[]
  readonly createdAt: number
}

/**
 * Why a claim is back with the person who filed it.
 *
 * A status word alone leaves them guessing: "sent back" without the sentence
 * that came with it is an instruction with the instruction missing. Carried
 * only while the claim is actually theirs to act on.
 */
export interface EntryRefusalView {
  readonly kind: string
  readonly reason: string | null
  readonly comment: string | null
  /** what the reviewer would write instead, for the owner to apply by hand */
  readonly suggestedPayload: unknown
  readonly actorName: string | null
  readonly at: number
}

/** the open ask on this claim's round, for the screens that answer it */
export interface EntrySupplementView {
  readonly requestId: string
  readonly instanceId: string
  readonly requestNo: number
  readonly instructions: string
  readonly requirements: readonly SupplementRequirement[]
  readonly requestedByName: string | null
  readonly requestedAt: number
}

export interface EntryView {
  readonly id: string
  readonly batchId: string
  readonly itemId: string
  readonly participantId: string
  readonly status: EntryRow['status']
  readonly source: EntryRow['source']
  readonly currentRevision: EntryRevisionView | null
  readonly currentReviewInstanceId: string | null
  readonly createdAt: number
  /**
   * The reviewer's open ask for more backing, when the current round is
   * waiting on one. Discovery only - answering re-checks everything - and
   * null on write-path responses; the screens re-read through the gated
   * paths, like the capabilities.
   */
  readonly supplement: EntrySupplementView | null
  /** the last word said against it, while it is waiting on its owner */
  readonly refusal: EntryRefusalView | null
  readonly capabilities: {
    readonly edit: ActionAvailability
    readonly submit: ActionAvailability
    readonly withdraw: ActionAvailability
    readonly appeal: ActionAvailability
    readonly abandon: ActionAvailability
  }
}

/**
 * What a claim is recognised as, proven before it counts as approved.
 *
 * Every door that produces an approved claim goes through here: a reviewer's
 * word, a member of staff recording one, and the rule that approves a
 * question nobody reviews. The database guarantees an approved claim HAS a
 * determination and that it is an object; only this says it is the complete
 * and exact determination the frozen contract asked for. Without it a claim
 * reaches the account with a field missing, and the failure surfaces on a
 * student's results page rather than at the door that let it in.
 */
const provenRecognition = (
  plan: ScoringPlan,
  candidate: unknown,
): Effect.Effect<Record<string, unknown>, EntryPayloadInvalid> => {
  const wrong = judgeRecognition(plan.recognitionSchemas, candidate)
  return wrong.length === 0
    ? Effect.succeed(
        // stored the one way the contract says it means: a value written
        // "3.0" and read back "3.00" would make every later comparison a
        // fact about who typed it
        canonicalRecognition(plan.recognitionSchemas, candidate as Record<string, unknown>),
      )
    : Effect.fail(
        new EntryPayloadInvalid({
          issues: wrong.map((issue) => ({
            field: issue.recognitionId === '' ? 'recognition' : `recognition.${issue.recognitionId}`,
            reason: issue.reason,
          })),
        }),
      )
}

export interface CreateEntryInput {
  readonly itemId: string
  readonly participantId: string
  /** the question as the caller's screen had it; absent means no claim made */
  readonly expectedItemRevisionId?: string
  readonly payload: unknown
  readonly note?: string
  /** what the office determines by recording it; administrative only */
  readonly recognition?: { readonly values: unknown }
}

export type CreateEntryError =
  | ItemNotFound
  | ItemRevisionConflict
  | BatchNotFound
  | BatchReadOnly
  | EntryActionRefused
  | EntryPayloadInvalid
  | AccessDenied
export type ReviseEntryError =
  EntryNotFound | ItemRevisionConflict | BatchReadOnly | EntryActionRefused | EntryPayloadInvalid
/** the activity stream's public vocabulary; raw event kinds never leave */
export type EntryStatusError =
  EntryNotFound | ItemRevisionConflict | BatchReadOnly | EntryActionRefused

/**
 * What an administrator may do to a claim without pretending to be its
 * reviewer.
 *
 * Sending one back is not a rejection and not a decision: it is the round's
 * own arrangements changing under a claim, and the person who may change
 * those arrangements saying so. Judging stays with whoever actually holds
 * the level - `decideReview` still refuses anybody else, administrator or
 * not (§32.62).
 */
export interface InterveneInput {
  /**
   * `return-for-revision` hands a claim back to the person who filed it.
   *
   * `void` withdraws a fact nobody filed. A record or an import is not its
   * subject's to give up - letting them would let a student delete a
   * penalty - so the way one stops counting is a member of staff saying so,
   * with a reason, which is what this is. Correcting one is voiding it and
   * recording again.
   */
  readonly kind: 'return-for-revision' | 'void'
  readonly reason: string
}

export type InterveneError = EntryNotFound | BatchReadOnly | EntryActionRefused | AccessDenied

export interface EntryRoundView {
  readonly id: string
  readonly roundNo: number
  readonly state: string
  readonly outcome: string | null
  readonly revisionId: string
  readonly origin: string
  readonly supersedesInstanceId: string | null
  readonly appealedInstanceId: string | null
  readonly appealedRecognitionId: string | null
  readonly submittedAt: number
  readonly completedAt: number | null
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    readonly reason: string | null
    readonly comment: string | null
    readonly suggestedPayload: unknown
    readonly at: number
  }[]
  /**
   * What this round asked for beyond the filing, and what came back.
   *
   * Part of the round's own account rather than a separate list: an ask and
   * its answer are two more things that happened to this claim, and the
   * screen that tells its story reads them in the same order as everything
   * else.
   */
  readonly supplements: readonly SupplementRow[]
}

export interface EntryHistoryView {
  readonly entry: EntryView
  readonly revisions: readonly (EntryRevisionView & {
    /**
     * The form this version was written under. History is read through the
     * configuration it cited, never today's - and without it a reader meets
     * the payload's internal keys instead of the questions they answered.
     */
    readonly formConfig: unknown
  })[]
  readonly rounds: readonly EntryRoundView[]
  /**
   * What happened to the claim that no round explains - being sent back
   * because the question changed, most of all. Its own list rather than a
   * pseudo-round, because there is no round to put it in and it is not a
   * decision anybody made about the evidence.
   */
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    readonly reason: string | null
    readonly at: number
  }[]
}

export interface EntryMethods {
  readonly listMyEntries: (
    tenantId: string,
    batchId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<
    {
      participantId: string
      entries: readonly EntryView[]
      /** the phase gate's word on filing into each active question */
      filing: readonly {
        itemId: string
        create: ActionAvailability
        submit: ActionAvailability
      }[]
      nextCursor: string | null
      attention: { unreadItemIds: readonly string[] }
    },
    BatchNotFound | ParticipantNotFound | AccessDenied | BadRequest
  >
  readonly getEntryHistory: (
    tenantId: string,
    entryId: string,
    as: Principal,
  ) => Effect.Effect<EntryHistoryView, EntryNotFound>
  readonly createEntry: (
    tenantId: string,
    input: CreateEntryInput,
    as: Principal,
  ) => Effect.Effect<EntryView, CreateEntryError>
  readonly getEntry: (
    tenantId: string,
    entryId: string,
    as: Principal,
  ) => Effect.Effect<EntryView, EntryNotFound>
  readonly appendEntryRevision: (
    tenantId: string,
    entryId: string,
    input: { payload: unknown; note?: string; expectedItemRevisionId?: string },
    as: Principal,
  ) => Effect.Effect<EntryView, ReviseEntryError>
  readonly setEntryStatus: (
    tenantId: string,
    entryId: string,
    to: 'in_review' | 'draft' | 'voided',
    as: Principal,
    /** the question the caller's screen showed when the press happened */
    expectedItemRevisionId?: string,
  ) => Effect.Effect<EntryView, EntryStatusError>
  readonly markMyEntryRead: (
    tenantId: string,
    batchId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<{ ok: true }, BatchNotFound | ParticipantNotFound | AccessDenied>
  readonly getMyEntrySummary: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    {
      unreadItemIds: readonly string[]
      actions: readonly {
        kind: 'supplement' | 'revision'
        entryId: string
        itemId: string
        itemTitle: string
        at: string
        who: string | null
        summary: string | null
      }[]
    },
    BatchNotFound | ParticipantNotFound | AccessDenied
  >
  readonly interveneOnEntry: (
    tenantId: string,
    entryId: string,
    input: InterveneInput,
    as: Principal,
  ) => Effect.Effect<EntryView, InterveneError>
}

type ActionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly layer: string; readonly reason: string }

/**
 * What a screen may do with one act on one claim: offer it, offer it
 * disabled with the reason on hover, or not speak of it at all.
 */
export interface ActionAvailability {
  readonly state: 'available' | 'blocked' | 'hidden'
  readonly reason: string | null
}

/** the gated participant acts, decided once per request and refined per item */
export interface EntryGates {
  readonly create: ActionDecision
  readonly edit: ActionDecision
  readonly submit: ActionDecision
  readonly withdraw: ActionDecision
  readonly abandon: ActionDecision
  readonly appeal: ActionDecision
}

export interface EntryDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the first two layers: authority in the batch, then the phase gate */
  readonly authorize: (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: GateContext,
  ) => Effect.Effect<ActionDecision, BatchNotFound>
  /**
   * Every participant act decided for every named item in one pass - the
   * roster once, the gate view once, then pure refinement. Per item because
   * a scoped supplementary phase admits some questions and not others, and
   * a blanket answer would shut them all.
   */
  readonly participantGates: (
    principal: Principal,
    batchId: string,
    participantId: string,
    itemIds: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, EntryGates>, BatchNotFound>
  /** whoever may judge an open round of a claim may read how it got here */
  readonly mayReviewEntry: (
    as: Principal,
    tenantId: string,
    entryId: string,
  ) => Effect.Effect<boolean>
  readonly requireRosterReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<void, AccessDenied>
  /** the same visibility every batch read passes through */
  readonly requireBatchVisible: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<void, AccessDenied>
  readonly parseRange: (text: string) => { start: string; end: string }
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  /** the two storage doors this module walks through, typed to what it uses */
  readonly storage: {
    readonly metadata: (input: {
      readonly tenantId: string
      readonly attachmentId: string
    }) => Effect.Effect<AttachmentMeta, unknown>
    readonly bind: (input: {
      readonly tenantId: string
      readonly attachmentId: string
      readonly ownerUserId: string
    }) => Effect.Effect<AttachmentMeta, unknown>
  }
}

const refuse = (action: string, reason: string) => new EntryActionRefused({ action, reason })

/** filings handed on for review, and the refusals, with nothing else in the labels */
const entrySubmitCount = boundedCounter('qualy.assessment.entry.submit', {
  outcome: ['success', 'refused'],
})

export const makeEntryMethods = (deps: EntryDeps): EntryMethods => {
  const { withDb, storage } = deps

  const driverOf = (item: ItemRow) => deps.itemTypes.get(item.itemType)

  /**
   * A payload through its driver: decoded against the exact configuration
   * the revision will cite, dates held to the round.
   */
  const decodePayload = (
    driver: ItemTypeDriver,
    revision: ItemRevisionRow,
    payload: unknown,
    materialRange: { start: string; end: string },
  ) =>
    Effect.result(driver.decodePayload(revision.formConfig, payload, { materialRange })).pipe(
      Effect.flatMap((decoded) =>
        Result.isFailure(decoded)
          ? Effect.fail(
              new EntryPayloadInvalid({
                issues: (
                  decoded.failure as { issues?: readonly { field: string; reason: string }[] }
                ).issues ?? [{ field: '', reason: 'unreadable' }],
              }),
            )
          : Effect.succeed(decoded.success),
      ),
    )

  /**
   * The attachments a payload cites, held to storage's own facts and bound
   * in the caller's transaction.
   *
   * Trust runs one way: the driver names what the payload claims, storage
   * says what actually exists - who uploaded it, how large it really is,
   * what state it is in. A staged file must be the actor's own; a bound one
   * may only be cited again by the entry that already cites it; nothing
   * retired is ever cited anew.
   */
  const bindAttachments = (input: {
    tenantId: string
    entryId: string | null
    actorId: string
    refs: readonly AttachmentRef[]
  }) =>
    Effect.gen(function* () {
      const issues: { field: string; reason: string }[] = []

      // one file, one field: a duplicate across fields would collide in the
      // relation's key anyway, and quietly picking a field for it would make
      // "which claim does this document back" a matter of iteration order
      const counted = new Map<string, number>()
      for (const ref of input.refs) {
        counted.set(ref.attachmentId, (counted.get(ref.attachmentId) ?? 0) + 1)
      }
      for (const ref of input.refs) {
        if ((counted.get(ref.attachmentId) ?? 0) > 1) {
          issues.push({ field: ref.field, reason: 'duplicate-attachment' })
        }
      }
      if (issues.length > 0) return yield* new EntryPayloadInvalid({ issues })

      // serialize across batches before reading anything: batch locks do not
      // cover two rounds citing one file at the same moment
      yield* lockAttachments(
        input.tenantId,
        input.refs.map((ref) => ref.attachmentId),
      )
      const toBind: { attachmentId: string; ownerUserId: string }[] = []
      const history =
        input.entryId === null
          ? new Set<string>()
          : yield* entryAttachmentHistory(input.tenantId, input.entryId)

      for (const ref of input.refs) {
        const meta = yield* Effect.result(
          storage.metadata({ tenantId: input.tenantId, attachmentId: ref.attachmentId }),
        )
        if (Result.isFailure(meta)) {
          issues.push({ field: ref.field, reason: 'attachment-not-found' })
          continue
        }
        const attachment = meta.success
        if (attachment.status === 'retired') {
          issues.push({ field: ref.field, reason: 'attachment-retired' })
          continue
        }
        // the field's current rules hold for every citation, re-used ones
        // included: a limit tightened after the first upload is a limit, not
        // a suggestion grandfathered away
        if (ref.maxFileBytes !== undefined && attachment.size > BigInt(ref.maxFileBytes)) {
          issues.push({ field: ref.field, reason: 'attachment-too-large' })
          continue
        }
        if (
          ref.accept !== undefined &&
          !acceptable(ref.accept, attachment.declaredMime, attachment.filename)
        ) {
          issues.push({ field: ref.field, reason: 'attachment-type' })
          continue
        }
        if (attachment.status === 'bound') {
          // reuse is an entry keeping its own history, never borrowing
          // another's (assessment-design §5.14)
          if (!history.has(ref.attachmentId)) {
            issues.push({ field: ref.field, reason: 'attachment-cross-entry' })
          }
          continue
        }
        if (attachment.ownerUserId !== input.actorId) {
          issues.push({ field: ref.field, reason: 'attachment-not-yours' })
          continue
        }
        toBind.push({ attachmentId: ref.attachmentId, ownerUserId: attachment.ownerUserId })
      }
      if (issues.length > 0) return yield* new EntryPayloadInvalid({ issues })
      for (const target of toBind) {
        const bound = yield* Effect.result(
          storage.bind({
            tenantId: input.tenantId,
            attachmentId: target.attachmentId,
            ownerUserId: target.ownerUserId,
          }),
        )
        if (Result.isFailure(bound)) {
          return yield* new EntryPayloadInvalid({
            issues: [{ field: '', reason: 'attachment-unavailable' }],
          })
        }
      }
    })

  /** the product's accept list: mime names, `type/*` families, `.ext` suffixes */
  const acceptable = (accept: readonly string[], mime: string, filename: string) =>
    accept.some((entry) =>
      entry.startsWith('.')
        ? filename.toLowerCase().endsWith(entry.toLowerCase())
        : entry.endsWith('/*')
          ? mime.toLowerCase().startsWith(entry.slice(0, -1).toLowerCase())
          : mime.toLowerCase() === entry.toLowerCase(),
    )

  /** the phase gate's word on each participant act, per item, asked once per request */
  const gatesFor = (
    as: Principal,
    batchId: string,
    participantId: string,
    itemIds: readonly string[],
  ) =>
    deps
      .participantGates(as, batchId, participantId, itemIds)
      .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))

  const view = (
    entry: EntryRow,
    revision: EntryRevisionView | null,
    as: Principal,
    participant: ParticipantAnchor | null,
    gates?: EntryGates,
    supplement?: OpenSupplementRow | null,
    refusal?: EntryRefusalView | null,
    /** the open round's provenance, where the caller looked it up */
    standing?: { origin: string; begun: boolean },
  ): EntryView => {
    const own = participant !== null && participant.userId === as.userId
    const active = own && participant.status === 'active'
    // ownership and state say whether an act belongs on this claim at all;
    // the gate says whether this minute allows it. `hidden` is the first
    // kind of no, `blocked` the second - a blocked act renders disabled
    // with its reason, because a vanished button reads as a broken page.
    const when = (fits: boolean, gate?: ActionDecision): ActionAvailability =>
      !active || !fits
        ? { state: 'hidden', reason: null }
        : gate !== undefined && !gate.allowed
          ? { state: 'blocked', reason: gate.reason }
          : { state: 'available', reason: null }
    return {
      id: entry.id,
      batchId: entry.batchId,
      itemId: entry.itemId,
      participantId: entry.participantId,
      status: entry.status,
      source: entry.source,
      currentRevision: revision,
      currentReviewInstanceId: entry.currentReviewInstanceId,
      createdAt: entry.createdAt,
      // only where it is being acted on: an approved claim's history is read
      // in its own account, not pinned to the card
      refusal:
        refusal == null || (entry.status !== 'rejected' && entry.status !== 'needs_revision')
          ? null
          : refusal,
      supplement:
        supplement == null
          ? null
          : {
              requestId: supplement.requestId,
              instanceId: supplement.instanceId,
              requestNo: supplement.requestNo,
              instructions: supplement.instructions,
              requirements: supplement.requirements,
              requestedByName: supplement.requestedByName,
              requestedAt: supplement.requestedAt,
            },
      // discovery, not authorization - the gate is asked again at the act -
      // but the same gate, so a button that renders enabled is a call that
      // goes through. Callers answering a write already hold the fresh row
      // and skip the gates; the screens re-read through the gated paths.
      capabilities: {
        edit: when(
          entry.status === 'draft' ||
            entry.status === 'rejected' ||
            entry.status === 'needs_revision',
          gates?.edit,
        ),
        // a rejected filing may go back as it stands (§32.65): the word was
        // "no, as filed" and the answer may be "look again". What was sent
        // back for revision may not - the round asked for different material
        submit:
          active && entry.status === 'needs_revision'
            ? { state: 'blocked', reason: 'must-revise-first' }
            : when(entry.status === 'draft' || entry.status === 'rejected', gates?.submit),
        // Taking work back to edit ends where review begins (§32.69): once
        // anybody has decided, escalated, asked for material or voted -
        // anywhere along a continuation lineage - the words said stand, and
        // the way out is abandoning the claim, not unsaying the round. An
        // appeal round is not withdrawable at all: taking an appeal back is
        // a different act with a different landing, and it is not built.
        withdraw:
          entry.status === 'in_review' && standing?.origin === 'appeal'
            ? { state: 'hidden', reason: null }
            : active && entry.status === 'in_review' && standing?.begun === true
              ? { state: 'blocked', reason: 'review-under-way' }
              : when(entry.status === 'in_review', gates?.withdraw),
        // There has to be a decision to disagree with. A round is one; so is
        // a determination the office wrote without a round, which is the
        // only thing a student can say about a recorded penalty. A claim the
        // rule approved by itself is neither - nobody formed an opinion
        // there, the configuration did, and that is not a thing to appeal.
        appeal: when(
          (entry.status === 'approved' || entry.status === 'rejected') &&
            (entry.currentReviewInstanceId !== null ||
              ((entry.source === 'record' || entry.source === 'import') &&
                entry.currentRecognitionId !== null)),
          gates?.appeal,
        ),
        // Giving a claim up is open across the whole life of the claim,
        // approved included (§32.69): "the school recognized it" and "its
        // owner still uses it this term" are different facts. The phase
        // plan closes it - typically at final publication - so a full
        // quota can be reworked while the term runs, and nothing moves
        // once results are settled.
        //
        // What a student may give up is what a student put forward. A
        // penalty the office recorded, or a fact an import carried in, is
        // not theirs to withdraw - it was never their claim, and letting
        // them abandon it would be letting them delete a deduction. Undoing
        // an administrative fact is an administrative act (see
        // `interveneOnEntry`), and disagreeing with one is an appeal.
        abandon: when(
          (entry.source === 'self' || entry.source === 'proxy') &&
            (entry.status === 'draft' ||
              entry.status === 'rejected' ||
              entry.status === 'needs_revision' ||
              entry.status === 'in_review' ||
              entry.status === 'approved'),
          gates?.abandon,
        ),
      },
    }
  }

  const revisionView = (tenantId: string, revisionId: string | null) =>
    Effect.gen(function* () {
      if (revisionId === null) return null
      const revision = yield* entryRevisionOf(tenantId, revisionId)
      if (revision === null) return null
      const attachments = yield* revisionAttachmentsOf(tenantId, revisionId)
      return {
        id: revision.id,
        revisionNo: revision.revisionNo,
        itemRevisionId: revision.itemRevisionId,
        payload: revision.payload,
        note: revision.note,
        source: revision.source,
        actorId: revision.actorId,
        subjectId: revision.subjectId,
        attachments,
        createdAt: revision.createdAt,
      } satisfies EntryRevisionView
    })

  /** everything several methods reload: the entry with its item and person */
  const loadEntry = (tenantId: string, entryId: string) =>
    Effect.gen(function* () {
      const entry = yield* entryOf(tenantId, entryId)
      if (entry === null) return null
      const item = yield* itemOf(tenantId, entry.itemId)
      const participant = yield* participantOf(tenantId, entry.batchId, entry.participantId)
      return { entry, item: item!, participant: participant! }
    })

  /**
   * The question has not moved since the caller drew its screen.
   *
   * Checked before the payload is read, so that a form which gained a
   * required field yesterday says "the requirements changed" rather than
   * "this field is missing" - the second sentence sends the reader looking
   * for a field that is not on their screen. A caller that names no version
   * is not making the claim, and nothing is checked for it.
   */
  const sameQuestion = (item: ItemRow, expected: string | undefined) =>
    Effect.gen(function* () {
      if (expected === undefined || item.currentRevisionId === expected) return
      return yield* new ItemRevisionConflict({
        itemId: item.id,
        currentRevisionId: item.currentRevisionId,
      })
    })

  const createEntry: EntryMethods['createEntry'] = Effect.fn('Assessment.createEntry')(
    function* (tenantId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            // the first read only locates the batch; nothing else read
            // before the lock may be trusted - a void can land between the
            // read and the lock, and its whole point is that no new work
            // starts after it
            const located = yield* itemOf(tenantId, input.itemId)
            if (located === null) return yield* new ItemNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (!locked) return yield* new BatchNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const item = (yield* itemOf(tenantId, input.itemId))!
            const participant = yield* participantOf(tenantId, item.batchId, input.participantId)
            if (participant === null) return yield* refuse('create', 'participant-not-found')
            if (participant.status !== 'active') {
              return yield* refuse('create', 'participant-not-active')
            }
            if (item.status !== 'active') return yield* refuse('create', 'item-not-active')
            // a derived question is granted, never filed: there is no claim
            // for anybody - participant or staff - to create under it
            if (driverOf(item)?.interaction === 'derived') {
              return yield* refuse('create', 'item-not-fileable')
            }
            yield* sameQuestion(item, input.expectedItemRevisionId)
            const revision =
              item.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, item.currentRevisionId)
            if (revision === null) return yield* refuse('create', 'item-not-configured')

            // who is filing is the item's decision, never the caller's: a
            // student question takes the participant themselves, an
            // administrative one takes staff whose accepted authority covers
            // this participant's frozen anchor
            const administrative = revision.entrySource === 'administrative'
            const code = administrative ? 'assessment.entry.record' : 'assessment.entry.create'
            if (!administrative && participant.userId !== as.userId) {
              return yield* refuse('create', 'not-your-participant')
            }
            const decision = yield* deps.authorize(as, code, item.batchId, {
              itemId: item.id,
              participantId: participant.id,
            })
            if (!decision.allowed) return yield* refuse('create', decision.reason)
            if (administrative) {
              // A record is one person writing a fact about another, and it
              // is approved the moment it is written - no reviewer ever sees
              // it. Both halves of that depend on the two people being two
              // people: a registrar who also sits on the roster must not be
              // able to hand themselves points nobody looked at. The screen
              // not offering them is a courtesy; this is the rule.
              if (participant.userId === as.userId) {
                return yield* refuse('create', 'self-record-refused')
              }
              const reaches = yield* staffReachesParticipant({
                tenantId,
                batchId: item.batchId,
                userId: as.userId,
                permissionCode: code,
                participant,
              })
              if (!reaches) return yield* refuse('create', 'participant-out-of-reach')
              // the basis is the record: an administrative fact without its
              // document reference is an assertion nobody can check
              if ((input.note ?? '').trim() === '') {
                return yield* refuse('create', 'basis-required')
              }
            }

            if (item.maxEntries !== null) {
              const count = yield* entryCountOf(tenantId, item.id, participant.id)
              if (count >= item.maxEntries) return yield* refuse('create', 'max-entries-reached')
            }

            const batch = yield* oneBatch(tenantId, item.batchId)
            const materialRange = deps.parseRange(String(batch!.materialRange))
            const driver = driverOf(item)
            if (driver === undefined) return yield* refuse('create', 'item-type-not-installed')
            const decoded = yield* decodePayload(driver, revision, input.payload, materialRange)
            const plan = yield* Effect.orDie(readScoringPlan(revision))
            // a determination is a thing only an approving door may carry:
            // a student filing a claim does not get to say what it is worth
            if (!administrative && input.recognition !== undefined) {
              return yield* new EntryPayloadInvalid({
                issues: [{ field: 'recognition', reason: 'not-allowed' }],
              })
            }
            // and where the door does carry one, it has to actually carry
            // it: a record is approved the moment it is written, so a
            // request that omits a non-empty determination would have the
            // defaults recorded as the officer's words unseen
            if (
              administrative &&
              input.recognition === undefined &&
              Object.keys(plan.recognitionSchemas).length > 0
            ) {
              return yield* new EntryPayloadInvalid({
                issues: [{ field: 'recognition', reason: 'required' }],
              })
            }

            // An administrative record is approved the moment it is filed,
            // but it becomes approved in the statement below rather than in
            // this one: the row has to have a determination before it can
            // call itself approved, and the determination needs the row.
            const entryId = yield* insertEntry({
              tenantId,
              batchId: item.batchId,
              itemId: item.id,
              participantId: participant.id,
              source: administrative ? 'record' : 'self',
              status: 'draft',
            })
            const revisionId = yield* insertEntryRevision({
              tenantId,
              entryId,
              itemId: item.id,
              itemRevisionId: revision.id,
              revisionNo: 1,
              payload: decoded,
              actorId: as.userId,
              subjectId: participant.userId,
              source: administrative ? 'record' : 'self',
              note: input.note?.trim() || null,
            })
            const refs = driver.attachmentRefs(revision.formConfig, decoded)
            yield* bindAttachments({ tenantId, entryId: null, actorId: as.userId, refs })
            yield* insertRevisionAttachments(
              tenantId,
              revisionId,
              refs.map((ref, position) => ({ attachmentId: ref.attachmentId, position })),
            )
            // What the office determined by recording this.
            //
            // The member of staff filing it is its author, so what they send
            // is authoritative and the plan's defaults are only what the form
            // was pre-filled with. Either way it is proven complete before
            // the claim becomes approved.
            const recognitionId = administrative
              ? yield* insertRecognition({
                  tenantId,
                  batchId: item.batchId,
                  entryId,
                  entryRevisionId: revisionId,
                  itemId: item.id,
                  itemRevisionId: revision.id,
                  // the same rule as a reviewer's approval: the defaults
                  // pre-fill the form, they do not stand in for the officer
                  // confirming them. Only the contract that asks for nothing
                  // is answered by omission.
                  values: yield* provenRecognition(
                    plan,
                    input.recognition === undefined ? {} : input.recognition.values,
                  ),
                  source: 'record',
                  createdBy: as.userId,
                })
              : undefined
            yield* setEntryState({
              tenantId,
              entryId,
              from: ['draft'],
              to: administrative ? 'approved' : 'draft',
              currentRevisionId: revisionId,
              ...(recognitionId === undefined ? {} : { currentRecognitionId: recognitionId }),
            })
            // a fact somebody else just added to their account is exactly
            // what the unread marker exists for: the broadcast reaches whoever
            // is looking, this reaches whoever is not
            if (administrative) yield* bumpParticipantAttention(tenantId, entryId)
            yield* announce(tenantId, item.batchId, [
              { kind: 'entries-changed', subjectUserId: participant.userId },
              ...(administrative
                ? [{ kind: 'result-changed' as const, subjectUserId: participant.userId }]
                : []),
            ])
            const entry = (yield* entryOf(tenantId, entryId))!
            return view(entry, yield* revisionView(tenantId, revisionId), as, participant)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const getEntry: EntryMethods['getEntry'] = Effect.fn('Assessment.getEntry')(
    function* (tenantId, entryId, as) {
      return yield* withDb(
        Effect.gen(function* () {
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          // the owner reads their own history whatever their standing now
          // (§32.56); everyone else needs administrative reach, and learns
          // nothing - not even existence - without it
          if (participant.userId !== as.userId) {
            const reach = yield* Effect.result(deps.requireRosterReach(as, tenantId, entry.batchId))
            if (Result.isFailure(reach)) return yield* new EntryNotFound()
          }
          const asked = yield* openSupplementsOfEntries(tenantId, [entryId])
          const said = yield* latestRefusalOf(tenantId, [entryId])
          const standings =
            entry.status === 'in_review' && entry.currentReviewInstanceId !== null
              ? yield* withdrawStandingsOf(tenantId, [entry.currentReviewInstanceId])
              : new Map<string, { origin: string; begun: boolean }>()
          return view(
            entry,
            yield* revisionView(tenantId, entry.currentRevisionId),
            as,
            participant,
            undefined,
            asked[0] ?? null,
            said.get(entryId) ?? null,
            entry.currentReviewInstanceId === null
              ? undefined
              : standings.get(entry.currentReviewInstanceId),
          )
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const appendEntryRevision: EntryMethods['appendEntryRevision'] = Effect.fn(
    'Assessment.appendEntryRevision',
  )(function* (tenantId, entryId, input, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const located = yield* entryOf(tenantId, entryId)
          if (located === null) return yield* new EntryNotFound()
          const locked = yield* lockBatch(tenantId, located.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          // only what was read under the lock is trusted; the locate read
          // races with voids by design
          const { entry, item, participant } = (yield* loadEntry(tenantId, entryId))!
          // editing is the subject's own act, always: proxies file once and
          // hold nothing afterwards, staff records are corrected by voiding
          if (participant.userId !== as.userId) return yield* refuse('edit', 'not-your-entry')
          if (participant.status !== 'active')
            return yield* refuse('edit', 'participant-not-active')
          if (entry.source === 'record' || entry.source === 'import') {
            return yield* refuse('edit', 'entry-not-editable')
          }
          if (
            entry.status !== 'draft' &&
            entry.status !== 'rejected' &&
            entry.status !== 'needs_revision'
          ) {
            return yield* refuse('edit', 'entry-not-editable')
          }
          if (item.status !== 'active') return yield* refuse('edit', 'item-not-active')
          yield* sameQuestion(item, input.expectedItemRevisionId)
          const revision =
            item.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, item.currentRevisionId)
          if (revision === null || revision.entrySource !== 'student') {
            return yield* refuse('edit', 'entry-not-editable')
          }
          const decision = yield* deps
            .authorize(as, 'assessment.entry.edit', entry.batchId, {
              itemId: item.id,
              participantId: participant.id,
            })
            .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
          if (!decision.allowed) return yield* refuse('edit', decision.reason)

          const batch = yield* oneBatch(tenantId, entry.batchId)
          const materialRange = deps.parseRange(String(batch!.materialRange))
          const driver = driverOf(item)
          if (driver === undefined) return yield* refuse('edit', 'item-type-not-installed')
          const decoded = yield* decodePayload(driver, revision, input.payload, materialRange)
          const revisionNo = yield* nextEntryRevisionNo(tenantId, entryId)
          const revisionId = yield* insertEntryRevision({
            tenantId,
            entryId,
            itemId: item.id,
            itemRevisionId: revision.id,
            revisionNo,
            payload: decoded,
            actorId: as.userId,
            subjectId: participant.userId,
            source: 'self',
            note: input.note?.trim() || null,
          })
          const refs = driver.attachmentRefs(revision.formConfig, decoded)
          yield* bindAttachments({ tenantId, entryId, actorId: as.userId, refs })
          yield* insertRevisionAttachments(
            tenantId,
            revisionId,
            refs.map((ref, position) => ({ attachmentId: ref.attachmentId, position })),
          )
          // a rejected entry, or one an administrator sent back, re-enters
          // work through its next revision
          yield* setEntryState({
            tenantId,
            entryId,
            from: ['draft', 'rejected', 'needs_revision'],
            to: 'draft',
            currentRevisionId: revisionId,
          })
          yield* announce(tenantId, entry.batchId, [
            { kind: 'entries-changed', subjectUserId: participant.userId },
          ])
          const written = (yield* entryOf(tenantId, entryId))!
          return view(written, yield* revisionView(tenantId, revisionId), as, participant)
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  const setEntryStatus: EntryMethods['setEntryStatus'] = Effect.fn('Assessment.setEntryStatus')(
    function* (tenantId, entryId, to, as, expectedItemRevisionId) {
      const acted = withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* entryOf(tenantId, entryId)
            if (located === null) return yield* new EntryNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            const { entry, item, participant } = (yield* loadEntry(tenantId, entryId))!
            const action = to === 'in_review' ? 'submit' : to === 'voided' ? 'abandon' : 'withdraw'
            // only handing it on is a decision about today's rules; taking
            // it back or giving it up must not be refused because the form
            // moved (§32.69)
            if (to === 'in_review') yield* sameQuestion(item, expectedItemRevisionId)
            if (participant.userId !== as.userId) return yield* refuse(action, 'not-your-entry')
            // the projection hides it; this is where it is refused. A fact
            // the office recorded or an import carried in is not the
            // subject's to withdraw, whatever the phase allows in general
            if (
              action === 'abandon' &&
              entry.source !== 'self' &&
              entry.source !== 'proxy'
            ) {
              return yield* refuse(action, 'entry-not-abandonable')
            }
            if (participant.status !== 'active') {
              return yield* refuse(action, 'participant-not-active')
            }
            // every act answers to the phase plan, abandoning included
            // (§32.69): the plan is what keeps settled results still
            const code =
              to === 'in_review'
                ? 'assessment.entry.submit'
                : to === 'voided'
                  ? 'assessment.entry.abandon'
                  : 'assessment.entry.withdraw'
            const decision = yield* deps
              .authorize(as, code, entry.batchId, {
                itemId: item.id,
                participantId: participant.id,
              })
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
            if (!decision.allowed) return yield* refuse(action, decision.reason)

            if (to === 'in_review') {
              // draft, or rejected as it stands (§32.65): the round said no
              // to this filing, and re-asking with the same filing is the
              // participant's right. needs_revision is not - that round
              // asked for different material and only a new version answers
              if (entry.status !== 'draft' && entry.status !== 'rejected') {
                return yield* refuse(action, 'entry-not-submittable')
              }
              if (item.status !== 'active') return yield* refuse(action, 'item-not-active')
              if (entry.currentRevisionId === null) {
                return yield* refuse(action, 'entry-not-submittable')
              }
              const current = yield* entryRevisionOf(tenantId, entry.currentRevisionId)
              // Two versions of the question, two different jobs (§32.62).
              // What was written is read as an answer to the form it was
              // written under; what happens to it now - which form it has to
              // satisfy, whose route it walks - is the question as it stands
              // today. Nothing has begun yet, so there is nothing to
              // grandfather: a draft that has been sitting since before the
              // form gained a required field is a draft that is not finished.
              const written = yield* revisionOf(tenantId, current!.itemRevisionId)
              const live =
                item.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, item.currentRevisionId)
              if (written === null || live === null) {
                return yield* refuse(action, 'item-not-configured')
              }
              const batch = yield* oneBatch(tenantId, entry.batchId)
              const driver = driverOf(item)
              if (driver === undefined) return yield* refuse(action, 'item-type-not-installed')
              const carried =
                driver.projectPayload === undefined
                  ? current!.payload
                  : driver.projectPayload(written.formConfig, live.formConfig, current!.payload)
              const readable = yield* Effect.result(
                driver.decodePayload(live.formConfig, carried, {
                  materialRange: deps.parseRange(String(batch!.materialRange)),
                }),
              )
              if (Result.isFailure(readable)) {
                // not "you cannot submit": the form asks for something this
                // draft does not have yet, and the way on is to go and fill
                // it in
                return yield* refuse(action, 'entry-needs-revision')
              }

              // A question that answers to nobody (§32.65, mode:'none'):
              // the submission is the decision. Approved on the spot, said
              // in the entry's own record, and no round ever exists - so
              // there is nothing to withdraw and nothing to appeal.
              if (policyModeOf(live.reviewPolicy) === 'none') {
                // determined by the rule itself, against the configuration
                // in force now - the same one that decided there is nobody
                // to ask. A previous determination, if this claim was
                // approved before, is superseded rather than edited.
                const standing = yield* currentRecognitionOf(tenantId, entryId)
                const livePlan = yield* Effect.orDie(readScoringPlan(live))
                const recognitionId = yield* insertRecognition({
                  tenantId,
                  batchId: entry.batchId,
                  entryId,
                  entryRevisionId: current!.id,
                  itemId: entry.itemId,
                  itemRevisionId: live.id,
                  // nobody is going to be asked, so the defaults are the
                  // whole determination - and if they do not add up to a
                  // complete one, this claim cannot become approved at all.
                  // The compiler refuses that configuration, so reaching it
                  // means the question changed under an old plan.
                  values: yield* provenRecognition(
                    livePlan,
                    seedFromEvidence(livePlan, carried),
                  ).pipe(
                    // nobody is misfiling anything: the question was
                    // configured so that a claim nobody reviews cannot be
                    // fully determined, which is a refusal about this round
                    Effect.catchTag('ASSESSMENT_ENTRY_PAYLOAD_INVALID', () =>
                      refuse(action, 'item-not-configured'),
                    ),
                  ),
                  source: 'system',
                  createdBy: as.userId,
                  ...(standing === null ? {} : { supersedesId: standing.id }),
                })
                const settled = yield* setEntryState({
                  tenantId,
                  entryId,
                  from: ['draft', 'rejected'],
                  to: 'approved',
                  currentRecognitionId: recognitionId,
                  // A claim that was refused, and is now approved by a rule
                  // instead, no longer stands on that refusal. Leaving the
                  // old round attached would keep offering an appeal against
                  // a decision this approval has already replaced.
                  currentReviewInstanceId: null,
                })
                if (!settled) return yield* refuse(action, 'entry-not-submittable')
                yield* insertEntryEvent({
                  tenantId,
                  entryId,
                  kind: 'auto-approved',
                  actorId: as.userId,
                })
                yield* announce(tenantId, entry.batchId, [
                  { kind: 'entries-changed', subjectUserId: participant.userId },
                  { kind: 'result-changed', subjectUserId: participant.userId },
                ])
                const written = (yield* entryOf(tenantId, entryId))!
                const { participant: after } = (yield* loadEntry(tenantId, entryId))!
                return view(
                  written,
                  yield* revisionView(tenantId, written.currentRevisionId),
                  as,
                  after,
                )
              }

              // Both routes, resolved once against this person's frozen
              // lineage and snapshotted. The escalation route is resolved here
              // too, though most rounds never reach it: escalating must
              // not re-resolve an organization that has moved since (§14).
              const policy = yield* resolvePolicy({
                tenantId,
                batchId: entry.batchId,
                policy: readPolicy(live.reviewPolicy),
                lineage: participant.anchorLineage,
              })
              const first = enterableFrom(policy, 'normal', 0)
              // every stage named a level this person sits under none of:
              // there is nowhere to anchor a round, and no later grant can
              // supply it - the configuration itself is wrong here
              if (first === null) return yield* refuse(action, 'review-level-missing')
              const nodePath = yield* nodePathOf(tenantId, first.nodeId!)
              if (nodePath === null) return yield* refuse(action, 'review-level-missing')
              // Nobody can act at the stage today - which is the round's
              // problem, not this person's. The round is written down as
              // blocked with its reason so the patrol and the alert panel
              // own it, and it heals the moment somebody is appointed (§14).
              const arrived = yield* stageArrival({
                tenantId,
                batchId: entry.batchId,
                stage: first,
                subjectUserId: participant.userId,
                actorId: current!.actorId,
              })

              const roundNo = yield* nextRoundNo(tenantId, entryId)
              const instanceId = yield* insertReviewInstance({
                tenantId,
                entryId,
                revisionId: entry.currentRevisionId,
                roundNo,
                policyRevisionId: live.id,
                // the same revision today, said twice on purpose: procedure and
                // recognition contract are separate facts about this round
                recognitionRevisionId: live.id,
                effectivePolicy: policy,
                // an ordinary submission: it walks the ordinary route, and
                // whoever it reaches may end it (§32.63)
                route: 'normal',
                stageId: first.id,
                roleIds: first.roleIds,
                nodeId: first.nodeId!,
                nodePath,
                state: arrived.state,
                blockedReason: arrived.blockedReason,
              })
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: instanceId,
                kind: 'submitted',
                actorId: as.userId,
                route: 'normal',
                stageId: first.id,
              })
              if (arrived.state === 'blocked') {
                yield* insertReviewEvent({
                  tenantId,
                  reviewInstanceId: instanceId,
                  kind: 'assignee-not-found',
                  actorId: null,
                  route: 'normal',
                  stageId: first.id,
                })
              }
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: ['draft', 'rejected'],
                to: 'in_review',
                currentReviewInstanceId: instanceId,
              })
              // unreachable while the batch lock is held over a fresh read;
              // checked so a future reordering fails loudly instead of
              // leaving a review round attached to nothing
              if (!moved) return yield* refuse(action, 'entry-not-submittable')
            } else if (to === 'voided') {
              // Walking away from a claim (§32.65, widened by §32.69): the
              // history stays - the rounds, the words, the versions - and
              // the quota place opens. A live round is closed as cancelled
              // first; an approved conclusion is left exactly as written -
              // the review was not undone, the claim just stopped being
              // used - and the scorer stops counting it because the entry
              // is no longer an effective fact.
              if (entry.status === 'voided') {
                return yield* refuse(action, 'entry-not-abandonable')
              }
              if (entry.status === 'in_review') {
                if (entry.currentReviewInstanceId === null) {
                  return yield* refuse(action, 'entry-not-abandonable')
                }
                const cancelled = yield* cancelReviewInstance({
                  tenantId,
                  instanceId: entry.currentReviewInstanceId,
                  outcome: 'cancelled',
                })
                if (!cancelled) return yield* refuse(action, 'entry-not-abandonable')
                yield* insertReviewEvent({
                  tenantId,
                  reviewInstanceId: entry.currentReviewInstanceId,
                  kind: 'cancelled-by-submitter',
                  actorId: as.userId,
                })
              }
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: ['draft', 'rejected', 'needs_revision', 'in_review', 'approved'],
                to: 'voided',
                ...(entry.status === 'in_review' ? { currentReviewInstanceId: null } : {}),
              })
              if (!moved) return yield* refuse(action, 'entry-not-abandonable')
              yield* insertEntryEvent({
                tenantId,
                entryId,
                kind: 'abandoned-by-submitter',
                actorId: as.userId,
              })
            } else {
              if (entry.status !== 'in_review' || entry.currentReviewInstanceId === null) {
                return yield* refuse(action, 'entry-not-withdrawable')
              }
              // withdrawing ends where review begins (§32.69), and an
              // appeal round is never withdrawable back to draft - the
              // decision under appeal would be quietly unmade with it
              const standing = (yield* withdrawStandingsOf(tenantId, [
                entry.currentReviewInstanceId,
              ])).get(entry.currentReviewInstanceId)
              if (standing?.origin === 'appeal') {
                return yield* refuse(action, 'appeal-not-withdrawable')
              }
              if (standing?.begun === true) {
                return yield* refuse(action, 'review-under-way')
              }
              const cancelled = yield* cancelReviewInstance({
                tenantId,
                instanceId: entry.currentReviewInstanceId,
                outcome: 'cancelled',
              })
              if (!cancelled) return yield* refuse(action, 'entry-not-withdrawable')
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: entry.currentReviewInstanceId,
                kind: 'cancelled-by-submitter',
                actorId: as.userId,
              })
              const moved = yield* setEntryState({
                tenantId,
                entryId,
                from: ['in_review'],
                to: 'draft',
                currentReviewInstanceId: null,
              })
              if (!moved) return yield* refuse(action, 'entry-not-withdrawable')
              // the user act in the entry's own ledger: the round's
              // cancelled-by-submitter above is closing bookkeeping, and
              // the activity feed must not have to guess which business
              // act - withdraw or abandon - stood behind it (§32.73)
              yield* insertEntryEvent({
                tenantId,
                entryId,
                kind: 'withdrawn-by-submitter',
                actorId: as.userId,
              })
            }
            // coarse across the three branches: whichever way the claim
            // moved, its owner's paper, the reviewers' queues and any open
            // round may all read differently now
            yield* announce(tenantId, entry.batchId, [
              { kind: 'entries-changed', subjectUserId: participant.userId },
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
              { kind: 'result-changed', subjectUserId: participant.userId },
            ])
            const written = (yield* entryOf(tenantId, entryId))!
            return view(
              written,
              yield* revisionView(tenantId, written.currentRevisionId),
              as,
              participant,
            )
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
      // only the handing-on is a counted business signal; a typed failure is
      // a refusal, a defect is an outage and stays out of the business count
      return yield* to === 'in_review'
        ? acted.pipe(
            Effect.tap(() => entrySubmitCount({ outcome: 'success' })),
            Effect.tapError(() => entrySubmitCount({ outcome: 'refused' })),
          )
        : acted
    },
  )

  const listMyEntries: EntryMethods['listMyEntries'] = Effect.fn('Assessment.listMyEntries')(
    function* (tenantId, batchId, page, as) {
      const fingerprint = `my-entries:${batchId}:${as.userId}`
      const key = readQueryCursor(page.cursor, fingerprint, ['timestamp', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      return yield* withDb(
        Effect.gen(function* () {
          const batch = yield* oneBatch(tenantId, batchId)
          if (!batch) return yield* new BatchNotFound()
          // one's own filings only, behind the same door as every other
          // read of the round; the membership row is historical standing
          yield* deps.requireBatchVisible(tenantId, batchId, as)
          const membership = yield* participantRowByUser(tenantId, batchId, as.userId)
          if (membership === null) return yield* new ParticipantNotFound()
          const participant = (yield* participantOf(tenantId, batchId, membership.id))!
          const rows = yield* entriesOfParticipantPage({
            tenantId,
            batchId,
            participantId: membership.id,
            after: key === undefined ? undefined : [key[0]!, key[1]!],
            limit: limit + 1,
          })
          const pageRows = rows.slice(0, limit)
          // gates per item: the questions being asked now, plus whatever
          // items the page's claims still name (a claim outlives its item)
          const activeItems = yield* activeItemIdsOf(tenantId, batchId)
          const gatesByItem = yield* gatesFor(as, batchId, membership.id, [
            ...new Set([...activeItems, ...pageRows.map((entry) => entry.itemId)]),
          ])
          const askedByEntry = new Map(
            (yield* openSupplementsOfEntries(
              tenantId,
              pageRows.map((entry) => entry.id),
            )).map((asked) => [asked.entryId, asked]),
          )
          // one query for the page, not one per card
          const standings = yield* withdrawStandingsOf(
            tenantId,
            pageRows
              .filter((one) => one.status === 'in_review' && one.currentReviewInstanceId !== null)
              .map((one) => one.currentReviewInstanceId!),
          )
          const saidByEntry = yield* latestRefusalOf(
            tenantId,
            pageRows
              .filter((one) => one.status === 'rejected' || one.status === 'needs_revision')
              .map((one) => one.id),
          )
          const entries: EntryView[] = []
          for (const entry of pageRows) {
            entries.push(
              view(
                entry,
                yield* revisionView(tenantId, entry.currentRevisionId),
                as,
                participant,
                gatesByItem.get(entry.itemId),
                askedByEntry.get(entry.id) ?? null,
                saidByEntry.get(entry.id) ?? null,
                entry.currentReviewInstanceId === null
                  ? undefined
                  : standings.get(entry.currentReviewInstanceId),
              ),
            )
          }
          // What filing into each question would meet at the gate, before
          // any claim exists. Discovery only, like the per-claim block: the
          // act itself is authorized again on the way in. Structural reasons
          // (quota, source, a voided item) stay with the screen - these rows
          // answer for the phase.
          const own = participant.userId === as.userId && participant.status === 'active'
          const opening = (decision?: ActionDecision): ActionAvailability =>
            !own
              ? { state: 'hidden', reason: null }
              : decision !== undefined && !decision.allowed
                ? { state: 'blocked', reason: decision.reason }
                : { state: 'available', reason: null }
          const filing = activeItems.map((itemId) => {
            const gate = gatesByItem.get(itemId)
            return { itemId, create: opening(gate?.create), submit: opening(gate?.submit) }
          })
          const last = pageRows[pageRows.length - 1]
          const lastIso =
            rows.length > limit && last !== undefined
              ? yield* entryCreatedIso(tenantId, last.id)
              : null
          return {
            participantId: membership.id,
            entries,
            filing,
            nextCursor:
              lastIso !== null && last !== undefined
                ? encodeQueryCursor(fingerprint, [lastIso, last.id])
                : null,
            attention: {
              unreadItemIds: yield* unreadItemIdsOf({
                tenantId,
                batchId,
                participantId: membership.id,
              }),
            },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const getEntryHistory: EntryMethods['getEntryHistory'] = Effect.fn('Assessment.getEntryHistory')(
    function* (tenantId, entryId, as) {
      return yield* withDb(
        Effect.gen(function* () {
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          // the same read rule as the entry itself (§32.56), plus the one
          // this screen exists for: whoever is judging an open round of this
          // claim reads how it got here. Anyone else learns nothing, not
          // even that it exists.
          if (participant.userId !== as.userId) {
            const judging = yield* deps.mayReviewEntry(as, tenantId, entryId)
            if (!judging) {
              const reach = yield* Effect.result(
                deps.requireRosterReach(as, tenantId, entry.batchId),
              )
              if (Result.isFailure(reach)) return yield* new EntryNotFound()
            }
          }
          const revisions = yield* entryRevisionsOf(tenantId, entryId)
          const forms = new Map<string, unknown>()
          for (const itemRevisionId of new Set(revisions.map((r) => r.itemRevisionId))) {
            const cited = yield* revisionOf(tenantId, itemRevisionId)
            forms.set(itemRevisionId, cited?.formConfig ?? null)
          }
          const attachments = yield* attachmentsOfRevisions(
            tenantId,
            revisions.map((revision) => revision.id),
          )
          const rounds = yield* roundsOfEntry(tenantId, entryId)
          const events = yield* eventsOfRounds(
            tenantId,
            rounds.map((round) => round.id),
          )
          const ownEvents = yield* entryEventsOf(tenantId, entryId)
          const asked = yield* openSupplementsOfEntries(tenantId, [entryId])
          const said = yield* latestRefusalOf(tenantId, [entryId])
          const supplements = yield* supplementsOfInstances(
            tenantId,
            rounds.map((round) => round.id),
          )
          return {
            entry: view(
              entry,
              yield* revisionView(tenantId, entry.currentRevisionId),
              as,
              participant,
              undefined,
              asked[0] ?? null,
              said.get(entryId) ?? null,
            ),
            revisions: revisions.map((revision) => ({
              id: revision.id,
              revisionNo: revision.revisionNo,
              itemRevisionId: revision.itemRevisionId,
              payload: revision.payload,
              note: revision.note,
              source: revision.source,
              actorId: revision.actorId,
              subjectId: revision.subjectId,
              attachments: attachments.get(revision.id) ?? [],
              createdAt: revision.createdAt,
              formConfig: forms.get(revision.itemRevisionId) ?? null,
            })),
            rounds: rounds.map((round): EntryRoundView => ({
              id: round.id,
              roundNo: round.roundNo,
              state: round.state,
              outcome: round.outcome,
              revisionId: round.revisionId,
              origin: round.origin,
              supersedesInstanceId: round.supersedesInstanceId,
              appealedInstanceId: round.appealedInstanceId,
              appealedRecognitionId: round.appealedRecognitionId,
              submittedAt: round.createdAt,
              completedAt: round.completedAt,
              events: (events.get(round.id) ?? []).map((event) => ({
                kind: event.kind,
                actorId: event.actorId,
                actorName: event.actorName,
                reason: event.reason,
                comment: event.comment,
                suggestedPayload: event.suggestedPayload,
                at: event.createdAt,
              })),
              supplements: supplements.get(round.id) ?? [],
            })),
            events: ownEvents.map((event) => ({
              kind: event.kind,
              actorId: event.actorId,
              actorName: event.actorName,
              reason: event.reason,
              at: event.createdAt,
            })),
          }
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  /**
   * The round's arrangements changed under a claim, and somebody who may
   * change them says so.
   *
   * Deliberately not `decideReview`: that one asks whether the caller really
   * holds the level the round is standing at, and it should keep asking. An
   * administrator whose level has nobody in it does not become that level's
   * reviewer by having the power to fix the question - they end the round and
   * hand the claim back, in those words.
   *
   * The review phase gate is not consulted either. This is how a claim
   * stranded on an empty level gets out, and a gate that has since closed is
   * exactly the situation it has to work in.
   */
  const interveneOnEntry: EntryMethods['interveneOnEntry'] = Effect.fn(
    'Assessment.interveneOnEntry',
  )(function* (tenantId, entryId, input, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const located = yield* entryOf(tenantId, entryId)
          if (located === null) return yield* new EntryNotFound()
          const locked = yield* lockBatch(tenantId, located.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          const reason = input.reason.trim()
          if (reason === '') {
            return yield* refuse(input.kind === 'void' ? 'abandon' : 'return', 'reason-required')
          }
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          const administrative = entry.source === 'record' || entry.source === 'import'

          // Two interventions, two authorities - asked on the locked
          // connection, like every other write here. Sending a claim back is
          // running the round, which is the batch administrator's power.
          // Withdrawing a recorded fact is unmaking a record, and the design
          // gives that to whoever could have made it: the record authority,
          // over this participant's frozen anchor. A batch administrator
          // without it must not be able to unmake a deduction they could
          // never have entered, and the registrar who could must not need
          // the batch to be theirs.
          if (input.kind === 'void') {
            const decision = yield* deps
              .authorize(as, 'assessment.entry.record', located.batchId, {
                itemId: entry.itemId,
                participantId: participant.id,
              })
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
            if (!decision.allowed) return yield* refuse('abandon', decision.reason)
            // the same two-people rule as making the record: unmaking one
            // is the same power, so the subject of a deduction who happens
            // to hold it must not be able to erase the deduction. Their way
            // to disagree is the appeal, which somebody else decides.
            if (participant.userId === as.userId) {
              return yield* refuse('abandon', 'self-record-refused')
            }
            const reaches = yield* staffReachesParticipant({
              tenantId,
              batchId: located.batchId,
              userId: as.userId,
              permissionCode: 'assessment.entry.record',
              participant,
            })
            if (!reaches) return yield* refuse('abandon', 'participant-out-of-reach')
          } else {
            yield* deps.requireRosterReach(as, tenantId, located.batchId)
          }

          // Withdrawing a fact nobody filed.
          //
          // Its subject cannot abandon it - a student deleting a penalty is
          // the thing that rule exists to stop - so somebody has to be able
          // to, and it is whoever could have recorded it. The determination
          // stays exactly as written: the office is not saying it never
          // decided, it is saying the fact no longer applies, and the scorer
          // stops counting it because the claim is no longer effective.
          if (input.kind === 'void') {
            if (!administrative) {
              // a claim its owner filed is theirs to give up; an
              // administrator taking it away is a different power and not
              // one anybody has asked for
              return yield* refuse('abandon', 'entry-not-abandonable')
            }
            if (entry.status === 'voided') {
              return yield* refuse('abandon', 'entry-not-abandonable')
            }
            // The same lifecycle discipline as its owner walking away: a
            // live round - an appeal against this record - closes first, and
            // its sitting dissolves with it. Left open, the withdrawn fact
            // would go on sitting in reviewers' queues, still accepting
            // decisions about a claim that no longer counts.
            if (entry.status === 'in_review') {
              if (entry.currentReviewInstanceId === null) {
                return yield* refuse('abandon', 'entry-not-abandonable')
              }
              const closed = yield* cancelReviewInstance({
                tenantId,
                instanceId: entry.currentReviewInstanceId,
                outcome: 'cancelled',
              })
              if (!closed) return yield* refuse('abandon', 'entry-not-abandonable')
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: entry.currentReviewInstanceId,
                kind: 'cancelled-by-staff',
                actorId: as.userId,
                comment: reason,
              })
            }
            const gone = yield* setEntryState({
              tenantId,
              entryId,
              from: ['draft', 'rejected', 'needs_revision', 'in_review', 'approved'],
              to: 'voided',
              ...(entry.status === 'in_review' ? { currentReviewInstanceId: null } : {}),
            })
            if (!gone) return yield* refuse('abandon', 'entry-not-abandonable')
            yield* insertEntryEvent({
              tenantId,
              entryId,
              kind: 'voided-by-staff',
              actorId: as.userId,
              reason,
            })
            // their effective facts and their score just changed under them;
            // the persistent marker is what an offline participant comes
            // back to
            yield* bumpParticipantAttention(tenantId, entryId)
            yield* announce(tenantId, entry.batchId, [
              { kind: 'entries-changed', subjectUserId: participant.userId },
              { kind: 'result-changed', subjectUserId: participant.userId },
              // the queues too: a round just left them
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
            ])
            const gone_ = (yield* entryOf(tenantId, entryId))!
            return view(gone_, yield* revisionView(tenantId, gone_.currentRevisionId), as, participant)
          }

          if (entry.status !== 'in_review' && entry.status !== 'approved') {
            return yield* refuse('return', 'entry-not-returnable')
          }
          // a recorded fact is not its subject's to rewrite, so handing it
          // back would leave it somewhere nobody can act: those are corrected
          // by voiding and recording again
          if (administrative) {
            return yield* refuse('return', 'entry-not-returnable')
          }
          if (entry.currentReviewInstanceId !== null) {
            const ended = yield* cancelReviewInstance({
              tenantId,
              instanceId: entry.currentReviewInstanceId,
              outcome: 'superseded',
            })
            if (ended) {
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: entry.currentReviewInstanceId,
                kind: 'returned-for-revision',
                actorId: as.userId,
                comment: reason,
              })
            }
          }
          const moved = yield* setEntryState({
            tenantId,
            entryId,
            from: ['in_review', 'approved'],
            to: 'needs_revision',
            currentReviewInstanceId: null,
          })
          if (!moved) return yield* refuse('return', 'entry-not-returnable')
          // an approved claim sent back has no open round to record this in,
          // and it is not a rejection: it gets its own line in the entry's
          // own log
          yield* insertEntryEvent({
            tenantId,
            entryId,
            kind: 'revision-required',
            actorId: as.userId,
            reason,
          })
          yield* bumpParticipantAttention(tenantId, entryId)
          // the paper too: a claim sent back from `approved` stops counting
          // the moment it moves, and the points it was carrying are gone
          yield* announce(tenantId, entry.batchId, [
            { kind: 'entries-changed', subjectUserId: participant.userId },
            { kind: 'review-inbox-changed' },
            { kind: 'review-instance-changed' },
            { kind: 'result-changed', subjectUserId: participant.userId },
          ])
          const written = (yield* entryOf(tenantId, entryId))!
          return view(
            written,
            yield* revisionView(tenantId, written.currentRevisionId),
            as,
            participant,
          )
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  /** the caller's own participant row behind the batch door, or the refusals */
  const myMembership = Effect.fn('Assessment.myMembership')(function* (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) {
    const batch = yield* oneBatch(tenantId, batchId)
    if (!batch) return yield* new BatchNotFound()
    yield* deps.requireBatchVisible(tenantId, batchId, as)
    const membership = yield* participantRowByUser(tenantId, batchId, as.userId)
    if (membership === null) return yield* new ParticipantNotFound()
    return membership
  })

  const markMyEntryRead: EntryMethods['markMyEntryRead'] = Effect.fn('Assessment.markMyEntryRead')(
    function* (tenantId, batchId, itemId, as) {
      return yield* withDb(
        Effect.gen(function* () {
          const membership = yield* myMembership(tenantId, batchId, as)
          // a look is not a business act: no phase gate, no updatedAt, no
          // announcement - and marking a question with no claims is a no-op
          yield* markMyEntryReads({ tenantId, batchId, itemId, participantId: membership.id })
          return { ok: true as const }
        }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const getMyEntrySummary: EntryMethods['getMyEntrySummary'] = Effect.fn(
    'Assessment.getMyEntrySummary',
  )(function* (tenantId, batchId, as) {
    return yield* withDb(
      Effect.gen(function* () {
        const membership = yield* myMembership(tenantId, batchId, as)
        const unread = yield* unreadItemIdsOf({ tenantId, batchId, participantId: membership.id })
        const actions = yield* myActionRowsOf({
          tenantId,
          batchId,
          participantId: membership.id,
        })
        return {
          unreadItemIds: unread,
          actions: actions.map((row) => ({
            kind: row.kind,
            entryId: row.entryId,
            itemId: row.itemId,
            itemTitle: row.itemTitle,
            at: row.at,
            who: row.who,
            summary: row.summary,
          })),
        }
      }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  return {
    listMyEntries,
    getEntryHistory,
    createEntry,
    getEntry,
    appendEntryRevision,
    setEntryStatus,
    markMyEntryRead,
    getMyEntrySummary,
    interveneOnEntry,
  }
}
