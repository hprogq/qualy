import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { cursorUnusable, pageSize, type BadRequest } from '@qualy/api-kit/schema'
import type { ItemTypeDriver } from '../plugin.ts'
import {
  BatchReadOnly,
  EntryActionRefused,
  EntryPayloadInvalid,
  ReviewConflict,
  ReviewNotFound,
} from '../server/errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { revisionOf } from '../item/db.ts'
import {
  advanceReviewInstance,
  entryRevisionOf,
  insertReviewEvent,
  revisionAttachmentsOf,
  setEntryState,
} from '../entry/db.ts'
import type { GateDecision } from '../phase/gate.ts'
import {
  doubtOpen,
  enterableFrom,
  holdersOf,
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
  completeInstance,
  inboxPage,
  instanceOf,
  chainNames,
  holderNamesAt,
  reviewEventsOf,
  userMayReview,
  type InboxRow,
  type ReviewInstanceDetailRow,
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
  readonly roundNo: number
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
  readonly route: 'normal' | 'doubt'
  /** the step it is standing at, by name */
  readonly stageId: string
  readonly normal: readonly ReviewStageView[]
  readonly doubt: readonly ReviewStageView[]
  readonly decisions: readonly string[]
}

export interface ReviewDetailView {
  readonly id: string
  readonly state: 'active' | 'blocked' | 'completed'
  readonly outcome: string | null
  readonly roundNo: number
  readonly entryId: string
  readonly batchId: string
  readonly itemId: string
  readonly itemTitle: string
  readonly participantName: string
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
  readonly events: readonly {
    readonly kind: string
    readonly actorId: string | null
    readonly actorName: string | null
    readonly comment: string | null
    readonly suggestedPayload: unknown
    readonly at: number
  }[]
  readonly capabilities: { readonly canDecide: boolean }
}

/**
 * What a reviewer can say (§14, §32.62).
 *
 * On the ordinary route: approve carries the round on and ends it at the
 * last step, reject ends it, and raising a doubt hands it to the other route
 * entirely - it does not carry on from where it was. On the doubt route the
 * middle steps may only advise and forward; the decision belongs to the end
 * of that route.
 */
export type ReviewDecision =
  | 'approve'
  | 'reject'
  | 'raise-doubt'
  | 'forward'
  | 'comment'
  | 'recommend-approve'
  | 'recommend-reject'

/**
 * What may be said from where the round stands.
 *
 * One function, asked by the reader and by the writer, so a button that
 * appears is a button that works.
 */
const decisionsAt = (policy: ResolvedPolicy, here: ResolvedStage): readonly ReviewDecision[] => {
  if (here.route === 'doubt') {
    return isRouteEnd(policy, here)
      ? ['approve', 'reject', 'comment']
      : ['comment', 'recommend-approve', 'recommend-reject', 'forward']
  }
  return doubtOpen(policy)
    ? ['approve', 'reject', 'raise-doubt', 'comment']
    : ['approve', 'reject', 'comment']
}

export interface ReviewDecisionInput {
  readonly decision: ReviewDecision
  readonly comment?: string
  readonly suggestedPayload?: unknown
}

export interface ReviewMethods {
  readonly listReviewInbox: (
    tenantId: string,
    page: { cursor?: string; limit?: string },
    as: Principal,
  ) => Effect.Effect<{ items: readonly ReviewInboxItem[]; nextCursor: string | null }, BadRequest>
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
}

export interface ReviewDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  /** the phase gate's word on assessment.review.process in this batch, now */
  readonly reviewGate: (tenantId: string, batchId: string) => Effect.Effect<GateDecision>
  /** administrative reach over the batch, the same door getEntry uses */
  readonly rosterReach: (as: Principal, tenantId: string, batchId: string) => Effect.Effect<boolean>
  readonly parseRange: (text: string) => { start: string; end: string }
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
}

