import { Effect, Result } from 'effect'
import {
  insertRecognition,
  currentRecognitionOf,
  currentRecognitionsOfEntries,
  recognitionsOfEntry,
} from '../scoring/recognition-db.ts'
import { recordAdministrativeEntryTx, voidAdministrativeEntryTx } from './administrative-write.ts'
import { entryLimitOf } from './limit.ts'
import { bindCitedAttachments } from './bind-attachments.ts'
import { questionFactsOf, type QuestionFacts } from './question-facts.ts'
import { boundIssues } from '../issues.ts'
import { provenRecognition } from '../scoring/proven-recognition.ts'
import { recognitionHash, seedFromEvidence } from '../scoring/recognition.ts'
import { ProbeNeeded, probeIdentity, settleWithProbe } from '../scoring/failure-boundary.ts'
import { ScoringRuntimeCatalog } from '../plugin.ts'
import { readScoringPlan } from '../scoring/plan.ts'
import { recognitionFormFields } from '../scoring/recognition.ts'
import { fillBoundEvidence } from '../scoring/bound-evidence.ts'

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
  DeterminationRefused,
  EntryActionRefused,
  EntryNotFound,
  EntryPayloadInvalid,
  ItemNotFound,
  ItemRevisionConflict,
  ScoringUnavailable,
  ParticipantNotFound,
} from '../errors.ts'
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
import { opensTo } from '../item/channels.ts'
import {
  activeItemIdsOf,
  attachmentsOfRevisions,
  latestRefusalOf,
  cancelReviewInstance,
  entriesOfParticipantPage,
  entryCreatedIso,
  entryEventsOf,
  entryRevisionsOf,
  eventsOfRounds,
  roundsOfEntry,
  entryCountOf,
  hasOpenRound,
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
  standingPlace,
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
import { reviewersVeiled as veiledFor, unnamedUnlessOwn } from '../review/veil.ts'
import {
  conclusionOfEntry,
  conclusionsOf,
  roundEffectOf,
  type Conclusion,
  type RoundEffect,
} from '../review/conclusion.ts'

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
  /** a round running right now, and what opened it; null when none is */
  readonly openRound: { readonly origin: 'initial' | 'appeal' | 'reopen' | 'reroute' } | null
  /**
   * What the claim currently stands recognised as, in the words of the
   * question version that judged it.
   *
   * Only what stands now: a determination a later round replaced is the
   * middle of an argument, and showing every round's by name invites one
   * (§32.85). Null where nothing has been determined, and on the write paths,
   * which do not read it.
   */
  readonly recognition: EntryRecognitionView | null
  readonly capabilities: {
    readonly edit: ActionAvailability
    readonly submit: ActionAvailability
    readonly withdraw: ActionAvailability
    readonly appeal: ActionAvailability
    readonly abandon: ActionAvailability
  }
}

