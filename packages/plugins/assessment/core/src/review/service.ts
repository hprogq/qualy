import { Effect, Result } from 'effect'
import type { ScoringPlan } from '../scoring/plan.ts'

/**
 * The compiled arithmetic a revision carries, for the contract a round
 * determines under. Reaching a null is an operational fault, not a data
 * state - it dies naming the revision rather than judging a determination
 * against a contract nobody has.
 */

import {
  judgeRecognition,
  recognitionHash,
  canonicalRecognition,
  contradicted,
  sameRecognition,
  seedFromEvidence,
  type RecognitionValues,
} from '../scoring/recognition.ts'
import { readScoringPlan } from '../scoring/plan.ts'
import { currentRecognitionOf, insertRecognition } from '../scoring/recognition-db.ts'
import { boundedCounter } from '@qualy/telemetry/metrics'
import { projectEntrySummary } from '../entry/summary.ts'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AttachmentMeta } from '@qualy/plugin-storage/server'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { cursorUnusable, pageSize, type BadRequest } from '@qualy/api-kit/schema'
import type { ItemTypeDriver } from '../plugin.ts'
import { announce } from '../live/events.ts'
import { bumpParticipantAttention } from '../entry/db.ts'
import {
  BatchNotFound,
  BatchReadOnly,
  EntryActionRefused,
  EntryPayloadInvalid,
  ReviewConflict,
  ReviewNotFound,
} from '../server/errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { itemOf, revisionOf } from '../item/db.ts'
import {
  advanceReviewInstance,
  entryAttachmentHistory,
  entryOf,
  entryRevisionOf,
  hasOpenRound,
  insertReviewEvent,
  insertReviewInstance,
  lockAttachments,
  nextRoundNo,
  participantOf,
  revisionAttachmentsOf,
  setEntryState,
} from '../entry/db.ts'
import type { GateDecision } from '../phase/gate.ts'
import {
  escalationOpen,
  enterableFrom,
  isPanelStage,
  readPolicy,
  resolveArrival,
  resolvePolicy,
  isRouteEnd,
  nextAfter,
  stageArrival,
  stageById,
  type ResolvedPolicy,
  type ResolvedStage,
} from './chain.ts'
import { nodePathOf } from '../entry/db.ts'
import {
  activeReviewBatches,
  awaitingPage,
  claimPanelSeat,
  createPanel,
  earlierConclusions,
  closeSupplementRequest,
  completeInstance,
  decisionsToday,
  endPanelAssignment,
  inboxPage,
  insertSupplementAttachments,
  insertSupplementRequest,
  insertSupplementResponse,
  insertVote,
  instanceOf,
  chainNames,
  holderNamesAt,
  livePanelSeats,
  lockReviewInstance,
  nextSupplementNo,
  openPanelOf,
  previousConclusion,
  resolvedPanelOpinions,
  resolvePanel,
  revisionBefore,
  reviewEventsOf,
  scoreGroupOf,
  setInstanceState,
  setInstanceSupplementState,
  siblingEntries,
  supersedeOpenPanels,
  supplementAttachmentHistory,
  supplementRequestOf,
  openAskRequesterOf,
  supplementsOf,
  isOpenReviewState,
  userMayReview,
  votesOfPanel,
  votesToday,
  type InboxRow,
  type PanelVoteRow,
  type ReviewInstanceDetailRow,
  type SupplementRequirement,
  type SupplementRow,
  instanceLineageOf,
  lastRecognitionOf,
  lockedProposalOf,
  recognitionOfInstance,
  lockPanelRecognition,
  panelRecognitionOf,
  revisionPayloadOf,
} from './db.ts'

// The single review stage, worked: a queue that is answered rather than
// assigned, a detail that shows exactly what was judged, and a decision
// that closes the round exactly once.
//
// Who may act is never decided here - it is the one SQL definition in
// ./db.ts, the same fragment submit's arrival check asked. This module adds
// what only act-time knows: is judging open in this batch this minute, and
// is the round still open at all.

export interface ReviewInboxItem {
  readonly instanceId: string
  readonly entryId: string
  readonly batchId: string
  readonly batchName: string
  readonly itemId: string
  readonly itemTitle: string
  readonly participantName: string
  readonly businessNo: string | null
  readonly unitId: string | null
  readonly unitName: string | null
  readonly roundNo: number
  readonly route: 'normal' | 'escalation'
  /**
   * The filing's own answers under the question's real labels, never prose.
   * A file field carries a count rather than a value; the browser says how
   * that reads.
   */
  readonly values: readonly {
    readonly label: string
    readonly value: string
    readonly files: number | null
  }[]
  readonly attachmentCount: number
  readonly submittedAt: number
}

export interface ReviewStageView {
  readonly id: string
  readonly index: number
  /** the administrator's name for the step, when the policy carries one */
  readonly label: string | null
  readonly nodeName: string | null
  readonly roleNames: readonly string[]
  /**
   * who could act there today - the same question the queue asks; null when
   * this response did not resolve them, which an empty list would misreport
   * as an empty stage
   */
  readonly reviewers: readonly string[] | null
  readonly skipped: string | null
  /**
   * What a concluded sitting at this step said, judgment by judgment: the
   * next judge's evidence. Null where no sitting concluded, and always null
   * while one is open - a sealed ballot stays sealed (§32.66).
   */
  readonly opinions:
    | readonly {
        readonly who: string | null
        readonly decision: 'approve' | 'reject'
        readonly reason: string | null
        readonly comment: string | null
        readonly at: number
      }[]
    | null
}

export interface ReviewChainView {
  /** which of the two routes this round is walking */
  readonly route: 'normal' | 'escalation'
  /** the step it is standing at, by name */
  readonly stageId: string
  readonly normal: readonly ReviewStageView[]
  readonly escalation: readonly ReviewStageView[]
}

/**
 * One act of the workbench, offered or explained.
 *
 * The workbench draws all four acts at every sitting; what varies is
 * whether each may be taken now, and if not, why - which only this side
 * knows. `reason` is a stable code the browser translates; there is no
 * hidden state, because a reviewer standing at a round is owed the whole
 * map of what a reviewer can ever do.
 */
export interface ReviewActionView {
  readonly state: 'available' | 'blocked'
  readonly reason: 'no-route' | 'route-closed' | 'phase-closed' | 'route-end' | null
}

export interface ReviewActionsView {
  readonly approve: ReviewActionView
  readonly reject: ReviewActionView
  readonly escalate: ReviewActionView
  readonly supplement: ReviewActionView
}

/** one ask and its answer, as a reader sees them */
export type ReviewSupplementView = SupplementRow

export interface ReviewDetailView {
  readonly id: string
  readonly state: 'active' | 'blocked' | 'awaiting_supplement' | 'completed'
  readonly outcome: string | null
  readonly roundNo: number
  readonly entryId: string
  readonly batchId: string
  readonly itemId: string
  readonly itemTitle: string
  readonly participantName: string
  readonly businessNo: string | null
  readonly unitName: string | null
  readonly submittedAt: number
  readonly completedAt: number | null
  readonly revision: {
    readonly revisionNo: number
    readonly payload: unknown
    readonly note: string | null
    readonly attachments: readonly { attachmentId: string; position: number }[]
  }
  readonly form: { readonly itemType: string; readonly formConfig: unknown }
  readonly chain: ReviewChainView
  /** the four acts, each offered or carrying the reason it is not */
  readonly actions: ReviewActionsView
  /** the surroundings a page read resolves; a decision response leaves it null */
  readonly context: ReviewContextView | null
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    readonly reason: string | null
    readonly comment: string | null
    readonly suggestedPayload: unknown
    readonly at: number
  }[]
  /** what this round asked for beyond the filing, and what came back */
  readonly supplements: readonly ReviewSupplementView[]
  readonly capabilities: {
    readonly canDecide: boolean
    readonly canCancelSupplement: boolean
    readonly canAnswerSupplement: boolean
  }
}

/** what stands around the judged filing, resolved only for page reads */
export interface ReviewContextView {
  readonly worth: {
    readonly each: string | null
    readonly maxEntries: number | null
    readonly groupName: string | null
    readonly groupCap: string | null
    readonly materialRange: { readonly start: string; readonly end: string }
  }
  readonly siblings: readonly {
    readonly entryId: string
    readonly values: readonly {
      readonly label: string
      readonly value: string
      readonly files: number | null
    }[]
    readonly status: string
    readonly current: boolean
  }[]
  readonly previous: {
    readonly roundNo: number
    readonly kind: string
    readonly reason: string | null
    readonly comment: string | null
    readonly actorName: string | null
    readonly at: number
  } | null
  /**
   * The version just before the judged one, with the form it answered.
   * Carried with the review because the workbench opens comparing against
   * it: fetched separately it arrives a request late and flashes into a
   * page already being read.
   */
  readonly previousRevision: {
    readonly id: string
    readonly revisionNo: number
    readonly formConfig: unknown
    readonly payload: unknown
  } | null
  /** the rounds before that, one line each: has this been asked twice? */
  readonly earlier: readonly {
    readonly roundNo: number
    readonly kind: string
    readonly reason: string | null
    readonly actorName: string | null
    readonly at: number
  }[]
}

/**
 * What a reviewer can say (§14, §32.66) - always their own judgment of
 * the filing, never a workflow instruction. What the word then does is the
 * route's business, and the two routes are different machines.
 *
 * The ordinary route is a chain of confirmations: approve carries the round
 * to the next step and ends it at the last, reject ends it anywhere,
 * escalate hands it to the escalation route while the phase opens that.
 *
 * The escalation route is a ladder of settlements (§32.66, re-ruled
 * 2026-08-20): every step of it is qualified to settle the matter
 * positively, so approve ends the round wherever it is said. A middle
 * step's reject is an opinion that climbs - the final negative word belongs
 * to the route's end alone - and escalate climbs without an opinion.
 * Nothing on the ladder is phase-gated: the phase gates entering it.
 */
export type ReviewDecision = 'approve' | 'reject' | 'escalate'

/**
 * What may be said from where the round stands. One function, asked by the
 * reader and by the writer, so a button that shows available is a button
 * that works.
 */
const decisionsAt = (
  policy: ResolvedPolicy,
  here: ResolvedStage,
  gates: { mayEscalate: boolean },
): readonly ReviewDecision[] => {
  const said: ReviewDecision[] = ['approve', 'reject']
  if (here.route === 'normal') {
    if (gates.mayEscalate && escalationOpen(policy)) said.push('escalate')
  } else if (!isRouteEnd(policy, here)) {
    said.push('escalate')
  }
  return said
}