const refuse = (action: string, reason: string) => new EntryActionRefused({ action, reason })

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
    view: { canDecide: boolean; resolveReviewers: boolean },
  ) =>
    Effect.gen(function* () {
      const revision = (yield* entryRevisionOf(tenantId, row.revisionId))!
      const itemRevision = yield* revisionOf(tenantId, row.itemRevisionId)
      const attachments = yield* revisionAttachmentsOf(tenantId, row.revisionId)
      const events = yield* reviewEventsOf(tenantId, row.id)
      const policy = row.effectivePolicy
      const everyStage = [...policy.normal, ...policy.doubt]
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
        !view.canDecide || here === null ? [] : decisionsAt(policy, here)
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
          doubt: policy.doubt.map(stageView),
          decisions,
        },
        events: events.map((event) => ({
          kind: event.kind,
          actorId: event.actorId,
          actorName: event.actorName,
          comment: event.comment,
          suggestedPayload: event.suggestedPayload,
          at: event.createdAt,
        })),
        capabilities: { canDecide: view.canDecide },
      } satisfies ReviewDetailView
    })

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

  const listReviewInbox: ReviewMethods['listReviewInbox'] = Effect.fn('Assessment.listReviewInbox')(
    function* (tenantId, page, as) {
      const fingerprint = `review-inbox:${as.userId}`
      const key = readQueryCursor(page.cursor, fingerprint, ['text', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      const withWork = yield* dieQuery(withDb(activeReviewBatches(tenantId)))
      const open = yield* openBatches(tenantId, withWork)
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
      return {
        items: pageRows.map((row) => ({
          instanceId: row.instanceId,
          entryId: row.entryId,
          batchId: row.batchId,
          batchName: row.batchName,
          itemId: row.itemId,
          itemTitle: row.itemTitle,
          participantName: row.participantName,
          roundNo: row.roundNo,
          submittedAt: row.submittedAt,
        })),
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeQueryCursor(fingerprint, [last.submittedAtIso, last.instanceId])
            : null,
      }
    },
  )

  const getReviewInstance: ReviewMethods['getReviewInstance'] = Effect.fn(
    'Assessment.getReviewInstance',
  )(function* (tenantId, instanceId, as) {
    const row = yield* dieQuery(withDb(instanceOf(tenantId, instanceId)))
    if (row === null) return yield* new ReviewNotFound()
    // who may see a round: its subject, whoever may judge its stage, and
    // staff whose administrative reach covers the batch - anyone else learns
    // nothing, not even that it exists
    const judge = yield* dieQuery(withDb(mayAct(tenantId, row, as)))
    if (row.subjectUserId !== as.userId && !judge) {
      const admin = yield* deps.rosterReach(as, tenantId, row.batchId)
      if (!admin) return yield* new ReviewNotFound()
    }
    const gate = yield* deps.reviewGate(tenantId, row.batchId)
    const canDecide =
      judge && row.state === 'active' && row.batchStatus === 'active' && gate.allowed
    return yield* dieQuery(
      withDb(assembleDetail(tenantId, row, { canDecide, resolveReviewers: true })),
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

            const policy = row.effectivePolicy
            const here = stageById(policy, row.currentRoute, row.currentStageId)
            if (here === null) return yield* refuse(action, 'chain-unreadable')
            // Where this round stands decides what may be said here (§14,
            // §32.62): an ordinary step carries or ends the round and may
            // hand it to the doubt route; a middle step of the doubt route
            // may only advise, because the decision belongs to its end.
            const allowed = decisionsAt(policy, here)
            if (!allowed.includes(action)) return yield* refuse(action, 'decision-not-available')

            const comment = input.comment?.trim() ?? ''
            if (comment === '' && action !== 'approve') {
              // everything except a plain approval is something being said to
              // a person; without a word it is only an obstacle
              return yield* new EntryPayloadInvalid({
                issues: [{ field: 'comment', reason: 'required' }],
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
                comment: comment === '' ? null : comment,
                ...(suggestion !== undefined ? { suggestedPayload: suggestion } : {}),
              })

            // an opinion moves nothing; it is said and the round stays where
            // it is, waiting for whoever will decide
            if (action === 'comment' || action.startsWith('recommend-')) {
              yield* say(action)
              const written = (yield* instanceOf(tenantId, instanceId))!
              return yield* assembleDetail(tenantId, written, {
                canDecide: true,
                resolveReviewers: false,
              })
            }

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

            // onward: raising a doubt leaves the ordinary route for the
            // first step of the other one; everything else walks its own
            // route to the next step that resolved to a unit
            const next: ResolvedStage | null =
              action === 'raise-doubt' ? enterableFrom(policy, 'doubt', 0) : nextAfter(policy, here)
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
            yield* say(
              action === 'raise-doubt'
                ? 'doubt-raised'
                : action === 'forward'
                  ? 'forwarded'
                  : 'approved',
            )
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

  return { listReviewInbox, getReviewInstance, decideReview }
}
