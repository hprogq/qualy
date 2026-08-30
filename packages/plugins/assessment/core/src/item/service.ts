import { Effect, Result } from 'effect'
import { transaction, type Orm, type QueryFailed } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AccessDenied } from '@qualy/rbac-contract/effect'
import type { EpochMillis } from '../phase/engine/types.ts'
import type { ItemTypeDriver } from '../plugin.ts'
import {
  ItemActionRefused,
  BatchNotFound,
  BatchReadOnly,
  ItemChangeDecisionRequired,
  ItemConfigInvalid,
  ItemNotFound,
  ScoreGroupInvalid,
  ScoreGroupVersionConflict,
} from '../server/errors.ts'
import { lockBatch, oneBatch } from '../server/db.ts'
import { announce } from '../live/events.ts'
import { bumpParticipantAttention } from '../entry/db.ts'
import { scaledAmount } from '../scoring/builtins.ts'
import { carriesInto, compileScoringPlan, readScoringPlan, recognitionSourceOf } from '../scoring/plan.ts'
import { judgeRecognition } from '../scoring/recognition.ts'
import { policyModeOf } from '../review/chain.ts'
import { validateItemConfig, type Catalogs, type ItemConfigInput } from './config.ts'
import {
  cancelReviewInstance,
  insertEntryEvent,
  insertReviewEvent,
  insertReviewInstance,
  nextRoundNo,
  nodePathOf,
  openEntriesOfItem,
  participantOf,
  setEntryState,
} from '../entry/db.ts'
import {
  enterableFrom,
  isPanelStage,
  readPolicy,
  resolvePolicy,
  routeOf,
  stageArrival,
  stageStaffing,
  type ResolvedPolicy,
} from '../review/chain.ts'
import { createPanel } from '../review/db.ts'
import {
  decisionNeeded,
  impactOf,
  missingDecisions,
  type ChangeEffects,
  type Incompatible,
} from './impact.ts'
import {
  bumpScoreGroupsVersion,
  deleteGroups,
  deleteItemRows,
  groupsOf,
  insertGroup,
  insertItem,
  insertItemRevision,
  itemAloneInPhaseScope,
  itemHasEntries,
  itemOf,
  itemsOf,
  frozenProposalsOfItem,
  liveEntryPayloads,
  nextRevisionNo,
  openRoundsOfItem,
  revisionOf,
  revisionsOf,
  scoreGroupsVersionOf,
  setCurrentRevision,
  setItemLifecycle,
  updateGroup,
  updateItemFields,
  type ItemRevisionRow,
  type ItemRow,
  type OpenRoundRow,
} from './db.ts'

// What a batch asks, managed: the score tree (one level of it), the items on
// it, and the immutable revisions their configuration moves through.
//
// The save algorithm is the whole point of the module. A configuration is
// checked against everything it cites - driver, scoring references, review
// policy - and then against every live entry that would have to be read
// under it; only then does it become the next revision. Nothing is ever
// updated in place: fixing a configuration is appending the next one.

export interface MaterialRange {
  readonly start: string
  readonly end: string
}

export interface ItemRevisionView {
  readonly id: string
  readonly revisionNo: number
  readonly entrySource: 'student' | 'administrative'
  readonly formConfig: unknown
  readonly scoringConfig: unknown
  readonly reviewPolicy: unknown
  readonly displayConfig: unknown
  readonly reason: string | null
  readonly createdAt: EpochMillis
}

export interface ItemView {
  readonly id: string
  readonly batchId: string
  readonly itemType: string
  readonly title: string
  readonly scoreGroupId: string
  readonly maxEntries: number | null
  readonly sortOrder: number
  readonly status: 'draft' | 'active' | 'voided'
  /** why the question was withdrawn; a withdrawn question says so wherever
   * it is read, and a reason nobody can see is a reason nobody trusts */
  readonly voidReason: string | null
  readonly currentRevision: ItemRevisionView | null
  readonly createdAt: EpochMillis
}

export interface ScoreGroupView {
  readonly id: string
  readonly parentGroupId: string | null
  readonly name: string
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder: number
  readonly itemCount: number
}

export interface CreateItemInput {
  readonly itemType: string
  readonly title: string
  readonly scoreGroupId: string
  readonly maxEntries: number | null
  readonly sortOrder?: number
  readonly config: ItemConfigInput
}

export interface UpdateItemInput {
  readonly title?: string
  readonly scoreGroupId?: string
  readonly maxEntries?: number | null
  readonly sortOrder?: number
  readonly config?: ItemConfigInput
  readonly reason?: string
  /** which version this edit was composed against; a stale one is refused */
  readonly expectedRevisionId?: string | null
  /** what should happen to work already under way (§32.62) */
  readonly effects?: ChangeEffects
}

export interface ScoreGroupSpec {
  readonly id?: string
  /**
   * The group this one adds up into. A tree, because the rules are one: a
   * sports cap inside a wider activities cap is how a real regulation reads
   * (§8.5 amended), and a flat list can only say one of the two.
   *
   * Never absent: leaving it out used to read as "top level", which turned a
   * partial payload into a flattening of the whole tree.
   */
  readonly parentGroupId: string | null
  readonly name: string
  readonly cap: string | null
  readonly floor: string | null
  readonly sortOrder?: number
}

export interface ReplaceScoreGroupsInput {
  readonly groups: readonly ScoreGroupSpec[]
  /** the tree's version as the caller read it; a stale one is refused */
  readonly expectedVersion: number
  readonly reason?: string
}

export type CreateItemError = BatchNotFound | BatchReadOnly | AccessDenied | ItemConfigInvalid
export type ItemLifecycleError = ItemNotFound | BatchReadOnly | AccessDenied | ItemActionRefused
/**
 * Putting a question on the round runs its configuration through the same
 * trial a saved one faces, so it refuses in the same words rather than in a
 * second vocabulary for the same problem.
 */
export type ItemStatusError = ItemLifecycleError | ItemConfigInvalid
export type UpdateItemError =
  | ItemNotFound
  | BatchNotFound
  | BatchReadOnly
  | AccessDenied
  | ItemChangeDecisionRequired
  | ItemConfigInvalid
export type ReplaceGroupsError =
  BatchNotFound | BatchReadOnly | AccessDenied | ScoreGroupInvalid | ScoreGroupVersionConflict