/** review words that landed, by which word; the label space is the decision enum */
const reviewDecisionCount = boundedCounter('qualy.assessment.review.decision', {
  decision: ['approve', 'reject', 'escalate'],
})

/** whether this word, said here, ends the round rather than moving it */
const wordEnds = (policy: ResolvedPolicy, here: ResolvedStage, action: ReviewDecision): boolean =>
  action === 'approve'
    ? here.route === 'escalation' || isRouteEnd(policy, here)
    : action === 'reject'
      ? here.route === 'normal' || isRouteEnd(policy, here)
      : false

export interface ReviewDecisionInput {
  readonly decision: ReviewDecision
  /** one of the batch's configured labels; required when a list is configured */
  readonly reason?: string
  readonly comment?: string
  readonly suggestedPayload?: unknown
  /**
   * What this approval determines, when the question asks for anything.
   *
   * Optional on the wire and absent for every question that asks nothing -
   * the server determines those from the seed rather than making a client
   * post an empty object. `reason` here is why the determination CHANGED,
   * which is a different question from why a claim was refused.
   */
  readonly recognition?: {
    readonly values: unknown
    readonly reason?: string
  }
}

/** one ask this reviewer's step is waiting on somebody else for */
export interface AwaitingItem {
  readonly requestId: string
  readonly instanceId: string
  readonly entryId: string
  readonly requestNo: number
  readonly status: 'open' | 'answered'
  readonly participantName: string
  readonly businessNo: string | null
  readonly itemTitle: string
  readonly asks: readonly string[]
  readonly requestedAt: number
  readonly answeredAt: number | null
}

export interface ReviewMethods {
  readonly listReviewInbox: (
    tenantId: string,
    page: { cursor?: string; limit?: string; batchId?: string },
    as: Principal,
  ) => Effect.Effect<
    { items: readonly ReviewInboxItem[]; nextCursor: string | null; handledToday: number },
    BadRequest
  >
  readonly listAwaitingSupplements: (
    tenantId: string,
    page: { batchId: string; cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<{ items: readonly AwaitingItem[]; nextCursor: string | null }, BadRequest>
  readonly getReviewInstance: (
    tenantId: string,
    instanceId: string,
    as: Principal,
  ) => Effect.Effect<ReviewDetailView, ReviewNotFound>
  readonly decideReview: (
    tenantId: string,
    instanceId: string,
    input: ReviewDecisionInput,
    as: Principal,
  ) => Effect.Effect<
    ReviewDetailView,
    ReviewNotFound | ReviewConflict | BatchReadOnly | EntryActionRefused | EntryPayloadInvalid
  >
  readonly appealReview: (
    tenantId: string,
    instanceId: string,
    input: { reason: string },
    as: Principal,
  ) => Effect.Effect<
    ReviewDetailView,
    ReviewNotFound | BatchReadOnly | EntryActionRefused | BatchNotFound
  >
  readonly requestSupplement: (
    tenantId: string,
    instanceId: string,
    input: {
      instructions: string
      requirements: readonly { label: string; kind: 'text' | 'file'; required: boolean }[]
    },
    as: Principal,
  ) => Effect.Effect<
    ReviewDetailView,
    ReviewNotFound | ReviewConflict | BatchReadOnly | EntryActionRefused | EntryPayloadInvalid
  >
  readonly cancelSupplement: (
    tenantId: string,
    requestId: string,
    as: Principal,
  ) => Effect.Effect<
    ReviewDetailView,
    ReviewNotFound | ReviewConflict | BatchReadOnly | EntryActionRefused
  >
  readonly answerSupplement: (
    tenantId: string,
    requestId: string,
    input: { payload: unknown },
    as: Principal,
  ) => Effect.Effect<
    ReviewDetailView,
    ReviewNotFound | ReviewConflict | BatchReadOnly | EntryActionRefused | EntryPayloadInvalid
  >
}

/** who may act now, and why not; the same shape the entry acts pass through */
type ActionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly layer: string; readonly reason: string }

export interface ReviewDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the phase gate's word on assessment.review.process in this batch, now */
  readonly reviewGate: (tenantId: string, batchId: string) => Effect.Effect<GateDecision>
  /** and on assessment.review.escalate, which a phase opens separately */
  readonly escalateGate: (tenantId: string, batchId: string) => Effect.Effect<GateDecision>
  /** administrative reach over the batch, the same door getEntry uses */
  readonly rosterReach: (as: Principal, tenantId: string, batchId: string) => Effect.Effect<boolean>
  readonly parseRange: (text: string) => { start: string; end: string }
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  /** the two storage doors a supplement answer walks, typed to what it uses */
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
  /** the participant-action door, for the one act a participant does here */
  readonly authorize: (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: { participantId?: string },
  ) => Effect.Effect<ActionDecision, BatchNotFound>
}

const refuse = (action: string, reason: string) => new EntryActionRefused({ action, reason })

/**
 * The claim's identity line for the queue and the sibling strip, in the
 * shared projection (§32.74): the item's elected summary fields, or the
 * first identifying ones. `files` stays in the shape for the wire, and is
 * always null now - an attachment count never identified a claim.
 */
const summaryValues = (
  formConfig: unknown,
  payload: unknown,
  displayConfig: unknown,
): readonly { label: string; value: string; files: number | null }[] =>
  projectEntrySummary({ formConfig, displayConfig, payload }).map((part) => ({
    label: part.label,
    value: part.value,
    files: null,
  }))

/** the batch's configured reason lists, read defensively off the jsonb */
const reasonsOf = (value: unknown): { reject: readonly string[]; escalate: readonly string[] } => {
  const read = (list: unknown): readonly string[] =>
    Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : []
  const record = (value ?? {}) as Record<string, unknown>
  return { reject: read(record['reject']), escalate: read(record['escalate']) }
}

