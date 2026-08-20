import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AttachmentMeta } from '@qualy/plugin-storage/server'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { cursorUnusable, pageSize, type BadRequest } from '@qualy/api-kit/schema'
import type { ItemTypeDriver } from '../plugin.ts'
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
  holdersOf,
  readPolicy,
  resolvePolicy,
  isRouteEnd,
  nextAfter,
  routeOf,
  stageById,
  type ResolvedPolicy,
  type ResolvedStage,
  type ReviewRoute,
} from './chain.ts'
import { nodePathOf } from '../entry/db.ts'
import {
  activeReviewBatches,
  awaitingPage,
  earlierConclusions,
  closeSupplementRequest,
  completeInstance,
  decisionsToday,
  inboxPage,
  insertSupplementAttachments,
  insertSupplementRequest,
  insertSupplementResponse,
  instanceOf,
  chainNames,
  holderNamesAt,
  nextSupplementNo,
  previousConclusion,
  revisionBefore,
  reviewEventsOf,
  scoreGroupOf,
  setInstanceSupplementState,
  siblingEntries,
  supplementAttachmentHistory,
  supplementRequestOf,
  supplementsOf,
  isOpenReviewState,
  userMayReview,
  type InboxRow,
  type ReviewInstanceDetailRow,
  type SupplementRequirement,
  type SupplementRow,
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
  readonly nodeName: string | null
  readonly roleNames: readonly string[]
  /**
   * who could act there today - the same question the queue asks; null when
   * this response did not resolve them, which an empty list would misreport
   * as an empty stage
   */
  readonly reviewers: readonly string[] | null
  readonly skipped: string | null
}