export interface ItemMethods {
  readonly listItems: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    { items: readonly ItemView[]; capabilities: { canManage: boolean } },
    BatchNotFound | AccessDenied
  >
  readonly createItem: (
    tenantId: string,
    batchId: string,
    input: CreateItemInput,
    as: Principal,
  ) => Effect.Effect<ItemView, CreateItemError>
  readonly getItem: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<ItemView & { manageable: boolean }, ItemNotFound | AccessDenied>
  readonly updateItem: (
    tenantId: string,
    itemId: string,
    input: UpdateItemInput,
    as: Principal,
  ) => Effect.Effect<ItemView, UpdateItemError>
  readonly deleteItem: (
    tenantId: string,
    itemId: string,
    as: Principal,
  ) => Effect.Effect<void, ItemLifecycleError>
  readonly setItemStatus: (
    tenantId: string,
    itemId: string,
    input: { status: 'voided'; reason: string } | { status: 'active' },
    as: Principal,
  ) => Effect.Effect<ItemView, ItemStatusError>
  readonly listScoreGroups: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<
    {
      groups: readonly ScoreGroupView[]
      version: number
      capabilities: { canManage: boolean }
    },
    BatchNotFound | AccessDenied
  >
  readonly replaceScoreGroups: (
    tenantId: string,
    batchId: string,
    input: ReplaceScoreGroupsInput,
    as: Principal,
  ) => Effect.Effect<{ groups: readonly ScoreGroupView[]; version: number }, ReplaceGroupsError>
}

/** what the item methods borrow from the service that owns authorization */
export interface ItemDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  readonly requireBatchVisible: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<void, AccessDenied>
  readonly requireRosterReach: (
    as: Principal,
    tenantId: string,
    batchId: string,
  ) => Effect.Effect<void, AccessDenied>
  readonly recordConfigChange: (
    tenantId: string,
    batchId: string,
    status: string,
    diff: Record<string, unknown>,
    actorId: string | null,
    reason: string | null,
  ) => Effect.Effect<void, QueryFailed, Orm>
  readonly parseRange: (text: string) => MaterialRange
  readonly catalogs: Catalogs
}