export const makeReviewMethods = (deps: ReviewDeps): ReviewMethods => {
  const { withDb } = deps

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

  /** the batches where judging is open this minute, out of those with work */
  const openBatches = (tenantId: string, batchIds: readonly string[]) =>
    Effect.gen(function* () {
      const open: string[] = []
      for (const batchId of [...new Set(batchIds)]) {
        const gate = yield* deps.reviewGate(tenantId, batchId)
        if (gate.allowed) open.push(batchId)
      }
      return open
    })

  /**
   * One round as a reader sees it. Naming the people at each stage costs a
   * query or two per stage, so whether to do it is the caller's: a page load
   * pays for it, the decision path does not - that one runs inside the batch
   * lock, where the critical section would otherwise grow with however many
   * stages an administrator configured, and every other reviewer in the batch
   * waits behind it.
   */
  const assembleDetail = (
    tenantId: string,
    row: ReviewInstanceDetailRow,
    view: {
      canDecide: boolean
      mayEscalate?: boolean
      resolveReviewers: boolean
      canCancelSupplement?: boolean
      /**
       * The caller-side half of "may answer the open ask": the subject of a
       * waiting round in a live batch. ANDed below with the ask actually
       * being open - the request itself is the capability, never a phase.
       */
      answerable?: boolean
    },
  ) =>
    Effect.gen(function* () {
      const revision = (yield* entryRevisionOf(tenantId, row.revisionId))!
      const itemRevision = yield* revisionOf(tenantId, row.itemRevisionId)
      const attachments = yield* revisionAttachmentsOf(tenantId, row.revisionId)
      const events = yield* reviewEventsOf(tenantId, row.id)
      const supplements = yield* supplementsOf(tenantId, row.id)
      const policy = row.effectivePolicy
      const everyStage = [...policy.normal, ...policy.escalation]
      const names = yield* chainNames({
        tenantId,
        nodeIds: everyStage.flatMap((stage) => (stage.nodeId === null ? [] : [stage.nodeId])),
        roleIds: everyStage.flatMap((stage) => [...stage.roleIds]),
      })
      // who is standing at each step right now: the one thing a route cannot
      // be read off its own snapshot, and the first thing anybody asks. The
      // round's own subject and author go in so a step never names somebody
      // the queue and the decision endpoint would refuse.
      const reviewersByStage = new Map<string, readonly string[]>()
      if (view.resolveReviewers) {
        for (const stage of everyStage) {
          if (stage.nodeId === null) continue
          reviewersByStage.set(
            stage.id,
            yield* holderNamesAt({
              tenantId,
              batchId: row.batchId,
              nodeId: stage.nodeId,
              roleIds: stage.roleIds,
              subjectUserId: row.subjectUserId,
              actorId: row.actorId,
            }),
          )
        }
      }
      const here = stageById(policy, row.currentRoute, row.currentStageId)
      // The four acts, each offered or explained. Availability repeats
      // decisionsAt's arithmetic in reasons: the same facts, said to a
      // person instead of a validator.
      const offered: readonly string[] =
        !view.canDecide || here === null
          ? []
          : decisionsAt(policy, here, { mayEscalate: view.mayEscalate === true })
      const act = (may: boolean, reason: ReviewActionView['reason']): ReviewActionView =>
        may ? { state: 'available', reason: null } : { state: 'blocked', reason }
      // why escalating is off the table here, when it is: on the ladder the
      // only cause is standing at its end; off it, no route, a route this
      // person resolves to none of, or the phase
      const escalateReason: ReviewActionView['reason'] =
        row.currentRoute === 'escalation'
          ? 'route-end'
          : policy.escalation.length === 0
            ? 'no-route'
            : !escalationOpen(policy)
              ? 'route-closed'
              : 'phase-closed'
      const actions: ReviewActionsView = {
        approve: act(offered.includes('approve'), null),
        reject: act(offered.includes('reject'), null),
        escalate: act(offered.includes('escalate'), escalateReason),
        supplement: act(view.canDecide, null),
      }
      // what the concluded sittings said, for the judge now standing after
      // them; and which steps this round stepped over, off its own trail
      const opinionsByStage = view.resolveReviewers
        ? yield* resolvedPanelOpinions(tenantId, row.id)
        : new Map<string, readonly PanelVoteRow[]>()
      const conflictSkipped = new Set(
        events
          .filter((event) => event.kind === 'stage-skipped' && event.stageId !== null)
          .map((event) => event.stageId as string),
      )
      // the surroundings only a page read pays for: the decision path runs
      // inside the batch lock, where every extra query is somebody waiting
      let context: ReviewContextView | null = null
      if (view.resolveReviewers) {
        const group = yield* scoreGroupOf(tenantId, row.scoreGroupId)
        const each = (
          itemRevision?.scoringConfig as
            { calculator?: { config?: { value?: unknown } } } | undefined
        )?.calculator?.config?.value
        const others = yield* siblingEntries(tenantId, row.itemId, row.participantId)
        const previous = yield* previousConclusion(tenantId, row.entryId, row.roundNo)
        const before = yield* revisionBefore(tenantId, row.entryId, revision.revisionNo)
        const older = yield* earlierConclusions(tenantId, row.entryId, row.roundNo)
        context = {
          worth: {
            each: typeof each === 'string' ? each : null,
            maxEntries: row.maxEntries,
            groupName: group?.name ?? null,
            groupCap: group?.cap ?? null,
            materialRange: deps.parseRange(row.batchMaterialRange),
          },
          siblings: others.map((one) => ({
            entryId: one.entryId,
            values: summaryValues(one.formConfig, one.payload, one.displayConfig),
            status: one.status,
            current: one.entryId === row.entryId,
          })),
          previous:
            previous === null
              ? null
              : {
                  roundNo: previous.roundNo,
                  kind: previous.kind,
                  reason: previous.reason,
                  comment: previous.comment,
                  actorName: previous.actorName,
                  at: previous.createdAt,
                },
          previousRevision:
            before === undefined
              ? null
              : {
                  id: before.id,
                  revisionNo: before.revisionNo,
                  formConfig: before.formConfig,
                  payload: before.payload,
                },
          // everything before the one shown in full, most recent first
          earlier: older.filter((one) => one.roundNo !== previous?.roundNo),
        }
      }
      const stageView = (stage: ResolvedStage): ReviewStageView => {
        const said = opinionsByStage.get(stage.id)
        return {
          id: stage.id,
          index: stage.index,
          label: stage.label,
          nodeName: stage.nodeId === null ? null : (names.nodes.get(stage.nodeId) ?? null),
          roleNames: stage.roleIds.map((roleId) => names.roles.get(roleId) ?? roleId),
          reviewers: view.resolveReviewers ? (reviewersByStage.get(stage.id) ?? []) : null,
          // the resolution-time reasons off the snapshot, and the run-time
          // one off the round's own trail: a staffed step stepped over
          // because only conflicted people held it
          skipped: stage.skipped ?? (conflictSkipped.has(stage.id) ? 'reviewer-conflict' : null),
          opinions:
            said === undefined
              ? null
              : said.map((vote) => ({
                  who: vote.voterName,
                  decision: vote.decision,
                  reason: vote.reason,
                  comment: vote.comment,
                  at: vote.createdAt,
                })),
        }
      }
      return {
        id: row.id,
        state: row.state,
        outcome: row.outcome,
        roundNo: row.roundNo,
        entryId: row.entryId,
        batchId: row.batchId,
        itemId: row.itemId,
        itemTitle: row.itemTitle,
        participantName: row.subjectName,
        businessNo: row.subjectBusinessNo,
        unitName: row.unitName,
        submittedAt: row.createdAt,
        completedAt: row.completedAt,
        revision: {
          revisionNo: revision.revisionNo,
          payload: revision.payload,
          note: revision.note,
          attachments,
        },
        form: { itemType: row.itemType, formConfig: itemRevision?.formConfig ?? null },
        chain: {
          route: row.currentRoute,
          stageId: row.currentStageId,
          normal: policy.normal.map(stageView),
          escalation: policy.escalation.map(stageView),
        },
        actions,
        context,
        events: events.map((event) => ({
          kind: event.kind,
          actorId: event.actorId,
          actorName: event.actorName,
          reason: event.reason,
          comment: event.comment,
          suggestedPayload: event.suggestedPayload,
          at: event.createdAt,
        })),
        supplements,
        capabilities: {
          canDecide: view.canDecide,
          canCancelSupplement: view.canCancelSupplement === true,
          canAnswerSupplement:
            view.answerable === true &&
            supplements.some((supplement) => supplement.status === 'open'),
        },
      } satisfies ReviewDetailView
    })

  /**
   * Whether this person matches the round's CURRENT stage. For acting that
   * is the whole question - the state machine behind each act answers
   * "closed" and "waiting" precisely, and the reviewer who just lost a race
   * to a peer deserves "somebody already handled this", not "nothing here".
   * For READING it is only half: see mayRead, which also requires the round
   * to still be open, because a reviewer's reach is their unfinished duty
   * and ends with their decision.
   */
  const mayAct = (tenantId: string, row: ReviewInstanceDetailRow, as: Principal) =>
    userMayReview({
      tenantId,
      userId: as.userId,
      instance: {
        id: row.id,
        batchId: row.batchId,
        currentRoute: row.currentRoute,
        currentNodeId: row.currentNodeId,
        currentRoleIds: row.currentRoleIds,
        subjectUserId: row.subjectUserId,
        actorId: row.actorId,
      },
    })

  /**
   * Whether this person may READ the round as its reviewer: the same
   * boundary the entry side's mayReviewEntry expresses in SQL - an open
   * round, and the reader at its current stage. A completed round keeps its
   * last stage on the row, and matching that stage used to keep reading
   * alive after the decision had handed the round on; the state gate is
   * what makes "submitted and moved on" mean "gone".
   *
   * An open ask narrows this further (§32.70): the stage is a shared pool,
   * but the ask is one reviewer's unfinished business. While the round
   * waits, only the reviewer who asked still holds it; a colleague's duty
   * ended the moment the ask went out, and resumes - for everyone eligible
   * - when the answer brings the round back to the pool.
   */
  const mayRead = (tenantId: string, row: ReviewInstanceDetailRow, as: Principal) =>
    row.state === 'awaiting_supplement'
      ? Effect.gen(function* () {
          const requester = yield* openAskRequesterOf(tenantId, row.id)
          if (requester !== as.userId) return false
          return yield* mayAct(tenantId, row, as)
        })
      : isOpenReviewState(row.state)
        ? mayAct(tenantId, row, as)
        : Effect.succeed(false)

  const listReviewInbox: ReviewMethods['listReviewInbox'] = Effect.fn('Assessment.listReviewInbox')(
    function* (tenantId, page, as) {
      const fingerprint = `review-inbox:${as.userId}`
      const key = readQueryCursor(page.cursor, fingerprint, ['timestamp', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      const withWork = yield* dieQuery(withDb(activeReviewBatches(tenantId)))
      const asked =
        page.batchId === undefined ? withWork : withWork.filter((one) => one === page.batchId)
      const open = yield* openBatches(tenantId, asked)
      const rows = yield* dieQuery(
        withDb(
          inboxPage({
            tenantId,
            userId: as.userId,
            batchIds: open,
            after: key === undefined ? undefined : [key[0]!, key[1]!],
            limit: limit + 1,
          }),
        ),
      )
      const pageRows: readonly InboxRow[] = rows.slice(0, limit)
      const last = pageRows[pageRows.length - 1]
      // the day's count belongs to a batch: a day is a timezone's, and only
      // a batch has one, so the cross-batch queue simply does not count
      let handledToday = 0
      if (page.batchId !== undefined) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, page.batchId)))
        if (batch !== null) {
          const asked = {
            tenantId,
            batchId: page.batchId,
            userId: as.userId,
            timezone: batch.timezone,
          }
          // events and votes are two shapes of one day's work: a panel vote
          // deliberately writes no event until its sitting concludes
          handledToday =
            (yield* dieQuery(withDb(decisionsToday(asked)))) +
            (yield* dieQuery(withDb(votesToday(asked))))
        }
      }
      return {
        items: pageRows.map((row) => ({
          instanceId: row.instanceId,
          entryId: row.entryId,
          batchId: row.batchId,
          batchName: row.batchName,
          itemId: row.itemId,
          itemTitle: row.itemTitle,
          participantName: row.participantName,
          businessNo: row.businessNo,
          unitId: row.unitId,
          unitName: row.unitName,
          roundNo: row.roundNo,
          route: row.route,
          values: summaryValues(row.formConfig, row.payload, row.displayConfig),
          attachmentCount: row.attachmentCount,
          submittedAt: row.submittedAt,
        })),
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeQueryCursor(fingerprint, [last.submittedAtIso, last.instanceId])
            : null,
        handledToday,
      }
    },
  )

  /**
   * What this reviewer's step is waiting on somebody else for.
   *
   * Its own list rather than a corner of the queue: the queue is what can be
   * decided now, and a round paused for material cannot. Kept beside it all
   * the same, because an ask nobody can see is an ask nobody follows up.
   */
  const listAwaitingSupplements: ReviewMethods['listAwaitingSupplements'] = Effect.fn(
    'Assessment.listAwaitingSupplements',
  )(function* (tenantId, page, as) {
    const fingerprint = `review-awaiting:${page.batchId}:${as.userId}`
    const key = readQueryCursor(page.cursor, fingerprint, ['timestamp', 'uuid'])
    if (key === null) return yield* cursorUnusable()
    const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
    const rows = yield* dieQuery(
      withDb(
        awaitingPage({
          tenantId,
          batchId: page.batchId,
          userId: as.userId,
          after: key === undefined ? undefined : [key[0]!, key[1]!],
          limit: limit + 1,
        }),
      ),
    )
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    return {
      items: pageRows.map((row) => ({
        requestId: row.requestId,
        instanceId: row.instanceId,
        entryId: row.entryId,
        requestNo: row.requestNo,
        status: row.status,
        participantName: row.participantName,
        businessNo: row.businessNo,
        itemTitle: row.itemTitle,
        asks: row.asks,
        requestedAt: row.requestedAt,
        answeredAt: row.answeredAt,
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeQueryCursor(fingerprint, [last.requestedAtIso, last.requestId])
          : null,
    }
  })

  const getReviewInstance: ReviewMethods['getReviewInstance'] = Effect.fn(
    'Assessment.getReviewInstance',
  )(function* (tenantId, instanceId, as) {
    const row = yield* dieQuery(withDb(instanceOf(tenantId, instanceId)))
    if (row === null) return yield* new ReviewNotFound()
    // who may see a round: its subject, whoever is judging its OPEN stage,
    // and staff whose administrative reach covers the batch - anyone else,
    // the reviewers of every finished stage included, learns nothing, not
    // even that it exists
    const judge = yield* dieQuery(withDb(mayRead(tenantId, row, as)))
    if (row.subjectUserId !== as.userId && !judge) {
      const admin = yield* deps.rosterReach(as, tenantId, row.batchId)
      if (!admin) return yield* new ReviewNotFound()
    }
    const gate = yield* deps.reviewGate(tenantId, row.batchId)
    const canDecide =
      judge && row.state === 'active' && row.batchStatus === 'active' && gate.allowed
    // turning an ordinary review into an escalation is its own thing a phase opens
    // and closes: during an appeal window there is nothing to escalate
    // about, because an appeal is already on the escalation route
    const escalationDecision = yield* deps.escalateGate(tenantId, row.batchId)
    return yield* dieQuery(
      withDb(
        assembleDetail(tenantId, row, {
          canDecide,
          mayEscalate: escalationDecision.allowed,
          resolveReviewers: true,
          canCancelSupplement:
            judge &&
            row.state === 'awaiting_supplement' &&
            row.batchStatus === 'active' &&
            gate.allowed,
          // deliberately no phase gate: the open ask is the whole capability
          answerable:
            row.subjectUserId === as.userId &&
            row.state === 'awaiting_supplement' &&
            row.batchStatus === 'active',
        }),
      ),
    )
  })

  /**
   * What a reviewer is shown before they determine anything.
   *
   * The question is never "what was this claim last recognised as" - it is
   * "what is this round revisiting". A round that revisits a decision starts
   * from that decision; a round that is looking at a filing for the first
   * time starts from the filing.
   *
   *   the sitting's frozen proposal - a second ballot votes on the text the
   *   first one was cast on, never on a fresh reading;
   *
   *   this round's last approval - a stage inherits what the stage below
   *   determined, so a correction is not undone by climbing;
   *
   *   then, and only for a round that exists to revisit something: the
   *   determination it is revisiting. An appeal opens on the decision it
   *   contests, a re-routed round on what the round it replaced had already
   *   determined, a reopened one on what the claim stands recognised as;
   *
   *   and otherwise the filing itself, through the defaults the plan
   *   recorded.
   *
   * The last two are the whole point of reading `origin`. Inheriting from
   * the claim's standing determination unconditionally would be just as
   * wrong in the other direction: a student sent away to fix their evidence
   * files new material and resubmits, and the first person to read the new
   * material would be handed the level determined from the old.
   */
  const recognitionSeed = (
    tenantId: string,
    instanceId: string,
    plan: ScoringPlan,
    row: {
      readonly entryId: string
      readonly revisionId: string
      readonly itemType: string
      readonly recognitionRevisionId: string
      readonly origin: 'initial' | 'appeal' | 'reopen' | 'reroute'
      readonly appealedInstanceId: string | null
      readonly supersedesInstanceId: string | null
    },
  ) =>
    Effect.gen(function* () {
      const locked = yield* lockedProposalOf(tenantId, instanceId)
      if (locked !== null) return locked
      const said = yield* lastRecognitionOf(tenantId, instanceId)
      if (said !== null) return said
      const revisited = yield* revisitedRecognition(tenantId, row)
      if (revisited !== null) return revisited
      // read the way this round reads it: the filing may have been written
      // against an older form, and the round judges it under the current
      // one, so the defaults come from the carried material rather than
      // from the original answer to a question that has since changed
      const filing = yield* revisionPayloadOf(tenantId, row.revisionId)
      const driver = deps.itemTypes.get(row.itemType)
      const written =
        filing.itemRevisionId === null || driver?.projectPayload === undefined
          ? null
          : yield* revisionOf(tenantId, filing.itemRevisionId)
      const judged = yield* revisionOf(tenantId, row.recognitionRevisionId)
      const carried =
        written === null || judged === null || driver?.projectPayload === undefined
          ? filing.payload
          : driver.projectPayload(written.formConfig, judged.formConfig, filing.payload)
      return seedFromEvidence(plan, carried)
    })

  /**
   * The determination this round exists to revisit, if it exists to revisit
   * one at all.
   *
   * An appeal names the round it contests. A re-route names the round it
   * replaced, and walks back through a chain of them - an administrator may
   * move an open round more than once - to whatever the last of them
   * determined. A reopen has no round of its own to point at, so it takes
   * the claim's standing determination, which is exactly what reopening
   * means. A first look at a filing revisits nothing.
   */
  const revisitedRecognition = (
    tenantId: string,
    row: {
      readonly entryId: string
      readonly origin: 'initial' | 'appeal' | 'reopen' | 'reroute'
      readonly appealedInstanceId: string | null
      readonly supersedesInstanceId: string | null
    },
  ): Effect.Effect<RecognitionValues | null, QueryFailed, Orm> =>
    Effect.gen(function* () {
      if (row.origin === 'initial') return null
      if (row.origin === 'reopen') {
        const standing = yield* currentRecognitionOf(tenantId, row.entryId)
        return standing === null ? null : standing.values
      }
      if (row.origin === 'appeal') {
        if (row.appealedInstanceId === null) return null
        const contested = yield* recognitionOfInstance(tenantId, row.appealedInstanceId)
        if (contested !== null) return contested
        // a round that was appealed but left no determination of its own -
        // history from before determinations were recorded - falls back to
        // what the claim stands recognised as, which is what that round
        // decided if it decided anything
        const standing = yield* currentRecognitionOf(tenantId, row.entryId)
        return standing === null ? null : standing.values
      }
      // reroute: back through however many times the round was moved
      let previous = row.supersedesInstanceId
      const walked = new Set<string>()
      while (previous !== null && !walked.has(previous)) {
        walked.add(previous)
        const said = yield* lastRecognitionOf(tenantId, previous)
        if (said !== null) return said
        const older = yield* instanceLineageOf(tenantId, previous)
        previous = older === null ? null : older.supersedesInstanceId
      }
      return null
    })

  const decideReview: ReviewMethods['decideReview'] = Effect.fn('Assessment.decideReview')(
    function* (tenantId, instanceId, input, as) {
      const action = input.decision
      const decided = withDb(
        transaction(
          Effect.gen(function* () {
            // where the round lives, and nothing else: a round never changes
            // batch, so this is safe to lock by and safe to be stale about
            const located = yield* instanceOf(tenantId, instanceId)
            if (located === null) return yield* new ReviewNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            // The round row, taken under the batch lock and never before it:
            // panel votes and seat claims serialize here, and every panel
            // read below is post-lock. Order matters - a void or re-route
            // holds the batch and then touches instance rows, so locking
            // the instance first was a deadlock with everything (found the
            // hard way, as an ABBA kill under CI load).
            yield* lockReviewInstance(tenantId, instanceId)
            // Read it again, and judge from this one. A word is answered by
            // the step the round stands on at the moment it is written, not
            // the step it stood on when the page was drawn: between the two
            // another judge can have confirmed this step and handed the
            // round upward, and a decision taken against the abandoned step
            // would close the round from a place its author never held.
            const row = yield* instanceOf(tenantId, instanceId)
            if (row === null) return yield* new ReviewNotFound()
            const judge = yield* mayAct(tenantId, row, as)
            if (!judge) {
              // the read rule decides what the refusal admits: a reader is
              // told they may not act, a stranger that there is nothing here
              const admin = yield* deps.rosterReach(as, tenantId, row.batchId)
              if (row.subjectUserId === as.userId || admin) {
                return yield* refuse(action, 'not-reviewer')
              }
              return yield* new ReviewNotFound()
            }
            const gate = yield* deps.reviewGate(tenantId, row.batchId)
            if (!gate.allowed) return yield* refuse(action, gate.reason)
            // a round that asked for more has nothing to decide until the
            // answer comes back or the ask is taken back
            if (row.state === 'awaiting_supplement') {
              return yield* refuse(action, 'awaiting-supplement')
            }
            // and a round that has already concluded takes no more words. The
            // single judge's terminal write says this for itself by failing
            // its compare-and-set; a panel would otherwise seat itself afresh
            // on a closed round and leave the sitting open behind it.
            if (row.state === 'completed') return yield* new ReviewConflict()

            const policy = row.effectivePolicy
            const here = stageById(policy, row.currentRoute, row.currentStageId)
            if (here === null) return yield* refuse(action, 'chain-unreadable')
            // Where this round stands decides what may be said here (§14,
            // §32.66): the ordinary route confirms step by step and may hand
            // the round to the escalation ladder while the phase opens that;
            // every rung of the ladder may settle the matter, and only its
            // last rung may finally refuse it.
            const escalationDecision =
              action === 'escalate' && here.route === 'normal'
                ? yield* deps.escalateGate(tenantId, row.batchId)
                : { allowed: true as const }
            const allowed = decisionsAt(policy, here, {
              mayEscalate: escalationDecision.allowed,
            })
            if (!allowed.includes(action)) {
              // an escalation refused by the phase says so in the phase's own
              // words; anything else is simply not on offer here
              return yield* refuse(
                action,
                action === 'escalate' && !escalationDecision.allowed
                  ? (escalationDecision as { reason: string }).reason
                  : 'decision-not-available',
              )
            }

            const comment = input.comment?.trim() ?? ''
            if (comment === '' && action !== 'approve') {
              // everything except a plain approval is something being said to
              // a person; without a word it is only an obstacle
              return yield* new EntryPayloadInvalid({
                issues: [{ field: 'comment', reason: 'required' }],
              })
            }
            // the label is picked, not invented: it must come off the batch's
            // configured list for this act, and when a list is configured the
            // act does not go through without one
            const reason = input.reason?.trim() ?? ''
            const offered =
              action === 'reject'
                ? reasonsOf(row.batchReviewReasons).reject
                : action === 'escalate'
                  ? reasonsOf(row.batchReviewReasons).escalate
                  : []
            if (action === 'reject' || action === 'escalate') {
              if (offered.length > 0 && reason === '') {
                return yield* new EntryPayloadInvalid({
                  issues: [{ field: 'reason', reason: 'required' }],
                })
              }
              if (reason !== '' && !offered.includes(reason)) {
                return yield* new EntryPayloadInvalid({
                  issues: [{ field: 'reason', reason: 'not-offered' }],
                })
              }
            } else if (reason !== '') {
              return yield* new EntryPayloadInvalid({
                issues: [{ field: 'reason', reason: 'not-allowed' }],
              })
            }
            let suggestion: unknown
            if (input.suggestedPayload !== undefined) {
              // advice to the person who filed rides only a rejection that
              // actually reaches them: a climbing opinion and a panel vote
              // end nothing, and their words go to the next judge instead
              if (!(action === 'reject' && wordEnds(policy, here, 'reject'))) {
                return yield* new EntryPayloadInvalid({
                  issues: [{ field: 'suggestedPayload', reason: 'not-allowed' }],
                })
              }
              suggestion = yield* decodeSuggestion(tenantId, row, input.suggestedPayload)
            }

            // What this round determines under, and what it is standing on
            // now. The contract is the one frozen when the round opened -
            // not today's - so an administrator saving the question
            // mid-round cannot change what a reviewer is being asked.
            const contract = yield* revisionOf(tenantId, row.recognitionRevisionId)
            if (contract === null) return yield* refuse(action, 'chain-unreadable')
            const plan = yield* Effect.orDie(readScoringPlan(contract))
            const seed = yield* recognitionSeed(tenantId, instanceId, plan, row)

            // a refusal or a referral determines nothing: "I cannot tell"
            // is a legitimate thing for a reviewer to say, and forcing a
            // determination out of it would put words in their mouth
            if (action !== 'approve' && input.recognition !== undefined) {
              return yield* new EntryPayloadInvalid({
                issues: [{ field: 'recognition', reason: 'not-allowed' }],
              })
            }
            let determined: RecognitionValues | undefined
            let determinedHash: string | undefined
            let determinedReason: string | null = null
            if (action === 'approve') {
              const candidate = canonicalRecognition(
                plan.recognitionSchemas,
                input.recognition === undefined
                  ? seed
                  : (input.recognition.values as RecognitionValues),
              )
              const wrong = judgeRecognition(plan.recognitionSchemas, candidate)
              if (wrong.length > 0) {
                return yield* new EntryPayloadInvalid({
                  issues: wrong.map((issue) => ({
                    field: issue.recognitionId === '' ? 'recognition' : `recognition.${issue.recognitionId}`,
                    reason: issue.reason,
                  })),
                })
              }
              // Contradicting what was already determined is a decision of
              // its own, and one the next reader is owed an explanation for.
              // Filling in a fact that had none is not: a reviewer-only
              // field reaches the first reader empty by design, and asking
              // them to justify writing it would be asking them to justify
              // doing their job.
              const changed = contradicted(seed, candidate).length > 0
              const given = input.recognition?.reason?.trim() ?? ''
              if (changed && given === '') {
                return yield* new EntryPayloadInvalid({
                  issues: [{ field: 'recognition.reason', reason: 'required' }],
                })
              }
              determined = candidate
              determinedHash = recognitionHash(candidate)
              determinedReason = given === '' ? null : given
            }

            const say = (kind: string) =>
              insertReviewEvent({
                tenantId,
                reviewInstanceId: instanceId,
                kind,
                actorId: as.userId,
                // where it was said, so a round re-routed onto a newer policy
                // can still answer "which level approved this"
                route: here.route,
                stageId: here.id,
                reason: reason === '' ? null : reason,
                comment: comment === '' ? null : comment,
                ...(suggestion !== undefined ? { suggestedPayload: suggestion } : {}),
                ...(determined === undefined
                  ? {}
                  : {
                      recognitionPayload: determined,
                      recognitionReason: determinedReason,
                      recognitionHash: determinedHash ?? null,
                    }),
              })
            /** the round's own word, spoken by no one: a sitting concluding */
            const sayFrom = (
              kind: string,
              actorId: string | null,
              snapshot?: {
                readonly recognitionPayload: RecognitionValues
                readonly recognitionHash: string
                /** the sitting's own explanation for its proposal, if it gave one */
                readonly recognitionReason: string | null
              },
            ) =>
              insertReviewEvent({
                tenantId,
                reviewInstanceId: instanceId,
                kind,
                actorId,
                route: here.route,
                stageId: here.id,
                ...(snapshot === undefined
                  ? {}
                  : {
                      recognitionPayload: snapshot.recognitionPayload,
                      recognitionHash: snapshot.recognitionHash,
                      recognitionReason: snapshot.recognitionReason,
                    }),
              })

            /**
             * The determination this round settles on, written down.
             *
             * Appended, never edited: if this claim already stood recognised
             * as something, the new determination supersedes that one by
             * pointing at it, so an appeal reads as "provincial, then
             * national" rather than as a value whose history is gone. The
             * pointer moves in the same statement that moves the status,
             * because an approved claim without a determination is a row the
             * table refuses.
             */
            const settle = (values: RecognitionValues, eventId: string) =>
              Effect.gen(function* () {
                const standing = yield* currentRecognitionOf(tenantId, row.entryId)
                return yield* insertRecognition({
                  tenantId,
                  batchId: row.batchId,
                  entryId: row.entryId,
                  entryRevisionId: row.revisionId,
                  itemId: row.itemId,
                  itemRevisionId: row.recognitionRevisionId,
                  values,
                  source: 'review',
                  reviewInstanceId: instanceId,
                  reviewEventId: eventId,
                  ...(standing === null ? {} : { supersedesId: standing.id }),
                })
              })

            /**
             * Climbs the ladder from `from`: the next rung somebody
             * independent can stand at, stepping over rungs held only by
             * this round's own earlier judges, blocking on a genuinely
             * unstaffed one. The acting event is already written, so the
             * walker's independence rule counts the very act being taken.
             */
            const climb = (from: number) =>
              Effect.gen(function* () {
                const landing = yield* resolveArrival({
                  tenantId,
                  batchId: row.batchId,
                  policy,
                  route: 'escalation',
                  from,
                  subjectUserId: row.subjectUserId,
                  actorId: row.actorId,
                  excludeJudgedOfInstanceId: instanceId,
                  conflictSkip: true,
                })
                if (landing === null || landing.stage.nodeId === null) {
                  return yield* refuse(action, 'chain-ends-here')
                }
                const nodePath = yield* nodePathOf(tenantId, landing.stage.nodeId)
                if (nodePath === null) return yield* refuse(action, 'chain-ends-here')
                const moved = yield* advanceReviewInstance({
                  tenantId,
                  instanceId,
                  fromRoute: here.route,
                  fromStageId: here.id,
                  toRoute: 'escalation',
                  toStageId: landing.stage.id,
                  roleIds: landing.stage.roleIds,
                  nodeId: landing.stage.nodeId,
                  nodePath,
                  state: landing.state,
                  blockedReason: landing.blockedReason,
                })
                if (!moved) return yield* new ReviewConflict()
                // the steps stepped over, on the record: the chain view and
                // the trail both read them off the round itself
                for (const stepped of landing.skipped) {
                  yield* insertReviewEvent({
                    tenantId,
                    reviewInstanceId: instanceId,
                    kind: 'stage-skipped',
                    actorId: null,
                    route: 'escalation',
                    stageId: stepped.id,
                  })
                }
                if (landing.state === 'blocked') {
                  yield* insertReviewEvent({
                    tenantId,
                    reviewInstanceId: instanceId,
                    kind: 'assignee-not-found',
                    actorId: null,
                    route: 'escalation',
                    stageId: landing.stage.id,
                  })
                } else if (isPanelStage(landing.stage)) {
                  yield* createPanel({
                    tenantId,
                    reviewInstanceId: instanceId,
                    route: 'escalation',
                    stageId: landing.stage.id,
                    members: landing.eligible,
                  })
                }
              })

            /** what every path returns: the round as it now stands */
            const written = () =>
              Effect.gen(function* () {
                yield* announce(tenantId, row.batchId, [
                  { kind: 'review-instance-changed' },
                  { kind: 'review-inbox-changed' },
                  { kind: 'entries-changed', subjectUserId: row.subjectUserId },
                  { kind: 'result-changed', subjectUserId: row.subjectUserId },
                ])
                const after = (yield* instanceOf(tenantId, instanceId))!
                return yield* assembleDetail(tenantId, after, {
                  canDecide: false,
                  resolveReviewers: false,
                })
              })

            if (isPanelStage(here)) {
              // The sitting. Usually constituted when the round arrived; a
              // round that arrived blocked and healed constitutes it on
              // first contact, from whoever is eligible now.
              let panel = yield* openPanelOf(tenantId, instanceId)
              if (panel === null) {
                const arrived = yield* stageArrival({
                  tenantId,
                  batchId: row.batchId,
                  stage: here,
                  subjectUserId: row.subjectUserId,
                  actorId: row.actorId,
                  excludeJudgedOfInstanceId: instanceId,
                })
                if (arrived.state !== 'active') return yield* new ReviewConflict()
                yield* createPanel({
                  tenantId,
                  reviewInstanceId: instanceId,
                  route: here.route,
                  stageId: here.id,
                  members: arrived.eligible,
                })
                panel = yield* openPanelOf(tenantId, instanceId)
                if (panel === null) return yield* new ReviewConflict()
              }
              // live truth about the seats: an unvoted occupant who lost
              // standing frees the seat here and now, not at the next patrol
              const seats = yield* livePanelSeats(tenantId, panel.id)
              const eligibleNow = new Set(
                here.nodeId === null
                  ? []
                  : yield* reviewersAtStage(tenantId, row, here, instanceId),
              )
              for (const seat of seats) {
                if (seat.voted === null && !eligibleNow.has(seat.userId)) {
                  yield* endPanelAssignment({
                    tenantId,
                    assignmentId: seat.assignmentId,
                    reason: 'eligibility-lost',
                  })
                }
              }

              if (action === 'escalate') {
                // one member pulling the matter up ends the sitting: raising
                // the level is safe, and the unturned ballots are moot
                const closed = yield* resolvePanel({
                  tenantId,
                  panelId: panel.id,
                  resolution: 'escalated',
                })
                if (!closed) return yield* new ReviewConflict()
                yield* say('escalated')
                yield* climb(here.index + 1)
                return yield* written()
              }

              // approve and reject are ballots; the sitting concludes when
              // every seat has spoken, and not a moment sooner - the point
              // of a panel is every judgment, not the first
              const own = seats.find(
                (seat) =>
                  seat.userId === as.userId && seat.voted === null && eligibleNow.has(seat.userId),
              )
              const taken =
                own !== undefined
                  ? { assignmentId: own.assignmentId }
                  : yield* claimPanelSeat({ tenantId, panelId: panel.id, userId: as.userId })
              if (taken === null) return yield* new ReviewConflict()

              // The determination this sitting is voting on, frozen by its
              // Establishing what a sitting is voting on, and voting on it,
              // are two acts.
              //
              // The first APPROVING ballot fixes the text: three reviewers
              // approving three different determinations is not a decision
              // anybody could act on, so every approval after it must be for
              // the same words or be refused. A refusal fixes nothing and is
              // held to nothing - "I cannot pass this" is answerable without
              // anybody having determined anything, and a sitting whose
              // first reviewer refuses would otherwise have to invent a
              // complete determination before it could say no. It costs
              // nothing in safety: the round can only end approved if every
              // ballot approved, and every approving ballot carried the one
              // frozen text.
              const frozen = yield* panelRecognitionOf(tenantId, panel.id)
              let ballotHash = frozen === null ? null : frozen.hash
              if (action === 'approve') {
                if (frozen === null) {
                  const opening = canonicalRecognition(plan.recognitionSchemas, determined ?? seed)
                  const wrong = judgeRecognition(plan.recognitionSchemas, opening)
                  if (wrong.length > 0) {
                    return yield* new EntryPayloadInvalid({
                      issues: wrong.map((issue) => ({
                        field:
                          issue.recognitionId === ''
                            ? 'recognition'
                            : `recognition.${issue.recognitionId}`,
                        reason: issue.reason,
                      })),
                    })
                  }
                  yield* lockPanelRecognition({
                    tenantId,
                    panelId: panel.id,
                    values: opening as Record<string, unknown>,
                    hash: recognitionHash(opening),
                    // frozen with its explanation: the round ends on this
                    // text, so "why it differs from what we inherited" has
                    // to travel with it or it is lost when the sitting
                    // resolves
                    reason: determinedReason,
                  })
                  ballotHash = recognitionHash(opening)
                } else if (determined !== undefined && recognitionHash(determined) !== frozen.hash) {
                  return yield* new EntryPayloadInvalid({
                    issues: [{ field: 'recognition', reason: 'panel-recognition-locked' }],
                  })
                }
              }
              yield* insertVote({
                tenantId,
                panelId: panel.id,
                assignmentId: taken.assignmentId,
                voterUserId: as.userId,
                decision: action,
                reason: reason === '' ? null : reason,
                comment: comment === '' ? null : comment,
                // what this ballot was cast on: the frozen text where one
                // exists, and nothing where a refusal came before any
                recognitionHash: ballotHash,
              })
              const votes = yield* votesOfPanel(tenantId, panel.id)
              if (votes.length >= panel.seatCount) {
                const unanimous = votes.every((vote) => vote.decision === 'approve')
                // What the sitting amounted to, settled before it is written
                // down: a split at the ladder's end is the refusal, and
                // resolving as 'escalated' first left the row saying it had
                // handed the matter up while the round closed rejected.
                const ends = !unanimous && isRouteEnd(policy, here)
                const closed = yield* resolvePanel({
                  tenantId,
                  panelId: panel.id,
                  resolution: unanimous ? 'approved' : ends ? 'rejected' : 'escalated',
                })
                if (!closed) return yield* new ReviewConflict()
                if (unanimous) {
                  const won = yield* completeInstance({
                    tenantId,
                    instanceId,
                    outcome: 'approved',
                  })
                  if (!won) return yield* new ReviewConflict()
                  // The sitting's own word, and the determination it voted
                  // on: the frozen proposal, not this last ballot's opinion.
                  // Unanimous approval means every ballot was an approval,
                  // and the first of those fixed the text - so there is one.
                  const sitting = yield* panelRecognitionOf(tenantId, panel.id)
                  if (sitting === null) return yield* new ReviewConflict()
                  const eventId = yield* sayFrom('approved', null, {
                    recognitionPayload: sitting.values,
                    recognitionHash: sitting.hash,
                    recognitionReason: sitting.reason,
                  })
                  const recognitionId = yield* settle(sitting.values, eventId)
                  yield* setEntryState({
                    tenantId,
                    entryId: row.entryId,
                    from: ['in_review'],
                    to: 'approved',
                    currentRecognitionId: recognitionId,
                  })
                  yield* bumpParticipantAttention(tenantId, row.entryId)
                } else if (ends) {
                  // The end of the ladder owns the final no, and a sitting
                  // held there has nowhere to hand a split to: the split is
                  // the refusal. A panel is forbidden on the route's last
                  // step, but that is checked by POSITION while the round
                  // walks by RESOLUTION - a later step whose selector finds
                  // nobody for this participant is stepped over, which can
                  // leave this sitting as the last one. Climbing from here
                  // refuses the whole transaction, which threw the deciding
                  // vote away and left the round unable to ever conclude.
                  const won = yield* completeInstance({
                    tenantId,
                    instanceId,
                    outcome: 'rejected',
                  })
                  if (!won) return yield* new ReviewConflict()
                  yield* sayFrom('rejected', null)
                  yield* setEntryState({
                    tenantId,
                    entryId: row.entryId,
                    from: ['in_review'],
                    to: 'rejected',
                  })
                  yield* bumpParticipantAttention(tenantId, row.entryId)
                } else {
                  // anything short of every voice saying yes climbs, the
                  // 0-for-all case included: the ladder's end owns the final
                  // no, and it climbs with all the opinions attached
                  yield* sayFrom('escalated', null)
                  yield* climb(here.index + 1)
                }
              }
              return yield* written()
            }

            // a single judge answers for this step
            if (wordEnds(policy, here, action)) {
              // first writer wins; everyone else is told the round has closed
              const won = yield* completeInstance({
                tenantId,
                instanceId,
                outcome: action === 'approve' ? 'approved' : 'rejected',
              })
              if (!won) return yield* new ReviewConflict()
              const eventId = yield* say(action === 'approve' ? 'approved' : 'rejected')
              const recognitionId =
                determined === undefined ? undefined : yield* settle(determined, eventId)
              yield* setEntryState({
                tenantId,
                entryId: row.entryId,
                from: ['in_review'],
                to: action === 'approve' ? 'approved' : 'rejected',
                ...(recognitionId === undefined ? {} : { currentRecognitionId: recognitionId }),
              })
              // the verdict is the owner's news, not the stage handovers
              // on the way to it (§32.72)
              yield* bumpParticipantAttention(tenantId, row.entryId)
              return yield* written()
            }

            if (action === 'approve') {
              // the ordinary route's onward step: this level has confirmed,
              // the next one is owed the same look
              const next = nextAfter(policy, here)
              if (next === null || next.nodeId === null) {
                return yield* refuse(action, 'chain-ends-here')
              }
              const nodePath = yield* nodePathOf(tenantId, next.nodeId)
              if (nodePath === null) return yield* refuse(action, 'chain-ends-here')
              const arrived = yield* stageArrival({
                tenantId,
                batchId: row.batchId,
                stage: next,
                subjectUserId: row.subjectUserId,
                actorId: row.actorId,
              })
              // the arrival check, at every stage a round enters (§14): a
              // stage with nobody in it is written down as blocked, which the
              // patrol owns and heals - it is never the student's problem
              const moved = yield* advanceReviewInstance({
                tenantId,
                instanceId,
                fromRoute: here.route,
                fromStageId: here.id,
                toRoute: next.route,
                toStageId: next.id,
                roleIds: next.roleIds,
                nodeId: next.nodeId,
                nodePath,
                state: arrived.state,
                blockedReason: arrived.blockedReason,
              })
              if (!moved) return yield* new ReviewConflict()
              yield* say('approved')
              if (arrived.state === 'blocked') {
                yield* insertReviewEvent({
                  tenantId,
                  reviewInstanceId: instanceId,
                  kind: 'assignee-not-found',
                  actorId: null,
                  route: next.route,
                  stageId: next.id,
                })
              }
              return yield* written()
            }

            // The climbing words. The word goes on the record first, then
            // the ladder is walked: the walker's independence rule reads the
            // trail, and the very act being taken must already count -
            // whoever escalates or objects here is done with this round.
            yield* say(action === 'escalate' ? 'escalated' : 'opinion-rejected')
            yield* climb(here.route === 'normal' ? 0 : here.index + 1)
            return yield* written()
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
      // one count per decision that actually landed; refusals are not decisions
      return yield* decided.pipe(Effect.tap(() => reviewDecisionCount({ decision: action })))
    },
  )

  /**
   * The stage's eligible judges under the same-round rule, as a list of ids:
   * the panel paths ask it to reconcile seats against the present.
   */
  const reviewersAtStage = (
    tenantId: string,
    row: ReviewInstanceDetailRow,
    stage: ResolvedStage,
    instanceId: string,
  ) =>
    Effect.gen(function* () {
      const arrived = yield* stageArrival({
        tenantId,
        batchId: row.batchId,
        stage,
        subjectUserId: row.subjectUserId,
        actorId: row.actorId,
        excludeJudgedOfInstanceId: instanceId,
      })
      return arrived.eligible
    })

  /**
   * A suggestion held to the judged revision's own configuration: it must
   * read as a filing under THAT form, and it may only cite files the judged
   * payload already cited - advice may rearrange the evidence, never grow
   * it. Stored decoded, shown read-only; the entry itself does not move.
   */
  const decodeSuggestion = (tenantId: string, row: ReviewInstanceDetailRow, payload: unknown) =>
    Effect.gen(function* () {
      const driver = deps.itemTypes.get(row.itemType)
      if (driver === undefined) {
        return yield* new EntryPayloadInvalid({
          issues: [{ field: 'suggestedPayload', reason: 'item-type-not-installed' }],
        })
      }
      const itemRevision = yield* revisionOf(tenantId, row.itemRevisionId)
      if (itemRevision === null) {
        return yield* new EntryPayloadInvalid({
          issues: [{ field: 'suggestedPayload', reason: 'item-not-configured' }],
        })
      }
      const batch = yield* oneBatch(tenantId, row.batchId)
      const decoded = yield* Effect.result(
        driver.decodePayload(itemRevision.formConfig, payload, {
          materialRange: deps.parseRange(String(batch!.materialRange)),
        }),
      )
      if (Result.isFailure(decoded)) {
        const issues = (
          decoded.failure as { issues?: readonly { field: string; reason: string }[] }
        ).issues ?? [{ field: 'suggestedPayload', reason: 'unreadable' }]
        return yield* new EntryPayloadInvalid({ issues })
      }
      const cited = new Set(
        (yield* revisionAttachmentsOf(tenantId, row.revisionId)).map((a) => a.attachmentId),
      )
      const foreign = driver
        .attachmentRefs(itemRevision.formConfig, decoded.success)
        .filter((ref) => !cited.has(ref.attachmentId))
      if (foreign.length > 0) {
        return yield* new EntryPayloadInvalid({
          issues: foreign.map((ref) => ({ field: ref.field, reason: 'attachment-not-cited' })),
        })
      }
      return decoded.success
    })

  /**
   * Contesting a decision that has already been made.
   *
   * A round of its own, against the same filing: nothing was rewritten, and
   * what is being disputed is the conclusion. It opens on the escalation
   * route and behaves like any other walk of it (§32.66): every rung may
   * settle it positively, the last rung alone may finally refuse it.
   *
   * The other way out of a rejection is to change the material and submit
   * again, which is a different act on a different route. The two are
   * offered as two, because a screen that guesses which one somebody meant
   * gets it wrong for whoever was sure.
   */
  const appealReview: ReviewMethods['appealReview'] = Effect.fn('Assessment.appealReview')(
    function* (tenantId, instanceId, input, as) {
      const located = yield* dieQuery(withDb(instanceOf(tenantId, instanceId)))
      if (located === null) return yield* new ReviewNotFound()
      // only its subject appeals; to anybody else the round is not theirs to
      // have an opinion about, and a stranger learns nothing
      if (located.subjectUserId !== as.userId) {
        const admin = yield* deps.rosterReach(as, tenantId, located.batchId)
        if (!admin) return yield* new ReviewNotFound()
        return yield* refuse('appeal', 'not-your-entry')
      }
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            const reason = input.reason.trim()
            if (reason === '') return yield* refuse('appeal', 'reason-required')
            // Read under the lock, and nothing read before it is trusted:
            // an appeal is a state transition on the claim, and the claim
            // can have been decided again between the click and this line.
            const row = yield* instanceOf(tenantId, instanceId)
            if (row === null) return yield* new ReviewNotFound()
            const entry = yield* entryOf(tenantId, row.entryId)
            if (entry === null) return yield* new ReviewNotFound()
            // one open round per claim: whoever is already looking at it
            // finishes before anybody contests anything. Ahead of the
            // staleness test on purpose - a round in flight is the more
            // useful thing to be told about, and it is also why the
            // conclusion behind it is no longer the current one.
            if (yield* hasOpenRound(tenantId, row.entryId)) {
              return yield* refuse('appeal', 'review-already-open')
            }
            // An appeal contests the conclusion this claim stands on now,
            // not every conclusion it has ever stood on. The trail explains
            // how the claim got here; only the current pointers say what is
            // still open to argument. Without this a rejection already
            // superseded by a later approval could take the claim back off
            // that approval, and reopen it against the older filing.
            if (
              entry.currentReviewInstanceId !== instanceId ||
              entry.currentRevisionId !== row.revisionId
            ) {
              return yield* refuse('appeal', 'decision-superseded')
            }
            // The window, asked here and not at the door (§32.75): an appeal
            // is a transition on the claim, so what may be done to the claim
            // is read under the same lock that orders the transition. Asked
            // before it, an administrator narrowing the phase's profile or
            // taking the participant off the roster in that gap would be
            // answered with a permission that had already been withdrawn.
            const decision = yield* deps
              .authorize(as, 'assessment.entry.appeal', row.batchId, {
                participantId: row.participantId,
              })
              .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
            if (!decision.allowed) return yield* refuse('appeal', decision.reason)
            // there has to be a decision to contest
            if (
              row.state !== 'completed' ||
              (row.outcome !== 'approved' && row.outcome !== 'rejected')
            ) {
              return yield* refuse('appeal', 'nothing-to-appeal')
            }
            const item = yield* itemOf(tenantId, row.itemId)
            if (item === null || item.currentRevisionId === null) {
              return yield* refuse('appeal', 'item-not-configured')
            }
            const live = yield* revisionOf(tenantId, item.currentRevisionId)
            if (live === null) return yield* refuse('appeal', 'item-not-configured')
            const participant = yield* participantOf(tenantId, row.batchId, row.participantId)
            if (participant === null || participant.status !== 'active') {
              return yield* refuse('appeal', 'participant-not-active')
            }
            const policy = yield* resolvePolicy({
              tenantId,
              batchId: row.batchId,
              policy: readPolicy(live.reviewPolicy),
              lineage: participant.anchorLineage,
            })
            // An appeal walks the escalation route and nothing else; a
            // question with none configured has nowhere to hear one. The
            // walk applies the arrival rules (§32.66): a rung held only by
            // conflicted people - the appellant themselves, say - is stepped
            // over, a genuinely unstaffed one blocks. The prior round's
            // judges are eligible again on purpose: an appeal is a fresh
            // round, and their earlier word is a fact of the old one.
            const landing = yield* resolveArrival({
              tenantId,
              batchId: row.batchId,
              policy,
              route: 'escalation',
              from: 0,
              subjectUserId: participant.userId,
              actorId: row.actorId,
              conflictSkip: true,
            })
            if (landing === null || landing.stage.nodeId === null) {
              return yield* refuse('appeal', 'review-level-missing')
            }
            const nodePath = yield* nodePathOf(tenantId, landing.stage.nodeId)
            if (nodePath === null) return yield* refuse('appeal', 'review-level-missing')
            const roundNo = yield* nextRoundNo(tenantId, row.entryId)
            const opened = yield* insertReviewInstance({
              tenantId,
              entryId: row.entryId,
              // the same filing: an appeal disputes the conclusion, not the
              // material, and changing the material is the other door
              revisionId: row.revisionId,
              roundNo,
              origin: 'appeal',
              initiator: 'participant',
              appealedInstanceId: instanceId,
              policyRevisionId: live.id,
          recognitionRevisionId: live.id,
              effectivePolicy: policy,
              route: 'escalation',
              stageId: landing.stage.id,
              roleIds: landing.stage.roleIds,
              nodeId: landing.stage.nodeId,
              nodePath,
              state: landing.state,
              blockedReason: landing.blockedReason,
            })
            yield* insertReviewEvent({
              tenantId,
              reviewInstanceId: opened,
              kind: 'appealed',
              actorId: as.userId,
              route: 'escalation',
              stageId: landing.stage.id,
              comment: reason,
            })
            for (const stepped of landing.skipped) {
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: opened,
                kind: 'stage-skipped',
                actorId: null,
                route: 'escalation',
                stageId: stepped.id,
              })
            }
            if (landing.state === 'blocked') {
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: opened,
                kind: 'assignee-not-found',
                actorId: null,
                route: 'escalation',
                stageId: landing.stage.id,
              })
            } else if (isPanelStage(landing.stage)) {
              yield* createPanel({
                tenantId,
                reviewInstanceId: opened,
                route: 'escalation',
                stageId: landing.stage.id,
                members: landing.eligible,
              })
            }
            // the decision is being disputed, so it is no longer settled:
            // an approval under appeal stops counting until the appeal ends
            const moved = yield* setEntryState({
              tenantId,
              entryId: row.entryId,
              from: ['approved', 'rejected'],
              to: 'in_review',
              currentReviewInstanceId: opened,
            })
            if (!moved) return yield* refuse('appeal', 'nothing-to-appeal')
            yield* announce(tenantId, row.batchId, [
              { kind: 'review-instance-changed' },
              { kind: 'review-inbox-changed' },
              { kind: 'entries-changed', subjectUserId: row.subjectUserId },
              { kind: 'result-changed', subjectUserId: row.subjectUserId },
            ])
            const written = (yield* instanceOf(tenantId, opened))!
            return yield* assembleDetail(tenantId, written, {
              canDecide: false,
              resolveReviewers: false,
            })
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  /**
   * The judge/admin/stranger triage every supplement door shares with
   * decideReview: a judge acts, a reader is told they may not, a stranger
   * learns nothing.
   */
  const requireJudge = (
    tenantId: string,
    row: ReviewInstanceDetailRow,
    as: Principal,
    action: string,
  ) =>
    Effect.gen(function* () {
      const judge = yield* mayAct(tenantId, row, as)
      if (judge) return
      const admin = yield* deps.rosterReach(as, tenantId, row.batchId)
      if (row.subjectUserId === as.userId || admin) {
        return yield* refuse(action, 'not-reviewer')
      }
      return yield* new ReviewNotFound()
    })

  const MOST_REQUIREMENTS = 8
  const TEXT_MOST = 2000
  const FILES_MOST = 10

  /**
   * Asking the person who filed for more backing, without moving the round.
   *
   * The boundary (§32.65 ⑤): changing WHAT was claimed goes through a
   * rejection and a new revision; adding to WHY it should be believed goes
   * through here, and the judged revision never changes. The asks are a
   * deliberately small builder - text and file, nothing else - so a
   * supplement cannot grow into a second form the filing was not written
   * under. The round steps aside into awaiting_supplement, which is what
   * takes it out of everybody's queue while it waits.
   */
  const requestSupplement: ReviewMethods['requestSupplement'] = Effect.fn(
    'Assessment.requestSupplement',
  )(function* (tenantId, instanceId, input, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          // where the round lives, and nothing else: a round never changes
          // batch, so this is safe to lock by and safe to be stale about
          const located = yield* instanceOf(tenantId, instanceId)
          if (located === null) return yield* new ReviewNotFound()
          const locked = yield* lockBatch(tenantId, located.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          // Read it again, and ask from this one. Standing to ask is standing
          // at the step the round stands on now: between the two reads a
          // colleague can have confirmed this step and handed the round
          // upward, and an ask taken against the abandoned step would pause
          // the round out of the next judge's queue in the name of somebody
          // who holds nothing there. Nobody with standing could take it back
          // either, because cancelling belongs to the requester alone.
          const row = yield* instanceOf(tenantId, instanceId)
          if (row === null) return yield* new ReviewNotFound()
          yield* requireJudge(tenantId, row, as, 'supplement-request')
          const gate = yield* deps.reviewGate(tenantId, row.batchId)
          if (!gate.allowed) return yield* refuse('supplement-request', gate.reason)
          if (row.state !== 'active') {
            return yield* refuse(
              'supplement-request',
              row.state === 'awaiting_supplement' ? 'supplement-already-open' : 'review-not-open',
            )
          }
          const instructions = input.instructions.trim()
          const issues: { field: string; reason: string }[] = []
          if (instructions === '') issues.push({ field: 'instructions', reason: 'required' })
          if (input.requirements.length === 0) {
            issues.push({ field: 'requirements', reason: 'required' })
          }
          if (input.requirements.length > MOST_REQUIREMENTS) {
            issues.push({ field: 'requirements', reason: 'too-many' })
          }
          // keys are the server's: positional, stable for the answer to name
          const requirements: SupplementRequirement[] = input.requirements.map((asked, index) => ({
            key: `f${index + 1}`,
            label: asked.label.trim(),
            kind: asked.kind,
            required: asked.required,
          }))
          for (const [index, asked] of requirements.entries()) {
            if (asked.label === '') {
              issues.push({ field: `requirements.${index}.label`, reason: 'required' })
            }
          }
          if (issues.length > 0) return yield* new EntryPayloadInvalid({ issues })
          // the state flip is the race gate: only one ask can pause the round
          const paused = yield* setInstanceSupplementState({
            tenantId,
            instanceId,
            from: 'active',
            to: 'awaiting_supplement',
          })
          if (!paused) return yield* new ReviewConflict()
          const requestNo = yield* nextSupplementNo(tenantId, instanceId)
          yield* insertSupplementRequest({
            tenantId,
            reviewInstanceId: instanceId,
            requestNo,
            requestedBy: as.userId,
            instructions,
            requirements,
          })
          yield* insertReviewEvent({
            tenantId,
            reviewInstanceId: instanceId,
            kind: 'supplement-requested',
            actorId: as.userId,
            route: row.currentRoute,
            stageId: row.currentStageId,
            comment: instructions,
          })
          yield* bumpParticipantAttention(tenantId, row.entryId)
          yield* announce(tenantId, row.batchId, [
            { kind: 'review-instance-changed' },
            { kind: 'review-inbox-changed' },
            { kind: 'entries-changed', subjectUserId: row.subjectUserId },
          ])
          const written = (yield* instanceOf(tenantId, instanceId))!
          return yield* assembleDetail(tenantId, written, {
            canDecide: false,
            resolveReviewers: false,
            canCancelSupplement: true,
          })
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  /** taking the ask back: the round returns to the queue as it stood */
  const cancelSupplement: ReviewMethods['cancelSupplement'] = Effect.fn(
    'Assessment.cancelSupplement',
  )(function* (tenantId, requestId, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const request = yield* supplementRequestOf(tenantId, requestId)
          if (request === null) return yield* new ReviewNotFound()
          const row = yield* instanceOf(tenantId, request.reviewInstanceId)
          if (row === null) return yield* new ReviewNotFound()
          // the ask belongs to whoever sent it (§32.70): a colleague at the
          // same stage may not unsay it, and an administrator who wants it
          // gone intervenes as an administrator, not as its reviewer
          if (request.requestedBy !== as.userId) {
            return yield* refuse('supplement-cancel', 'not-requester')
          }
          yield* requireJudge(tenantId, row, as, 'supplement-cancel')
          const locked = yield* lockBatch(tenantId, row.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          const gate = yield* deps.reviewGate(tenantId, row.batchId)
          if (!gate.allowed) return yield* refuse('supplement-cancel', gate.reason)
          if (request.status !== 'open' || row.state !== 'awaiting_supplement') {
            return yield* refuse('supplement-cancel', 'request-not-open')
          }
          const closed = yield* closeSupplementRequest({
            tenantId,
            requestId,
            outcome: 'cancelled',
            cancelledBy: as.userId,
          })
          if (!closed) return yield* new ReviewConflict()
          const resumed = yield* setInstanceSupplementState({
            tenantId,
            instanceId: row.id,
            from: 'awaiting_supplement',
            to: 'active',
          })
          if (!resumed) return yield* new ReviewConflict()
          yield* insertReviewEvent({
            tenantId,
            reviewInstanceId: row.id,
            kind: 'supplement-cancelled',
            actorId: as.userId,
            route: row.currentRoute,
            stageId: row.currentStageId,
          })
          yield* bumpParticipantAttention(tenantId, row.entryId)
          yield* announce(tenantId, row.batchId, [
            { kind: 'review-instance-changed' },
            { kind: 'review-inbox-changed' },
            { kind: 'entries-changed', subjectUserId: row.subjectUserId },
          ])
          const written = (yield* instanceOf(tenantId, row.id))!
          return yield* assembleDetail(tenantId, written, {
            canDecide: true,
            resolveReviewers: false,
          })
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  /**
   * The supplement's files, held to storage's facts and bound in the
   * caller's transaction. The short form of the entry service's
   * bindAttachments, minus the per-field accept and size rules the
   * restricted builder cannot express: a staged file must be the actor's
   * own, a bound one may only be cited again inside this claim's own story,
   * nothing retired is cited anew.
   */
  const bindSupplementFiles = (input: {
    tenantId: string
    entryId: string
    actorId: string
    refs: readonly { field: string; attachmentId: string }[]
  }) =>
    Effect.gen(function* () {
      const issues: { field: string; reason: string }[] = []
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
      yield* lockAttachments(
        input.tenantId,
        input.refs.map((ref) => ref.attachmentId),
      )
      const history = yield* entryAttachmentHistory(input.tenantId, input.entryId)
      const supplementHistory = yield* supplementAttachmentHistory(input.tenantId, input.entryId)
      const toBind: { attachmentId: string; ownerUserId: string }[] = []
      for (const ref of input.refs) {
        const meta = yield* Effect.result(
          deps.storage.metadata({ tenantId: input.tenantId, attachmentId: ref.attachmentId }),
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
        if (attachment.status === 'bound') {
          if (!history.has(ref.attachmentId) && !supplementHistory.has(ref.attachmentId)) {
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
          deps.storage.bind({
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

  /**
   * The answer. Only the entry's own subject gives it, and the open request
   * is their whole standing to do so - deliberately no phase gate, because a
   * round that paused itself to ask must not have the answer locked out by
   * whatever the calendar did since. The original revision is never touched:
   * the answer lives beside it, on the round that asked.
   */
  const answerSupplement: ReviewMethods['answerSupplement'] = Effect.fn(
    'Assessment.answerSupplement',
  )(function* (tenantId, requestId, input, as) {
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const request = yield* supplementRequestOf(tenantId, requestId)
          if (request === null) return yield* new ReviewNotFound()
          const row = yield* instanceOf(tenantId, request.reviewInstanceId)
          if (row === null) return yield* new ReviewNotFound()
          if (row.subjectUserId !== as.userId) {
            // same admission rule as appealing: an administrator is told the
            // act is not theirs, a stranger learns nothing
            const admin = yield* deps.rosterReach(as, tenantId, row.batchId)
            if (!admin) return yield* new ReviewNotFound()
            return yield* refuse('supplement-answer', 'not-your-entry')
          }
          const locked = yield* lockBatch(tenantId, row.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
          if (request.status !== 'open' || row.state !== 'awaiting_supplement') {
            return yield* refuse('supplement-answer', 'request-not-open')
          }
          // the answer held to the ask: exactly the asked-for pieces
          const record = (input.payload ?? {}) as Record<string, unknown>
          const issues: { field: string; reason: string }[] = []
          const known = new Set(request.requirements.map((asked) => asked.key))
          for (const key of Object.keys(record)) {
            if (!known.has(key)) issues.push({ field: key, reason: 'not-asked' })
          }
          const normalized: Record<string, string | readonly string[]> = {}
          const refs: { field: string; attachmentId: string }[] = []
          for (const asked of request.requirements) {
            const value = record[asked.key]
            if (asked.kind === 'text') {
              if (value !== undefined && typeof value !== 'string') {
                issues.push({ field: asked.key, reason: 'unreadable' })
                continue
              }
              const text = typeof value === 'string' ? value.trim() : ''
              if (text === '') {
                if (asked.required) issues.push({ field: asked.key, reason: 'required' })
                continue
              }
              if (text.length > TEXT_MOST) {
                issues.push({ field: asked.key, reason: 'too-long' })
                continue
              }
              normalized[asked.key] = text
            } else {
              if (
                value !== undefined &&
                (!Array.isArray(value) || value.some((one) => typeof one !== 'string'))
              ) {
                issues.push({ field: asked.key, reason: 'unreadable' })
                continue
              }
              const cited = Array.isArray(value) ? (value as readonly string[]) : []
              if (cited.length === 0) {
                if (asked.required) issues.push({ field: asked.key, reason: 'required' })
                continue
              }
              if (cited.length > FILES_MOST) {
                issues.push({ field: asked.key, reason: 'too-many' })
                continue
              }
              normalized[asked.key] = cited
              refs.push(...cited.map((attachmentId) => ({ field: asked.key, attachmentId })))
            }
          }
          if (issues.length > 0) return yield* new EntryPayloadInvalid({ issues })
          yield* bindSupplementFiles({
            tenantId,
            entryId: row.entryId,
            actorId: as.userId,
            refs,
          })
          const responseId = yield* insertSupplementResponse({
            tenantId,
            requestId,
            payload: normalized,
            respondedBy: as.userId,
          })
          yield* insertSupplementAttachments({
            tenantId,
            responseId,
            attachmentIds: refs.map((ref) => ref.attachmentId),
          })
          const closed = yield* closeSupplementRequest({
            tenantId,
            requestId,
            outcome: 'answered',
          })
          if (!closed) return yield* new ReviewConflict()
          // back into the queue it left; if its stage emptied meanwhile the
          // patrol writes it blocked, the same as any other active round
          const resumed = yield* setInstanceSupplementState({
            tenantId,
            instanceId: row.id,
            from: 'awaiting_supplement',
            to: 'active',
          })
          if (!resumed) return yield* new ReviewConflict()
          yield* insertReviewEvent({
            tenantId,
            reviewInstanceId: row.id,
            kind: 'supplement-submitted',
            actorId: as.userId,
            route: row.currentRoute,
            stageId: row.currentStageId,
          })
          // A sitting judges one body of evidence, and the answer changed
          // it: ballots already cast no longer speak to what is on the
          // table. The sitting dissolves - its votes stay as history that
          // counted for nothing - and a fresh one is constituted from
          // whoever is eligible now, which is usually the same people,
          // asked again (§32.66). A sitting nobody had voted in carries on.
          const here = stageById(row.effectivePolicy, row.currentRoute, row.currentStageId)
          if (here !== null && isPanelStage(here)) {
            const panel = yield* openPanelOf(tenantId, row.id)
            if (panel !== null && (yield* votesOfPanel(tenantId, panel.id)).length > 0) {
              yield* supersedeOpenPanels(tenantId, row.id)
              const arrived = yield* stageArrival({
                tenantId,
                batchId: row.batchId,
                stage: here,
                subjectUserId: row.subjectUserId,
                actorId: row.actorId,
                excludeJudgedOfInstanceId: row.id,
              })
              if (arrived.state === 'active') {
                yield* createPanel({
                  tenantId,
                  reviewInstanceId: row.id,
                  route: here.route,
                  stageId: here.id,
                  members: arrived.eligible,
                })
              } else {
                const parked = yield* setInstanceState({
                  tenantId,
                  instanceId: row.id,
                  from: 'active',
                  to: 'blocked',
                  blockedReason: arrived.blockedReason,
                })
                if (parked) {
                  yield* insertReviewEvent({
                    tenantId,
                    reviewInstanceId: row.id,
                    kind: 'assignee-not-found',
                    actorId: null,
                    route: here.route,
                    stageId: here.id,
                  })
                }
              }
            }
          }
          yield* announce(tenantId, row.batchId, [
            { kind: 'review-instance-changed' },
            { kind: 'review-inbox-changed' },
            { kind: 'entries-changed', subjectUserId: row.subjectUserId },
          ])
          const written = (yield* instanceOf(tenantId, row.id))!
          return yield* assembleDetail(tenantId, written, {
            canDecide: false,
            resolveReviewers: false,
          })
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
    )
  })

  return {
    listReviewInbox,
    listAwaitingSupplements,
    getReviewInstance,
    decideReview,
    appealReview,
    requestSupplement,
    cancelSupplement,
    answerSupplement,
  }
}
