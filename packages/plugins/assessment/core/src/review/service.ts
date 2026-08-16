import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
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
  entryOf,
  entryRevisionOf,
  hasOpenRound,
  insertReviewEvent,
  insertReviewInstance,
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
  readonly route: 'normal' | 'escalation'
  /** the step it is standing at, by name */
  readonly stageId: string
  readonly normal: readonly ReviewStageView[]
  readonly escalation: readonly ReviewStageView[]
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
export type ReviewDecision = 'approve' | 'reject' | 'escalate' | 'comment'

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
    return endable ? ['approve', 'reject', 'comment'] : ['approve', 'comment']
  }
  const said: ReviewDecision[] = endable ? ['approve', 'reject'] : ['approve']
  if (mayEscalate && escalationOpen(policy)) said.push('escalate')
  said.push('comment')
  return said
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
  readonly appealReview: (
    tenantId: string,
    instanceId: string,
    input: { reason: string },
    as: Principal,
  ) => Effect.Effect<
    ReviewDetailView,
    ReviewNotFound | BatchReadOnly | EntryActionRefused | BatchNotFound
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
  /** the participant-action door, for the one act a participant does here */
  readonly authorize: (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: { participantId?: string },
  ) => Effect.Effect<ActionDecision, BatchNotFound>
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
    view: { canDecide: boolean; mayEscalate?: boolean; resolveReviewers: boolean },
  ) =>
    Effect.gen(function* () {
      const revision = (yield* entryRevisionOf(tenantId, row.revisionId))!
      const itemRevision = yield* revisionOf(tenantId, row.itemRevisionId)
      const attachments = yield* revisionAttachmentsOf(tenantId, row.revisionId)
      const events = yield* reviewEventsOf(tenantId, row.id)
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
          escalation: policy.escalation.map(stageView),
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
            if (action === 'comment') {
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
        .authorize(as, 'assessment.entry.resubmit', located.batchId, {
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

  return { listReviewInbox, getReviewInstance, decideReview, appealReview }
}