export const makeItemMethods = (deps: ItemDeps): ItemMethods => {
  const { withDb, catalogs } = deps

  const toRevisionView = (row: ItemRevisionRow): ItemRevisionView => ({
    id: row.id,
    revisionNo: row.revisionNo,
    entrySource: row.entrySource,
    formConfig: row.formConfig,
    scoringConfig: row.scoringConfig,
    reviewPolicy: row.reviewPolicy,
    displayConfig: row.displayConfig,
    reason: row.reason,
    createdAt: row.createdAt,
  })

  const toView = (row: ItemRow, revision: ItemRevisionRow | null): ItemView => ({
    id: row.id,
    batchId: row.batchId,
    itemType: row.itemType,
    title: row.title,
    scoreGroupId: row.scoreGroupId,
    maxEntries: row.maxEntries,
    sortOrder: row.sortOrder,
    status: row.status,
    voidReason: row.voidReason,
    currentRevision: revision === null ? null : toRevisionView(revision),
    createdAt: row.createdAt,
  })

  // jsonb hands objects back with keys re-sorted, so equality has to be
  // order-blind: stringify with keys canonically sorted at every level
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value) ?? 'null'
  }
  const sameJson = (left: unknown, right: unknown) =>
    canonical(left ?? null) === canonical(right ?? null)

  /** whether a submitted configuration differs from the stored current one */
  const configChanged = (current: ItemRevisionRow, config: ItemConfigInput) =>
    current.entrySource !== config.entrySource ||
    !sameJson(current.formConfig, config.formConfig) ||
    !sameJson(current.scoringConfig, config.scoringConfig) ||
    !sameJson(current.reviewPolicy, config.reviewPolicy) ||
    !sameJson(current.displayConfig, config.displayConfig ?? {})

  /** whether this person could administer the batch, as a plain answer */
  const canManage = (as: Principal, tenantId: string, batchId: string) =>
    deps.requireRosterReach(as, tenantId, batchId).pipe(
      Effect.as(true),
      Effect.catchTag('ACCESS_DENIED', () => Effect.succeed(false)),
    )

  /**
   * The §6.3 gauntlet for one configuration: everything it cites, the window
   * it has to fit inside, and every live entry it would have to read.
   *
   * Runs inside the caller's transaction, after the batch row is locked.
   *
   * Every road to a live question goes through here - writing a configuration,
   * and putting one on the round by publishing or restoring the question that
   * holds it - because the window a form has to fit can move while a question
   * that is not live is not being looked at.
   *
   * What it no longer does is refuse a configuration because a live entry
   * could not be read under it. That was a hard gate whose only way forward
   * was void-and-replace; it is now an impact report the administrator
   * answers (§32.62, and `impactUnder` below).
   */
  const issuesOf = (input: {
    tenantId: string
    item: ItemRow
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
  }) =>
    Effect.gen(function* () {
      const issues = [...(yield* validateItemConfig(catalogs, input.item.itemType, input.config))]
      // once anything has been filed against the item, who may file is no
      // longer negotiable: the resource policy reads it from the current
      // revision, and flipping it would strand every existing entry on a
      // path that no longer exists. Void and replace is the way to change
      // what kind of question this is.
      if (
        input.current !== null &&
        input.config.entrySource !== input.current.entrySource &&
        (yield* itemHasEntries(input.tenantId, input.item.id))
      ) {
        issues.push({ path: 'entrySource', reason: 'entry-source-frozen' })
      }
      const driver = catalogs.itemTypes.get(input.item.itemType) as ItemTypeDriver | undefined
      if (driver?.configIssues !== undefined) {
        issues.push(
          ...driver
            .configIssues(input.config.formConfig, { materialRange: input.materialRange })
            .map((issue) => ({ path: issue.path, reason: issue.reason })),
        )
      }
      return issues
    })

  /**
   * What this configuration would disturb, counted from the state under the
   * batch lock (§32.62).
   *
   * Every live answer is read through the form it was written under before
   * being offered to the new one, so a deletion or a reordering is the no-op
   * it actually is; only what still fails is work this change would strand.
   */
  const impactUnder = (input: {
    tenantId: string
    item: ItemRow
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
  }) =>
    Effect.gen(function* () {
      const driver = catalogs.itemTypes.get(input.item.itemType) as ItemTypeDriver | undefined
      const live = yield* liveEntryPayloads(input.tenantId, input.item.id)
      const rounds = yield* openRoundsOfItem(input.tenantId, input.item.id)
      const refusals: Incompatible[] = []
      if (driver !== undefined) {
        for (const row of live) {
          const carried =
            driver.projectPayload === undefined
              ? row.payload
              : driver.projectPayload(row.formConfig, input.config.formConfig, row.payload)
          const decoded = yield* Effect.result(
            driver.decodePayload(input.config.formConfig, carried, {
              materialRange: input.materialRange,
            }),
          )
          if (Result.isFailure(decoded)) refusals.push({ entryId: row.entryId, status: row.status })
        }
      }

      // What the new arithmetic would make of what is already recognised.
      //
      // Scoring reads the question's CURRENT plan against a determination
      // made under an older one, so an administrator renaming a recognition,
      // narrowing its type or dropping it entirely would leave every
      // approved claim approved and unscorable - and nothing would say so
      // until somebody opened a results page. The determinations a sitting
      // has already frozen count too: they are what an open round would
      // settle on if it concluded.
      const nextPlan = yield* compileScoringPlan({
        calculators: deps.catalogs.calculators,
        aggregators: deps.catalogs.aggregators,
        itemType: driver,
        formConfig: input.config.formConfig,
        scoringConfig: input.config.scoringConfig,
        batch: { materialRange: input.materialRange },
        recognitionSource: recognitionSourceOf({
          interaction: driver?.interaction,
          entrySource: input.config.entrySource,
          reviewMode: policyModeOf(input.config.reviewPolicy),
        }),
      })
      const stranded: string[] = []
      if ('plan' in nextPlan) {
        for (const row of live) {
          if (row.recognition === null) continue
          if (judgeRecognition(nextPlan.plan.recognitionSchemas, row.recognition).length > 0) {
            stranded.push(row.entryId)
          }
        }
        for (const proposal of yield* frozenProposalsOfItem(input.tenantId, input.item.id)) {
          if (stranded.includes(proposal.entryId)) continue
          if (judgeRecognition(nextPlan.plan.recognitionSchemas, proposal.values).length > 0) {
            stranded.push(proposal.entryId)
          }
        }
        // And the rounds still open, which have determined nothing yet.
        //
        // A round judges by the contract it opened with, whatever the
        // question says today - that is what keeps a reviewer from being
        // asked something different halfway through. So the determination
        // it settles on tomorrow is one THAT contract admits, and if the new
        // plan cannot read every such determination, the round is walking
        // toward a claim that will be approved and unscorable.
        const contracts = new Map<string, string[]>()
        for (const round of rounds) {
          const under = contracts.get(round.recognitionRevisionId)
          if (under === undefined) contracts.set(round.recognitionRevisionId, [round.entryId])
          else under.push(round.entryId)
        }
        for (const [revisionId, entryIds] of contracts) {
          const frozen = yield* revisionOf(input.tenantId, revisionId)
          if (frozen === null) continue
          const under = yield* readScoringPlan(frozen).pipe(Effect.option)
          const carries =
            under._tag === 'Some' &&
            carriesInto(under.value.recognitionSchemas, nextPlan.plan.recognitionSchemas)
          if (carries) continue
          for (const entryId of entryIds) {
            if (!stranded.includes(entryId)) stranded.push(entryId)
          }
        }
      }
      return {
        live,
        rounds,
        stranded: stranded as readonly string[],
        incompatible: refusals as readonly Incompatible[],
        impact: impactOf({
          currentRevisionId: input.current?.id ?? null,
          currentConfig: input.current,
          nextConfig: input.config,
          live,
          rounds,
          incompatible: refusals,
        }),
      }
    })

  /**
   * The answer, carried out.
   *
   * Order is fixed and not negotiable: sending a claim back happens first,
   * and a claim sent back is never also re-routed. It is going to be filed
   * again, and the round that opens then walks the policy in force at that
   * moment - re-routing the round it is leaving would be work nobody ever
   * sees.
   */
  const propagate = (input: {
    tenantId: string
    item: ItemRow
    newRevisionId: string
    effects: ChangeEffects
    live: readonly { entryId: string; status: 'in_review' | 'approved' }[]
    rounds: readonly OpenRoundRow[]
    incompatible: readonly Incompatible[]
    nextPolicy: unknown
    actorId: string
    reason: string | null
  }) =>
    Effect.gen(function* () {
      const form = input.effects.form
      const sendBack = new Set(
        input.incompatible
          .filter((row) =>
            row.status === 'in_review' ? form?.inReview === 'return' : form?.approved === 'return',
          )
          .map((row) => row.entryId),
      )

      let returnedInReview = 0
      let returnedApproved = 0
      for (const row of input.live) {
        if (!sendBack.has(row.entryId)) continue
        const open = input.rounds.find((round) => round.entryId === row.entryId)
        if (open !== undefined) {
          const ended = yield* cancelReviewInstance({
            tenantId: input.tenantId,
            instanceId: open.id,
            outcome: 'superseded',
          })
          if (ended) {
            yield* insertReviewEvent({
              tenantId: input.tenantId,
              reviewInstanceId: open.id,
              kind: 'returned-for-revision',
              actorId: input.actorId,
              route: open.route,
              stageId: open.stageId,
              comment: input.reason,
            })
          }
        }
        const moved = yield* setEntryState({
          tenantId: input.tenantId,
          entryId: row.entryId,
          from: ['in_review', 'approved'],
          to: 'needs_revision',
          currentReviewInstanceId: null,
        })
        if (!moved) continue
        yield* insertEntryEvent({
          tenantId: input.tenantId,
          entryId: row.entryId,
          kind: 'revision-required',
          actorId: input.actorId,
          reason: input.reason,
          causeRevisionId: input.newRevisionId,
        })
        yield* bumpParticipantAttention(input.tenantId, row.entryId)
        if (row.status === 'in_review') returnedInReview += 1
        else returnedApproved += 1
      }

      const choice = input.effects.review?.open ?? 'keep'
      const moving =
        choice === 'keep'
          ? []
          : input.rounds
              .filter((round) => !sendBack.has(round.entryId))
              .filter((round) => choice === 'reroute-all' || round.state === 'blocked')

      let rerouted = 0
      let keptOnOldPolicy = 0
      // What the rounds of one question keep re-asking, answered once and
      // held for the length of the move: the policy is read once rather than
      // per round, the chain is resolved once per distinct lineage (a class
      // of forty shares one), a landing unit's live path is read once, and a
      // step's membership is asked once. Nothing written below changes any
      // of those answers - no appointment, no move of the tree - and the
      // whole move is one transaction holding the batch row, so every
      // statement saved is time the batch is not stopped.
      const policy = readPolicy(input.nextPolicy)
      const chains = new Map<string, ResolvedPolicy>()
      const paths = new Map<string, string | null>()
      const staffing = stageStaffing()
      for (const round of moving) {
        const participant = yield* participantOf(
          input.tenantId,
          input.item.batchId,
          round.participantId,
        )
        if (participant === null) {
          keptOnOldPolicy += 1
          continue
        }
        const lineageKey = participant.anchorLineage
          .map((step) => `${step.nodeId}:${step.nodeTypeId}`)
          .join('>')
        let resolved = chains.get(lineageKey)
        if (resolved === undefined) {
          resolved = yield* resolvePolicy({
            tenantId: input.tenantId,
            batchId: input.item.batchId,
            policy,
            lineage: participant.anchorLineage,
          })
          chains.set(lineageKey, resolved)
        }
        // the step it is standing at, by name. If the new policy still has
        // it, the round carries on from there - which is the whole point of
        // "this level has nobody, so I am editing this level". The
        // administrator may instead send every migrated round back to the
        // start of its own route: a full re-review under the new policy,
        // route by route - a round already in escalation restarts
        // escalation, never the ordinary chain.
        const here = routeOf(resolved, round.route).find((stage) => stage.id === round.stageId)
        const landing =
          input.effects.review?.landing === 'route-start'
            ? enterableFrom(resolved, round.route, 0)
            : here !== undefined && here.nodeId !== null
              ? here
              : here !== undefined
                ? enterableFrom(resolved, round.route, here.index)
                : input.effects.review?.missingCurrentStage === 'refuse'
                  ? null
                  : input.effects.review?.missingCurrentStage === 'restart-route'
                    ? enterableFrom(resolved, round.route, 0)
                    : null
        if (landing === null || landing.nodeId === null) {
          // no guessing: a round whose step is gone stays where it is unless
          // the administrator said to start its route over
          keptOnOldPolicy += 1
          continue
        }
        let nodePath = paths.get(landing.nodeId)
        if (nodePath === undefined) {
          nodePath = yield* nodePathOf(input.tenantId, landing.nodeId)
          paths.set(landing.nodeId, nodePath)
        }
        if (nodePath === null) {
          keptOnOldPolicy += 1
          continue
        }
        const ended = yield* cancelReviewInstance({
          tenantId: input.tenantId,
          instanceId: round.id,
          outcome: 'superseded',
        })
        if (!ended) {
          keptOnOldPolicy += 1
          continue
        }
        yield* insertReviewEvent({
          tenantId: input.tenantId,
          reviewInstanceId: round.id,
          kind: 'rerouted',
          actorId: input.actorId,
          route: round.route,
          stageId: round.stageId,
          comment: input.reason,
        })
        // a re-route is a fresh round: the old round's judges carry no
        // exclusion into it, the same as an appeal's do not. The filing's
        // own author still does - a claim written by a proxy must not be
        // judged by that proxy, and passing the subject twice collapsed the
        // conflict set to one person and seated them.
        const arrived = yield* stageArrival({
          tenantId: input.tenantId,
          batchId: input.item.batchId,
          stage: landing,
          subjectUserId: participant.userId,
          actorId: round.actorId,
          staffing,
        })
        const roundNo = yield* nextRoundNo(input.tenantId, round.entryId)
        // a new round, never an edit to the old one: "why did it go there"
        // has to survive the change that moved it
        const opened = yield* insertReviewInstance({
          tenantId: input.tenantId,
          entryId: round.entryId,
          revisionId: round.revisionId,
          roundNo,
          // A round keeps what it is across a re-route. An appeal moved onto
          // a newer chain is still an appeal: withdrawal reads origin off
          // the round a claim currently stands on, and a replacement that
          // called itself an ordinary re-route made a contested verdict
          // withdrawable, which would wash it back to a draft.
          origin: round.origin === 'appeal' ? 'appeal' : 'reroute',
          // and what it was contesting travels with it - whichever pointer
          // it held. An appeal against an administrative determination that
          // lost this on a re-route would quietly re-seed from the filing,
          // which is the exact thing the pointer exists to prevent.
          ...(round.appealedInstanceId !== null
            ? { appealedInstanceId: round.appealedInstanceId }
            : {}),
          ...(round.appealedRecognitionId !== null
            ? { appealedRecognitionId: round.appealedRecognitionId }
            : {}),
          initiator: 'staff',
          supersedesInstanceId: round.id,
          policyRevisionId: input.newRevisionId,
          recognitionRevisionId: input.newRevisionId,
          effectivePolicy: resolved,
          route: landing.route,
          stageId: landing.id,
          roleIds: landing.roleIds,
          nodeId: landing.nodeId,
          nodePath,
          state: arrived.state,
          blockedReason: arrived.blockedReason,
        })
        // The old round's `rerouted` event is the administrator's one act;
        // the new round says how it began through origin + supersedes, and a
        // second identical event here read as the same thing done twice.
        if (arrived.state === 'blocked') {
          yield* insertReviewEvent({
            tenantId: input.tenantId,
            reviewInstanceId: opened,
            kind: 'assignee-not-found',
            actorId: null,
            route: landing.route,
            stageId: landing.id,
          })
        } else if (isPanelStage(landing)) {
          // the landing is a sitting: constitute it from whoever is
          // eligible on arrival, the same as any other entry to the stage
          yield* createPanel({
            tenantId: input.tenantId,
            reviewInstanceId: opened,
            route: landing.route,
            stageId: landing.id,
            members: arrived.eligible,
          })
        }
        yield* setEntryState({
          tenantId: input.tenantId,
          entryId: round.entryId,
          from: ['in_review'],
          to: 'in_review',
          currentReviewInstanceId: opened,
        })
        rerouted += 1
      }

      return { returnedInReview, returnedApproved, rerouted, keptOnOldPolicy }
    })

  /**
   * One configuration through the gauntlet, ending in the next revision.
   * Nothing is ever updated in place: fixing a configuration is appending the
   * next one.
   */
  const appendRevision = (input: {
    tenantId: string
    item: ItemRow
    current: ItemRevisionRow | null
    materialRange: MaterialRange
    config: ItemConfigInput
    actorId: string
    reason: string | null
  }) =>
    Effect.gen(function* () {
      const issues = yield* issuesOf(input)
      if (issues.length > 0) return yield* new ItemConfigInvalid({ issues })

      // a byte-identical configuration is not a new version of anything:
      // appending it would move current_revision_id and the audit counter to
      // say that nothing happened
      if (input.current !== null && !configChanged(input.current, input.config)) {
        return { revisionId: input.current.id, changed: false as const }
      }

      // the arithmetic is compiled once, here, and frozen onto the revision:
      // what an entry gets scored by is then a stored fact rather than a
      // decision the scorer re-derives every time it opens the account
      const compiled = yield* compileScoringPlan({
        calculators: deps.catalogs.calculators,
        aggregators: deps.catalogs.aggregators,
        itemType: deps.catalogs.itemTypes.get(input.item.itemType),
        formConfig: input.config.formConfig,
        scoringConfig: input.config.scoringConfig,
        batch: { materialRange: input.materialRange },
        recognitionSource: recognitionSourceOf({
          interaction: deps.catalogs.itemTypes.get(input.item.itemType)?.interaction,
          entrySource: input.config.entrySource,
          reviewMode: policyModeOf(input.config.reviewPolicy),
        }),
      })
      if ('issues' in compiled) return yield* new ItemConfigInvalid({ issues: compiled.issues })

      const revisionNo = yield* nextRevisionNo(input.tenantId, input.item.id)
      const revisionId = yield* insertItemRevision({
        tenantId: input.tenantId,
        itemId: input.item.id,
        revisionNo,
        entrySource: input.config.entrySource,
        formConfig: input.config.formConfig,
        scoringConfig: input.config.scoringConfig,
        scoringPlan: compiled.plan,
        reviewPolicy: input.config.reviewPolicy,
        displayConfig: input.config.displayConfig ?? {},
        createdBy: input.actorId,
        reason: input.reason,
      })
      yield* setCurrentRevision(input.tenantId, input.item.id, revisionId)
      return { revisionId, changed: true as const }
    })

  const groupsView = (tenantId: string, batchId: string) =>
    groupsOf(tenantId, batchId).pipe(
      Effect.map((rows) =>
        rows.map((row): ScoreGroupView => ({
          id: row.id,
          parentGroupId: row.parentGroupId,
          name: row.name,
          cap: row.cap,
          floor: row.floor,
          sortOrder: row.sortOrder,
          // the questions the group asks, not the ones filed under it: this
          // view reaches everybody who may read the round, and a draft is
          // neither theirs to see nor worth anything against the cap
          itemCount: row.activeItemCount,
        })),
      ),
    )

  const listItems: ItemMethods['listItems'] = Effect.fn('Assessment.listItems')(
    function* (tenantId, batchId, as) {
      yield* deps.requireBatchVisible(tenantId, batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const manage = yield* canManage(as, tenantId, batchId)
          // a draft question is not yet asked of anybody: whoever composes
          // the paper sees it, nobody else learns it exists
          const rows = (yield* itemsOf(tenantId, batchId)).filter(
            (row) => manage || row.status !== 'draft',
          )
          const revisions = yield* revisionsOf(
            tenantId,
            rows.map((row) => row.id),
          )
          return {
            items: rows.map((row) => toView(row, revisions.get(row.id) ?? null)),
            capabilities: { canManage: manage },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const createItem: ItemMethods['createItem'] = Effect.fn('Assessment.createItem')(
    function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const batch = yield* oneBatch(tenantId, batchId)
            const groups = yield* groupsOf(tenantId, batchId)
            if (!groups.some((group) => group.id === input.scoreGroupId)) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'scoreGroupId', reason: 'group-not-in-batch' }],
              })
            }
            const itemId = yield* insertItem({
              tenantId,
              batchId,
              itemType: input.itemType,
              title: input.title,
              scoreGroupId: input.scoreGroupId,
              maxEntries: input.maxEntries,
              sortOrder: input.sortOrder ?? 0,
            })
            const item = (yield* itemOf(tenantId, itemId))!
            const appended = yield* appendRevision({
              tenantId,
              item,
              current: null,
              materialRange: deps.parseRange(String(batch!.materialRange)),
              config: input.config,
              actorId: as.userId,
              reason: null,
            })
            yield* deps.recordConfigChange(
              tenantId,
              batchId,
              locked.status,
              {
                itemCreated: {
                  itemId: item.id,
                  title: item.title,
                  revisionId: appended.revisionId,
                },
              },
              as.userId,
              null,
            )
            yield* announce(tenantId, item.batchId, [{ kind: 'item-changed' }])
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const getItem: ItemMethods['getItem'] = Effect.fn('Assessment.getItem')(
    function* (tenantId, itemId, as) {
      const found = yield* withDb(
        itemOf(tenantId, itemId).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
      if (found === null) return yield* new ItemNotFound()
      yield* deps.requireBatchVisible(tenantId, found.batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const manage = yield* canManage(as, tenantId, found.batchId)
          // the rule the list applies, applied to the one: a draft question is
          // not yet asked of anybody, so to a reader who does not compose the
          // paper it does not exist - naming its id must not be a way in
          if (found.status === 'draft' && !manage) return yield* new ItemNotFound()
          const revision =
            found.currentRevisionId === null
              ? null
              : yield* revisionOf(tenantId, found.currentRevisionId)
          return { ...toView(found, revision), manageable: manage }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const updateItem: ItemMethods['updateItem'] = Effect.fn('Assessment.updateItem')(
    function* (tenantId, itemId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* itemOf(tenantId, itemId)
            if (located === null) return yield* new ItemNotFound()
            const locked = yield* lockBatch(tenantId, located.batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* deps.requireRosterReach(as, tenantId, located.batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            // only the state read under the lock is trusted: a void landing
            // between the locate read and the lock must be seen, or an edit
            // would quietly reconfigure a question that no longer runs
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            // a voided question keeps its history; un-voiding it is its own
            // act, not a side effect of an edit
            if (item.status === 'voided') {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'item', reason: 'item-voided' }],
              })
            }
            if (input.scoreGroupId !== undefined) {
              const groups = yield* groupsOf(tenantId, item.batchId)
              if (!groups.some((group) => group.id === input.scoreGroupId)) {
                return yield* new ItemConfigInvalid({
                  issues: [{ path: 'scoreGroupId', reason: 'group-not-in-batch' }],
                })
              }
            }
            const current =
              item.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, item.currentRevisionId)

            const fieldDiff: Record<string, unknown> = {}
            if (input.title !== undefined && input.title !== item.title) {
              fieldDiff['title'] = [item.title, input.title]
            }
            if (input.scoreGroupId !== undefined && input.scoreGroupId !== item.scoreGroupId) {
              fieldDiff['scoreGroupId'] = [item.scoreGroupId, input.scoreGroupId]
            }
            if (input.maxEntries !== undefined && input.maxEntries !== item.maxEntries) {
              fieldDiff['maxEntries'] = [item.maxEntries, input.maxEntries]
            }
            if (input.sortOrder !== undefined && input.sortOrder !== item.sortOrder) {
              fieldDiff['sortOrder'] = [item.sortOrder, input.sortOrder]
            }

            // On a running round, changing what a question is worth needs a
            // sentence saying why (assessment-design §32.8): the scoring
            // references, and which group's caps the item answers to, are
            // scoring semantics. A title is not.
            const scoringChanged =
              input.config !== undefined &&
              current !== null &&
              !sameJson(current.scoringConfig, input.config.scoringConfig)
            const semanticChange = scoringChanged || fieldDiff['scoreGroupId'] !== undefined
            const reason = input.reason?.trim() ?? ''
            // A question nobody has been asked yet has produced no facts to
            // explain (§32.60), so composing one inside a running round is
            // still just composing.
            if (
              locked.status === 'active' &&
              item.status !== 'draft' &&
              semanticChange &&
              reason === ''
            ) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'reason', reason: 'reason-required' }],
              })
            }

            if (Object.keys(fieldDiff).length > 0) {
              yield* updateItemFields({
                tenantId,
                itemId,
                fields: {
                  ...(input.title !== undefined ? { title: input.title } : {}),
                  ...(input.scoreGroupId !== undefined ? { scoreGroupId: input.scoreGroupId } : {}),
                  ...(input.maxEntries !== undefined ? { maxEntries: input.maxEntries } : {}),
                  ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
                },
              })
            }
            // Which version this edit was composed against. Without it two
            // administrators with the same question open both save, and the
            // second is answering an impact report drawn from a state that
            // stopped existing while they were reading it.
            if (
              input.expectedRevisionId !== undefined &&
              input.expectedRevisionId !== (item.currentRevisionId ?? null)
            ) {
              return yield* new ItemConfigInvalid({
                issues: [{ path: 'expectedRevisionId', reason: 'item-revision-conflict' }],
              })
            }

            if (input.config !== undefined) {
              const batch = yield* oneBatch(tenantId, item.batchId)
              const materialRange = deps.parseRange(String(batch!.materialRange))
              const config = input.config
              const counted = yield* impactUnder({
                tenantId,
                item,
                current,
                materialRange,
                config,
              })
              // A determination somebody already made is not something a
              // dialog can offer to handle. Scoring reads the question's
              // CURRENT plan, so a configuration the standing determinations
              // do not fit leaves those claims approved and unscorable -
              // and there is no remedy a student or a reviewer could carry
              // out. It is refused at the save, which is the only moment
              // anybody is looking (§35).
              if (counted.stranded.length > 0) {
                return yield* new ItemConfigInvalid({
                  issues: counted.stranded.map((entryId) => ({
                    path: `scoringConfig.recognitions:${entryId}`,
                    reason: 'strands-existing-recognition',
                  })),
                })
              }
              // A save that would disturb work under way comes back with what
              // it would disturb rather than going ahead or refusing. The
              // whole transaction rolls back, so nothing was half done while
              // the question was being asked.
              if (missingDecisions(counted.impact, input.effects)) {
                return yield* new ItemChangeDecisionRequired(counted.impact)
              }
              // and the answer is only carried out against the state it was
              // drawn from: reviewers keep working while a dialog is open
              if (
                input.effects !== undefined &&
                input.effects.impactToken !== counted.impact.impactToken
              ) {
                return yield* new ItemChangeDecisionRequired(counted.impact)
              }
              const appended = yield* appendRevision({
                tenantId,
                item,
                current,
                materialRange,
                config,
                actorId: as.userId,
                reason: input.reason ?? null,
              })
              if (appended.changed) {
                fieldDiff['config'] = {
                  oldRevisionId: current?.id ?? null,
                  newRevisionId: appended.revisionId,
                }
                const decided = decisionNeeded(counted.impact)
                if (input.effects !== undefined && (decided.form || decided.review)) {
                  const result = yield* propagate({
                    tenantId,
                    item,
                    newRevisionId: appended.revisionId,
                    effects: input.effects,
                    live: counted.live,
                    rounds: counted.rounds,
                    incompatible: counted.incompatible,
                    nextPolicy: config.reviewPolicy,
                    actorId: as.userId,
                    reason: input.reason ?? null,
                  })
                  // one change, one line: what was chosen and what it did
                  fieldDiff['propagation'] = {
                    form: input.effects.form ?? null,
                    review: input.effects.review ?? null,
                  }
                  fieldDiff['propagationResult'] = result
                }
              }
            }
            // an update that changed nothing leaves no event and moves no
            // counter; recordConfigChange skips the empty diff
            yield* deps.recordConfigChange(
              tenantId,
              item.batchId,
              locked.status,
              Object.keys(fieldDiff).length > 0 ? { itemId, ...fieldDiff } : {},
              as.userId,
              input.reason ?? null,
            )
            // coarse on purpose: an edit may have swept rounds and standing
            // along with the paper, and a wake-up says only "look again"
            yield* announce(tenantId, item.batchId, [
              { kind: 'item-changed' },
              { kind: 'entries-changed' },
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
              { kind: 'result-changed' },
            ])
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  const listScoreGroups: ItemMethods['listScoreGroups'] = Effect.fn('Assessment.listScoreGroups')(
    function* (tenantId, batchId, as) {
      yield* deps.requireBatchVisible(tenantId, batchId, as)
      return yield* withDb(
        Effect.gen(function* () {
          const version = yield* scoreGroupsVersionOf(tenantId, batchId)
          if (version === null) return yield* new BatchNotFound()
          return {
            groups: yield* groupsView(tenantId, batchId),
            version,
            capabilities: { canManage: yield* canManage(as, tenantId, batchId) },
          }
        }).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
      )
    },
  )

  /** an amount as the engine's integer, or null; the schema already vetted it */
  const scaled = (value: string | null) => (value === null ? null : scaledAmount(value))

  const replaceScoreGroups: ItemMethods['replaceScoreGroups'] = Effect.fn(
    'Assessment.replaceScoreGroups',
  )(function* (tenantId, batchId, input, as) {
    const specs = input.groups
    return yield* withDb(
      transaction(
        Effect.gen(function* () {
          const locked = yield* lockBatch(tenantId, batchId)
          if (!locked) return yield* new BatchNotFound()
          yield* deps.requireRosterReach(as, tenantId, batchId)
          if (locked.status === 'archived') return yield* new BatchReadOnly()
          // the whole tree arrives at once, so a payload composed against an
          // older one silently removes whatever it never saw; refused before
          // anything in it is read
          const version = locked.scoreGroupsVersion
          if (version !== input.expectedVersion) {
            return yield* new ScoreGroupVersionConflict({ currentVersion: version })
          }

          const existing = yield* groupsOf(tenantId, batchId)
          const existingById = new Map(existing.map((group) => [group.id, group]))
          const refusals: { reason: string; groupId: string | null; index?: number }[] = []
          for (const [index, spec] of specs.entries()) {
            if (spec.id !== undefined && !existingById.has(spec.id)) {
              refusals.push({ reason: 'group-not-found', groupId: spec.id, index })
            }
            // compared as the engine's own integers: a float comparison here
            // would be a second arithmetic beside the scoring one
            if (
              spec.cap !== null &&
              spec.floor !== null &&
              scaled(spec.floor)! > scaled(spec.cap)!
            ) {
              refusals.push({ reason: 'floor-above-cap', groupId: spec.id ?? null, index })
            }
          }
          // a group may only sit inside one of this batch's own, and the
          // nesting has to be a tree: a cycle would make "what does this
          // group add up to" a question with no answer
          const known = new Set([
            ...existingById.keys(),
            ...specs.flatMap((spec) => (spec.id ? [spec.id] : [])),
          ])
          const parentOf = new Map<string, string | null>()
          for (const [index, spec] of specs.entries()) {
            const parent = spec.parentGroupId
            if (parent !== null && !known.has(parent)) {
              refusals.push({ reason: 'parent-not-in-batch', groupId: spec.id ?? null, index })
            }
            if (parent !== null && spec.id !== undefined && parent === spec.id) {
              refusals.push({ reason: 'parent-is-self', groupId: spec.id, index })
            }
            if (spec.id !== undefined) parentOf.set(spec.id, parent)
          }
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) continue
            const seen = new Set<string>([spec.id])
            let step = parentOf.get(spec.id) ?? null
            while (step !== null) {
              if (seen.has(step)) {
                refusals.push({ reason: 'parent-cycle', groupId: spec.id, index })
                break
              }
              seen.add(step)
              step = parentOf.get(step) ?? null
            }
          }

          // The round has one paper, and the paper is the group everything
          // else sits inside: its ceiling is what the whole round is worth.
          // A second group with no parent would be a second paper.
          if (specs.filter((spec) => (spec.parentGroupId ?? null) === null).length > 1) {
            refusals.push({ reason: 'one-paper-only', groupId: null })
          }

          const submitted = new Set(specs.flatMap((spec) => (spec.id ? [spec.id] : [])))
          const removed = existing.filter((group) => !submitted.has(group.id))
          for (const group of removed) {
            // every question counts here, and not the number the same group
            // shows a reader: one still being composed is as good a reason to
            // keep the group as one already asked
            if (group.heldItemCount > 0) {
              refusals.push({ reason: 'group-has-items', groupId: group.id })
            }
            if (specs.some((spec) => spec.parentGroupId === group.id)) {
              refusals.push({ reason: 'group-has-children', groupId: group.id })
            }
          }

          // the audit diff, computed before anything is written: which rows
          // appeared, which went, and field by field what changed on the rest
          const changed: Record<string, unknown>[] = []
          let limitsChanged = false
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) continue
            const before = existingById.get(spec.id)
            if (before === undefined) continue
            const delta: Record<string, unknown> = { groupId: spec.id }
            if (before.name !== spec.name) delta['name'] = [before.name, spec.name]
            if (scaled(before.cap) !== scaled(spec.cap)) {
              delta['cap'] = [before.cap, spec.cap]
              limitsChanged = true
            }
            if (scaled(before.floor) !== scaled(spec.floor)) {
              delta['floor'] = [before.floor, spec.floor]
              limitsChanged = true
            }
            const order = spec.sortOrder ?? index
            if (before.sortOrder !== order) delta['sortOrder'] = [before.sortOrder, order]
            const parent = spec.parentGroupId
            if (before.parentGroupId !== parent) {
              delta['parentGroupId'] = [before.parentGroupId, parent]
              // moving a group inside another changes what a cap applies to
              limitsChanged = true
            }
            if (Object.keys(delta).length > 1) changed.push(delta)
          }
          const added = specs.filter((spec) => spec.id === undefined).map((spec) => spec.name)
          const isNoOp = added.length === 0 && removed.length === 0 && changed.length === 0

          // a cap or floor on a running round is scoring semantics: moving
          // one without a sentence saying why is refused (§32.8)
          const reason = input.reason?.trim() ?? ''
          if (locked.status === 'active' && limitsChanged && reason === '') {
            refusals.push({ reason: 'reason-required', groupId: null })
          }
          if (refusals.length > 0) return yield* new ScoreGroupInvalid({ refusals })
          if (isNoOp) return { groups: yield* groupsView(tenantId, batchId), version }

          // the surviving rows move first, the departing ones go last: the
          // parent key is RESTRICT and not deferrable, so a group whose child
          // is being reparented away can only leave once that child has
          // actually moved. Nothing points the other way - a spec naming a
          // removed group as its parent is refused above, and a group being
          // inserted has no id for anything to name yet.
          for (const [index, spec] of specs.entries()) {
            if (spec.id === undefined) {
              yield* insertGroup({
                tenantId,
                batchId,
                parentGroupId: spec.parentGroupId,
                name: spec.name,
                cap: spec.cap,
                floor: spec.floor,
                sortOrder: spec.sortOrder ?? index,
              })
            } else {
              yield* updateGroup({
                tenantId,
                batchId,
                id: spec.id,
                parentGroupId: spec.parentGroupId,
                name: spec.name,
                cap: spec.cap,
                floor: spec.floor,
                sortOrder: spec.sortOrder ?? index,
              })
            }
          }
          yield* deleteGroups(
            tenantId,
            batchId,
            removed.map((group) => group.id),
          )
          yield* bumpScoreGroupsVersion(tenantId, batchId)
          yield* deps.recordConfigChange(
            tenantId,
            batchId,
            locked.status,
            {
              scoreGroups: {
                ...(added.length > 0 ? { added } : {}),
                ...(removed.length > 0
                  ? { removed: removed.map((group) => ({ groupId: group.id, name: group.name })) }
                  : {}),
                ...(changed.length > 0 ? { changed } : {}),
              },
            },
            as.userId,
            reason === '' ? null : reason,
          )
          return { groups: yield* groupsView(tenantId, batchId), version: version + 1 }
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error))),
    )
  })

  const refuse = (action: string, reason: string) => new ItemActionRefused({ action, reason })

  const deleteItem: ItemMethods['deleteItem'] = Effect.fn('Assessment.deleteItem')(
    function* (tenantId, itemId, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* itemOf(tenantId, itemId)
            if (located === null) return yield* new ItemNotFound()
            yield* deps
              .requireBatchVisible(tenantId, located.batchId, as)
              .pipe(Effect.catchTag('ACCESS_DENIED', () => new ItemNotFound()))
            const locked = yield* lockBatch(tenantId, located.batchId)
            // a question cannot outlive the round it belongs to, so a round
            // that is gone answers the only question asked here
            if (locked === null) return yield* new ItemNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            yield* deps.requireRosterReach(as, tenantId, located.batchId)
            // only the state read under the lock decides: a publish landing
            // between the locate read and the lock must be seen, or a question
            // that has since been asked would be deleted on the strength of
            // having been a draft a moment ago
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            // deletion is for questions nothing ever happened to: one never
            // published, or any question in a round that has not started -
            // and in neither case with a single entry against it. Anything
            // more is a void, which keeps the record.
            if (item.status !== 'draft' && locked.status !== 'draft') {
              return yield* refuse('delete', 'item-published')
            }
            if (yield* itemHasEntries(tenantId, itemId)) {
              return yield* refuse('delete', 'item-has-entries')
            }
            // a supplementary phase that opens only this question would be
            // left with an empty allowance, which opens every question in the
            // round instead. Widening a phase is the plan's decision to make,
            // never a side effect of removing a question
            if (yield* itemAloneInPhaseScope(tenantId, itemId)) {
              return yield* refuse('delete', 'item-last-in-phase-scope')
            }
            yield* deleteItemRows(tenantId, itemId)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  const setItemStatus: ItemMethods['setItemStatus'] = Effect.fn('Assessment.setItemStatus')(
    function* (tenantId, itemId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const located = yield* itemOf(tenantId, itemId)
            if (located === null) return yield* new ItemNotFound()
            yield* deps
              .requireBatchVisible(tenantId, located.batchId, as)
              .pipe(Effect.catchTag('ACCESS_DENIED', () => new ItemNotFound()))
            const locked = yield* lockBatch(tenantId, located.batchId)
            // a question cannot outlive the round it belongs to
            if (locked === null) return yield* new ItemNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            yield* deps.requireRosterReach(as, tenantId, located.batchId)
            // where the question stands is read under the lock, never before
            // it: whether this call publishes or restores, what it may say no
            // to, and what it writes down afterwards all follow from that one
            // answer, and the locate read above can already be out of date
            const item = yield* itemOf(tenantId, itemId)
            if (item === null) return yield* new ItemNotFound()
            if (input.status === 'voided' && locked.status === 'draft') {
              // a draft round has no facts to keep; the ceremony would
              // record nothing - delete instead
              return yield* refuse('void', 'batch-draft')
            }

            if (input.status === 'voided') {
              const reason = input.reason.trim()
              if (reason === '') return yield* refuse('void', 'reason-required')
              const moved = yield* setItemLifecycle({
                tenantId,
                itemId,
                to: 'voided',
                actorId: as.userId,
                reason,
              })
              if (!moved) return yield* refuse('void', 'item-not-active')
              // open work dies with the question; decided work stands
              for (const entry of yield* openEntriesOfItem(tenantId, itemId)) {
                if (entry.status === 'in_review' && entry.currentReviewInstanceId !== null) {
                  const cancelled = yield* cancelReviewInstance({
                    tenantId,
                    instanceId: entry.currentReviewInstanceId,
                    outcome: 'cancelled',
                  })
                  if (cancelled) {
                    yield* insertReviewEvent({
                      tenantId,
                      reviewInstanceId: entry.currentReviewInstanceId,
                      kind: 'cancelled-item-voided',
                      actorId: as.userId,
                    })
                  }
                }
                yield* setEntryState({
                  tenantId,
                  entryId: entry.id,
                  from: ['draft', 'in_review', 'needs_revision'],
                  to: 'voided',
                })
              }
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked.status,
                { voidedItem: itemId },
                as.userId,
                reason,
              )
            } else {
              // Publishing asks the question of the round for the first time;
              // restoring reopens one that was withdrawn. Both are the same
              // write, and neither reaches backwards: entries voided with a
              // question stay voided, cancelled rounds stay cancelled.
              const publishing = item.status === 'draft'
              // Both are also the moment the configuration becomes live, and
              // it has never been judged as a live one: a draft was composed
              // under no such trial, and the round's window is re-read only
              // against the questions it is already asking. So it faces the
              // save's own gauntlet here, and is refused in the save's own
              // words.
              const current =
                item.currentRevisionId === null
                  ? null
                  : yield* revisionOf(tenantId, item.currentRevisionId)
              if (current === null) {
                return yield* refuse(publishing ? 'publish' : 'restore', 'item-not-configured')
              }
              const batch = yield* oneBatch(tenantId, item.batchId)
              const issues = yield* issuesOf({
                tenantId,
                item,
                current,
                materialRange: deps.parseRange(String(batch!.materialRange)),
                config: {
                  entrySource: current.entrySource,
                  formConfig: current.formConfig,
                  scoringConfig: current.scoringConfig,
                  reviewPolicy: current.reviewPolicy,
                  displayConfig: current.displayConfig,
                },
              })
              if (issues.length > 0) return yield* new ItemConfigInvalid({ issues })
              const moved = yield* setItemLifecycle({ tenantId, itemId, to: 'active' })
              if (!moved) {
                return yield* refuse(
                  publishing ? 'publish' : 'restore',
                  publishing ? 'item-not-draft' : 'item-not-voided',
                )
              }
              yield* deps.recordConfigChange(
                tenantId,
                item.batchId,
                locked.status,
                publishing ? { publishedItem: itemId } : { restoredItem: itemId },
                as.userId,
                null,
              )
            }
            yield* announce(tenantId, item.batchId, [
              { kind: 'item-changed' },
              { kind: 'entries-changed' },
              { kind: 'review-inbox-changed' },
              { kind: 'review-instance-changed' },
              { kind: 'result-changed' },
            ])
            const written = (yield* itemOf(tenantId, itemId))!
            const revision =
              written.currentRevisionId === null
                ? null
                : yield* revisionOf(tenantId, written.currentRevisionId)
            return toView(written, revision)
          }),
        ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error))),
      )
    },
  )

  return {
    listItems,
    createItem,
    getItem,
    updateItem,
    deleteItem,
    setItemStatus,
    listScoreGroups,
    replaceScoreGroups,
  }
}