export interface EntryRecognitionView {
  readonly id: string
  readonly source: 'review' | 'record' | 'import' | 'system' | 'redetermination'
  /** the filing version it judged: a later revision means it judged older material */
  readonly entryRevisionId: string
  /** opaque ids with the frozen schemas that name them, in the contract's order */
  readonly fields: readonly { readonly id: string; readonly schema: unknown }[]
  readonly values: Record<string, unknown>
  readonly createdAt: number
  /** null where this reader is not told who determined it */
  readonly actorName: string | null
  /** a sitting of several reviewers determined it, not one person */
  readonly byPanel: boolean
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
  | DeterminationRefused
  | ScoringUnavailable
  | AccessDenied
export type ReviseEntryError =
  | EntryNotFound
  | ItemRevisionConflict
  | BatchReadOnly
  | EntryActionRefused
  | EntryPayloadInvalid
/** the activity stream's public vocabulary; raw event kinds never leave */
export type EntryStatusError =
  | EntryNotFound
  | ItemRevisionConflict
  | BatchReadOnly
  | EntryActionRefused
  | EntryPayloadInvalid
  | DeterminationRefused
  | ScoringUnavailable

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
  /**
   * What a round that revisited a conclusion did to it - upheld, corrected,
   * revoked, overturned - derived by the system from where the claim stood
   * before and after; null for every other round.
   */
  readonly effect: RoundEffect | null
  readonly submittedAt: number
  readonly completedAt: number | null
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    /** the round itself reached this, rather than a person */
    readonly byRound: boolean
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
  /** false where the phase keeps from the participant who judged the claim */
  readonly reviewersShown: boolean
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

/**
 * One claim as a staff account reads it: the claim, and what it currently
 * stands recognised as.
 *
 * The determination is its own field rather than folded into the claim,
 * because who may read it is a different question from who may read the
 * claim - the review service has said so all along, and this is the first
 * screen with an answer. Nothing here is computed: the amount a
 * determination leads to belongs to the ledger, which is scoring's to say.
 */
export interface ParticipantEntryView {
  readonly entry: EntryView
  /**
   * What this reader may do to correct the claim's conclusion: reopen it
   * through the escalation route on the participant's behalf, or
   * re-determine it directly. Discovery through the doors the acts pass.
   */
  readonly corrections: {
    readonly reopen: ActionAvailability
    readonly redetermine: ActionAvailability
  }
  readonly recognition: {
    readonly id: string
    readonly source: 'review' | 'record' | 'import' | 'system' | 'redetermination'
    readonly entryRevisionId: string
    readonly values: Record<string, unknown>
    readonly createdAt: number
    readonly createdByName: string | null
    /** a sitting of several reviewers determined it, not one person */
    readonly byPanel: boolean
  } | null
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
  /**
   * One named participant's claims, for whoever administers the round.
   *
   * Deliberately not `listMyEntries` with a different subject. That one
   * also answers what its reader may do next - the phase gate per question,
   * the unread marks - and none of that is a fact about the participant: it
   * is the participant's own working state, and an administrator reading an
   * account has no use for it and no business seeing it. What this adds
   * instead is the determination each claim currently stands on, which is
   * the half the owner's own page never needed.
   */
  readonly listParticipantEntries: (
    tenantId: string,
    batchId: string,
    participantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<
    {
      participantId: string
      entries: readonly ParticipantEntryView[]
      nextCursor: string | null
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
  ) => Effect.Effect<EntryView, CreateEntryError, ScoringRuntimeCatalog>
  readonly getEntry: (
    tenantId: string,
    entryId: string,
    as: Principal,
  ) => Effect.Effect<EntryView, EntryNotFound>
  /**
   * Whether this person may read that entry at all - the same boundary the
   * detail and its history use, offered to the doors that hold a citation
   * rather than a row (an attachment is one).
   */
  readonly mayReadEntryById: (
    tenantId: string,
    entryId: string,
    as: Principal,
  ) => Effect.Effect<boolean>
  readonly appendEntryRevision: (
    tenantId: string,
    entryId: string,
    input: {
      payload: unknown
      note?: string
      expectedItemRevisionId?: string
      /** the version of the claim the writer's screen was drawn from */
      expectedEntryRevisionId?: string
    },
    as: Principal,
  ) => Effect.Effect<EntryView, ReviseEntryError>
  readonly setEntryStatus: (
    tenantId: string,
    entryId: string,
    to: 'in_review' | 'draft' | 'voided',
    as: Principal,
    /** the question the caller's screen showed when the press happened */
    expectedItemRevisionId?: string,
    /** the version of the claim that screen showed, when handing it on */
    expectedEntryRevisionId?: string,
  ) => Effect.Effect<EntryView, EntryStatusError, ScoringRuntimeCatalog>
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
  /** whether the batch's phase of the moment opens a gated code */
  readonly phaseOpens: (tenantId: string, batchId: string, code: string) => Effect.Effect<boolean>
  /**
   * The phase gate alone, for an act of the participant a claim belongs to,
   * asked by somebody else: whether that person could take it right now.
   */
  readonly subjectGate: (
    tenantId: string,
    batchId: string,
    code: string,
    ctx: GateContext,
  ) => Effect.Effect<
    { readonly allowed: true } | { readonly allowed: false; readonly reason: string }
  >
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
  /**
   * Who may read one participant's claims as staff: administering the
   * roster, or re-determining over this participant. The same refusal
   * whether the id names nobody or somebody out of reach.
   */
  readonly requireAccountReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
    participantId: string,
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

/**
 * Whether a sitting determined it rather than one person: a round's
 * determination names its judge, except when several reviewers resolved it
 * together, and then it names nobody (a single voter is not its author).
 */
const byPanel = (standing: { source: string; createdBy: string | null }) =>
  standing.source === 'review' && standing.createdBy === null

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
                // bounded here too: a driver need not refuse through the
                // class that bounds its list
                issues: boundIssues(
                  (decoded.failure as { issues?: readonly { field: string; reason: string }[] })
                    .issues ?? [{ field: '', reason: 'unreadable' }],
                ),
              }),
            )
          : Effect.succeed(decoded.success),
      ),
    )

  const bindAttachments = (input: {
    tenantId: string
    entryId: string | null
    actorId: string
    refs: readonly AttachmentRef[]
  }) => bindCitedAttachments(storage, input)

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
    /** the last round's provenance and whether it is still running */
    standing?: { origin: string; begun: boolean; open: boolean },
    /** what it stands recognised as, where the caller read it */
    recognition?: EntryRecognitionView | null,
    /**
     * The conclusion the claim stands on and whether it may still be
     * appealed, where the caller read it; the same answer the appeal itself
     * reads under the lock.
     */
    conclusion?: Conclusion | null,
    /** what the question itself allows, where the caller read it */
    question?: QuestionFacts,
  ): EntryView => {
    const own = participant !== null && participant.userId === as.userId
    const active = own && participant.status === 'active'
    // What the question itself refuses, whatever the minute allows: the
    // writes say the same words for the same facts, so a button offered here
    // is a call that goes through.
    const refusedBy = (act: 'edit' | 'submit' | 'appeal'): ActionDecision | undefined =>
      question === undefined
        ? undefined
        : !question.active
          ? { allowed: false, layer: 'policy', reason: 'item-not-active' }
          : act === 'appeal' && !question.appealRoute
            ? { allowed: false, layer: 'policy', reason: 'no-appeal-route' }
            : undefined
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
    // A round under way on this claim answers it, whatever the status says:
    // a refused claim under appeal still reads `rejected`, and the writes
    // that would put new material or a second round beside that appeal
    // refuse with this reason, so the screen says it before the press.
    const underway: ActionDecision | undefined =
      standing?.open === true
        ? { allowed: false, layer: 'policy', reason: 'appeal-under-way' }
        : undefined
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
      recognition: recognition ?? null,
      // A round running right now, and what opened it. The claim's own status
      // cannot say so: an appeal leaves it standing where it stood (§32.21),
      // and a card reading "已认定" through an appeal says the argument is
      // over while it is being had.
      openRound:
        standing?.open === true
          ? { origin: standing.origin as NonNullable<EntryView['openRound']>['origin'] }
          : null,
      // an ask is answered by a participant, and somebody off the roster is
      // not one: there is nothing to offer them, and nobody else answers it
      supplement:
        supplement == null || (participant !== null && participant.status !== 'active')
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
        // Editing is the subject's own act, on their own claim. A penalty
        // the office recorded or a fact an import carried in is corrected by
        // voiding it, never by rewriting it - the same rule `abandon` states
        // below, which the write has always enforced and this line had not:
        // the screen offered a press that came back `entry-not-editable`.
        edit: when(
          (entry.source === 'self' || entry.source === 'proxy') &&
            (entry.status === 'draft' ||
              entry.status === 'rejected' ||
              entry.status === 'needs_revision'),
          underway ?? refusedBy('edit') ?? gates?.edit,
        ),
        // a rejected filing may go back as it stands (§32.65): the word was
        // "no, as filed" and the answer may be "look again". What was sent
        // back for revision may not - the round asked for different material
        submit:
          active && entry.status === 'needs_revision'
            ? { state: 'blocked', reason: 'must-revise-first' }
            : when(
                (entry.source === 'self' || entry.source === 'proxy') &&
                  (entry.status === 'draft' || entry.status === 'rejected'),
                underway ?? refusedBy('submit') ?? gates?.submit,
              ),
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
        appeal:
          // A round already under way is what the write refuses first
          // (`review-already-open`), and an appeal IS such a round: without
          // this the button stayed lit through the appeal it had just
          // opened, and pressing it answered "still under review" - a
          // sentence about a round the reader started.
          standing?.open === true
            ? { state: 'blocked', reason: 'review-already-open' }
            : conclusion !== undefined
              ? // one appeal per conclusion (ruling of 2026-09-25): a
                // conclusion an appeal reached, or one already contested,
                // stays on the card with the reason rather than vanishing
                when(
                  conclusion !== null,
                  conclusion?.exhausted === true
                    ? { allowed: false, layer: 'policy', reason: 'appeal-exhausted' }
                    : (refusedBy('appeal') ?? gates?.appeal),
                )
              : when(
                  (entry.status === 'approved' || entry.status === 'rejected') &&
                    (entry.currentReviewInstanceId !== null ||
                      ((entry.source === 'record' || entry.source === 'import') &&
                        entry.currentRecognitionId !== null)),
                  refusedBy('appeal') ?? gates?.appeal,
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
      const runtime = yield* ScoringRuntimeCatalog
      // An administrative record is approved the moment it is written, so
      // what the office determined is proven against the question's
      // arithmetic before the row exists - between two runs of this
      // transaction, never inside one. A student's filing determines
      // nothing and runs once, as before.
      const attempt = (proven: string | null) =>
        withDb(
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

              // Which door this comes through is who is filing for whom: a
              // person filing for themselves takes the participant door,
              // anybody else is the office recording a fact about them. The
              // question says which doors are open, and a shut door is a
              // refusal about the question, not a permission the caller
              // lacks - a participant at a question only the office records
              // is told so, and staff at a question only its participants
              // file hear the same words they always did.
              const administrative = participant.userId !== as.userId
              if (administrative && !opensTo(revision.entryChannels, 'administrative')) {
                return yield* refuse('create', 'not-your-participant')
              }
              if (!administrative && !opensTo(revision.entryChannels, 'participant')) {
                // At a question only the office records, a member of that
                // office asking about themselves is a registrar recording
                // against themselves, and that is the refusal that names
                // the rule. Anybody else at the same door is simply told it
                // is shut - which is what a participant who lacks the
                // office's authority is actually looking at.
                const office = yield* deps.authorize(as, 'assessment.entry.record', item.batchId, {
                  itemId: item.id,
                  participantId: participant.id,
                })
                return yield* refuse(
                  'create',
                  opensTo(revision.entryChannels, 'administrative') && office.allowed
                    ? 'self-record-refused'
                    : 'entry-channel-closed',
                )
              }
              const code = administrative ? 'assessment.entry.record' : 'assessment.entry.create'
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

              const ceiling = entryLimitOf(item.maxEntries)
              const count = yield* entryCountOf(tenantId, item.id, participant.id)
              if (count >= ceiling.limit) return yield* refuse('create', ceiling.reason)

              const batch = yield* oneBatch(tenantId, item.batchId)
              const materialRange = deps.parseRange(String(batch!.materialRange))
              const driver = driverOf(item)
              if (driver === undefined) return yield* refuse('create', 'item-type-not-installed')
              const plan = yield* Effect.orDie(readScoringPlan(revision))
              // a field the determination stands for is not asked of the
              // office twice: whatever it left blank is written from what it
              // determined, and the decoder then judges the two as one
              const payload =
                administrative &&
                typeof input.payload === 'object' &&
                input.payload !== null &&
                !Array.isArray(input.payload)
                  ? fillBoundEvidence(
                      plan,
                      input.payload as Record<string, unknown>,
                      input.recognition === undefined
                        ? {}
                        : ((input.recognition.values ?? {}) as Record<string, unknown>),
                    )
                  : input.payload
              const decoded = yield* decodePayload(driver, revision, payload, materialRange)
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

              // What the office determined by recording this, proven complete
              // and proven scorable before anything is written. The member of
              // staff filing it is its author, so what they send is
              // authoritative and the plan's defaults are only what the form
              // was pre-filled with - the same rule as a reviewer's approval.
              const determined = administrative
                ? yield* provenRecognition(
                    plan,
                    input.recognition === undefined ? {} : input.recognition.values,
                    materialRange,
                  )
                : undefined
              if (determined !== undefined) {
                const identity = probeIdentity({
                  revisionId: revision.id,
                  planHash: plan.planHash,
                  recognition: recognitionHash(determined),
                })
                if (proven !== identity) {
                  return yield* new ProbeNeeded({
                    probe: {
                      identity,
                      revisionId: revision.id,
                      tenantId,
                      batchId: item.batchId,
                      itemId: item.id,
                      plan,
                      recognition: determined,
                    },
                  })
                }
              }

              const refs = driver.attachmentRefs(revision.formConfig, decoded)
              yield* bindAttachments({ tenantId, entryId: null, actorId: as.userId, refs })
              // An administrative fact goes through the one writer both doors
              // use, so a record and an import cannot drift into writing the
              // same thing differently. A participant's own filing does not:
              // it is a draft with no determination, which is a different
              // sequence and not a special case of this one.
              const { entryId, revisionId } = administrative
                ? yield* recordAdministrativeEntryTx({
                    tenantId,
                    batchId: item.batchId,
                    itemId: item.id,
                    itemRevisionId: revision.id,
                    participantId: participant.id,
                    subjectUserId: participant.userId,
                    actorUserId: as.userId,
                    payload: decoded,
                    recognition: determined,
                    basis: input.note ?? '',
                    source: 'record',
                    attachments: refs,
                  })
                : yield* Effect.gen(function* () {
                    const id = yield* insertEntry({
                      tenantId,
                      batchId: item.batchId,
                      itemId: item.id,
                      participantId: participant.id,
                      source: 'self',
                      status: 'draft',
                    })
                    const written = yield* insertEntryRevision({
                      tenantId,
                      entryId: id,
                      itemId: item.id,
                      itemRevisionId: revision.id,
                      revisionNo: 1,
                      payload: decoded,
                      actorId: as.userId,
                      subjectId: participant.userId,
                      source: 'self',
                      note: input.note?.trim() || null,
                    })
                    yield* insertRevisionAttachments(
                      tenantId,
                      written,
                      refs.map((ref, position) => ({
                        attachmentId: ref.attachmentId,
                        position,
                      })),
                    )
                    yield* setEntryState({
                      tenantId,
                      entryId: id,
                      from: ['draft'],
                      to: 'draft',
                      currentRevisionId: written,
                    })
                    return { entryId: id, revisionId: written }
                  })
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
      return yield* settleWithProbe(
        runtime,
        attempt,
        (first, again) =>
          new ItemRevisionConflict({ itemId: first.itemId, currentRevisionId: again.revisionId }),
      )
    },
  )

  /**
   * Who may read one entry, asked once so every door agrees.
   *
   * Three ways in, and the third is the one that was missing. The subject
   * reads their own history whatever their standing now (§32.56). A batch
   * administrator reads the round they run. And a recorder reads the
   * administrative facts they could have written themselves - the list
   * already offers them those rows, filtered by exactly this permission and
   * this reach, so a detail that asked for the administrator's authority
   * instead answered "no such entry" for a row the same person had just been
   * shown, and the screen behind it did nothing at all.
   *
   * A claim its owner filed is deliberately NOT in the third case: holding
   * `assessment.entry.record` is the power to write facts about people, not
   * the power to read what they submitted about themselves.
   *
   * And a fourth (ruling of 2026-09-25 #33): whoever may re-determine claims
   * over this participant reads every claim of theirs, filed or recorded -
   * a result cannot be re-made by somebody who may not read what it was
   * made from. `userEntriesPage` asks the same four in sql.
   */
  const mayReadEntry = (
    tenantId: string,
    entry: { readonly batchId: string; readonly source: string },
    participant: ParticipantAnchor & { readonly userId: string },
    as: Principal,
  ) =>
    Effect.gen(function* () {
      if (participant.userId === as.userId) return true
      const roster = yield* Effect.result(deps.requireRosterReach(as, tenantId, entry.batchId))
      if (Result.isSuccess(roster)) return true
      const redetermines = yield* staffReachesParticipant({
        tenantId,
        batchId: entry.batchId,
        userId: as.userId,
        permissionCode: 'assessment.entry.redetermine',
        participant,
      })
      if (redetermines) return true
      if (entry.source !== 'record' && entry.source !== 'import') return false
      return yield* staffReachesParticipant({
        tenantId,
        batchId: entry.batchId,
        userId: as.userId,
        permissionCode: 'assessment.entry.record',
        participant,
      })
    })

  /** the same question by id, for the doors that hold a citation rather than a row */
  const mayReadEntryById = (
    tenantId: string,
    entryId: string,
    as: Principal,
  ): Effect.Effect<boolean> =>
    withDb(
      Effect.gen(function* () {
        const loaded = yield* loadEntry(tenantId, entryId)
        if (loaded === null) return false
        return yield* mayReadEntry(tenantId, loaded.entry, loaded.participant, as)
      }),
      // a database that cannot answer is not a refusal to hand to a caller
      // deciding whether to show a file; it is this process being broken
    ).pipe(Effect.orDie)

  /** whether this reader is kept from knowing who judged the claim (§32.85) */
  const reviewersVeiled = (
    tenantId: string,
    batchId: string,
    participant: ParticipantAnchor | null,
    as: Principal,
  ) =>
    veiledFor(deps.phaseOpens, {
      tenantId,
      batchId,
      subjectUserId: participant?.userId ?? null,
      readerUserId: as.userId,
    })

  /** the same view with the people who judged it left out */
  const veil = (shown: EntryView, veiled: boolean): EntryView =>
    !veiled
      ? shown
      : {
          ...shown,
          refusal: shown.refusal === null ? null : { ...shown.refusal, actorName: null },
          supplement:
            shown.supplement === null ? null : { ...shown.supplement, requestedByName: null },
        }

  /**
   * What one claim stands recognised as, in the words of the version that
   * judged it.
   *
   * The values are addressed by opaque ids the browser cannot read, so the
   * frozen contract that names them travels with them - the question may
   * have been edited since, and the determination is still about the
   * version it was made under.
   */
  const recognitionOf = (tenantId: string, entry: EntryRow, veiled: boolean) =>
    Effect.gen(function* () {
      if (entry.currentRecognitionId === null) return null
      // Only while the claim actually stands on it. A determination is a
      // round's conclusion, and a claim back under review - appealed,
      // reopened, sent back, withdrawn - has no conclusion just now: the one
      // it used to have is precisely what the open round is revisiting.
      // Showing it anyway told the filer their claim was recognised as
      // something while somebody was deciding whether it still is.
      if (entry.status !== 'approved') return null
      const standing = (yield* currentRecognitionsOfEntries(tenantId, [entry.id]))[0]
      if (standing === undefined) return null
      const judged = yield* revisionOf(tenantId, standing.itemRevisionId)
      const plan = judged === null ? null : yield* readScoringPlan(judged).pipe(Effect.option)
      const fields =
        plan === null || plan._tag !== 'Some' ? null : recognitionFormFields(plan.value)
      return {
        id: standing.id,
        source: standing.source,
        entryRevisionId: standing.entryRevisionId,
        fields: fields ?? [],
        values: standing.values,
        createdAt: standing.createdAt,
        actorName: veiled ? null : standing.createdByName,
        byPanel: byPanel(standing),
      }
    })

  const getEntry: EntryMethods['getEntry'] = Effect.fn('Assessment.getEntry')(
    function* (tenantId, entryId, as) {
      return yield* withDb(
        Effect.gen(function* () {
          const loaded = yield* loadEntry(tenantId, entryId)
          if (loaded === null) return yield* new EntryNotFound()
          const { entry, participant } = loaded
          // everyone learns nothing - not even existence - without a way in
          if (!(yield* mayReadEntry(tenantId, entry, participant, as))) {
            return yield* new EntryNotFound()
          }
          const asked = yield* openSupplementsOfEntries(tenantId, [entryId])
          const said = yield* latestRefusalOf(tenantId, [entryId])
          // Whatever the claim's own status says. An appeal leaves the claim
          // standing where it stood (§32.21), so "is a round running" cannot
          // be read off the status - and it is what decides both the word on
          // the card and whether another appeal may be started.
          const standings =
            entry.currentReviewInstanceId === null
              ? new Map<string, { origin: string; begun: boolean; open: boolean }>()
              : yield* withdrawStandingsOf(tenantId, [entry.currentReviewInstanceId])
          const veiled = yield* reviewersVeiled(tenantId, entry.batchId, participant, as)
          const question = (yield* questionFactsOf(tenantId, [entry.itemId])).get(entry.itemId)
          return veil(
            view(
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
              yield* recognitionOf(tenantId, entry, veiled),
              yield* conclusionOfEntry(tenantId, entryId),
              question,
            ),
            veiled,
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
          // A refused claim under appeal still reads `rejected` (§32.21), and
          // the appeal is judging the filing it was opened on: a new version
          // now would move the claim out from under its own round. Changing
          // the material is the other door, and it opens when the round ends.
          if (yield* hasOpenRound(tenantId, entryId)) {
            return yield* refuse('edit', 'appeal-under-way')
          }
          if (item.status !== 'active') return yield* refuse('edit', 'item-not-active')
          yield* sameQuestion(item, input.expectedItemRevisionId)
          // another tab or device can have saved since this screen was
          // drawn: writing on top would replace that version unseen
          if (
            input.expectedEntryRevisionId !== undefined &&
            input.expectedEntryRevisionId !== entry.currentRevisionId
          ) {
            return yield* refuse('edit', 'entry-changed')
          }
          const revision =
            item.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, item.currentRevisionId)
          if (revision === null || !opensTo(revision.entryChannels, 'participant')) {
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
    function* (tenantId, entryId, to, as, expectedItemRevisionId, expectedEntryRevisionId) {
      const runtime = yield* ScoringRuntimeCatalog
      // a claim nobody reviews is approved by the rule at submission, so the
      // rule's arithmetic is asked first - between two runs of this
      // transaction, as every other determination is
      const attempt = (proven: string | null) =>
        withDb(
          transaction(
            Effect.gen(function* () {
              const located = yield* entryOf(tenantId, entryId)
              if (located === null) return yield* new EntryNotFound()
              const locked = yield* lockBatch(tenantId, located.batchId)
              if (locked!.status === 'archived') return yield* new BatchReadOnly()
              const { entry, item, participant } = (yield* loadEntry(tenantId, entryId))!
              const action =
                to === 'in_review' ? 'submit' : to === 'voided' ? 'abandon' : 'withdraw'
              // only handing it on is a decision about today's rules; taking
              // it back or giving it up must not be refused because the form
              // moved (§32.69)
              if (to === 'in_review') yield* sameQuestion(item, expectedItemRevisionId)
              if (participant.userId !== as.userId) return yield* refuse(action, 'not-your-entry')
              // what goes to the reviewers is the version the person pressing
              // saw, not one another tab saved over it in the meantime
              if (
                to === 'in_review' &&
                expectedEntryRevisionId !== undefined &&
                expectedEntryRevisionId !== entry.currentRevisionId
              ) {
                return yield* refuse(action, 'entry-changed')
              }
              // the projection hides it; this is where it is refused. A fact
              // the office recorded or an import carried in is not the
              // subject's to withdraw, whatever the phase allows in general -
              // nor to file. An administrative record can reach `rejected`
              // (an appeal that did not carry), and from there submitting
              // would walk the ordinary route and re-file the office's own
              // finding as the subject's claim.
              if (entry.source !== 'self' && entry.source !== 'proxy') {
                if (action === 'abandon') return yield* refuse(action, 'entry-not-abandonable')
                if (to === 'in_review') return yield* refuse(action, 'entry-not-submittable')
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
                // one open round per claim (§15): a refused claim whose appeal
                // is being heard is answered by that round, and a second one
                // beside it - or an approval by rule that leaves it behind -
                // is not a thing the claim can carry
                if (yield* hasOpenRound(tenantId, entryId)) {
                  return yield* refuse(action, 'appeal-under-way')
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
                  // nobody is going to be asked, so the defaults are the whole
                  // determination - and if they do not add up to a complete
                  // one, this claim cannot become approved at all. The compiler
                  // refuses that configuration, so reaching it means the
                  // question changed under an old plan.
                  const determined = yield* provenRecognition(
                    livePlan,
                    seedFromEvidence(livePlan, carried),
                    deps.parseRange(String(batch!.materialRange)),
                  ).pipe(
                    // a date outside the round is the claim's own to fix,
                    // and said on the field it was filed in - the one thing
                    // the participant can change. Anything else means nobody
                    // is misfiling anything: the question was configured so
                    // that a claim nobody reviews cannot be fully
                    // determined, which is a refusal about this round
                    Effect.catchTag('ASSESSMENT_ENTRY_PAYLOAD_INVALID', (invalid) => {
                      const outside = invalid.issues.filter(
                        (issue) => issue.reason === 'out-of-material-range',
                      )
                      if (outside.length === 0) {
                        return Effect.fail<EntryActionRefused | EntryPayloadInvalid>(
                          refuse(action, 'item-not-configured'),
                        )
                      }
                      return Effect.fail(
                        new EntryPayloadInvalid({
                          issues: outside.map((issue) => {
                            const recognitionId = issue.field.slice('recognition.'.length)
                            const binding = Object.hasOwn(livePlan.defaultBindings, recognitionId)
                              ? livePlan.defaultBindings[recognitionId]
                              : undefined
                            return {
                              field:
                                binding === undefined
                                  ? issue.field
                                  : (binding.payloadKey ?? binding.fieldId),
                              reason: 'out-of-material-range',
                            }
                          }),
                        }),
                      )
                    }),
                  )
                  const identity = probeIdentity({
                    revisionId: live.id,
                    planHash: livePlan.planHash,
                    entryRevisionId: current!.id,
                    standing: standing?.id ?? null,
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
                        plan: livePlan,
                        recognition: determined,
                      },
                    })
                  }
                  const recognitionId = yield* insertRecognition({
                    tenantId,
                    batchId: entry.batchId,
                    entryId,
                    entryRevisionId: current!.id,
                    itemId: entry.itemId,
                    itemRevisionId: live.id,
                    values: determined,
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
                const place = yield* standingPlace(tenantId, first)
                if (place === null) return yield* refuse(action, 'review-level-missing')
                // Nobody can act at the stage today - which is the round's
                // problem, not this person's. The round is written down as
                // blocked with its reason so the patrol and the alert panel
                // own it, and it heals the moment somebody is appointed (§14).
                // A vacant step with no unit at all is the same case, and
                // stands blocked where it is rather than refusing the filing.
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
                  nodeId: place.nodeId,
                  nodePath: place.nodePath,
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
                // The round, not the status: a claim under appeal keeps the
                // standing it already had (§32.21), so an approved or refused
                // claim can be carrying an open round. Left open, it would go
                // on sitting in reviewers' queues and holding the batch open
                // over a claim nobody is making any more. The pointer outlives
                // its round, so `false` is "nothing was open" - which only an
                // `in_review` claim cannot be.
                const closed =
                  entry.currentReviewInstanceId !== null &&
                  (yield* cancelReviewInstance({
                    tenantId,
                    instanceId: entry.currentReviewInstanceId,
                    outcome: 'cancelled',
                  }))
                if (entry.status === 'in_review' && !closed) {
                  return yield* refuse(action, 'entry-not-abandonable')
                }
                if (closed) {
                  yield* insertReviewEvent({
                    tenantId,
                    reviewInstanceId: entry.currentReviewInstanceId!,
                    kind: 'cancelled-by-submitter',
                    actorId: as.userId,
                  })
                }
                const moved = yield* setEntryState({
                  tenantId,
                  entryId,
                  from: ['draft', 'rejected', 'needs_revision', 'in_review', 'approved'],
                  to: 'voided',
                  ...(entry.currentReviewInstanceId === null
                    ? {}
                    : { currentReviewInstanceId: null }),
                })
                if (!moved) return yield* refuse(action, 'entry-not-abandonable')
                yield* insertEntryEvent({
                  tenantId,
                  entryId,
                  kind: 'abandoned-by-submitter',
                  actorId: as.userId,
                })
              } else {
                // The round, not the status: a claim under appeal keeps the
                // standing it already had (§32.21). The entry goes on
                // pointing at its round after that round ends, so open is
                // what the round row says rather than what the pointer says.
                if (
                  entry.currentReviewInstanceId === null ||
                  !(yield* hasOpenRound(tenantId, entryId))
                ) {
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
      const acted = settleWithProbe(runtime, attempt, (first, again) =>
        // the question moved under the claim, or the claim itself moved:
        // each is said in the words the caller already knows
        again.revisionId !== first.revisionId
          ? new ItemRevisionConflict({ itemId: first.itemId, currentRevisionId: again.revisionId })
          : refuse('submit', 'entry-not-submittable'),
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
          // A withdrawn question takes no new work on the claims it leaves
          // behind, and one with no escalation step hears no appeal, whatever
          // the phase opens: read once for the page, said by the view the
          // same way the detail says it
          const questions = yield* questionFactsOf(tenantId, [
            ...new Set(pageRows.map((entry) => entry.itemId)),
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
            // whatever the claim's own status says: an appeal leaves it
            // standing where it stood (§32.21), so a round running right now
            // is not something the status can be read for
            pageRows
              .filter((one) => one.currentReviewInstanceId !== null)
              .map((one) => one.currentReviewInstanceId!),
          )
          const saidByEntry = yield* latestRefusalOf(
            tenantId,
            pageRows
              .filter((one) => one.status === 'rejected' || one.status === 'needs_revision')
              .map((one) => one.id),
          )
          // what each claim stands on, and whether it is still appealable
          const conclusions = yield* conclusionsOf(
            tenantId,
            pageRows.map((one) => one.id),
          )
          const entries: EntryView[] = []
          const veiled = yield* reviewersVeiled(tenantId, batchId, participant, as)
          for (const entry of pageRows) {
            entries.push(
              veil(
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
                  yield* recognitionOf(tenantId, entry, veiled),
                  conclusions.get(entry.id) ?? null,
                  questions.get(entry.itemId),
                ),
                veiled,
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

  /**
   * The two corrections a member of staff may offer on one person's claims,
   * decided once per page: the authority and the phase through the same
   * door the acts pass, the reach over this participant, and the question
   * each claim answers. Somebody without the authority, or reading their own
   * claims, is offered neither - not a disabled button.
   */
  const correctionOffers = (
    tenantId: string,
    batch: { readonly id: string; readonly status: string },
    participant: ParticipantAnchor,
    rows: readonly EntryRow[],
    as: Principal,
  ) =>
    Effect.gen(function* () {
      const door = (code: string) =>
        Effect.gen(function* () {
          if (participant.userId === as.userId || batch.status === 'archived') return null
          const decision = yield* deps
            .authorize(as, code, batch.id, { participantId: participant.id })
            .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
          if (!decision.allowed && decision.layer === 'authority') return null
          const reaches = yield* staffReachesParticipant({
            tenantId,
            batchId: batch.id,
            userId: as.userId,
            permissionCode: code,
            participant,
          })
          return reaches ? decision : null
        })
      const reopen = yield* door('assessment.review.reopen')
      const redetermine = yield* door('assessment.entry.redetermine')
      const conclusions =
        reopen === null
          ? new Map<string, Conclusion>()
          : yield* conclusionsOf(
              tenantId,
              rows.map((row) => row.id),
            )
      const questions = new Map<string, { active: boolean; escalation: boolean }>()
      if (reopen !== null || redetermine !== null) {
        for (const itemId of new Set(rows.map((row) => row.itemId))) {
          const item = yield* itemOf(tenantId, itemId)
          const live =
            item === null || item.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, item.currentRevisionId)
          questions.set(itemId, {
            active: item !== null && item.status === 'active',
            escalation: live !== null && readPolicy(live.reviewPolicy).escalation.length > 0,
          })
        }
      }
      const hidden: ActionAvailability = { state: 'hidden', reason: null }
      const blocked = (reason: string): ActionAvailability => ({ state: 'blocked', reason })
      const open: ActionAvailability = { state: 'available', reason: null }
      return (entry: EntryRow, running: boolean): ParticipantEntryView['corrections'] => {
        const question = questions.get(entry.itemId)
        const decided = entry.status === 'approved' || entry.status === 'rejected'
        return {
          // the escalation route again: a conclusion to contest, no round
          // already running, and a route to walk
          reopen:
            reopen === null || !conclusions.has(entry.id)
              ? hidden
              : running
                ? blocked('review-already-open')
                : question?.active !== true
                  ? blocked('item-not-active')
                  : !question.escalation
                    ? blocked('no-appeal-route')
                    : participant.status !== 'active'
                      ? blocked('participant-not-active')
                      : !reopen.allowed
                        ? blocked(reopen.reason)
                        : open,
          // a new result for any decided claim; a round still running is
          // ended with it, which the screen says before it is pressed
          redetermine:
            redetermine === null || !decided
              ? hidden
              : question?.active !== true
                ? blocked('item-not-active')
                : !redetermine.allowed
                  ? blocked(redetermine.reason)
                  : open,
        }
      }
    })

  const listParticipantEntries: EntryMethods['listParticipantEntries'] = Effect.fn(
    'Assessment.listParticipantEntries',
  )(function* (tenantId, batchId, participantId, page, as) {
    // the cursor is bound to this batch AND this participant: a cursor is
    // only meaningful against the question it came from, and "the same page
    // of somebody else's claims" is a different question
    const fingerprint = `participant-entries:${batchId}:${participantId}`
    const key = readQueryCursor(page.cursor, fingerprint, ['timestamp', 'uuid'])
    if (key === null) return yield* cursorUnusable()
    const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    return yield* withDb(
      Effect.gen(function* () {
        const batch = yield* oneBatch(tenantId, batchId)
        if (!batch) return yield* new BatchNotFound()
        // one refusal for an id out of reach and an id naming nobody, so a
        // reader without reach cannot learn whether an id is on this roster
        yield* deps.requireAccountReach(as, tenantId, batchId, participantId)
        const participant = yield* participantOf(tenantId, batchId, participantId)
        if (participant === null) return yield* new ParticipantNotFound()
        const rows = yield* entriesOfParticipantPage({
          tenantId,
          batchId,
          participantId,
          after: key === undefined ? undefined : [key[0]!, key[1]!],
          limit: limit + 1,
        })
        const pageRows = rows.slice(0, limit)
        // one query per page for each thing a row needs, never one per row
        const askedByEntry = new Map(
          (yield* openSupplementsOfEntries(
            tenantId,
            pageRows.map((entry) => entry.id),
          )).map((asked) => [asked.entryId, asked]),
        )
        const standings = yield* withdrawStandingsOf(
          tenantId,
          pageRows
            .filter((one) => one.currentReviewInstanceId !== null)
            .map((one) => one.currentReviewInstanceId!),
        )
        const saidByEntry = yield* latestRefusalOf(
          tenantId,
          pageRows
            .filter((one) => one.status === 'rejected' || one.status === 'needs_revision')
            .map((one) => one.id),
        )
        const recognitions = new Map(
          (yield* currentRecognitionsOfEntries(
            tenantId,
            pageRows.map((entry) => entry.id),
          )).map((one) => [one.entryId, one]),
        )
        // a member of staff reading their own roster row is still the one
        // who filed, and is told what the filer is told
        const veiled = yield* reviewersVeiled(tenantId, batchId, participant, as)
        const corrections = yield* correctionOffers(
          tenantId,
          { id: batchId, status: batch.status },
          participant,
          pageRows,
          as,
        )
        const entries: ParticipantEntryView[] = []
        for (const entry of pageRows) {
          const standing = recognitions.get(entry.id)
          const running =
            entry.currentReviewInstanceId !== null &&
            standings.get(entry.currentReviewInstanceId)?.open === true
          entries.push({
            corrections: corrections(entry, running),
            // no gates: the acts this view carries are the participant's own,
            // and the reader is not the participant. `view` answers `hidden`
            // for every one of them on its own, from the same ownership test
            // every other reader passes through.
            entry: veil(
              view(
                entry,
                yield* revisionView(tenantId, entry.currentRevisionId),
                as,
                participant,
                undefined,
                askedByEntry.get(entry.id) ?? null,
                saidByEntry.get(entry.id) ?? null,
                entry.currentReviewInstanceId === null
                  ? undefined
                  : standings.get(entry.currentReviewInstanceId),
              ),
              veiled,
            ),
            recognition:
              standing === undefined
                ? null
                : {
                    id: standing.id,
                    source: standing.source,
                    entryRevisionId: standing.entryRevisionId,
                    values: standing.values,
                    createdAt: standing.createdAt,
                    createdByName: veiled ? null : standing.createdByName,
                    byPanel: byPanel(standing),
                  },
          })
        }
        const last = pageRows[pageRows.length - 1]
        const lastIso =
          rows.length > limit && last !== undefined
            ? yield* entryCreatedIso(tenantId, last.id)
            : null
        return {
          participantId,
          entries,
          nextCursor:
            lastIso !== null && last !== undefined
              ? encodeQueryCursor(fingerprint, [lastIso, last.id])
              : null,
        }
      }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

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
            // the same boundary the detail uses, so a recorder who can open
            // an administrative fact can read how it got there
            if (!judging && !(yield* mayReadEntry(tenantId, entry, participant, as))) {
              return yield* new EntryNotFound()
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
          // every determination the claim has had, for telling what each
          // round that revisited a conclusion did to it
          const determinations = (yield* recognitionsOfEntry(tenantId, entryId)).map((one) => ({
            id: one.id,
            reviewInstanceId: one.reviewInstanceId,
            hash: recognitionHash(one.values),
          }))
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
          const veiled = yield* reviewersVeiled(tenantId, entry.batchId, participant, as)
          // the participant's own acts keep their name; everybody else in a
          // round is somebody who judged it
          // `byRound` is read before the veil and travels beside it: a round
          // that concluded by itself (a sitting reaching quorum) and a round
          // whose judge this reader may not be told about are different
          // facts, and taking the name away must not turn one into the other
          const actor = (event: { actorId: string | null; actorName: string | null }) => ({
            byRound: event.actorId === null,
            ...unnamedUnlessOwn(veiled, as.userId, {
              actorId: event.actorId,
              actorName: event.actorName,
            }),
          })
          return {
            reviewersShown: !veiled,
            entry: veil(
              view(
                entry,
                yield* revisionView(tenantId, entry.currentRevisionId),
                as,
                participant,
                undefined,
                asked[0] ?? null,
                said.get(entryId) ?? null,
              ),
              veiled,
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
              effect: roundEffectOf(round, rounds, determinations),
              submittedAt: round.createdAt,
              completedAt: round.completedAt,
              events: (events.get(round.id) ?? []).map((event) => ({
                kind: event.kind,
                ...actor(event),
                reason: event.reason,
                comment: event.comment,
                suggestedPayload: event.suggestedPayload,
                at: event.createdAt,
              })),
              supplements: (supplements.get(round.id) ?? []).map((asked) =>
                veiled ? { ...asked, requestedBy: '', requestedByName: null } : asked,
              ),
            })),
            // the claim's own trail under the same veil: the member of staff
            // who sent it back is named nowhere else to this reader either
            events: ownEvents.map((event) => ({
              kind: event.kind,
              ...unnamedUnlessOwn(veiled, as.userId, {
                actorId: event.actorId,
                actorName: event.actorName,
              }),
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
          // to, and it is whoever could have recorded it.
          if (input.kind === 'void') {
            if (!administrative) {
              // a claim its owner filed is theirs to give up; an
              // administrator taking it away is a different power and not
              // one anybody has asked for
              return yield* refuse('abandon', 'entry-not-abandonable')
            }
            const withdrawn = yield* voidAdministrativeEntryTx({
              tenantId,
              entryId,
              status: entry.status,
              currentReviewInstanceId: entry.currentReviewInstanceId,
              actorUserId: as.userId,
              reason,
            })
            if (!withdrawn.voided) return yield* refuse('abandon', 'entry-not-abandonable')
            yield* announce(tenantId, entry.batchId, [
              { kind: 'entries-changed', subjectUserId: participant.userId },
              { kind: 'result-changed', subjectUserId: participant.userId },
              // the queues too: a round just left them
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
            ])
            const gone_ = (yield* entryOf(tenantId, entryId))!
            return view(
              gone_,
              yield* revisionView(tenantId, gone_.currentRevisionId),
              as,
              participant,
            )
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
          // An approved claim handed back stops counting at once, and only
          // its owner can make it count again - by revising and sending it.
          // So it goes back only while its owner could do both right now:
          // on the roster, on a live question, with the phase opening edit
          // and submit to them. Otherwise it would sit handed back with
          // nobody able to act, and the way to correct it is reopening or
          // redetermining. A claim still under review keeps the rescue it
          // has always had, whatever the phase.
          if (entry.status === 'approved') {
            const ctx = { itemId: entry.itemId, participantId: participant.id }
            const refile =
              participant.status === 'active' &&
              loaded.item.status === 'active' &&
              (yield* deps.subjectGate(tenantId, entry.batchId, 'assessment.entry.edit', ctx))
                .allowed &&
              (yield* deps.subjectGate(tenantId, entry.batchId, 'assessment.entry.submit', ctx))
                .allowed
            if (!refile) return yield* refuse('return', 'owner-cannot-refile')
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
        // every row is something to do, and a member taken off the roster has
        // nothing left to do here: their history stays readable, not actionable
        const actions =
          membership.status === 'active'
            ? yield* myActionRowsOf({
                tenantId,
                batchId,
                participantId: membership.id,
              })
            : []
        // every row is about the reader's own claims: the membership was
        // looked up by them
        const veiled = yield* veiledFor(deps.phaseOpens, {
          tenantId,
          batchId,
          subjectUserId: as.userId,
          readerUserId: as.userId,
        })
        return {
          unreadItemIds: unread,
          actions: actions.map((row) => ({
            kind: row.kind,
            entryId: row.entryId,
            itemId: row.itemId,
            itemTitle: row.itemTitle,
            at: row.at,
            who: unnamedUnlessOwn(veiled, as.userId, { actorId: row.whoId, actorName: row.who })
              .actorName,
            summary: row.summary,
          })),
        }
      }).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  return {
    listMyEntries,
    listParticipantEntries,
    getEntryHistory,
    createEntry,
    getEntry,
    mayReadEntryById,
    appendEntryRevision,
    setEntryStatus,
    markMyEntryRead,
    getMyEntrySummary,
    interveneOnEntry,
  }
}