export interface ReviewChainView {
  /** which of the two routes this round is walking */
  readonly route: 'normal' | 'escalation'
  /** the step it is standing at, by name */
  readonly stageId: string
  readonly normal: readonly ReviewStageView[]
  readonly escalation: readonly ReviewStageView[]
  readonly decisions: readonly string[]
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
    readonly canRequestSupplement: boolean
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
 * What a reviewer can say (§14, §32.63).
 *
 * Both routes are real review chains: approve carries the round to the next
 * step of the route it is on and ends it at the last one, reject ends it
 * wherever reject is on offer. Escalating hands the round to the other
 * route entirely rather than carrying on from where it was, so it is only
 * ever offered on the ordinary one.
 *
 * There is no separate vocabulary for advising. A middle step approving
 * already says "nothing here for me, pass it on", and inventing a second
 * word for it meant a reviewer had to know which kind of chain they were
 * standing in before they knew which button meant what.
 */
export type ReviewDecision = 'approve' | 'reject' | 'escalate'

/**
 * What may be said from where the round stands.
 *
 * One function, asked by the reader and by the writer, so a button that
 * appears is a button that works.
 *
 * `rejectPolicy` comes off the round, never off the phase in force at this
 * moment: an appeal keeps its terminal-only rule after the appeal window
 * closes, and an ordinary review does not acquire one when that window opens
 * (§32.63).
 */
const decisionsAt = (
  policy: ResolvedPolicy,
  here: ResolvedStage,
  round: { rejectPolicy: 'any-stage' | 'terminal-only' },
  mayEscalate: boolean,
): readonly ReviewDecision[] => {
  const endable = round.rejectPolicy === 'any-stage' || isRouteEnd(policy, here)
  if (here.route === 'escalation') {
    return endable ? ['approve', 'reject'] : ['approve']
  }
  const said: ReviewDecision[] = endable ? ['approve', 'reject'] : ['approve']
  if (mayEscalate && escalationOpen(policy)) said.push('escalate')
  return said
}

export interface ReviewDecisionInput {
  readonly decision: ReviewDecision
  /** one of the batch's configured labels; required when a list is configured */
  readonly reason?: string
  readonly comment?: string
  readonly suggestedPayload?: unknown
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
  /** and on assessment.review.raise-escalation, which a phase opens separately */
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
 * A filing's answers under its form's own labels, for a list column or a
 * one-line sibling.
 *
 * The question's real fields in their own order, never a written summary -
 * and that includes the ones that ask for files. Those used to be dropped
 * and replaced by one "materials" count at the end of the row, which turned
 * "certificate" and "photo of the award" into the same word: a number. A
 * file field is a field, so it keeps its place and its name, and says how
 * many were filed under it. How that count reads is the browser's business;
 * the server counts.
 */
const summaryValues = (
  formConfig: unknown,
  payload: unknown,
  most = 3,
): readonly { label: string; value: string; files: number | null }[] => {
  const fields = (formConfig as { fields?: unknown } | null)?.fields
  if (!Array.isArray(fields)) return []
  const record = (payload ?? {}) as Record<string, unknown>
  const out: { label: string; value: string; files: number | null }[] = []
  for (const field of fields as readonly {
    key?: string
    label?: string
    type?: string
  }[]) {
    if (out.length >= most) break
    if (typeof field.key !== 'string') continue
    const value = record[field.key]
    const label = typeof field.label === 'string' ? field.label : field.key
    if (field.type === 'attachment') {
      out.push({ label, value: '', files: Array.isArray(value) ? value.length : 0 })
      continue
    }
    out.push({
      label,
      files: null,
      value:
        typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '',
    })
  }
  return out
}

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
      canRequestSupplement?: boolean
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
      const decisions: readonly string[] =
        !view.canDecide || here === null
          ? []
          : decisionsAt(policy, here, row, view.mayEscalate === true)
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
            values: summaryValues(one.formConfig, one.payload),
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
          earlier: older.filter((one) => one.at !== previous?.createdAt),
        }
      }
      const stageView = (stage: ResolvedStage): ReviewStageView => ({
        id: stage.id,
        index: stage.index,
        nodeName: stage.nodeId === null ? null : (names.nodes.get(stage.nodeId) ?? null),
        roleNames: stage.roleIds.map((roleId) => names.roles.get(roleId) ?? roleId),
        reviewers: view.resolveReviewers ? (reviewersByStage.get(stage.id) ?? []) : null,
        skipped: stage.skipped,
      })
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
          decisions,
        },
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
          canRequestSupplement: view.canRequestSupplement === true,
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
        batchId: row.batchId,
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
   * what makes "submitted and moved on" mean "gone". An open ask keeps the
   * round with its reviewer, because their task has not ended.
   */
  const mayRead = (tenantId: string, row: ReviewInstanceDetailRow, as: Principal) =>
    isOpenReviewState(row.state) ? mayAct(tenantId, row, as) : Effect.succeed(false)

  const listReviewInbox: ReviewMethods['listReviewInbox'] = Effect.fn('Assessment.listReviewInbox')(
    function* (tenantId, page, as) {
      const fingerprint = `review-inbox:${as.userId}`
      const key = readQueryCursor(page.cursor, fingerprint, ['text', 'uuid'])
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
          handledToday = yield* dieQuery(
            withDb(
              decisionsToday({
                tenantId,
                batchId: page.batchId,
                userId: as.userId,
                timezone: batch.timezone,
              }),
            ),
          )
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
          values: summaryValues(row.formConfig, row.payload),
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
    const key = readQueryCursor(page.cursor, fingerprint, ['text', 'uuid'])
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
          canRequestSupplement: canDecide,
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

  const decideReview: ReviewMethods['decideReview'] = Effect.fn('Assessment.decideReview')(
    function* (tenantId, instanceId, input, as) {
      const action = input.decision
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
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
            const locked = yield* lockBatch(tenantId, row.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            const gate = yield* deps.reviewGate(tenantId, row.batchId)
            if (!gate.allowed) return yield* refuse(action, gate.reason)
            // a round that asked for more has nothing to decide until the
            // answer comes back or the ask is taken back
            if (row.state === 'awaiting_supplement') {
              return yield* refuse(action, 'awaiting-supplement')
            }

            const policy = row.effectivePolicy
            const here = stageById(policy, row.currentRoute, row.currentStageId)
            if (here === null) return yield* refuse(action, 'chain-unreadable')
            // Where this round stands decides what may be said here (§14,
            // §32.62): an ordinary step carries or ends the round and may
            // hand it to the escalation route; a middle step of the escalation route
            // may only advise, because the decision belongs to its end.
            const escalationDecision =
              action === 'escalate'
                ? yield* deps.escalateGate(tenantId, row.batchId)
                : { allowed: true as const }
            const allowed = decisionsAt(policy, here, row, escalationDecision.allowed)
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
              if (action !== 'reject') {
                return yield* new EntryPayloadInvalid({
                  issues: [{ field: 'suggestedPayload', reason: 'not-allowed' }],
                })
              }
              suggestion = yield* decodeSuggestion(tenantId, row, input.suggestedPayload)
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
              })

            // Every decision carries its opinion with it; a freestanding
            // note is no longer an act. Rounds decided before this carry
            // `comment` events in their trail, and the readers still render
            // them - only the writing of new ones is gone.

            // ending the round: a rejection wherever it may be said, or an
            // approval at the last step of the route being walked
            const ends = action === 'reject' || (action === 'approve' && isRouteEnd(policy, here))
            if (ends) {
              // first writer wins; everyone else is told the round has closed
              const won = yield* completeInstance({
                tenantId,
                instanceId,
                outcome: action === 'approve' ? 'approved' : 'rejected',
              })
              if (!won) return yield* new ReviewConflict()
              yield* say(action === 'approve' ? 'approved' : 'rejected')
              yield* setEntryState({
                tenantId,
                entryId: row.entryId,
                from: ['in_review'],
                to: action === 'approve' ? 'approved' : 'rejected',
              })
              const written = (yield* instanceOf(tenantId, instanceId))!
              return yield* assembleDetail(tenantId, written, {
                canDecide: false,
                resolveReviewers: false,
              })
            }

            // onward: escalating leaves the ordinary route for the
            // first step of the other one; everything else walks its own
            // route to the next step that resolved to a unit
            const next: ResolvedStage | null =
              action === 'escalate'
                ? enterableFrom(policy, 'escalation', 0)
                : nextAfter(policy, here)
            if (next === null || next.nodeId === null) {
              return yield* refuse(action, 'chain-ends-here')
            }
            const nodePath = yield* nodePathOf(tenantId, next.nodeId)
            if (nodePath === null) return yield* refuse(action, 'chain-ends-here')
            const holders = yield* holdersOf({
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
              state: holders.length > 0 ? 'active' : 'blocked',
            })
            if (!moved) return yield* new ReviewConflict()
            yield* say(action === 'escalate' ? 'escalated' : 'approved')
            if (holders.length === 0) {
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: instanceId,
                kind: 'assignee-not-found',
                actorId: null,
                route: next.route,
                stageId: next.id,
              })
            }
            const written = (yield* instanceOf(tenantId, instanceId))!
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
   * what is being disputed is the conclusion. It opens on the escalation route
   * with only its last step able to end it, and both of those are frozen on
   * the round rather than read from whatever phase is in force when somebody
   * later presses a button (§32.63).
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
      const decision = yield* deps
        .authorize(as, 'assessment.entry.appeal', located.batchId, {
          participantId: located.participantId,
        })
        .pipe(Effect.catchTag('ASSESSMENT_BATCH_NOT_FOUND', (error) => Effect.die(error)))
      if (!decision.allowed) return yield* refuse('appeal', decision.reason)

      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const row = yield* instanceOf(tenantId, instanceId)
            if (row === null) return yield* new ReviewNotFound()
            const locked = yield* lockBatch(tenantId, row.batchId)
            if (locked!.status === 'archived') return yield* new BatchReadOnly()
            const reason = input.reason.trim()
            if (reason === '') return yield* refuse('appeal', 'reason-required')
            // there has to be a decision to contest
            if (
              row.state !== 'completed' ||
              (row.outcome !== 'approved' && row.outcome !== 'rejected')
            ) {
              return yield* refuse('appeal', 'nothing-to-appeal')
            }
            const entry = yield* entryOf(tenantId, row.entryId)
            if (entry === null) return yield* new ReviewNotFound()
            // one open round per claim: whoever is already looking at it
            // finishes before anybody contests anything
            if (yield* hasOpenRound(tenantId, row.entryId)) {
              return yield* refuse('appeal', 'review-already-open')
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
            // an appeal walks the escalation route and nothing else; a question
            // with none configured has nowhere to hear one
            const first = enterableFrom(policy, 'escalation', 0)
            if (first === null || first.nodeId === null) {
              return yield* refuse('appeal', 'review-level-missing')
            }
            const nodePath = yield* nodePathOf(tenantId, first.nodeId)
            if (nodePath === null) return yield* refuse('appeal', 'review-level-missing')
            const holders = yield* holdersOf({
              tenantId,
              batchId: row.batchId,
              stage: first,
              subjectUserId: participant.userId,
              actorId: row.actorId,
            })
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
              rejectPolicy: 'terminal-only',
              policyRevisionId: live.id,
              effectivePolicy: policy,
              route: 'escalation',
              stageId: first.id,
              roleIds: first.roleIds,
              nodeId: first.nodeId,
              nodePath,
              state: holders.length > 0 ? 'active' : 'blocked',
            })
            yield* insertReviewEvent({
              tenantId,
              reviewInstanceId: opened,
              kind: 'appealed',
              actorId: as.userId,
              route: 'escalation',
              stageId: first.id,
              comment: reason,
            })
            if (holders.length === 0) {
              yield* insertReviewEvent({
                tenantId,
                reviewInstanceId: opened,
                kind: 'assignee-not-found',
                actorId: null,
                route: 'escalation',
                stageId: first.id,
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
          const row = yield* instanceOf(tenantId, instanceId)
          if (row === null) return yield* new ReviewNotFound()
          yield* requireJudge(tenantId, row, as, 'supplement-request')
          const locked = yield* lockBatch(tenantId, row.batchId)
          if (locked!.status === 'archived') return yield* new BatchReadOnly()
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
          const written = (yield* instanceOf(tenantId, row.id))!
          return yield* assembleDetail(tenantId, written, {
            canDecide: true,
            resolveReviewers: false,
            canRequestSupplement: true,
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
      if (issues.length > 0) return yield* Effect.fail(new EntryPayloadInvalid({ issues }))
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
      if (issues.length > 0) return yield* Effect.fail(new EntryPayloadInvalid({ issues }))
      for (const target of toBind) {
        const bound = yield* Effect.result(
          deps.storage.bind({
            tenantId: input.tenantId,
            attachmentId: target.attachmentId,
            ownerUserId: target.ownerUserId,
          }),
        )
        if (Result.isFailure(bound)) {
          return yield* Effect.fail(
            new EntryPayloadInvalid({ issues: [{ field: '', reason: 'attachment-unavailable' }] }),
          )
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
