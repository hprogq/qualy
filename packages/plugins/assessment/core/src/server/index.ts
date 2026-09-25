import { Clock, Context, Effect, Layer, Option, Result, Stream } from 'effect'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { TenantSettings } from '@qualy/settings-contract/effect'
import { authTerms } from '@qualy/auth-contract/terms'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { HttpServerResponse } from 'effect/unstable/http'
import { Api } from '@qualy/api-kit/plugin'
import { Assembled } from '@qualy/api-kit/assembled'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/auth-contract/session'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { BATCH_MANAGE, rosterReachOf } from './configuration-access.ts'
import { AssessmentLive } from '../live/service.ts'
import { announce, type AssessmentLiveEvent } from '../live/events.ts'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { Audit } from '@qualy/audit-contract/effect'
import { BatchCreated, BatchDeleted } from '../actions.ts'
import type { AuthorizationScope, Principal } from '@qualy/rbac-contract'
import type { ApplicableAssignment } from '@qualy/rbac-contract/effect'
import { assessmentApiGroup, MAX_PLAN_PHASES } from '../api.ts'
import {
  applyToPlan,
  reviewInsertion,
  reviewPlan,
  reviewPlanEdit,
  type EditWarning,
  type NewPhaseSpec,
  type PlanEdit,
} from '../phase/engine/edits.ts'
import { effectiveState, normalizePlan } from '../phase/engine/queue.ts'
import { deriveTimeline, type TimelineEntry } from '../phase/engine/timeline.ts'
import type { EpochMillis, PhasePlan, PhaseSnapshot } from '../phase/engine/types.ts'
import { gateAllows, type GateContext, type GateDecision } from '../phase/gate.ts'
import { PARTICIPANT_ACTION_CODES, BATCH_STAFF_CODES } from '../permissions.ts'
import {
  ItemTypeCatalog,
  ScoringDefinitionCatalog,
  ScoringRuntimeCatalog,
  type AttachmentRef,
} from '../plugin.ts'
import { makeItemMethods, type ItemMethods, type ItemView } from '../item/service.ts'
import {
  currentBatchConfigs,
  itemsOf as batchItemsOf,
  liveBatchPayloads,
  revisionsByIdOf,
} from '../item/db.ts'
import { opensTo } from '../item/channels.ts'
import {
  administrativeRecordService,
  type AdministrativeRecordInput,
  type AdministrativeRecordPreview,
} from '../administrative-record/service.ts'
import {
  makeAdministrativeImportMethods,
  type AdministrativeImportMethods,
} from '../administrative-import/service.ts'
import { currentRecognitionsOfEntries } from '../scoring/recognition-db.ts'
import { readScoringPlan } from '../scoring/plan.ts'
import { recognitionFormFields } from '../scoring/recognition.ts'

import { makeEntryMethods, type EntryMethods, type EntryView } from '../entry/service.ts'
import { makeReviewMethods, type ReviewDetailView, type ReviewMethods } from '../review/service.ts'
import {
  entryCountsByBatchOf,
  openAskCountsByBatchOf,
  participatingBatchIdsOf,
  entrySummaryRowsOf,
  insertReviewEvent,
  listAdministrativeEntriesPage,
  userActivityPage,
  type AdministrativeEntryRow,
} from '../entry/db.ts'
import {
  blockedGroups,
  chainNames,
  endPanelAssignment,
  livePanelSeats,
  mayReviewEntry,
  openInstances,
  openPanelOf,
  openRoundCountOfBatch,
  reviewersAt,
  setInstanceState,
  stageNodesOf,
  reviewerDeskOf,
  reviewsWaitingByBatchOf,
  tenantsWithOpenRounds,
} from '../review/db.ts'
import { stageById } from '../review/chain.ts'
import { reviewersVeiled, unnamedUnlessOwn } from '../review/veil.ts'
import { makeScoringMethods, type ScoringMethods } from '../scoring/service.ts'
import { participantRowByUser } from '../scoring/db.ts'
import { projectEntrySummary } from '../entry/summary.ts'
import { makeAttachmentMethods, type AttachmentMethods } from '../attachment/service.ts'
import { servedTypeOf } from '../attachment/served-type.ts'
import { Storage } from '@qualy/plugin-storage/server'
import {
  AttachmentUnavailable,
  AccessInvalid,
  AdministrativeRecordFilesNotShareable,
  AdministrativeRecordNotFound,
  AdministrativeRecordRefused,
  AdministrativeRecordTargetsChanged,
  AdvanceInvalid,
  BatchNoParticipants,
  BatchNotFound,
  BatchReadOnly,
  BatchReferenceInvalid,
  BatchStatusInvalid,
  MaterialRangeInvalid,
  ParticipantInvalid,
  ParticipantNotFound,
  ParticipantPlacementChanged,
  PhaseNotFound,
  PlanInvalid,
  DeterminationRefused,
  EntryPayloadInvalid,
  ItemNotFound,
  EntryActionRefused,
  ItemRevisionConflict,
  ScoringUnavailable,
  TemplateConflict,
  TemplateNotFound,
  batchConstraints,
  templateConstraints,
  type AdvancePhaseError,
  type SchedulePhaseError,
  type CreateBatchError,
  type ReplacePlanError,
  type SetBatchStatusError,
  type DeleteBatchError,
  type UpdateBatchError,
} from '../errors.ts'
import {
  db,
  batchParticipantIds,
  batchesWithDueBoundaries,
  nextDueBoundaryAt,
  bumpConfigRevision,
  deletePhases,
  deleteTemplateRow,
  insertBatch,
  insertParticipantEvents,
  knownTimeZone,
  keepParticipantPlacement,
  participantPlacements,
  syncParticipantPlacement,
  userTypeNames,
  type PlacementRow,
  type PlacementSnapshot,
  insertManagementAnchors,
  insertParticipants,
  insertRosterImport,
  importCandidates,
  rosterImports,
  reachableNodeNames,
  batchUnits,
  batchWithinReach,
  insertConfigEvent,
  insertPhase,
  insertLifecycleEvent,
  lastArchivedAt,
  lastArchivedFor,
  accessSources,
  accessSubjectPage,
  acceptAccessSource,
  acceptPermissions,
  accessDenies,
  setAccessDeny as setAccessDenyRow,
  oneAccessSource,
  dropAcceptedPermissions,
  dropAccessSource,
  dropEmptyAccessSources,
  explicitAssignments,
  namesOf,
  deleteBatchRow,
  insertPhaseEvent,
  insertTemplate,
  batchVisibleTo,
  countBatches,
  activeBatchIdsVisibleTo,
  listBatchesPage,
  userBatchesPage,
  userEntriesPage,
  type UserBatchRow,
  type UserEntryRow,
  countBatchesByStatus,
  listParticipantsPage,
  listRosterUnits,
  listPhaseRows,
  phaseRowsForBatches,
  listTemplatesPage,
  lockBatch,
  nodesByIds,
  oneBatch,
  oneParticipant,
  oneTemplate,
  activeParticipantByUser,
  batchItemIds,
  phaseScopes,
  replacePhaseScopes,
  rosterAnchors,
  scopeOptions as scopeOptionRows,
  scopesForBatch,
  setCurrentPhase,
  setParticipantStatus,
  setPhaseActual,
  updateBatchFields,
  userLivePosition,
  userTypeOptions as userTypeOptionRows,
  updatePhaseFields,
  updateTemplateRow,
  type BatchRow,
  type ParticipantRow,
  type PhaseRow,
  type TemplateRow,
} from './db.ts'
import { DEFAULT_REVIEW_REASONS } from '../review/reasons.ts'

// The assessment service: the engine's answers, wired to rows. Every write
// serializes on its batch row, "entered" is decided by the clock, and the
// engine's structured refusals go to the wire as they are.

/**
 * One row of the administrative record book, assembled.
 *
 * The cursor rides with the row rather than being recomputed by the handler:
 * the keyset is the row's own creation instant, and the handler has no
 * business knowing which two columns that is.
 */
interface AdministrativeEntryView {
  readonly entryId: string
  readonly participant: {
    readonly id: string
    readonly userId: string
    readonly displayName: string
    readonly businessNo: string | null
  }
  readonly item: { readonly id: string; readonly title: string }
  readonly source: 'record' | 'import'
  readonly status: AdministrativeEntryRow['status']
  readonly revision: {
    readonly id: string
    readonly payload: Record<string, unknown>
    readonly note: string | null
    readonly actorId: string
    readonly actorName: string | null
    readonly createdAt: string
  }
  readonly recognition: {
    readonly id: string
    readonly itemRevisionId: string
    readonly values: Record<string, unknown>
    readonly fields: readonly { readonly id: string; readonly schema: unknown }[]
    /** whose determination it is, off its own row rather than the filing's */
    readonly source: 'review' | 'record' | 'import' | 'system'
    readonly actorName: string | null
    readonly createdAt: string
  } | null
  readonly importId: string | null
  /** the bulk act it was settled by, when it was settled by one */
  readonly operationId: string | null
  /** what the next page starts after, in the order this list is read */
  readonly cursor: readonly [string, string]
}

export interface MaterialRange {
  readonly start: string
  readonly end: string
}

/** a batch as a list shows it: the row, plus where the batch has got to */
export interface BatchListRow extends BatchRow {
  readonly timeline: readonly TimelineEntry[]
  /** where a page resumes, at the precision the column is actually stored at */
  readonly cursorAt: string
}

export interface BatchDetail {
  readonly id: string
  readonly name: string
  readonly descriptionMd: string | null
  readonly materialRange: MaterialRange
  readonly timezone: string
  readonly status: 'draft' | 'active' | 'archived'
  readonly configRevision: number
  readonly manageable: boolean
  readonly currentPhaseId: string | null
  readonly currentPhaseName: string | null
  readonly participantCount: number
  readonly createdAt: EpochMillis
  /** the labels a reviewer picks a reason from, one list per act */
  readonly reviewReasons: {
    readonly reject: readonly string[]
    readonly escalate: readonly string[]
  }
}

/**
 * Who the reader is in this round, as navigation reads it (§32.57 sibling
 * ruling): coarse standing, not an act-permission mirror, and deliberately
 * gate-free - "you are a reviewer here" does not flicker with the phases.
 * Computed with the same arithmetic the acts use, never re-derived by a
 * screen.
 */
export interface BatchCapabilities {
  /** a membership row exists - excluded people keep their history (§32.56) */
  readonly personal: boolean
  readonly review: boolean
  readonly record: boolean
  readonly manage: boolean
}

/** one phase as a plan write states it; instants already parsed to epoch ms */
export interface PhaseSpecInput extends NewPhaseSpec {
  readonly id?: string
  /**
   * supplementary-phase allowances. Empty is unrestricted; absent, on a spec
   * naming an existing phase, is "leave what is stored" (see specOver).
   */
  readonly itemScope?: readonly string[]
  readonly participantScope?: readonly string[]
}

/** a phase row with its allowances, as the plan endpoints serve it */
export interface PlanPhase extends PhaseRow {
  readonly itemScope: readonly string[]
  readonly participantScope: readonly string[]
}

/**
 * A refusal on the wire: the engine's enum plus the plan-level reasons only
 * the service can decide (removal, reorder, template application).
 */
export interface PlanRefusal {
  readonly reason: string
  readonly phaseId: string | null
  readonly blockingPhaseId?: string
  readonly code?: string
  readonly index?: number
}

export interface CreateBatchInput {
  readonly name: string
  readonly descriptionMd?: string
  readonly materialRange: MaterialRange
  readonly timezone?: string
  /**
   * Where the first people come from: a query run once, here, and then only
   * a record of having been run. The batch keeps no scope - who takes part is
   * the roster from this point on.
   */
  readonly import: {
    readonly orgNodeIds: readonly string[]
    readonly userTypeIds: readonly string[]
  }
}

export interface UpdateBatchInput {
  readonly name?: string
  readonly descriptionMd?: string | null
  readonly materialRange?: MaterialRange
  readonly timezone?: string
  readonly reviewReasons?: {
    readonly reject: readonly string[]
    readonly escalate: readonly string[]
  }
  readonly reason?: string
}

/** one accepted assignment, as the access page reads it */
export interface AccessSourceView {
  readonly sourceId: string
  readonly assignmentId: string
  readonly userId: string
  readonly displayName: string
  readonly businessNo: string | null
  readonly roleId: string
  readonly roleName: string
  readonly origin: 'inherited' | 'explicit'
  readonly orgNodeId: string | null
  readonly coverage: 'self' | 'subtree' | null
  /** the ceiling this batch accepted */
  readonly accepted: readonly string[]
  /** of those, what the assignment still carries */
  readonly current: readonly string[]
  /** whether the assignment itself is still in force */
  readonly active: boolean
}

/** what one person may do in this batch, and why */
export interface AccessSubject {
  readonly userId: string
  readonly displayName: string
  readonly businessNo: string | null
  readonly sources: readonly AccessSourceView[]
  /** this batch's own refusals, whichever source offered the capability */
  readonly denied: readonly string[]
  /** what is left: (accepted ∩ current) − denied, before the phase gate */
  readonly effective: readonly string[]
}

export interface BatchAccess {
  readonly staff: readonly AccessSubject[]
}

/** the same, as one reader sees it: every row says whether it is theirs to change */
export interface BatchAccessView {
  readonly staff: readonly (AccessSubject & { readonly manageable: boolean })[]
}

/**
 * One difference between what the organization says and what this batch
 * accepted.
 *
 * `new` and `widened` wait for a decision; `lapsed` has already taken effect
 * and is reported so a reader knows why somebody lost access. `id` is what
 * accepting names - the assignment for a new grant, the accepted source for a
 * widening - and is the source for a lapse, which nobody accepts.
 */
export interface AccessChange {
  readonly id: string
  readonly kind: 'new' | 'widened' | 'lapsed'
  readonly userId: string
  readonly displayName: string
  readonly businessNo: string | null
  readonly roleName: string
  readonly permissions: readonly string[]
}

/** what a synchronisation would add; withdrawals have already taken effect */
export interface AccessSyncPlan {
  readonly changes: readonly AccessChange[]
}

/** one page of them, and how many there are of each errand */
export interface AccessSyncPage {
  readonly items: readonly AccessChange[]
  readonly nextCursor: string | null
  readonly pendingTotal: number
  readonly lapsedTotal: number
}

/** a placement as a reader may be told it; units root first */
export interface PlacementView {
  readonly units: readonly { id: string; name: string | null }[]
  readonly userType: { id: string; name: string | null }
}

/** what differs between where a round has somebody and where the organization does */
export type PlacementChange = 'placement' | 'ancestry' | 'user-type'

export interface PlacementDifference {
  readonly participantId: string
  readonly displayName: string
  readonly businessNo: string | null
  readonly standing: 'changed' | 'unavailable'
  readonly unavailable: 'gone' | 'disabled' | 'unplaced' | null
  readonly changes: readonly PlacementChange[]
  readonly frozen: PlacementView
  readonly current: PlacementView | null
  readonly currentBeyondReach: boolean
  readonly canSync: boolean
  readonly observedFingerprint: string | null
}

export interface PlacementPage {
  readonly items: readonly PlacementDifference[]
  readonly nextCursor: string | null
  readonly changedTotal: number
  readonly unavailableTotal: number
}

/** one decision about one member's placement */
export interface PlacementDecision {
  readonly participantId: string
  readonly observedFingerprint: string
  readonly decision: 'sync' | 'keep'
}

/** every difference there is, name for name: somebody can move and change kind at once */
export const placementChanges = (
  frozen: PlacementSnapshot,
  live: PlacementSnapshot,
): PlacementChange[] => {
  const changes: PlacementChange[] = []
  if (frozen.nodeId !== live.nodeId) changes.push('placement')
  else if (
    frozen.path !== live.path ||
    JSON.stringify(frozen.lineage) !== JSON.stringify(live.lineage)
  ) {
    changes.push('ancestry')
  }
  if (frozen.userTypeId !== live.userTypeId) changes.push('user-type')
  return changes
}

// The order differences are listed and paged in: people without a number
// last, then by number, name and id. Compared by code point in both places,
// so a cursor and the list it resumes agree whatever the database collates by.
const placementKey = (row: PlacementRow): [string, string, string, string] => [
  row.businessNo === null ? '1' : '0',
  row.businessNo ?? '',
  row.displayName,
  row.participantId,
]
const comesAfter = (key: readonly string[], than: readonly string[]) => {
  for (let at = 0; at < key.length; at += 1) {
    if (key[at]! !== than[at]!) return key[at]! > than[at]!
  }
  return false
}

/** the order a page of changes resumes in, as a comparable key */
const CHANGE_RANK = { new: 0, widened: 1, lapsed: 2 } as const

// every part a string, because that is what a cursor may carry back: a
// number would be rejected by the reader that validates its own parts
const changeKey = (change: AccessChange): [string, string, string] => [
  String(CHANGE_RANK[change.kind]),
  change.displayName,
  change.id,
]

/**
 * Where the page after a cursor starts.
 *
 * The first row strictly past the key rather than the row after the one it
 * names: a change accepted by somebody else between two pages is gone from
 * the list, and looking for it by identity would resume at the end.
 */
function positionAfter(changes: readonly AccessChange[], key: readonly string[]): number {
  const rank = Number(key[0])
  const target = { rank: Number.isNaN(rank) ? 0 : rank, name: key[1] ?? '', id: key[2] ?? '' }
  const past = ([rankOf, name, id]: [string, string, string]) =>
    Number(rankOf) !== target.rank
      ? Number(rankOf) > target.rank
      : name !== target.name
        ? name.localeCompare(target.name) > 0
        : id > target.id
  const at = changes.findIndex((change) => past(changeKey(change)))
  return at === -1 ? changes.length : at
}

/** which changes to take, and how much of each */
export interface AccessSyncSelection {
  readonly accept: readonly {
    readonly kind: 'new' | 'widened'
    readonly id: string
    readonly permissions: readonly string[]
  }[]
}

/** closing a batch that has reached the end of its plan */
const specToEngine = (spec: PhaseSpecInput): NewPhaseSpec => ({
  phaseKey: spec.phaseKey,
  displayName: spec.displayName,
  description: spec.description ?? '',
  entryNote: spec.entryNote ?? '',
  permissionProfile: spec.permissionProfile ?? [],
})

const MANAGE = BATCH_MANAGE
const FORCE_ADVANCE = 'assessment.batch.force-advance'

const RANGE = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/

/** the daterange as postgres prints it, back into its two dates */
const parseRange = (text: string): MaterialRange => {
  const match = RANGE.exec(text)
  if (!match) throw new Error(`unreadable material range: ${text}`)
  return { start: match[1]!, end: match[2]! }
}

const toSnapshots = (rows: readonly PhaseRow[]): PhasePlan =>
  normalizePlan(
    rows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      phaseKey: row.phaseKey,
      displayName: row.displayName,
      description: row.description,
      entryNote: row.entryNote,
      plannedEntryAt: row.plannedEntryAt,
      actualEntryAt: row.actualEntryAt,
      permissionProfile: row.permissionProfile,
    })),
  )

/** a key no other phase of this batch uses; the plan's own naming convention */
const freshPhaseKey = (rows: readonly PhaseRow[]): string => {
  const used = new Set(rows.map((row) => row.phaseKey))
  let n = rows.length + 1
  while (used.has(`stage-${n}`)) n += 1
  return `stage-${n}`
}

export interface ArchiveInput {
  readonly status: 'archived'
  readonly reason?: string
}

/**
 * Opening a finished batch again.
 *
 * Never a rollback: the archive stands as a fact and the phases that ran keep
 * their intervals. What reopening does is continue the plan, so it always
 * brings a new phase with it - the second round of submissions is not the
 * first one happening again.
 */
export interface ReopenInput {
  readonly status: 'active'
  readonly reason: string
  readonly phase: {
    readonly displayName: string
    readonly description?: string
    readonly permissionProfile?: readonly string[]
  }
  /** null enters the new phase now; an instant schedules it */
  readonly plannedEntryAt: EpochMillis | null
}

/** an allowance as a set: order and repetition carry no meaning */
const normalScope = (ids: readonly string[] | undefined): readonly string[] =>
  [...new Set(ids ?? [])].sort()

/**
 * What a spec actually says about a phase that already exists.
 *
 * Every writer of a plan sends back a projection of the rows it read, and no
 * projection carries all five editable fields: the stage editor drops the two
 * allowances, applying a timeline template drops those and the entry note. An
 * omitted field therefore has to mean "leave what is stored" - read as an
 * empty value it silently blanked entry notes and emptied the allowances of
 * phases the write was not about, and an emptied allowance is unrestricted to
 * the gate. Clearing stays possible, by sending the empty value.
 */
const specOver = (spec: PhaseSpecInput, existing: PlanPhase) => ({
  description: spec.description ?? existing.description,
  entryNote: spec.entryNote ?? existing.entryNote,
  permissionProfile: spec.permissionProfile ?? existing.permissionProfile,
  itemScope: spec.itemScope === undefined ? existing.itemScope : normalScope(spec.itemScope),
  participantScope:
    spec.participantScope === undefined
      ? existing.participantScope
      : normalScope(spec.participantScope),
})

export type ActionDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      /**
       * Which of the three questions said no.
       *
       * 'authority' rather than 'rbac': a participant refused here never went
       * near a role, and calling it an rbac refusal sent whoever read it
       * looking for a grant that was never going to exist.
       */
      readonly layer: 'authority' | 'gate' | 'policy'
      readonly reason: string
    }

/** what one sweep of the clock-crossed boundaries did */
export interface SweepReport {
  /** batches the candidate query offered */
  readonly scanned: number
  /** boundaries this sweep was the one to write down */
  readonly ratified: number
}

/**
 * How many batches one sweep will take. A ceiling rather than a page: the
 * next sweep is a minute away and picks up whatever is left, so a backlog
 * drains instead of holding one transaction open across a whole tenant.
 */
const SWEEP_BATCH_LIMIT = 200

/**
 * How many people-by-unit pairs one staffing request may name.
 *
 * Each pair is an assignment, and all of them are written in one transaction
 * so that half a request never stands. The two lists are bounded separately
 * at the contract, which bounds neither their product nor how long the
 * tenant is held; this is that bound, and it is far above what naming people
 * over the units of one round comes to.
 */
const MAX_STAFF_PAIRS = 2000

/** holding the batch permission anywhere, which is what building a round needs */
const runsRounds = (held: AuthorizationScope) => held.tenantWide || held.anchors.length > 0

/** rows gathered under a key, in the order they came; one pass */
const groupBy = <T, K, V>(
  rows: readonly T[],
  keyOf: (row: T) => K,
  valueOf: (row: T) => V,
): Map<K, V[]> => {
  const groups = new Map<K, V[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key)
    if (group) group.push(valueOf(row))
    else groups.set(key, [valueOf(row)])
  }
  return groups
}

/**
 * What a plan says about its structure, as one value an editor can hold on
 * to while it edits. Times are left out: they are committed one phase at a
 * time, and the scheduler settling a boundary is not somebody else's edit.
 */
export const planFingerprintOf = (plan: readonly PlanPhase[]): string =>
  hashCanonicalJson(
    plan.map((phase) => ({
      id: phase.id,
      phaseKey: phase.phaseKey,
      displayName: phase.displayName,
      description: phase.description,
      entryNote: phase.entryNote,
      permissionProfile: phase.permissionProfile,
      itemScope: phase.itemScope,
      participantScope: phase.participantScope,
    })),
  )

/** a plan write whose result would hold more phases than a plan may */
const planTooLong = () =>
  new PlanInvalid({ refusals: [{ reason: 'plan-too-long', phaseId: null }] })

/**
 * Why a role is not on offer for a staffing selection.
 *
 * The first four are rbac's answer about the person and the place;
 * `beyond-batch` is this domain's own, and says the authority the role
 * carries is more than a batch may hand out at all.
 */
export type RoleRefusal =
  | 'user-type'
  | 'authority'
  | 'self-escalation'
  | 'unavailable'
  | 'beyond-batch'
  | null

/** one level of the lineage being frozen, with who could act there today */
export interface ChainPreviewStep {
  readonly nodeId: string
  readonly nodeTypeId: string
  /** people holding any role anchored exactly here; real chains arrive with review policies */
  readonly holders: number
}

export type UserActivityKind =
  | 'entry-created'
  | 'entry-revised'
  | 'entry-submitted'
  | 'entry-withdrawn'
  | 'entry-abandoned'
  | 'entry-voided'
  | 'entry-voided-with-item'
  | 'review-approved'
  | 'review-rejected'
  | 'review-escalated'
  | 'appeal-filed'
  | 'supplement-requested'
  | 'supplement-submitted'
  | 'supplement-cancelled'
  | 'revision-required'
  | 'review-stage-approved'
  | 'review-opinion-rejected'
  | 'supplement-answered'
  | 'review-vote-approved'
  | 'review-vote-rejected'

/**
 * What one reader has to do in each round under way.
 *
 * The cross-round form of the reviewer branch of `MyOverview`, and it must
 * agree with it: both say what is waiting for this person in a round, and
 * two endpoints that disagreed about that would be read as the round
 * changing under the reader. Either half is null for somebody the half is
 * not about - `reviewsWaiting` for one who does not judge in that round,
 * `myEntries` for one who is not on its roster - because "not your job" and
 * "your job, nothing pending" are different facts, and only the first one
 * means the line has nothing to say.
 */
export interface MyStanding {
  readonly items: readonly {
    readonly batchId: string
    readonly myEntries: MyFilings | null
    readonly reviewsWaiting: number | null
  }[]
}

/**
 * A participant's own filings in one round, each counted once under what it
 * is waiting for. `submitted` is what is with the reviewers; a filing whose
 * round has paused to ask its author for more is `toAnswer` instead, since
 * it waits on them. Withdrawn-for-good (voided) filings are not counted.
 */
export interface MyFilings {
  readonly toAnswer: number
  readonly toFix: number
  readonly draft: number
  readonly rejected: number
  readonly submitted: number
  readonly approved: number
  /** whether a new filing can be started now, at a later stage, or not again */
  readonly filing: 'open' | 'upcoming' | 'closed'
}

export interface MyOverview {
  readonly participant: {
    readonly unreadItemIds: readonly string[]
    readonly actions: readonly {
      kind: 'supplement' | 'revision'
      entryId: string
      itemId: string
      itemTitle: string
      at: string
      who: string | null
      summary: string | null
    }[]
  } | null
  readonly reviewer: {
    readonly pendingCount: number
    readonly answeredAskCount: number
    readonly queueGroups: readonly { name: string; count: number }[]
    readonly answeredAsks: readonly { who: string | null; itemTitle: string }[]
  } | null
}

export interface MyActivityPage {
  readonly items: readonly {
    id: string
    perspective: 'participant' | 'reviewer'
    kind: UserActivityKind
    entryId: string
    itemId: string
    itemTitle: string
    subjectName: string | null
    instanceId: string | null
    actorName: string | null
    reason: string | null
    comment: string | null
    summary: readonly { label: string; value: string }[]
    at: string
  }[]
  readonly nextCursor: string | null
}

export class Assessment extends Context.Service<
  Assessment,
  {
    readonly createBatch: (
      tenantId: string,
      input: CreateBatchInput,
      as: Principal,
    ) => Effect.Effect<BatchDetail, CreateBatchError>
    /** whether this person holds the batch permission anywhere at all */
    readonly canCreateBatch: (as: Principal) => Effect.Effect<boolean>
    readonly countBatchesByStatus: (
      tenantId: string,
      filter: { q?: string },
      as: Principal,
    ) => Effect.Effect<{ draft: number; active: number; archived: number }>
    readonly listBatches: (
      tenantId: string,
      filter: {
        status?: 'draft' | 'active' | 'archived'
        q?: string
        after?: { createdAt: string; id: string }
        limit: number
      },
      as: Principal,
    ) => Effect.Effect<readonly BatchListRow[]>
    readonly countBatches: (
      tenantId: string,
      filter: { status?: 'draft' | 'active' | 'archived'; q?: string },
      as: Principal,
    ) => Effect.Effect<number>
    /** the rounds one person is or was in, among those the reader may see */
    readonly listUserBatches: (
      tenantId: string,
      userId: string,
      filter: { after?: { includedAt: string; id: string }; limit: number },
      as: Principal,
    ) => Effect.Effect<readonly UserBatchRow[]>
    /** what one person filed, in the rounds the reader administers or works on */
    readonly listUserEntries: (
      tenantId: string,
      userId: string,
      filter: { after?: { createdAt: string; id: string }; limit: number },
      as: Principal,
    ) => Effect.Effect<readonly UserEntryRow[]>
    readonly getBatch: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<
      BatchDetail & { capabilities: BatchCapabilities },
      BatchNotFound | AccessDenied
    >
    readonly capabilitiesFor: (
      tenantId: string,
      batchId: string,
      manageable: boolean,
      as: Principal,
    ) => Effect.Effect<BatchCapabilities>
    /** refuses a batch this person neither administers nor takes part in */
    readonly assertVisible: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<void, AccessDenied>
    readonly updateBatch: (
      tenantId: string,
      batchId: string,
      input: UpdateBatchInput,
      as: Principal,
    ) => Effect.Effect<BatchDetail, UpdateBatchError>
    /**
     * Archiving a batch that has reached its last phase, and reopening one
     * that was archived. Starting is not here: a batch starts by having its
     * first phase scheduled, which is the same act as promising it will run.
     */
    readonly setBatchStatus: (
      tenantId: string,
      batchId: string,
      input: ArchiveInput | ReopenInput,
      as: Principal,
    ) => Effect.Effect<BatchDetail, SetBatchStatusError>
    /**
     * Who may work on this batch, where the authority comes from, and what
     * this batch has taken back from it.
     */
    readonly listAccess: (
      tenantId: string,
      batchId: string,
      page: { cursor?: string; limit?: string },
      as: Principal,
    ) => Effect.Effect<
      BatchAccessView & { nextCursor: string | null },
      BatchNotFound | AccessDenied | BadRequest
    >
    /** what the organization now offers that this batch has not accepted */
    readonly previewAccessSync: (
      tenantId: string,
      batchId: string,
      page: { cursor?: string; limit?: string },
      as: Principal,
    ) => Effect.Effect<AccessSyncPage, BatchNotFound | AccessDenied | BadRequest>
    /** accepts what was chosen of it; withdrawals need no accepting */
    readonly applyAccessSync: (
      tenantId: string,
      batchId: string,
      input: AccessSyncSelection,
      as: Principal,
    ) => Effect.Effect<
      { merged: number; cleared: number },
      BatchNotFound | BatchReadOnly | AccessDenied
    >
    /** takes one capability back from a person, whichever source offered it */
    readonly setAccessDeny: (
      tenantId: string,
      batchId: string,
      input: { userId: string; permission: string; denied: boolean; reason?: string },
      as: Principal,
    ) => Effect.Effect<
      BatchAccessView,
      BatchNotFound | BatchReadOnly | AccessInvalid | AccessDenied
    >
    /** the units and roles bringing somebody in can name, for this caller */
    readonly staffOptions: (
      tenantId: string,
      batchId: string,
      request: { userIds?: readonly string[] | string; orgNodeIds?: readonly string[] | string },
      as: Principal,
    ) => Effect.Effect<
      {
        nodes: readonly {
          id: string
          name: string
          parentId: string | null
          orgTypeId: string
        }[]
        roles: readonly {
          id: string
          name: string
          refusal:
            | 'user-type'
            | 'authority'
            | 'self-escalation'
            | 'unavailable'
            | 'beyond-batch'
            | null
        }[]
      },
      BatchNotFound | AccessInvalid | AccessDenied
    >
    /**
     * Somebody brought in for this round: an ordinary role assignment confined
     * to this batch, accepted into it in the same transaction.
     */
    readonly addStaff: (
      tenantId: string,
      batchId: string,
      input: {
        userIds: readonly string[]
        orgNodeIds: readonly string[]
        roleId: string
        validUntil?: EpochMillis
      },
      as: Principal,
    ) => Effect.Effect<
      BatchAccessView,
      BatchNotFound | BatchReadOnly | AccessInvalid | AccessDenied
    >
    /** and taking them out again, which revokes the assignment behind it */
    readonly removeStaff: (
      tenantId: string,
      batchId: string,
      sourceId: string,
      as: Principal,
    ) => Effect.Effect<BatchAccessView, BatchNotFound | AccessInvalid | AccessDenied>
    /** a draft that never ran, removed with everything configured on it */
    readonly deleteBatch: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<void, DeleteBatchError>
    readonly getPlan: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<readonly PlanPhase[], BatchNotFound | AccessDenied>
    readonly replacePlan: (
      tenantId: string,
      batchId: string,
      body: {
        fromTemplateId?: string
        specs?: readonly PhaseSpecInput[]
        /** the plan the specs were edited from; a changed plan is refused */
        expectedFingerprint?: string
      },
      as: Principal,
    ) => Effect.Effect<
      { phases: readonly PlanPhase[]; warnings: readonly EditWarning[] },
      ReplacePlanError
    >
    readonly advancePhase: (
      tenantId: string,
      batchId: string,
      input: { to: string; force?: boolean; reason?: string },
      as: Principal,
    ) => Effect.Effect<readonly PlanPhase[], AdvancePhaseError>
    readonly schedulePhase: (
      tenantId: string,
      batchId: string,
      phaseId: string,
      plannedEntryAt: EpochMillis | null,
      as: Principal,
    ) => Effect.Effect<readonly PlanPhase[], SchedulePhaseError>
    readonly timeline: (
      tenantId: string,
      batchId: string,
    ) => Effect.Effect<readonly TimelineEntry[], BatchNotFound>
    readonly gate: (
      tenantId: string,
      batchId: string,
      code: string,
      ctx?: GateContext,
    ) => Effect.Effect<GateDecision, BatchNotFound>
    readonly authorizeEntryAction: (
      principal: Principal,
      code: string,
      batchId: string,
      ctx?: GateContext,
    ) => Effect.Effect<ActionDecision, BatchNotFound>
    readonly listTemplates: (
      tenantId: string,
      filter: { kind?: 'timeline' | 'phase'; after?: { name: string; id: string }; limit: number },
      as: Principal,
    ) => Effect.Effect<readonly TemplateRow[], AccessDenied>
    readonly createTemplate: (
      tenantId: string,
      input: {
        name: string
        kind?: 'timeline' | 'phase'
        phases: readonly PhaseSpecInput[]
      },
      as: Principal,
    ) => Effect.Effect<TemplateRow, AccessDenied | TemplateConflict | PlanInvalid>
    readonly updateTemplate: (
      tenantId: string,
      templateId: string,
      input: { name?: string; phases?: readonly PhaseSpecInput[] },
      as: Principal,
    ) => Effect.Effect<
      TemplateRow,
      AccessDenied | TemplateConflict | TemplateNotFound | PlanInvalid
    >
    readonly deleteTemplate: (
      tenantId: string,
      templateId: string,
      as: Principal,
    ) => Effect.Effect<void, AccessDenied | TemplateNotFound>
    /**
     * One person on the roster, by the membership row's own id.
     *
     * Beside the list rather than inside it: an account is addressable, and
     * an address must open without paging the roster until the row appears.
     */
    readonly getParticipant: (
      tenantId: string,
      batchId: string,
      participantId: string,
      as: Principal,
    ) => Effect.Effect<ParticipantRow, BatchNotFound | ParticipantNotFound | AccessDenied>
    /** administrative facts in bulk: a workbook in, an import out, and taking one back */
    readonly administrativeImportTemplate: AdministrativeImportMethods['administrativeImportTemplate']
    readonly prepareAdministrativeImportUpload: AdministrativeImportMethods['prepareAdministrativeImportUpload']
    readonly completeAdministrativeImportUpload: AdministrativeImportMethods['completeAdministrativeImportUpload']
    /** who one bulk administrative act would reach, and what would refuse it */
    readonly previewAdministrativeRecord: (
      tenantId: string,
      batchId: string,
      input: AdministrativeRecordInput,
      as: Principal,
    ) => Effect.Effect<
      AdministrativeRecordPreview & { files: readonly AttachmentRef[] },
      | BatchNotFound
      | BatchReadOnly
      | AccessDenied
      | ItemNotFound
      | ItemRevisionConflict
      | DeterminationRefused
      | EntryPayloadInvalid
      // a selection past the ceiling is refused here too, so a reader is
      // never shown a set the write would then refuse
      | AdministrativeRecordRefused
      | ScoringUnavailable,
      ScoringRuntimeCatalog
    >
    /** what a determination being composed would score, before anything is written */
    readonly previewRecordDetermination: (
      tenantId: string,
      batchId: string,
      itemId: string,
      values: unknown,
      as: Principal,
    ) => Effect.Effect<
      {
        readonly issues: readonly { readonly recognitionId: string; readonly reason: string }[]
        readonly amount: string | null
        readonly refusal: string | null
      },
      BatchNotFound | AccessDenied | ItemNotFound | ScoringUnavailable,
      ScoringRuntimeCatalog
    >
    /** the act itself, all of it or none of it */
    readonly recordAdministrativeBatch: (
      tenantId: string,
      batchId: string,
      input: AdministrativeRecordInput & { expectedTargetFingerprint: string },
      as: Principal,
    ) => Effect.Effect<
      { operationId: string; recordedCount: number },
      | BatchNotFound
      | BatchReadOnly
      | AccessDenied
      | ItemNotFound
      | ItemRevisionConflict
      | DeterminationRefused
      | EntryPayloadInvalid
      | ScoringUnavailable
      | AdministrativeRecordTargetsChanged
      | AdministrativeRecordFilesNotShareable
      | AdministrativeRecordRefused,
      ScoringRuntimeCatalog
    >
    /** the acts of one round, newest first, with what each comes to now */
    readonly listAdministrativeRecords: (
      tenantId: string,
      batchId: string,
      filter: { after?: readonly [string, string] | undefined; limit: number },
      as: Principal,
    ) => Effect.Effect<
      readonly {
        id: string
        itemId: string
        itemTitle: string
        targetKind: string
        targetSpec: Record<string, unknown>
        recordedCount: number
        voidedCount: number
        actorName: string | null
        createdAt: string
      }[],
      AccessDenied
    >
    /** one act, what it came to, and what has been done to it */
    readonly getAdministrativeRecord: (
      tenantId: string,
      operationId: string,
      as: Principal,
      /** where the list of people resumes; an act may name thousands */
      rowsAfter?: string,
    ) => Effect.Effect<
      {
        id: string
        batchId: string
        itemId: string
        itemTitle: string
        itemRevisionId: string
        targetKind: string
        targetSpec: Record<string, unknown>
        actorId: string | null
        actorName: string | null
        recordedCount: number
        voidedCount: number
        createdAt: string
        rowsNextCursor: string | null
        rows: readonly {
          entryId: string
          participantId: string
          displayName: string
          businessNo: string | null
          status: string
        }[]
        events: readonly {
          id: string
          kind: string
          reason: string | null
          affectedCount: number
          actorName: string | null
          createdAt: string
        }[]
      },
      AdministrativeRecordNotFound
    >
    /** taking a whole act back, along the rows it actually wrote */
    readonly reverseAdministrativeRecord: (
      tenantId: string,
      operationId: string,
      input: { reason: string },
      as: Principal,
    ) => Effect.Effect<
      { affectedCount: number },
      | AdministrativeRecordNotFound
      | BatchReadOnly
      | EntryActionRefused
      | AdministrativeRecordRefused
    >
    readonly previewAdministrativeImport: AdministrativeImportMethods['previewAdministrativeImport']
    readonly commitAdministrativeImport: AdministrativeImportMethods['commitAdministrativeImport']
    readonly listAdministrativeImports: AdministrativeImportMethods['listAdministrativeImports']
    readonly getAdministrativeImport: AdministrativeImportMethods['getAdministrativeImport']
    readonly listAdministrativeImportRows: AdministrativeImportMethods['listAdministrativeImportRows']
    readonly openAdministrativeImportSource: AdministrativeImportMethods['openAdministrativeImportSource']
    readonly describeAdministrativeImportSource: AdministrativeImportMethods['describeAdministrativeImportSource']
    readonly reverseAdministrativeImport: AdministrativeImportMethods['reverseAdministrativeImport']
    /**
     * The book of administrative facts in one round, newest first.
     *
     * Read by the same two doors the roster is: whoever administers the
     * round sees all of it, and whoever is here on recording authority sees
     * the part they may record on - intersected in sql, because a page
     * filtered afterwards has already read and counted other people's.
     */
    readonly listAdministrativeEntries: (
      tenantId: string,
      batchId: string,
      filter: {
        q?: string
        entryId?: string
        itemId?: string
        source?: 'record' | 'import'
        status?: AdministrativeEntryRow['status']
        orgNodeIds?: readonly string[]
        orgScope?: 'self' | 'subtree'
        after?: readonly [string, string]
        limit: number
      },
      as: Principal,
    ) => Effect.Effect<readonly AdministrativeEntryView[], BatchNotFound | AccessDenied>
    readonly listParticipants: (
      tenantId: string,
      batchId: string,
      filter: {
        status?: 'active' | 'excluded'
        /** a name or a business number, matched in sql rather than after the page */
        q?: string
        orgNodeIds?: readonly string[]
        orgScope?: 'self' | 'subtree'
        userTypeId?: string
        after?: { path: string; id: string }
        limit: number
      },
      as: Principal,
    ) => Effect.Effect<readonly ParticipantRow[], BatchNotFound | AccessDenied>
    /** the units this round's people were admitted from, as it froze them */
    readonly listRosterUnits: (
      tenantId: string,
      batchId: string,
      filter: { userTypeId?: string },
      as: Principal,
    ) => Effect.Effect<
      readonly { id: string; name: string; parentId: string | null }[],
      BatchNotFound | AccessDenied
    >
    /**
     * Adding people by name of the people themselves.
     *
     * Importing from the organization resolves its units to people first, so
     * there is one way in and it takes user ids. Anybody already taking part
     * is skipped rather than refused: adding a hundred people of whom two are
     * already there is not a mistake.
     */
    readonly addParticipants: (
      tenantId: string,
      batchId: string,
      userIds: readonly string[],
      as: Principal,
    ) => Effect.Effect<
      { added: number; skipped: number },
      BatchNotFound | BatchReadOnly | ParticipantInvalid | AccessDenied
    >
    /** how many people a set of units and types would add, before adding them */
    readonly previewImport: (
      tenantId: string,
      batchId: string,
      selection: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] },
      as: Principal,
    ) => Effect.Effect<{ candidates: number }, BatchNotFound | AccessDenied>
    /** and doing it, which is recorded as the act it is */
    readonly importParticipants: (
      tenantId: string,
      batchId: string,
      selection: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] },
      as: Principal,
    ) => Effect.Effect<
      { added: number },
      BatchNotFound | BatchReadOnly | BatchReferenceInvalid | ParticipantInvalid | AccessDenied
    >
    /** what was imported, when, and on what grounds; history, never a rule */
    readonly listImports: (
      tenantId: string,
      batchId: string,
      page: { cursor?: string; limit?: string },
      as: Principal,
    ) => Effect.Effect<
      {
        items: readonly {
          id: string
          units: readonly string[]
          userTypes: readonly string[]
          importedCount: number
          actorId: string | null
          occurredAt: number
        }[]
        nextCursor: string | null
      },
      BatchNotFound | AccessDenied | BadRequest
    >
    readonly setParticipantStatus: (
      tenantId: string,
      batchId: string,
      participantId: string,
      to: 'active' | 'excluded',
      reason: string | undefined,
      as: Principal,
    ) => Effect.Effect<
      ParticipantRow,
      BatchNotFound | BatchReadOnly | ParticipantNotFound | ParticipantInvalid | AccessDenied
    >
    /** members the organization now has somewhere other than this round does */
    readonly listParticipantPlacements: (
      tenantId: string,
      batchId: string,
      page: { cursor?: string; limit?: string },
      as: Principal,
    ) => Effect.Effect<PlacementPage, BatchNotFound | AccessDenied | BadRequest>
    /** syncs or keeps each chosen member's placement, all of them or none */
    readonly reconcileParticipantPlacements: (
      tenantId: string,
      batchId: string,
      input: { decisions: readonly PlacementDecision[]; reason?: string | undefined },
      as: Principal,
    ) => Effect.Effect<
      { synced: number; kept: number },
      | BatchNotFound
      | BatchReadOnly
      | ParticipantNotFound
      | ParticipantInvalid
      | ParticipantPlacementChanged
      | AccessDenied
    >
    readonly scopeOptions: (
      tenantId: string,
      as: Principal,
    ) => Effect.Effect<
      readonly {
        id: string
        name: string
        parentId: string | null
        depth: number
        orgTypeId: string
      }[],
      AccessDenied
    >
    readonly userTypeOptions: (
      tenantId: string,
      as: Principal,
    ) => Effect.Effect<readonly { id: string; code: string; name: string }[], AccessDenied>
    readonly reviewCoverage: (
      tenantId: string,
      batchId: string,
      stage: { nodeTypeId: string; roleIds: readonly string[] },
      as: Principal,
    ) => Effect.Effect<
      { nodes: readonly { id: string; name: string; reviewers: number }[] },
      BatchNotFound | AccessDenied
    >
    readonly itemOptions: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<
      {
        orgTypes: readonly { id: string; name: string }[]
        roles: readonly { id: string; name: string }[]
      },
      BatchNotFound | AccessDenied
    >
    /**
     * Ratifies every boundary the clock has crossed, across tenants.
     *
     * The scheduler's whole job, as a service method so the fiber owns only
     * cadence. It acts as the system rather than for a principal: no
     * authorization is consulted because nothing is being decided - the
     * boundaries already took effect when the clock passed them, and this
     * writes down what is already true.
     */
    readonly sweepDueBoundaries: Effect.Effect<SweepReport>
    /**
     * The next instant any active batch's diary commits to, or null.
     *
     * For the scheduler's alarm, and nothing else: the answer is already
     * stale the moment it returns, which is fine for deciding how long to
     * sleep and for nothing that decides state.
     */
    readonly nextDueBoundary: Effect.Effect<number | null>
    /** re-resolves every open round's stage and heals both ways (§14) */
    readonly patrolReviewRounds: Effect.Effect<{ blocked: number; released: number }>
    readonly reviewAlerts: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<
      {
        groups: readonly {
          /** nothing when the step resolved to no unit: a duty nobody holds */
          nodeId: string | null
          nodeName: string | null
          roleNames: readonly string[]
          reason: 'no-assignee' | 'no-independent-reviewer' | 'panel-seat-unfilled'
          waiting: number
        }[]
      },
      BatchNotFound | AccessDenied
    >
    /** one person's claims on the round's questions, and their lifecycle */
    readonly listMyEntries: EntryMethods['listMyEntries']
    /** one named participant's claims and determinations, for whoever administers the round */
    readonly listParticipantEntries: EntryMethods['listParticipantEntries']
    readonly getEntryHistory: EntryMethods['getEntryHistory']
    readonly createEntry: EntryMethods['createEntry']
    readonly getEntry: EntryMethods['getEntry']
    readonly appendEntryRevision: EntryMethods['appendEntryRevision']
    readonly setEntryStatus: EntryMethods['setEntryStatus']
    readonly markMyEntryRead: EntryMethods['markMyEntryRead']
    readonly getMyEntrySummary: EntryMethods['getMyEntrySummary']
    /**
     * The user's desk on this batch (§32.73): one branch per standing they
     * hold, absent branches null. Being nobody here is not an error.
     */
    readonly getMyOverview: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<MyOverview, BatchNotFound | AccessDenied>
    /**
     * The same question as `getMyOverview`'s reviewer branch, asked of every
     * round under way at once: what is waiting for this reader where.
     */
    readonly listMyStanding: (tenantId: string, as: Principal) => Effect.Effect<MyStanding>
    /** the user's own recent story across their standings, newest first */
    readonly listMyActivity: (
      tenantId: string,
      batchId: string,
      page: { cursor?: string; limit?: string; perspective?: 'participant' | 'reviewer' },
      as: Principal,
    ) => Effect.Effect<MyActivityPage, BatchNotFound | AccessDenied | BadRequest>
    readonly interveneOnEntry: EntryMethods['interveneOnEntry']
    /** the single review stage: a queue answered, a round closed exactly once */
    readonly listReviewInbox: ReviewMethods['listReviewInbox']
    readonly listAwaitingSupplements: ReviewMethods['listAwaitingSupplements']
    readonly getReviewInstance: ReviewMethods['getReviewInstance']
    readonly previewDetermination: ReviewMethods['previewDetermination']
    readonly decideReview: ReviewMethods['decideReview']
    readonly appealEntry: ReviewMethods['appealEntry']
    /** the supplement exchange: ask, take back, answer (§32.65 ⑤) */
    readonly requestSupplement: ReviewMethods['requestSupplement']
    readonly cancelSupplement: ReviewMethods['cancelSupplement']
    readonly answerSupplement: ReviewMethods['answerSupplement']
    /** one's own provisional standing, from the one scorer */
    readonly getMyResult: ScoringMethods['getMyResult']
    /** the same standing for a named participant, behind administrative reach */
    readonly getParticipantResult: ScoringMethods['getParticipantResult']
    /** the bytes of a business material, for whoever its story admits */
    readonly openAttachment: AttachmentMethods['openAttachment']
    readonly prepareAttachmentUpload: AttachmentMethods['prepareAttachmentUpload']
    readonly completeAttachmentUpload: AttachmentMethods['completeAttachmentUpload']
    readonly describeAttachment: AttachmentMethods['describeAttachment']
    readonly describeAttachments: AttachmentMethods['describeAttachments']
    /** the score tree and the items on it; the save gauntlet lives behind these */
    readonly listItems: ItemMethods['listItems']
    readonly createItem: ItemMethods['createItem']
    readonly getItem: ItemMethods['getItem']
    readonly getRecognitionContract: ItemMethods['getRecognitionContract']
    readonly updateItem: ItemMethods['updateItem']
    readonly deleteItem: ItemMethods['deleteItem']
    readonly setItemStatus: ItemMethods['setItemStatus']
    readonly listScoreGroups: ItemMethods['listScoreGroups']
    readonly replaceScoreGroups: ItemMethods['replaceScoreGroups']
    readonly previewScoring: ItemMethods['previewScoring']
    readonly checkItem: ItemMethods['checkItem']
  }
>()('@qualy/plugin-assessment/Assessment') {}

/** a locale tag as the product speaks it; anything else reads in the default locale */
const localeOf = (tag: string): SupportedLocale =>
  (supportedLocales as readonly string[]).includes(tag) ? (tag as SupportedLocale) : 'zh-CN'

export const make = Effect.fn('Assessment.make')(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit
  const itemTypes = yield* ItemTypeCatalog
  const scoring = yield* ScoringDefinitionCatalog
  const storage = yield* Storage

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

  /** the configured reason lists, read defensively off the jsonb */
  const readReviewReasons = (
    value: unknown,
  ): { reject: readonly string[]; escalate: readonly string[] } => {
    const read = (list: unknown): readonly string[] =>
      Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : []
    const record = (value ?? {}) as Record<string, unknown>
    return { reject: read(record['reject']), escalate: read(record['escalate']) }
  }

  /**
   * A batch as a reader receives it.
   *
   * The stage in hand is derived, not read off the row. `current_phase_id` is
   * a projection the sweeper maintains, and the clock is what decides: for
   * the minutes between an instant arriving and the sweeper writing it down,
   * the projection says "not started" while the gate is already open and the
   * round already visible to the people in it. Every screen that colours a
   * batch by where it stands was reading that gap.
   */
  const readDetail = (tenantId: string, batch: BatchRow) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const plan = toSnapshots(yield* listPhaseRows(tenantId, batch.id))
      const here = yield* effectivePhaseIndex(tenantId, batch, plan, now)
      const phase = here === null ? null : plan[here]
      return {
        id: batch.id,
        name: batch.name,
        descriptionMd: batch.descriptionMd,
        materialRange: parseRange(batch.materialRange),
        timezone: batch.timezone,
        status: batch.status as BatchDetail['status'],
        configRevision: batch.configRevision,
        manageable: batch.manageable,
        currentPhaseId: phase?.id ?? null,
        currentPhaseName: phase?.displayName ?? null,
        participantCount: batch.participantCount,
        createdAt: batch.createdAt,
        reviewReasons: readReviewReasons(batch.reviewReasons),
      } satisfies BatchDetail
    })

  /** the plan with its allowances, as every plan endpoint answers it */
  const readPlan = (tenantId: string, batchId: string) =>
    Effect.gen(function* () {
      const rows = yield* listPhaseRows(tenantId, batchId)
      const scopes = yield* scopesForBatch(tenantId, batchId)
      const itemsOf = groupBy(
        scopes.items,
        (entry) => entry.phaseId,
        (entry) => entry.itemId,
      )
      const participantsOf = groupBy(
        scopes.participants,
        (entry) => entry.phaseId,
        (entry) => entry.participantId,
      )
      return rows.map((row): PlanPhase => ({
        ...row,
        itemScope: itemsOf.get(row.id) ?? [],
        participantScope: participantsOf.get(row.id) ?? [],
      }))
    })

  /**
   * The one door configuration changes leave through (§9): a draft changes
   * with zero ceremony, an active batch appends one config event per actual
   * change and moves the monotonic counter a stale score run is detected by.
   */
  const recordConfigChange = (
    tenantId: string,
    batchId: string,
    status: string,
    diff: Record<string, unknown>,
    actorId: string | null,
    reason: string | null,
  ) =>
    Effect.gen(function* () {
      if (status !== 'active' || Object.keys(diff).length === 0) return
      const revision = yield* bumpConfigRevision(tenantId, batchId)
      yield* insertConfigEvent({ tenantId, batchId, revision, actorId, diff, reason })
    })

  /**
   * Ratifies clock-crossed boundaries and catches the projection up.
   * Idempotent: the actual lands once, re-running writes nothing.
   */
  const ratifyPending = (tenantId: string, batchId: string, plan: PhasePlan, now: EpochMillis) =>
    Effect.gen(function* () {
      const state = effectiveState(plan, now)
      let ratified = 0
      for (const pending of state.pending) {
        // the write is conditional on the actual still being null, so a
        // concurrent ratifier converges instead of writing history twice;
        // only the call that won reports the boundary
        const wrote = yield* setPhaseActual(tenantId, pending.phaseId, pending.actualEntryAt)
        if (wrote) {
          ratified++
          yield* insertPhaseEvent({
            tenantId,
            phaseId: pending.phaseId,
            kind: 'entered',
            actualAt: pending.actualEntryAt,
            processedAt: now,
          })
        }
      }
      if (state.pending.length > 0 && state.phase !== null) {
        yield* setCurrentPhase(tenantId, batchId, state.phase.id)
      }
      return { state, ratified }
    })

  const fieldEditsOf = (existing: PlanPhase, spec: PhaseSpecInput): PlanEdit[] => {
    const over = specOver(spec, existing)
    const edits: PlanEdit[] = []
    if (spec.displayName !== existing.displayName) {
      edits.push({ kind: 'rename', phaseId: existing.id, displayName: spec.displayName })
    }
    if (over.description !== existing.description) {
      edits.push({ kind: 'describe', phaseId: existing.id, description: over.description })
    }
    if (over.entryNote !== existing.entryNote) {
      edits.push({ kind: 'note-entry', phaseId: existing.id, entryNote: over.entryNote })
    }
    if (JSON.stringify(over.permissionProfile) !== JSON.stringify(existing.permissionProfile)) {
      edits.push({
        kind: 'set-profile',
        phaseId: existing.id,
        permissionProfile: over.permissionProfile,
      })
    }
    return edits
  }

  const editEvent = (edit: PlanEdit): { kind: string; plannedAt?: number | null } => {
    switch (edit.kind) {
      case 'rename':
        return { kind: 'renamed' }
      case 'set-planned':
        return { kind: 'planned-changed', plannedAt: edit.plannedEntryAt }
      case 'describe':
        return { kind: 'described' }
      case 'note-entry':
        return { kind: 'entry-noted' }
      case 'set-profile':
        return { kind: 'profile-changed' }
      default:
        return { kind: 'edited' }
    }
  }

  /**
   * Rewrites the plan to the submitted order: retained rows park their
   * ordinals out of the way first, so the unique (batch, ordinal) index never
   * sees a transient collision, then every slot is finalized left to right,
   * allowances included. Returns each slot's phase id.
   */
  const writePlanOrder = (
    tenantId: string,
    batchId: string,
    specs: readonly PhaseSpecInput[],
    existingById: ReadonlyMap<string, PlanPhase>,
    options: { events: boolean; actorId: string | null; provenance?: TemplateRow },
  ) =>
    Effect.gen(function* () {
      const PARK = 1_000_000
      let parked = 0
      for (const spec of specs) {
        if (spec.id !== undefined && existingById.has(spec.id)) {
          yield* updatePhaseFields(tenantId, spec.id, { ordinal: PARK + parked++ })
        }
      }
      const ids: string[] = []
      for (const [index, spec] of specs.entries()) {
        const existing = spec.id !== undefined ? existingById.get(spec.id) : undefined
        if (existing) {
          const over = specOver(spec, existing)
          const edits = options.events ? fieldEditsOf(existing, spec) : []
          yield* updatePhaseFields(tenantId, existing.id, {
            ordinal: index,
            displayName: spec.displayName,
            phaseKey: spec.phaseKey,
            description: over.description,
            entryNote: over.entryNote,
            permissionProfile: over.permissionProfile,
          })
          const scopesChanged =
            JSON.stringify(over.itemScope) !== JSON.stringify(existing.itemScope) ||
            JSON.stringify(over.participantScope) !== JSON.stringify(existing.participantScope)
          if (scopesChanged) {
            yield* replacePhaseScopes(tenantId, existing.id, {
              items: over.itemScope,
              participants: over.participantScope,
            })
          }
          for (const edit of edits) {
            const event = editEvent(edit)
            yield* insertPhaseEvent({
              tenantId,
              phaseId: existing.id,
              kind: event.kind,
              plannedAt: event.plannedAt,
              actorId: options.actorId,
            })
          }
          if (scopesChanged && options.events) {
            yield* insertPhaseEvent({
              tenantId,
              phaseId: existing.id,
              kind: 'scope-changed',
              actorId: options.actorId,
            })
          }
          ids.push(existing.id)
        } else {
          const phaseId = yield* insertPhase({
            tenantId,
            batchId,
            ordinal: index,
            phaseKey: spec.phaseKey,
            displayName: spec.displayName,
            description: spec.description ?? '',
            entryNote: spec.entryNote ?? '',
            permissionProfile: spec.permissionProfile ?? [],
            ...(options.provenance
              ? {
                  sourceTemplateId: options.provenance.id,
                  sourceTemplateVersion: options.provenance.version,
                }
              : {}),
          })
          const itemScope = normalScope(spec.itemScope)
          const participantScope = normalScope(spec.participantScope)
          if (itemScope.length > 0 || participantScope.length > 0) {
            yield* replacePhaseScopes(tenantId, phaseId, {
              items: itemScope,
              participants: participantScope,
            })
          }
          if (options.events) {
            yield* insertPhaseEvent({
              tenantId,
              phaseId,
              kind: 'inserted',
              actorId: options.actorId,
            })
          }
          ids.push(phaseId)
        }
      }
      return ids
    })

  /** a tenant-level template cannot name batch-local rows */
  const templateScopeRefusals = (specs: readonly PhaseSpecInput[]): PlanRefusal[] =>
    specs.flatMap((spec, index) =>
      (spec.itemScope?.length ?? 0) > 0 || (spec.participantScope?.length ?? 0) > 0
        ? [{ reason: 'scope-in-template', phaseId: null, index }]
        : [],
    )

  // A phase template describes one phase's options - its name and what it
  // opens. When and how a phase starts belongs to the batch that has it, so
  // the stored spec is exactly one entry, manual by convention, with no times.
  const phaseTemplateShapeRefusals = (specs: readonly PhaseSpecInput[]): PlanRefusal[] =>
    specs.length === 1 ? [] : [{ reason: 'phase-template-shape', phaseId: null }]

  /** allowance rules the engine has no vocabulary for */
  const scopeRefusals = (
    specs: readonly PhaseSpecInput[],
    existingById: ReadonlyMap<string, PlanPhase>,
    participants: ReadonlySet<string>,
    items: ReadonlySet<string>,
    endedIds: ReadonlySet<string>,
  ): PlanRefusal[] => {
    const refusals: PlanRefusal[] = []
    for (const [index, spec] of specs.entries()) {
      const participantScope = normalScope(spec.participantScope)
      for (const participantId of participantScope) {
        // the allowance names this batch's roster rows and nothing else -
        // the foreign key only knows the tenant, so the service holds the line
        if (!participants.has(participantId)) {
          refusals.push({ reason: 'participant-not-in-batch', phaseId: spec.id ?? null, index })
        }
      }
      for (const itemId of normalScope(spec.itemScope)) {
        // same line for items: the key proves the item exists in the tenant,
        // the service proves it is this batch's - an allowance naming another
        // round's question would gate on something nobody here can satisfy
        if (!items.has(itemId)) {
          refusals.push({ reason: 'item-not-in-batch', phaseId: spec.id ?? null, index })
        }
      }
      if (spec.id !== undefined && endedIds.has(spec.id)) {
        const existing = existingById.get(spec.id)!
        const over = specOver(spec, existing)
        if (
          JSON.stringify(over.itemScope) !== JSON.stringify(existing.itemScope) ||
          JSON.stringify(over.participantScope) !== JSON.stringify(existing.participantScope)
        ) {
          refusals.push({ reason: 'ended-phase-name-only', phaseId: spec.id, index })
        }
      }
    }
    return refusals
  }

  /** the current phase's profile and scopes, null before any phase is in effect */
  /**
   * Whether the stage the plan computes is really the stage in hand.
   *
   * It is not, if the round was closed after that stage began: reopening
   * appends a new one, and until that one arrives the round is between
   * stages rather than back in the last one it ran.
   */
  const beganAfter = (phase: PhaseSnapshot, closed: number | null) => {
    if (closed === null) return true
    const began = phase.actualEntryAt ?? phase.plannedEntryAt
    return began !== null && began > closed
  }

  const inService = (tenantId: string, batchId: string, phase: PhaseSnapshot) =>
    Effect.map(lastArchivedAt(tenantId, batchId), (closed) => beganAfter(phase, closed))

  /** the same answer as effectivePhaseIndex, for a page of rounds at once */
  const effectiveIndexOf = (
    status: string,
    plan: PhasePlan,
    now: EpochMillis,
    closed: number | null,
  ) => {
    if (status !== 'active') return null
    const state = effectiveState(plan, now)
    if (state.phase === null) return null
    return beganAfter(state.phase, closed) ? state.index : null
  }

  /**
   * Which stage is in hand, or nothing at all.
   *
   * One answer for the gate, the timeline and whatever asks next. A draft has
   * not begun; an archived round is over; a round reopened for a date still
   * to come is between stages until that date arrives - and none of those is
   * "the last stage it ran", which is what a plan read on its own says.
   */
  const effectivePhaseIndex = (
    tenantId: string,
    batch: BatchRow,
    plan: PhasePlan,
    now: EpochMillis,
  ) =>
    Effect.gen(function* () {
      if (batch.status !== 'active') return null
      const state = effectiveState(plan, now)
      if (state.phase === null) return null
      return (yield* inService(tenantId, batch.id, state.phase)) ? state.index : null
    })

  const gateView = (tenantId: string, batch: BatchRow, now: EpochMillis) =>
    Effect.gen(function* () {
      const plan = toSnapshots(yield* listPhaseRows(tenantId, batch.id))
      const here = yield* effectivePhaseIndex(tenantId, batch, plan, now)
      if (here === null) return null
      const phase = plan[here]!
      const scopes = yield* phaseScopes(tenantId, phase.id)
      return {
        profile: phase.permissionProfile,
        itemScope: scopes.items,
        participantScope: scopes.participants,
      }
    })

  /**
   * Whether this participant can start a filing in the round now, will be
   * able to at a later stage, or has missed it.
   *
   * "Open" is a create that would go through: the stage in hand admits this
   * participant at some question they could file themselves - live, open to
   * participants, filed rather than granted - which is what `createEntry`
   * asks of one question. "Upcoming" is a stage not yet reached whose gate
   * would admit this participant, not merely one that opens filing to
   * somebody. Stages already behind the round count for nothing, including
   * the ones before an archive a reopening has not yet reached past.
   */
  const filingOf = (tenantId: string, batch: BatchRow, participantId: string, now: EpochMillis) =>
    Effect.gen(function* () {
      const plan = toSnapshots(yield* listPhaseRows(tenantId, batch.id))
      const admitting = (
        phase: PhaseSnapshot,
        scopes: { items: ReadonlySet<string>; participants: ReadonlySet<string> },
        itemId: string | undefined,
      ) =>
        gateAllows({
          code: 'assessment.entry.create',
          profile: phase.permissionProfile,
          itemScope: scopes.items,
          participantScope: scopes.participants,
          ctx: { participantId, ...(itemId === undefined ? {} : { itemId }) },
        }).allowed
      const here = yield* effectivePhaseIndex(tenantId, batch, plan, now)
      if (here !== null) {
        const phase = plan[here]!
        const scopes = yield* phaseScopes(tenantId, phase.id)
        const items = (yield* batchItemsOf(tenantId, batch.id)).filter(
          (item) =>
            item.status === 'active' &&
            item.currentRevisionId !== null &&
            itemTypes.get(item.itemType)?.interaction !== 'derived',
        )
        const revisions = yield* revisionsByIdOf(
          tenantId,
          items.map((item) => item.currentRevisionId!),
        )
        const fileable = items.filter((item) => {
          const revision = revisions.get(item.currentRevisionId!)
          return revision !== undefined && opensTo(revision.entryChannels, 'participant')
        })
        if (fileable.some((item) => admitting(phase, scopes, item.id))) return 'open' as const
      }
      // what the clock has reached, whether or not the round is in service:
      // everything after it is still to come
      const ahead = plan.slice(effectiveState(plan, now).index + 1)
      for (const phase of ahead) {
        if (!phase.permissionProfile.includes('assessment.entry.create')) continue
        const scopes = yield* phaseScopes(tenantId, phase.id)
        // a stage's questions may still be taking shape; who it admits is
        // already decided
        const [anyItem] = scopes.items
        if (admitting(phase, scopes, anyItem)) return 'upcoming' as const
      }
      return 'closed' as const
    })

  const decide = (
    view: {
      profile: readonly string[]
      itemScope: ReadonlySet<string>
      participantScope: ReadonlySet<string>
    } | null,
    code: string,
    ctx: GateContext | undefined,
  ): GateDecision =>
    gateAllows({
      code,
      profile: view === null ? null : view.profile,
      itemScope: view === null ? new Set() : view.itemScope,
      participantScope: view === null ? new Set() : view.participantScope,
      ...(ctx !== undefined ? { ctx } : {}),
    })

  /** the degraded chain check: who could act at each frozen level, today */

  /** the shared guards of every roster write, inside its transaction */
  /**
   * Admitting people to a roster, by name.
   *
   * The one path there is, whether somebody is being added for the first time
   * or let back in: where each person stands now is read, the caller's
   * authority is checked at that position, and the write itself names the
   * position it was authorized at (see insertParticipants). Readmission used
   * to skip the check entirely - so an administrator could let back in
   * somebody who had since moved to a unit they had no authority over, and
   * the round would take the new anchor as read.
   */
  const admit = (
    tenantId: string,
    batchId: string,
    userIds: readonly string[],
    as: Principal,
    reason?: string | null,
  ) =>
    Effect.gen(function* () {
      const wanted = [...new Set(userIds)]
      const admitting: { userId: string; nodeId: string }[] = []
      for (const userId of wanted) {
        const position = yield* userLivePosition(tenantId, userId)
        if (!position) return yield* new ParticipantInvalid({ reason: 'user-not-found' })
        if (!position.enabled) return yield* new ParticipantInvalid({ reason: 'user-not-eligible' })
        // the roster is what batch authority is measured against, so admitting
        // a stranger would widen it by writing a row
        if (!(yield* rbac.canAt(as, MANAGE, position.nodeId))) {
          return yield* new ParticipantInvalid({ reason: 'user-out-of-scope' })
        }
        admitting.push({ userId, nodeId: position.nodeId })
      }
      const admitted = yield* insertParticipants(tenantId, batchId, admitting, as.userId)
      yield* recordAdmissions(tenantId, batchId, admitted, as.userId, reason ?? null)
      return { admitted, wanted: wanted.length }
    })

  /**
   * The record of an admission, one line per person admitted.
   *
   * Written wherever people join a roster, and told apart by whether the row
   * was created or brought back: "joined the round" and "was let back in"
   * are different facts, and the participant row cannot hold both.
   */
  const recordAdmissions = (
    tenantId: string,
    batchId: string,
    admitted: readonly { id: string; inserted: boolean }[],
    actorId: string | null,
    reason: string | null = null,
  ) =>
    insertParticipantEvents({
      tenantId,
      batchId,
      events: admitted.map((row) => ({
        participantId: row.id,
        kind: row.inserted ? ('included' as const) : ('readmitted' as const),
      })),
      actorId,
      reason,
    })

  /**
   * A page of placement differences, as this reader may be told them.
   *
   * Where the organization has somebody now is named only when this reader
   * manages it: seeing that a member moved is theirs to see, where to is not
   * when it is somebody else's unit. Units above the reader's reach are there
   * by id without a name, on either side.
   */
  const placementDifferences = (tenantId: string, rows: readonly PlacementRow[], as: Principal) =>
    Effect.gen(function* () {
      const within = new Set<string>()
      for (const row of rows) {
        if (row.live !== null && (yield* rbac.canAt(as, MANAGE, row.live.nodeId))) {
          within.add(row.participantId)
        }
      }
      const shown = (row: PlacementRow) => (within.has(row.participantId) ? row.live : null)
      const held = yield* rbac.listAuthorizedScope(as, MANAGE)
      const nodeIds = new Set<string>()
      const typeIds = new Set<string>()
      for (const row of rows) {
        for (const snapshot of [row.frozen, shown(row)]) {
          if (snapshot === null) continue
          for (const step of snapshot.lineage) nodeIds.add(step.nodeId)
          typeIds.add(snapshot.userTypeId)
        }
      }
      const names = yield* dieQuery(withDb(reachableNodeNames(tenantId, [...nodeIds], held)))
      const types = yield* dieQuery(withDb(userTypeNames(tenantId, [...typeIds])))
      const viewOf = (snapshot: PlacementSnapshot): PlacementView => ({
        // the lineage is kept from the unit up; a reader reads from the top
        units: [...snapshot.lineage]
          .reverse()
          .map((step) => ({ id: step.nodeId, name: names.get(step.nodeId) ?? null })),
        userType: { id: snapshot.userTypeId, name: types.get(snapshot.userTypeId) ?? null },
      })
      return rows.map((row): PlacementDifference => {
        const current = shown(row)
        return {
          participantId: row.participantId,
          displayName: row.displayName,
          businessNo: row.businessNo,
          standing: row.unavailable === null ? 'changed' : 'unavailable',
          unavailable: row.unavailable,
          changes: row.live === null ? [] : placementChanges(row.frozen, row.live),
          frozen: viewOf(row.frozen),
          current: current === null ? null : viewOf(current),
          currentBeyondReach: row.live !== null && current === null,
          canSync: current !== null,
          observedFingerprint: row.unavailable === null ? row.liveFingerprint : null,
        }
      })
    })

  const rosterWriteGuards = (tenantId: string, batchId: string, as: Principal) =>
    Effect.gen(function* () {
      const locked = yield* lockBatch(tenantId, batchId)
      if (!locked) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      // A draft's roster is exactly what a draft is for. It is drawn when the
      // batch is created (§32.45), and the point of the gap before the first
      // stage is scheduled is that somebody can check it - add the person the
      // import missed, take out the one who transferred out, and start from
      // zero if the import found nobody. Only an archived round is closed.
      if (locked.status === 'archived') return yield* new BatchReadOnly()
      return locked
    })

  /**
   * Who may write the tenant's timetable templates.
   *
   * A template belongs to the tenant, not to a unit: it has no owner column
   * and no organizational scope, and every round in the tenant can be built
   * from it. Held-anywhere was the wrong shape for that - one college's
   * batch administrator could edit, and delete, what every other college
   * builds from. Only authority over the whole tenant is wide enough for
   * something that is nobody's in particular, which is the same answer the
   * roster reach gives for a round whose units are gone.
   */
  const templatePermission = (as: Principal) =>
    Effect.flatMap(rbac.listAuthorizedScope(as, MANAGE), (held) =>
      held.tenantWide
        ? Effect.void
        : Effect.fail(new AccessDenied({ reason: 'cannot manage assessment timetable templates' })),
    )

  /**
   * Whether the caller runs rounds anywhere at all, with where: the question
   * the create button, the new-batch form's options and the template list
   * all ask. Where exactly is answered where it matters - every unit a new
   * batch faces is checked on its own, and applying a template is a plan
   * write on one batch - so any reach is enough here. Writing a template is
   * a different question (templatePermission).
   */
  const roundsHeld = (as: Principal) =>
    Effect.flatMap(rbac.listAuthorizedScope(as, MANAGE), (held) =>
      runsRounds(held)
        ? Effect.succeed(held)
        : Effect.fail(new AccessDenied({ reason: 'cannot manage assessment batches' })),
    )

  /** the selection as a validated, deduplicated set of living units */
  const validateScopeSelection = (tenantId: string, ids: readonly string[]) =>
    Effect.gen(function* () {
      const wanted = [...new Set(ids)].sort()
      if (wanted.length === 0) {
        return yield* new BatchReferenceInvalid({ reference: 'scope-empty' })
      }
      const nodes = yield* nodesByIds(tenantId, wanted)
      if (nodes.length !== wanted.length) {
        return yield* new BatchReferenceInvalid({ reference: 'scope-node' })
      }
      // union semantics make a nested pair harmless and, precisely therefore,
      // confusing; refused rather than silently collapsed
      for (const a of nodes) {
        for (const b of nodes) {
          if (a.id !== b.id && (b.path === a.path || b.path.startsWith(`${a.path}.`))) {
            return yield* new BatchReferenceInvalid({ reference: 'scope-nested' })
          }
        }
      }
      return nodes
    })

  /**
   * Manage authority over every living scope node. A dangling row defines
   * nobody, so it anchors no requirement; if none survive, the fallback is
   * holding the permission at all rather than opening the batch wide.
   */
  /**
   * What this person may see of the batches: everything they administer, plus
   * everything they are actually in.
   *
   * Taking part is not a permission - a student holds none of these codes and
   * still has a round of their own to look at - so it is answered by the
   * roster and the accepted staff rather than by the authorization scope.
   */
  const viewerOf = (as: Principal) =>
    Effect.map(rbac.listAuthorizedScope(as, MANAGE), (held) => ({ held, userId: as.userId }))

  /**
   * Reading one batch, for whoever it is: its administrators, and the people
   * in it. Anything beyond reading still asks for the permission.
   */
  /** who the reader is on this batch, for the desk endpoints (§32.73) */
  const deskStandingOf = Effect.fn('Assessment.deskStandingOf')(function* (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) {
    const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
    if (!batch) return yield* new BatchNotFound()
    yield* requireBatchVisible(tenantId, batchId, as)
    const membership = yield* dieQuery(withDb(participantRowByUser(tenantId, batchId, as.userId)))
    const authority = yield* batchAuthority(tenantId, batchId, as.userId)
    return { membership, review: authority.has('assessment.review.process') }
  })

  const requireBatchVisible = Effect.fn('Assessment.requireBatchVisible')(function* (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) {
    const visible = yield* dieQuery(withDb(batchVisibleTo(tenantId, batchId, yield* viewerOf(as))))
    if (!visible) return yield* new AccessDenied({ reason: 'cannot see this batch' })
  })

  // the one roster-reach predicate, shared with the configuration-access
  // face other plugins consume - two spellings of "who manages this round"
  // is exactly the drift that made the halves disagree once already
  const requireRosterReach = rosterReachOf(rbac, withDb)

  /** administering who may work on a batch is administering the batch */
  const requireBatchAdministration = (tenantId: string, batchId: string, as: Principal) =>
    Effect.gen(function* () {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
    })

  /** this batch, as an object authority can be confined to */
  /** a zone the database reads the way its name says, or a refusal before it is stored */
  const requireKnownZone = (zone: string) =>
    Effect.flatMap(knownTimeZone(zone), (known) =>
      known
        ? Effect.void
        : Effect.fail(new BadRequest({ message: 'not a time zone the database knows' })),
    )

  const batchResource = (batchId: string) => ({
    namespace: 'assessment',
    type: 'batch',
    id: batchId,
  })

  /**
   * Every assignment the tenant currently has that could work on this batch.
   *
   * Asked of rbac rather than answered here: who holds what, where, is the
   * tenant's question, and a second implementation of it in this plugin would
   * be a second authorization system that agrees until the day one is edited.
   * Assignments confined to this batch come back too - somebody drafted in for
   * this round is an ordinary assignment that happens to name it.
   */
  const applicableAssignments = (tenantId: string, batchId: string) =>
    Effect.gen(function* () {
      // the anchors of the people in it: there is no standing scope any more,
      // and this is the only place authority over this round can come from
      const anchors = yield* dieQuery(withDb(rosterAnchors(tenantId, batchId)))
      return yield* rbac.listApplicableAssignments({
        tenantId,
        codes: [...BATCH_STAFF_CODES],
        nodeIds: anchors,
        resource: batchResource(batchId),
      })
    })

  /**
   * Accepting assignments into a batch: the whole acceptance boundary in one
   * place, used at creation and at every synchronisation afterwards.
   */
  const acceptAssignments = (
    tenantId: string,
    batchId: string,
    assignments: readonly ApplicableAssignment[],
    origin: 'inherited' | 'explicit',
    actorId: string | null,
  ) =>
    Effect.forEach(assignments, (assignment) =>
      acceptAccessSource({
        tenantId,
        batchId,
        roleAssignmentId: assignment.assignmentId,
        subjectId: assignment.userId,
        origin,
        permissions: assignment.codes,
        acceptedBy: actorId,
      }),
    )

  /**
   * Who may work on this batch, and what is left of it.
   *
   *   what the assignment still carries  ∩  what this batch accepted  −  denies
   *
   * The first term is why withdrawing a role takes effect everywhere at once;
   * the second is why granting one does not. Nothing here consults the phase:
   * that narrows what may be done today, not who may do it at all.
   */
  const readAccess = Effect.fn('Assessment.readAccess')(function* (
    tenantId: string,
    batchId: string,
    subjectIds?: readonly string[],
  ) {
    const [sources, denies, assignments] = yield* Effect.all([
      dieQuery(withDb(accessSources(tenantId, batchId, subjectIds))),
      dieQuery(withDb(accessDenies(tenantId, batchId))),
      applicableAssignments(tenantId, batchId),
    ])
    const live = new Map(assignments.map((row) => [row.assignmentId, row]))
    const names = new Map(
      (yield* dieQuery(
        withDb(namesOf(tenantId, [...new Set(sources.map((row) => row.subjectId))])),
      )).map((row) => [row.id, row]),
    )
    const deniedOf = (userId: string) =>
      denies.filter((row) => row.subjectId === userId).map((row) => row.permissionCode)

    const bySubject = new Map<string, AccessSourceView[]>()
    for (const source of sources) {
      const assignment = live.get(source.roleAssignmentId)
      const view: AccessSourceView = {
        sourceId: source.id,
        assignmentId: source.roleAssignmentId,
        userId: source.subjectId,
        displayName: names.get(source.subjectId)?.displayName ?? '',
        businessNo: names.get(source.subjectId)?.businessNo ?? null,
        roleId: assignment?.roleId ?? '',
        roleName: assignment?.roleName ?? '',
        origin: source.origin,
        orgNodeId: assignment?.orgNodeId ?? null,
        coverage: assignment?.coverage ?? null,
        accepted: source.accepted,
        current: source.accepted.filter((code) => assignment?.codes.includes(code) === true),
        active: assignment !== undefined,
      }
      bySubject.set(source.subjectId, [...(bySubject.get(source.subjectId) ?? []), view])
    }

    return {
      staff: [...bySubject.entries()].map(([userId, views]): AccessSubject => {
        const denied = [...new Set(deniedOf(userId))].sort()
        const offered = new Set(views.flatMap((view) => view.current))
        return {
          userId,
          displayName: views[0]!.displayName,
          businessNo: views[0]!.businessNo,
          sources: views,
          denied,
          effective: [...offered].filter((code) => !denied.includes(code)).sort(),
        }
      }),
    }
  })

  /**
   * The same list, with each row saying whether this reader may change it.
   *
   * Nobody edits their own standing: an administrator who can withdraw their
   * own authority can lock themselves out of the batch they are responsible
   * for, with nobody left to undo it. The server refuses it as well - this is
   * so nobody is offered a button that answers with a refusal.
   */
  const asSeenBy = (access: BatchAccess, as: Principal) => ({
    staff: access.staff.map((subject) => ({
      ...subject,
      manageable: subject.userId !== as.userId,
    })),
  })

  /**
   * What one person may do in this batch, before the phase gate narrows it.
   *
   * Participants are not here: being on the roster is what their capabilities
   * are made of, and five hundred students times five permissions would be two
   * and a half thousand rows saying it again.
   */
  const batchAuthority = Effect.fn('Assessment.batchAuthority')(function* (
    tenantId: string,
    batchId: string,
    userId: string,
  ) {
    const access = yield* readAccess(tenantId, batchId, [userId])
    const subject = access.staff.find((row) => row.userId === userId)
    return new Set(subject?.effective ?? [])
  })

  /**
   * What synchronising would add, and what has already fallen away.
   *
   * Only the additions need deciding. A capability the tenant withdrew stopped
   * counting the moment it was withdrawn - it is listed so the reader knows
   * why somebody lost access, not so they can approve it.
   */
  const planAccessSync = Effect.fn('Assessment.planAccessSync')(function* (
    tenantId: string,
    batchId: string,
  ) {
    const [sources, anchors, assignments] = yield* Effect.all([
      dieQuery(withDb(accessSources(tenantId, batchId))),
      dieQuery(withDb(rosterAnchors(tenantId, batchId))),
      applicableAssignments(tenantId, batchId),
    ])
    // Authority over this round can only come from the units its people
    // stand in, so a round with nobody on it has nowhere to ask. That is not
    // the same answer as "the tenant withdrew everything": read as lapses,
    // it offered a reader the button that puts the whole baseline down, over
    // an emptied roster rather than over anything anybody withdrew.
    if (anchors.length === 0) {
      return { changes: [] as AccessChange[] }
    }
    const accepted = new Map(sources.map((source) => [source.roleAssignmentId, source]))
    const names = new Map(
      (yield* dieQuery(
        withDb(
          namesOf(tenantId, [
            ...new Set([
              ...sources.map((row) => row.subjectId),
              ...assignments.map((row) => row.userId),
            ]),
          ]),
        ),
      )).map((row) => [row.id, row]),
    )
    const named = (userId: string) => names.get(userId)?.displayName ?? ''
    const business = (userId: string) => names.get(userId)?.businessNo ?? null

    const newSources = assignments
      .filter((assignment) => !accepted.has(assignment.assignmentId))
      .map((assignment): AccessChange => ({
        id: assignment.assignmentId,
        kind: 'new',
        userId: assignment.userId,
        displayName: named(assignment.userId),
        businessNo: business(assignment.userId),
        roleName: assignment.roleName,
        permissions: assignment.codes,
      }))

    const widened = assignments.flatMap((assignment): AccessChange[] => {
      const source = accepted.get(assignment.assignmentId)
      if (!source) return []
      const ceiling = new Set(source.accepted)
      const gained = assignment.codes.filter((code) => !ceiling.has(code))
      return gained.length === 0
        ? []
        : [
            {
              id: source.id,
              kind: 'widened',
              userId: source.subjectId,
              displayName: named(source.subjectId),
              businessNo: business(source.subjectId),
              roleName: assignment.roleName,
              permissions: gained,
            },
          ]
    })

    const lapsed = sources.flatMap((source): AccessChange[] => {
      const assignment = assignments.find((row) => row.assignmentId === source.roleAssignmentId)
      const live = new Set(assignment?.codes ?? [])
      const gone = source.accepted.filter((code) => !live.has(code))
      return gone.length === 0
        ? []
        : [
            {
              id: source.id,
              kind: 'lapsed',
              userId: source.subjectId,
              displayName: named(source.subjectId),
              businessNo: business(source.subjectId),
              roleName: assignment?.roleName ?? '',
              permissions: gone,
            },
          ]
    })

    // One order for everybody: the page a reader resumes has to be the page
    // they left, and two runs of the same comparison must agree on it.
    const rank = { new: 0, widened: 1, lapsed: 2 } as const
    const changes = [...newSources, ...widened, ...lapsed].sort(
      (left, right) =>
        rank[left.kind] - rank[right.kind] ||
        left.displayName.localeCompare(right.displayName) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    return { changes }
  })

  const authorizeAction = Effect.fn('Assessment.authorizeEntryAction')(function* (
    principal: Principal,
    code: string,
    batchId: string,
    ctx?: GateContext,
  ) {
    // Layer one: authority in THIS batch, which is not the same question
    // as authority in the tenant.
    //
    // A participant needs no grant, and could not be given one: their
    // actions are not rbac permissions at all. Being on the roster is what
    // those capabilities are made of. Everybody else holds what this batch
    // accepted from the tenant and has not taken back, or what this batch
    // granted directly.
    //
    // Which node it applies to is not asked yet: entries do not exist, so
    // there is no object to locate. When they do, the participant's frozen
    // lineage is what the scopes here get compared against.
    const held = PARTICIPANT_ACTION_CODES.includes(code as never)
      ? (yield* dieQuery(
          withDb(activeParticipantByUser(principal.tenantId, batchId, principal.userId)),
        )) !== null
      : (yield* batchAuthority(principal.tenantId, batchId, principal.userId)).has(code)
    if (!held) {
      return {
        allowed: false,
        layer: 'authority',
        reason: PARTICIPANT_ACTION_CODES.includes(code as never)
          ? 'not-participant'
          : 'permission-not-held',
      } as const
    }
    // Layer two: the phase gate.
    const batch = yield* dieQuery(withDb(oneBatch(principal.tenantId, batchId)))
    if (!batch) return yield* new BatchNotFound()
    const now = yield* Clock.currentTimeMillis
    const view = yield* dieQuery(withDb(gateView(principal.tenantId, batch, now)))
    const decision = decide(view, code, ctx)
    if (!decision.allowed) {
      return { allowed: false, layer: 'gate', reason: decision.reason } as const
    }
    // Layer three: the resource policy. Entries do not exist yet, so there
    // is no object state to guard; the slot exists so callers already
    // compose all three.
    return { allowed: true } as const
  })

  /**
   * `authorizeAction` for every participant act on every named item, priced
   * as one request: the roster once, the gate view once, then the same pure
   * `decide` per (act, item). Per item because a scoped supplementary phase
   * admits some questions and not others - a blanket answer either shuts the
   * admitted ones or opens the rest.
   */
  const participantGates = Effect.fn('Assessment.participantGates')(function* (
    principal: Principal,
    batchId: string,
    participantId: string,
    itemIds: readonly string[],
  ) {
    const member =
      (yield* dieQuery(
        withDb(activeParticipantByUser(principal.tenantId, batchId, principal.userId)),
      )) !== null
    const batch = yield* dieQuery(withDb(oneBatch(principal.tenantId, batchId)))
    if (!batch) return yield* new BatchNotFound()
    const now = yield* Clock.currentTimeMillis
    const view = yield* dieQuery(withDb(gateView(principal.tenantId, batch, now)))
    const one = (code: string, itemId: string) => {
      if (!member) return { allowed: false, layer: 'authority', reason: 'not-participant' } as const
      const decision = decide(view, code, { itemId, participantId })
      return decision.allowed
        ? ({ allowed: true } as const)
        : ({ allowed: false, layer: 'gate', reason: decision.reason } as const)
    }
    return new Map(
      itemIds.map((itemId) => [
        itemId,
        {
          create: one('assessment.entry.create', itemId),
          edit: one('assessment.entry.edit', itemId),
          submit: one('assessment.entry.submit', itemId),
          withdraw: one('assessment.entry.withdraw', itemId),
          abandon: one('assessment.entry.abandon', itemId),
          appeal: one('assessment.entry.appeal', itemId),
        },
      ]),
    )
  })

  const itemMethods = makeItemMethods({
    withDb,
    requireBatchVisible,
    requireRosterReach,
    recordConfigChange,
    parseRange,
    // the same judgment the batch capabilities and the record page use
    hasRecordAuthority: (tenantId, batchId, userId) =>
      Effect.map(batchAuthority(tenantId, batchId, userId), (authority) =>
        authority.has('assessment.entry.record'),
      ),
    catalogs: {
      itemTypes,
      calculators: scoring.calculators,
      aggregators: scoring.aggregators,
    },
  })

  // whether the phase of the moment opens a gated code, asked of nobody in
  // particular: the codes read this way decide what a screen says, not who
  // may act
  const phaseOpens = (tenantId: string, batchId: string, code: string) =>
    Effect.gen(function* () {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return false
      const now = yield* Clock.currentTimeMillis
      const view = yield* dieQuery(withDb(gateView(tenantId, batch, now)))
      return decide(view, code, undefined).allowed
    })

  const entryMethods = makeEntryMethods({
    withDb,
    authorize: authorizeAction,
    participantGates,
    phaseOpens,
    mayReviewEntry: (as, tenantId, entryId) =>
      dieQuery(withDb(mayReviewEntry({ tenantId, userId: as.userId, entryId }))),
    requireRosterReach,
    requireBatchVisible,
    parseRange,
    itemTypes,
    storage,
  })

  // the same gate every entry act passes through, asked for review.process:
  // what the queue is filtered by, and so what every count of it says too
  const reviewGate = (tenantId: string, batchId: string) =>
    Effect.gen(function* () {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return { allowed: false, reason: 'no-active-phase' } as const
      const now = yield* Clock.currentTimeMillis
      const view = yield* dieQuery(withDb(gateView(tenantId, batch, now)))
      return decide(view, 'assessment.review.process', undefined)
    })

  const reviewMethods = makeReviewMethods({
    withDb,
    authorize: authorizeAction,
    reviewGate,
    escalateGate: (tenantId, batchId) =>
      Effect.gen(function* () {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return { allowed: false, reason: 'no-active-phase' } as const
        const now = yield* Clock.currentTimeMillis
        const view = yield* dieQuery(withDb(gateView(tenantId, batch, now)))
        return decide(view, 'assessment.review.escalate', undefined)
      }),
    phaseOpens,
    rosterReach: (as, tenantId, batchId) =>
      Effect.map(Effect.result(requireRosterReach(as, tenantId, batchId)), Result.isSuccess),
    parseRange,
    itemTypes,
    storage,
  })

  const scoringMethods = makeScoringMethods({
    withDb,
    requireBatchVisible,
    requireRosterReach,
    itemTypes,
    catalogs: { aggregators: scoring.aggregators },
  })

  const attachmentMethods = makeAttachmentMethods({
    withDb,
    storage,
    rosterReach: (as, tenantId, batchId) =>
      Effect.map(Effect.result(requireRosterReach(as, tenantId, batchId)), Result.isSuccess),
    // the filing's own boundary, so material a recorder attached to an
    // administrative fact reads back to the person who attached it
    mayReadEntry: (tenantId, entryId, as) => entryMethods.mayReadEntryById(tenantId, entryId, as),
    // who may put material in at all: an active member, or staff whose
    // accepted authority includes recording on others' behalf
    uploadStanding: (tenantId, batchId, as) =>
      Effect.gen(function* () {
        const member = yield* dieQuery(
          withDb(activeParticipantByUser(tenantId, batchId, as.userId)),
        )
        if (member !== null) return true
        return (yield* batchAuthority(tenantId, batchId, as.userId)).has('assessment.entry.record')
      }),
  })

  /**
   * The recording authority and the phase gate for one question, read once
   * and answered per person - the same two layers `authorizeAction` asks,
   * without asking the database again for every row of a file.
   */
  const recordGate = Effect.fn('Assessment.recordGate')(function* (
    principal: Principal,
    batchId: string,
    itemId: string,
  ) {
    const held = (yield* batchAuthority(principal.tenantId, batchId, principal.userId)).has(
      'assessment.entry.record',
    )
    const batch = yield* dieQuery(withDb(oneBatch(principal.tenantId, batchId)))
    if (!batch) return yield* new BatchNotFound()
    const now = yield* Clock.currentTimeMillis
    const view = yield* dieQuery(withDb(gateView(principal.tenantId, batch, now)))
    return (participantId: string) => {
      if (!held) {
        return { allowed: false, layer: 'authority', reason: 'permission-not-held' } as const
      }
      const decision = decide(view, 'assessment.entry.record', { itemId, participantId })
      return decision.allowed
        ? ({ allowed: true } as const)
        : ({ allowed: false, layer: 'gate', reason: decision.reason } as const)
    }
  })

  // The tenant's word for a person's identifier heads the workbook. Read
  // through the settings service when the assembly has one; a harness
  // without it gets the term's default, which is also what a tenant that
  // never chose otherwise gets.
  const terminology = yield* Effect.serviceOption(TenantSettings)
  const businessNoLabel = (tenantId: string, locale: string) =>
    Option.isSome(terminology)
      ? terminology.value.resolveTerm(tenantId, authTerms.businessNumber, localeOf(locale))
      : Effect.succeed(authTerms.businessNumber.defaults[localeOf(locale)])

  const importMethods = makeAdministrativeImportMethods({
    withDb,
    authorize: authorizeAction,
    recordGate,
    holdsRecord: (tenantId, batchId, userId) =>
      Effect.map(batchAuthority(tenantId, batchId, userId), (authority) =>
        authority.has('assessment.entry.record'),
      ),
    storage,
    itemTypes,
    parseRange,
    businessNoLabel,
  })

  const recordMethods = administrativeRecordService({
    withDb,
    recordGate,
    holdsRecord: (tenantId, batchId, userId) =>
      Effect.map(batchAuthority(tenantId, batchId, userId), (authority) =>
        authority.has('assessment.entry.record'),
      ),
    storage,
    itemTypes,
    parseRange,
  })

  return Assessment.of({
    ...itemMethods,
    ...entryMethods,
    ...importMethods,
    previewAdministrativeRecord: recordMethods.preview,
    previewRecordDetermination: recordMethods.previewDetermination,
    recordAdministrativeBatch: recordMethods.record,
    listAdministrativeRecords: recordMethods.list,
    getAdministrativeRecord: recordMethods.detail,
    reverseAdministrativeRecord: recordMethods.reverse,
    ...reviewMethods,
    ...scoringMethods,
    ...attachmentMethods,
    createBatch: Effect.fn('Assessment.createBatch')(function* (tenantId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const nodes = yield* validateScopeSelection(tenantId, input.import.orgNodeIds)
            for (const node of nodes) yield* rbac.requireAt(as, MANAGE, node.id)
            if (input.timezone !== undefined) yield* requireKnownZone(input.timezone)
            const created = yield* insertBatch({
              tenantId,
              name: input.name,
              descriptionMd: input.descriptionMd ?? null,
              materialStart: input.materialRange.start,
              materialEnd: input.materialRange.end,
              // the system's defaults, copied in and owned by the batch from
              // here on: editing them later is this batch's business alone
              reviewReasons: DEFAULT_REVIEW_REASONS,
              ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            })
            const batchId = created.id
            yield* audit.record(BatchCreated, {
              tenantId,
              actor: { kind: 'user', userId: as.userId },
              target: { id: batchId, label: input.name },
              details: { scopeNodeCount: nodes.length },
            })
            // The one place these units are used, and the last: they are the
            // query that fills the batch's two populations, not a definition
            // it will have to be kept in step with afterwards. Who takes part
            // is the roster from here on; who may work on it is what was
            // accepted here, and both are changed by somebody deciding to.
            const nodeIds = nodes.map((node) => node.id)
            const userTypeIds = [...new Set(input.import.userTypeIds)]
            // where this round is run from, kept for as long as it exists:
            // the roster is what it has become, and a roster can empty
            yield* insertManagementAnchors(tenantId, batchId, nodeIds)
            const admitted = yield* insertParticipants(
              tenantId,
              batchId,
              yield* importCandidates(
                tenantId,
                batchId,
                nodeIds,
                userTypeIds,
                yield* rbac.listAuthorizedScope(as, MANAGE),
              ),
              as.userId,
            )
            yield* recordAdmissions(tenantId, batchId, admitted, as.userId)
            yield* insertRosterImport({
              tenantId,
              batchId,
              orgNodeIds: nodeIds,
              userTypeIds,
              importedCount: admitted.length,
              actorId: as.userId,
            })
            yield* acceptAssignments(
              tenantId,
              batchId,
              yield* rbac.listApplicableAssignments({
                tenantId,
                codes: [...BATCH_STAFF_CODES],
                nodeIds,
              }),
              'inherited',
              as.userId,
            )
            const batch = yield* oneBatch(tenantId, batchId)
            return { ...(yield* readDetail(tenantId, batch!)), manageable: true }
          }),
        ),
      ).pipe(
        translateConstraints(batchConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
    }),

    canCreateBatch: Effect.fn('Assessment.canCreateBatch')(function* (as) {
      // creating validates every unit the form chose; this only says whether
      // there is any unit at all it could choose from
      return runsRounds(yield* rbac.listAuthorizedScope(as, MANAGE))
    }),

    listUserBatches: Effect.fn('Assessment.listUserBatches')(
      function* (tenantId, userId, filter, as) {
        const viewer = yield* viewerOf(as)
        return yield* dieQuery(withDb(userBatchesPage(tenantId, userId, viewer, filter)))
      },
    ),

    listUserEntries: Effect.fn('Assessment.listUserEntries')(
      function* (tenantId, userId, filter, as) {
        const viewer = yield* viewerOf(as)
        return yield* dieQuery(withDb(userEntriesPage(tenantId, userId, viewer, filter)))
      },
    ),

    listBatches: Effect.fn('Assessment.listBatches')(function* (tenantId, filter, as) {
      const viewer = yield* viewerOf(as)
      const rows = yield* dieQuery(withDb(listBatchesPage(tenantId, viewer, filter)))
      // where each batch has got to, derived the same way the batch's own
      // timeline is: a list that says "in progress" and stops there is a list
      // nobody can read without opening every row
      const now = yield* Clock.currentTimeMillis
      const phases = yield* dieQuery(
        withDb(
          phaseRowsForBatches(
            tenantId,
            rows.map((row) => row.id),
          ),
        ),
      )
      const byBatch = groupBy(
        phases,
        (phase) => phase.batchId,
        (phase) => phase,
      )
      // one more query for the whole page rather than a different rule here:
      // a round reopened for a date still to come has nothing in hand, and a
      // list that said otherwise would contradict the round's own page
      const closures = new Map(
        (yield* dieQuery(
          withDb(
            lastArchivedFor(
              tenantId,
              rows.map((row) => row.id),
            ),
          ),
        )).map((row) => [row.batchId, row.occurredAt]),
      )
      return rows.map((row) => {
        const plan = toSnapshots(byBatch.get(row.id) ?? [])
        const here = effectiveIndexOf(row.status, plan, now, closures.get(row.id) ?? null)
        const phase = here === null ? null : plan[here]
        return {
          ...row,
          // the same derivation the batch's own page uses, so a card and the
          // page it opens never disagree about where the round has got to
          currentPhaseId: phase?.id ?? null,
          currentPhaseName: phase?.displayName ?? null,
          timeline: deriveTimeline(plan, now, here),
        }
      })
    }),

    countBatches: Effect.fn('Assessment.countBatches')(function* (tenantId, filter, as) {
      return yield* dieQuery(withDb(countBatches(tenantId, yield* viewerOf(as), filter)))
    }),

    countBatchesByStatus: Effect.fn('Assessment.countBatchesByStatus')(function* (
      tenantId: string,
      filter: { q?: string },
      as: Principal,
    ) {
      return yield* dieQuery(withDb(countBatchesByStatus(tenantId, yield* viewerOf(as), filter)))
    }),

    assertVisible: requireBatchVisible,

    /** who this reader is in the round, with the same arithmetic the acts use */
    capabilitiesFor: Effect.fn('Assessment.capabilitiesFor')(function* (
      tenantId: string,
      batchId: string,
      manageable: boolean,
      as: Principal,
    ) {
      const membership = yield* dieQuery(withDb(participantRowByUser(tenantId, batchId, as.userId)))
      const authority = yield* batchAuthority(tenantId, batchId, as.userId)
      return {
        personal: membership !== null,
        review: authority.has('assessment.review.process'),
        record: authority.has('assessment.entry.record'),
        manage: manageable,
      } satisfies BatchCapabilities
    }),

    getMyOverview: Effect.fn('Assessment.getMyOverview')(function* (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) {
      const standing = yield* deskStandingOf(tenantId, batchId, as)
      // the participant branch cannot miss its membership here, so its
      // not-found is a programming error, not an answer
      const participant =
        standing.membership === null
          ? null
          : yield* entryMethods
              .getMyEntrySummary(tenantId, batchId, as)
              .pipe(Effect.catchTag('ASSESSMENT_PARTICIPANT_NOT_FOUND', (e) => Effect.die(e)))
      const desk = standing.review
        ? yield* dieQuery(withDb(reviewerDeskOf({ tenantId, batchId, userId: as.userId })))
        : null
      // What waits in the queue is what the queue shows: while the phase
      // keeps judging closed, the queue is empty and so is this count. The
      // answered asks stay, because reading them is not judging.
      const reviewer =
        desk === null || (yield* reviewGate(tenantId, batchId)).allowed
          ? desk
          : { ...desk, pendingCount: 0, queueGroups: [] }
      return { participant, reviewer }
    }),

    listMyStanding: Effect.fn('Assessment.listMyStanding')(function* (
      tenantId: string,
      as: Principal,
    ) {
      const viewer = yield* viewerOf(as)
      const batchIds = yield* dieQuery(withDb(activeBatchIdsVisibleTo(tenantId, viewer)))
      if (batchIds.length === 0) return { items: [] }
      const filings = yield* dieQuery(
        withDb(entryCountsByBatchOf({ tenantId, userId: as.userId, batchIds })),
      )
      const waiting = new Map(
        (yield* dieQuery(
          withDb(reviewsWaitingByBatchOf({ tenantId, userId: as.userId, batchIds })),
        )).map((row) => [row.batchId, row.waiting]),
      )
      // by round and by the status the asked-about filing stands in
      const asks = new Map(
        (yield* dieQuery(
          withDb(openAskCountsByBatchOf({ tenantId, userId: as.userId, batchIds })),
        )).map((row) => [`${row.batchId}:${row.status}`, Number(row.total)]),
      )
      type Counts = Omit<MyFilings, 'filing'>
      const none: Counts = {
        toAnswer: 0,
        toFix: 0,
        draft: 0,
        rejected: 0,
        submitted: 0,
        approved: 0,
      }
      const mine = new Map<string, Counts>()
      for (const row of filings) {
        const counts = { ...(mine.get(row.batchId) ?? none) }
        // A filing whose round is asking its author for more is counted as
        // waiting on them, whatever status it stands in: an appealed claim
        // keeps its approval or refusal while its round runs (§32.21), and
        // its ask is as much the author's to answer as a first round's.
        const asked = asks.get(`${row.batchId}:${row.status}`) ?? 0
        const total = Number(row.total) - asked
        counts.toAnswer += asked
        // A refusal is its own count, not folded into 'to fix' (§32.65): it
        // has its own next steps.
        if (row.status === 'needs_revision') counts.toFix = total
        if (row.status === 'draft') counts.draft = total
        if (row.status === 'rejected') counts.rejected = total
        if (row.status === 'approved') counts.approved = total
        if (row.status === 'in_review') counts.submitted = total
        mine.set(row.batchId, counts)
      }
      // Whether the line is drawn at all is the batch's own authority to
      // answer, not the count: a judge who is caught up holds the standing
      // still, and the count alone cannot tell that from not judging here.
      // Asked per round, as the round's own desk asks it.
      const taking = new Set(
        yield* dieQuery(withDb(participatingBatchIdsOf({ tenantId, userId: as.userId, batchIds }))),
      )
      const now = yield* Clock.currentTimeMillis
      const filingFor = Effect.fn(function* (batchId: string) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        const participant = yield* dieQuery(
          withDb(activeParticipantByUser(tenantId, batchId, as.userId)),
        )
        if (!batch || participant === null) return 'closed' as const
        return yield* dieQuery(withDb(filingOf(tenantId, batch, participant.id, now)))
      })
      // Every round asks rbac its own question, so the rounds ask at once:
      // in series a reader with a dozen rounds under way waited for a dozen
      // round trips to answer a card that shows one of them.
      const items = yield* Effect.forEach(
        batchIds,
        Effect.fn(function* (batchId: string) {
          const authority = yield* batchAuthority(tenantId, batchId, as.userId)
          return {
            batchId,
            myEntries: taking.has(batchId)
              ? { ...(mine.get(batchId) ?? none), filing: yield* filingFor(batchId) }
              : null,
            // the queue's own count, so under the queue's own gate
            reviewsWaiting: authority.has('assessment.review.process')
              ? (yield* reviewGate(tenantId, batchId)).allowed
                ? (waiting.get(batchId) ?? 0)
                : 0
              : null,
          }
        }),
        { concurrency: 8 },
      )
      return { items }
    }),

    listMyActivity: Effect.fn('Assessment.listMyActivity')(function* (
      tenantId: string,
      batchId: string,
      page: { cursor?: string; limit?: string; perspective?: 'participant' | 'reviewer' },
      as: Principal,
    ) {
      const fingerprint = `me-activity:${as.userId}:${batchId}:${page.perspective ?? 'all'}`
      const key = readQueryCursor(page.cursor, fingerprint, ['timestamp', 'text', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      const standing = yield* deskStandingOf(tenantId, batchId, as)
      const perspectives = (['participant', 'reviewer'] as const).filter(
        (one) =>
          (page.perspective === undefined || page.perspective === one) &&
          (one === 'participant' ? standing.membership !== null : standing.review),
      )
      const rows = yield* dieQuery(
        withDb(
          userActivityPage({
            tenantId,
            batchId,
            userId: as.userId,
            participantId: standing.membership?.id ?? null,
            perspectives,
            after: key === undefined ? undefined : [key[0]!, key[1]!, key[2]!],
            limit: limit + 1,
          }),
        ),
      )
      const pageRows = rows.slice(0, limit)
      const last = pageRows[pageRows.length - 1]
      // the participant rows are all about the reader's own claims, and the
      // people who acted on them are kept from the reader as on every other
      // door (§32.85); the reviewer rows are the reader's own acts
      const veiled =
        standing.membership !== null &&
        (yield* reviewersVeiled(phaseOpens, {
          tenantId,
          batchId,
          subjectUserId: as.userId,
          readerUserId: as.userId,
        }))
      // each row says which claim it is, in the one projection every
      // surface shares (§32.74): parts off the claim's current version
      const summaried = yield* dieQuery(
        withDb(entrySummaryRowsOf(tenantId, [...new Set(pageRows.map((row) => row.entryId))])),
      )
      const identityOf = new Map(
        summaried.map((row) => [
          row.entryId,
          projectEntrySummary(row).map((part) => ({ label: part.label, value: part.value })),
        ]),
      )
      return {
        items: pageRows.map((row) => ({
          id: row.id,
          perspective: row.perspective,
          // the union is enforced by the mapping CASEs in the query; rows
          // whose kind fell out of them were filtered before the page
          kind: row.kind as UserActivityKind,
          entryId: row.entryId,
          itemId: row.itemId,
          itemTitle: row.itemTitle,
          subjectName: row.subjectName,
          instanceId: row.instanceId,
          actorName: unnamedUnlessOwn(veiled && row.perspective === 'participant', as.userId, row)
            .actorName,
          reason: row.reason,
          comment: row.comment,
          summary: identityOf.get(row.entryId) ?? [],
          at: row.at,
        })),
        // the cursor carries the instant as stored, not as shown: `at` is
        // rounded to milliseconds for the wire, and asking the next page
        // for rows older than a rounded-down instant skips everything in
        // between - including whatever was written alongside this row
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeQueryCursor(fingerprint, [last.cursorAt, last.source, last.id])
            : null,
      }
    }),

    getBatch: Effect.fn('Assessment.getBatch')(function* (tenantId, batchId, as) {
      // with the reader, so the row can say whether it is theirs to change:
      // asked without one it answered "no" to everybody, and every control
      // that reads it quietly disappeared
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId, yield* viewerOf(as))))
      if (!batch) return yield* new BatchNotFound()
      yield* requireBatchVisible(tenantId, batchId, as)
      const detail = yield* dieQuery(withDb(readDetail(tenantId, batch)))
      const membership = yield* dieQuery(withDb(participantRowByUser(tenantId, batchId, as.userId)))
      const authority = yield* batchAuthority(tenantId, batchId, as.userId)
      return {
        ...detail,
        capabilities: {
          personal: membership !== null,
          review: authority.has('assessment.review.process'),
          record: authority.has('assessment.entry.record'),
          manage: detail.manageable,
        } satisfies BatchCapabilities,
      }
    }),

    updateBatch: Effect.fn('Assessment.updateBatch')(function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* requireRosterReach(as, tenantId, batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()

            const before = (yield* oneBatch(tenantId, batchId))!

            const diff: Record<string, unknown> = {}
            if (input.name !== undefined && input.name !== before.name) {
              diff.name = [before.name, input.name]
            }
            if (input.descriptionMd !== undefined && input.descriptionMd !== before.descriptionMd) {
              diff.descriptionMd = [before.descriptionMd, input.descriptionMd]
            }
            if (input.timezone !== undefined && input.timezone !== before.timezone) {
              yield* requireKnownZone(input.timezone)
              diff.timezone = [before.timezone, input.timezone]
            }
            // the lists are offer, not history: events copied the label they
            // used, so editing these never rewrites anything already said
            // the service holds the same line as the wire: labels are
            // stored canonical (trimmed, non-blank, deduplicated AFTER
            // trimming), because a decision's reason arrives trimmed and is
            // matched by inclusion - a padded or blank stored label is an
            // action nobody could ever complete
            const canonicalReasons = (list: readonly string[]) => [
              ...new Set(list.map((label) => label.trim()).filter((label) => label !== '')),
            ]
            const reasonLists =
              input.reviewReasons === undefined
                ? undefined
                : {
                    reject: canonicalReasons(input.reviewReasons.reject),
                    escalate: canonicalReasons(input.reviewReasons.escalate),
                  }
            if (reasonLists !== undefined) {
              const current = readReviewReasons(before.reviewReasons)
              if (
                JSON.stringify(current) !==
                JSON.stringify({ reject: reasonLists.reject, escalate: reasonLists.escalate })
              ) {
                diff.reviewReasons = [current, reasonLists]
              }
            }
            if (input.materialRange !== undefined) {
              const current = parseRange(before.materialRange)
              if (
                current.start !== input.materialRange.start ||
                current.end !== input.materialRange.end
              ) {
                diff.materialRange = [current, input.materialRange]
                // The window is part of what makes the round's questions and
                // their evidence legal, so both are re-read under the
                // candidate range: every active item's current form (a date
                // field can end up with no legal day at all), and every live
                // entry by its own item revision's form. Whatever cannot
                // live inside the new window is named; a driver that is not
                // installed proves nothing and refuses rather than skips.
                const badItems: { itemId: string; reason: string }[] = []
                const configs = yield* currentBatchConfigs(tenantId, batchId)
                for (const row of configs) {
                  const driver = itemTypes.get(row.itemType)
                  if (driver === undefined) {
                    badItems.push({ itemId: row.itemId, reason: 'item-type-not-installed' })
                    continue
                  }
                  for (const issue of driver.configIssues?.(row.formConfig, {
                    materialRange: input.materialRange,
                  }) ?? []) {
                    badItems.push({ itemId: row.itemId, reason: issue.reason })
                  }
                }
                const live = yield* liveBatchPayloads(tenantId, batchId)
                const stranded: { entryId: string; itemId: string }[] = []
                for (const row of live) {
                  const driver = itemTypes.get(row.itemType)
                  if (driver === undefined) {
                    badItems.push({ itemId: row.itemId, reason: 'item-type-not-installed' })
                    continue
                  }
                  const decoded = yield* Effect.result(
                    driver.decodePayload(row.formConfig, row.payload, {
                      materialRange: input.materialRange,
                    }),
                  )
                  if (Result.isFailure(decoded)) {
                    stranded.push({ entryId: row.entryId, itemId: row.itemId })
                  }
                }
                if (stranded.length > 0 || badItems.length > 0) {
                  return yield* new MaterialRangeInvalid({ entries: stranded, items: badItems })
                }
              }
            }

            yield* updateBatchFields(tenantId, batchId, {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.descriptionMd !== undefined ? { descriptionMd: input.descriptionMd } : {}),
              ...(input.materialRange !== undefined
                ? {
                    materialStart: input.materialRange.start,
                    materialEnd: input.materialRange.end,
                  }
                : {}),
              ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
              ...(reasonLists !== undefined ? { reviewReasons: reasonLists } : {}),
            })

            yield* recordConfigChange(
              tenantId,
              batchId,
              locked.status,
              diff,
              as.userId,
              input.reason ?? null,
            )

            const batch = yield* oneBatch(tenantId, batchId)
            return { ...(yield* readDetail(tenantId, batch!)), manageable: true }
          }),
        ),
      ).pipe(
        translateConstraints(batchConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
    }),

    setBatchStatus: Effect.fn('Assessment.setBatchStatus')(
      function* (tenantId, batchId, input, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              const locked = yield* lockBatch(tenantId, batchId)
              if (!locked) return yield* new BatchNotFound()
              yield* requireRosterReach(as, tenantId, batchId)
              const from = locked.status
              const to = input.status
              const now = yield* Clock.currentTimeMillis

              if (input.status === 'archived') {
                if (from !== 'active') {
                  return yield* new BatchStatusInvalid({ from, to, refusal: 'wrong-status' })
                }
                const plan = toSnapshots(yield* listPhaseRows(tenantId, batchId))
                // The end of the plan is the end of the batch: the last phase
                // has no successor to bound it, so archiving is what closes its
                // interval. Reaching it means having entered it - a time in the
                // diary is not the same as having got there.
                const { state } = yield* ratifyPending(tenantId, batchId, plan, now)
                if (state.index !== plan.length - 1) {
                  return yield* new BatchStatusInvalid({
                    from,
                    to,
                    refusal: 'last-phase-not-entered',
                  })
                }
                const openRounds = yield* openRoundCountOfBatch(tenantId, batchId)
                if (openRounds > 0) {
                  return yield* new BatchStatusInvalid({
                    from,
                    to,
                    refusal: 'rounds-open',
                    openRounds,
                  })
                }
                yield* updateBatchFields(tenantId, batchId, { status: 'archived' })
                // nothing is in effect once a round is over, and a projection
                // left behind is what a later reopening would revive
                yield* setCurrentPhase(tenantId, batchId, null)
                yield* insertLifecycleEvent({
                  tenantId,
                  batchId,
                  kind: 'archived',
                  occurredAt: now,
                  actorId: as.userId,
                  reason: input.reason ?? null,
                })
              } else {
                if (from !== 'archived') {
                  return yield* new BatchStatusInvalid({ from, to, refusal: 'wrong-status' })
                }
                if (input.reason.trim() === '') {
                  return yield* new BatchStatusInvalid({ from, to, refusal: 'reason-required' })
                }
                if (input.phase.displayName.trim() === '') {
                  return yield* new BatchStatusInvalid({ from, to, refusal: 'phase-required' })
                }
                const rows = yield* listPhaseRows(tenantId, batchId)
                if (rows.length >= MAX_PLAN_PHASES) return yield* planTooLong()
                // the same rules any other phase is held to: only codes the
                // gate knows, and a time that is still ahead of the round
                const review = reviewInsertion(toSnapshots(rows), now, rows.length, {
                  phaseKey: freshPhaseKey(rows),
                  displayName: input.phase.displayName.trim(),
                  description: input.phase.description?.trim() ?? '',
                  permissionProfile: input.phase.permissionProfile ?? [],
                })
                if (review.refusals.length > 0) {
                  return yield* new PlanInvalid({ refusals: review.refusals })
                }
                if (input.plannedEntryAt !== null && input.plannedEntryAt <= now) {
                  // the word the rest of the plan already uses for this, and
                  // the only one the screen has a sentence for: a second
                  // spelling of the same refusal reached the reader as the
                  // machine key itself
                  return yield* new PlanInvalid({
                    refusals: [{ reason: 'planned-not-in-future', phaseId: null }],
                  })
                }
                const phaseId = yield* insertPhase({
                  tenantId,
                  batchId,
                  ordinal: rows.length,
                  phaseKey: freshPhaseKey(rows),
                  displayName: input.phase.displayName.trim(),
                  description: input.phase.description?.trim() ?? '',
                  // a phase opened to continue an archived round begins now:
                  // there is nothing it is waiting for
                  entryNote: '',
                  permissionProfile: input.phase.permissionProfile ?? [],
                })
                yield* updateBatchFields(tenantId, batchId, { status: 'active' })
                yield* insertLifecycleEvent({
                  tenantId,
                  batchId,
                  kind: 'reopened',
                  occurredAt: now,
                  actorId: as.userId,
                  reason: input.reason.trim(),
                })
                if (input.plannedEntryAt === null) {
                  // reopening now: the new phase starts where the archive ended
                  yield* setPhaseActual(tenantId, phaseId, now)
                  yield* insertPhaseEvent({
                    tenantId,
                    phaseId,
                    kind: 'entered',
                    actualAt: now,
                    processedAt: now,
                    actorId: as.userId,
                    reason: input.reason.trim(),
                  })
                  yield* setCurrentPhase(tenantId, batchId, phaseId)
                } else {
                  yield* updatePhaseFields(tenantId, phaseId, {
                    plannedEntryAt: input.plannedEntryAt,
                  })
                  yield* insertPhaseEvent({
                    tenantId,
                    phaseId,
                    kind: 'scheduled',
                    plannedAt: input.plannedEntryAt,
                    actorId: as.userId,
                  })
                }
              }

              // Archiving closes every door in the round and reopening opens
              // a new one; either way every screen already open is offering
              // acts the round no longer permits. It was the one
              // phase-affecting write here that said nothing.
              // Archiving closes every door in the round and reopening opens
              // a new one; either way every screen already open is offering
              // acts the round no longer permits. It was the one
              // phase-affecting write here that said nothing.
              // Archiving closes every door in the round and reopening opens
              // a new one; either way every screen already open is offering
              // acts the round no longer permits. It was the one
              // phase-affecting write here that said nothing.
              yield* announce(tenantId, batchId, [
                { kind: 'phase-changed' },
                { kind: 'plan-changed' },
                { kind: 'entries-changed' },
                { kind: 'review-inbox-changed' },
                { kind: 'result-changed' },
              ])
              const batch = yield* oneBatch(tenantId, batchId)
              return { ...(yield* readDetail(tenantId, batch!)), manageable: true }
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    listAccess: Effect.fn('Assessment.listAccess')(function* (tenantId, batchId, page, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      const key = readQueryCursor(page.cursor, `access:${batchId}`, ['text', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const size = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      // one more than asked for, which is how the page knows there is another
      const found = yield* dieQuery(
        withDb(
          accessSubjectPage(tenantId, batchId, {
            ...(key !== undefined ? { after: key } : {}),
            limit: size + 1,
          }),
        ),
      )
      const subjects = found.slice(0, size)
      const access = yield* readAccess(
        tenantId,
        batchId,
        subjects.map((subject) => subject.userId),
      )
      const last = subjects.at(-1)
      // In the order the page was CUT in. The page is chosen by display name
      // and the cursor is minted from it, while the rows come back in the
      // order their sources were accepted - so a reader saw one order and
      // resumed in another, and the boundary between two pages read as rows
      // going missing.
      const at = new Map(subjects.map((subject, index) => [subject.userId, index]))
      const seen = asSeenBy(access, as)
      return {
        staff: [...seen.staff].sort(
          (one, other) => (at.get(one.userId) ?? 0) - (at.get(other.userId) ?? 0),
        ),
        nextCursor:
          found.length > size && last !== undefined
            ? encodeQueryCursor(`access:${batchId}`, [last.displayName, last.userId])
            : null,
      }
    }),

    previewAccessSync: Effect.fn('Assessment.previewAccessSync')(
      function* (tenantId, batchId, page, as) {
        yield* requireBatchAdministration(tenantId, batchId, as)
        const { changes } = yield* planAccessSync(tenantId, batchId)
        // the comparison itself is over the whole batch either way - there is
        // no partial answer to "what differs" - so the page is over its
        // result, and exists so a screen is not handed ten thousand rows
        const key = readQueryCursor(page.cursor, `access-sync:${batchId}`, ['text', 'text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const after = key === undefined ? 0 : positionAfter(changes, key)
        const size = pageSize(page.limit, DEFAULT_PAGE_SIZE)
        const items = changes.slice(after, after + size)
        const last = items.at(-1)
        return {
          items,
          nextCursor:
            after + size < changes.length && last !== undefined
              ? encodeQueryCursor(`access-sync:${batchId}`, changeKey(last))
              : null,
          pendingTotal: changes.filter((change) => change.kind !== 'lapsed').length,
          lapsedTotal: changes.filter((change) => change.kind === 'lapsed').length,
        }
      },
    ),

    applyAccessSync: Effect.fn('Assessment.applyAccessSync')(
      function* (tenantId, batchId, input, as) {
        yield* requireBatchAdministration(tenantId, batchId, as)
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              // The same lock every other write on this batch takes, and the
              // reason this one needs it: two administrators pressing sync at
              // the same moment both saw the same source as new and both
              // inserted it, and the loser met a unique index as a database
              // fault - a 500 for having been second.
              const locked = yield* lockBatch(tenantId, batchId)
              if (!locked) return yield* new BatchNotFound()
              // A closed round takes on nobody new and no more of anybody:
              // accepting would widen what it hands out the day it reopens.
              // What the organization took back still goes, below - that
              // only narrows, and it is the one way such a record ends.
              if (locked.status === 'archived' && input.accept.length > 0) {
                return yield* new BatchReadOnly()
              }
              const assignments = yield* applicableAssignments(tenantId, batchId)
              // recomputed inside the transaction rather than trusted from the
              // request: the selection says which change and how much of it, and
              // both are intersected with what the organization offers right now
              const { changes } = yield* planAccessSync(tenantId, batchId)
              const offered = new Map(
                changes
                  .filter((change) => change.kind !== 'lapsed')
                  .map((change) => [`${change.kind}/${change.id}`, change]),
              )
              const byAssignment = new Map(assignments.map((row) => [row.assignmentId, row]))
              let merged = 0
              const taken = new Set<string>()
              for (const choice of input.accept) {
                const key = `${choice.kind}/${choice.id}`
                // the same change named twice is one change, not a second
                // acceptance meeting the first at a unique index
                if (taken.has(key)) continue
                taken.add(key)
                const change = offered.get(key)
                if (!change) continue
                const chosen = new Set(choice.permissions)
                const permissions = change.permissions.filter((code) => chosen.has(code))
                if (permissions.length === 0) continue
                if (choice.kind === 'new') {
                  const assignment = byAssignment.get(choice.id)
                  if (!assignment) continue
                  yield* acceptAccessSource({
                    tenantId,
                    batchId,
                    roleAssignmentId: assignment.assignmentId,
                    subjectId: assignment.userId,
                    origin: 'inherited',
                    permissions,
                    acceptedBy: as.userId,
                  })
                } else {
                  yield* acceptPermissions(tenantId, choice.id, permissions)
                }
                merged += 1
              }
              // What the organization took back goes with it, whether or not
              // anybody ticked anything: the withdrawal is already in effect,
              // and a ceiling that outlives it would let the same capability
              // flow back unasked the day the role is handed out again. It is
              // also the only way the page stops saying so - a standing fact
              // reported as news is a notice nobody can ever put down.
              let cleared = 0
              for (const change of changes) {
                if (change.kind !== 'lapsed') continue
                yield* dropAcceptedPermissions(tenantId, change.id, change.permissions)
                cleared += 1
              }
              if (cleared > 0) {
                // an appointment this batch made is its record's to end: once
                // the record goes, nothing could ever revoke it again
                for (const assignmentId of yield* explicitAssignments(
                  tenantId,
                  batchId,
                  'emptied',
                )) {
                  yield* rbac.revokeAssignment({ tenantId, assignmentId, actorId: as.userId })
                }
                yield* dropEmptyAccessSources(tenantId, batchId)
              }
              return { merged, cleared }
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    setAccessDeny: Effect.fn('Assessment.setAccessDeny')(function* (tenantId, batchId, input, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      if (input.userId === as.userId) {
        return yield* new AccessInvalid({ reason: 'self-adjustment' })
      }
      if (!BATCH_STAFF_CODES.includes(input.permission as never)) {
        return yield* new AccessInvalid({ reason: 'permission-not-known' })
      }
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            // lifting a deny on a closed round hands a capability back for
            // the day it reopens; imposing one only narrows, and stays open
            if (locked.status === 'archived' && !input.denied) {
              return yield* new BatchReadOnly()
            }
            yield* setAccessDenyRow({
              tenantId,
              batchId,
              subjectId: input.userId,
              permissionCode: input.permission,
              denied: input.denied,
              actorId: as.userId,
              reason: input.reason ?? null,
            })
            return asSeenBy(yield* readAccess(tenantId, batchId), as)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    staffOptions: Effect.fn('Assessment.staffOptions')(function* (tenantId, batchId, request, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      const nodes = yield* dieQuery(
        withDb(batchUnits(tenantId, batchId, yield* rbac.listAuthorizedScope(as, MANAGE))),
      )
      const userIds = [...new Set(listed(request.userIds ?? []))]
      const orgNodeIds = [...new Set(listed(request.orgNodeIds ?? []))]
      // every pair below is its own authorization question, and the write
      // refuses a selection this large anyway: answering it was work for
      // nothing, a few database reads per pair
      if (userIds.length * orgNodeIds.length > MAX_STAFF_PAIRS) {
        return yield* new AccessInvalid({ reason: 'too-many' })
      }
      if (userIds.length === 0 || orgNodeIds.length === 0) return { nodes, roles: [] }
      // every unit has to be one of this round's own, or bringing somebody in
      // would be a way of handing out authority anywhere in the tenant
      if (!orgNodeIds.every((id) => nodes.some((node) => node.id === id))) {
        return { nodes, roles: [] }
      }
      // Every pair, because the write is every pair and it is all or nothing.
      // A role is offered only where it would be accepted for the whole
      // selection; anywhere it would not, the first refusal is the one shown,
      // since that is the one somebody has to resolve first.
      const refusals = new Map<string, { name: string; refusal: RoleRefusal }>()
      for (const userId of userIds) {
        for (const orgNodeId of orgNodeIds) {
          const grantable = yield* rbac.listGrantableRoles({
            tenantId,
            actor: as,
            userId,
            orgNodeId,
          })
          const offered = new Set(grantable.map((role) => role.id))
          for (const role of grantable) {
            const held = refusals.get(role.id)
            if (held === undefined) {
              refusals.set(role.id, { name: role.name, refusal: role.refusal })
              continue
            }
            if (held.refusal === null) held.refusal = role.refusal
          }
          // a role this pair was not offered at all is unavailable for the
          // selection, whatever another pair had to say about it
          for (const [roleId, held] of refusals) {
            if (!offered.has(roleId) && held.refusal === null) held.refusal = 'unavailable'
          }
        }
      }
      // and one more rule of this domain's own: a batch may only hand out
      // what a batch may hand out. A role reaching past that is shown and
      // refused rather than hidden, like the ones rbac refused.
      const roles: { id: string; name: string; refusal: RoleRefusal }[] = []
      for (const [id, held] of refusals) {
        if (held.refusal !== null) {
          roles.push({ id, name: held.name, refusal: held.refusal })
          continue
        }
        const carried = yield* rbac.getRolePermissions(tenantId, id)
        const delegatable =
          carried.length > 0 && carried.every((code) => BATCH_STAFF_CODES.includes(code as never))
        roles.push({ id, name: held.name, refusal: delegatable ? null : 'beyond-batch' })
      }
      return { nodes, roles }
    }),

    addStaff: Effect.fn('Assessment.addStaff')(function* (tenantId, batchId, input, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      const now = yield* Clock.currentTimeMillis
      if (input.validUntil !== undefined && input.validUntil <= now) {
        return yield* new AccessInvalid({ reason: 'expiry-in-past' })
      }
      // The pairs are what this costs, and the two lists are bounded
      // separately, so their product is not. Refused before anything is
      // read: every pair becomes an assignment written inside one
      // transaction, and a request nobody can finish holds the tenant
      // against everybody else while it tries.
      const pairs = new Set(input.userIds).size * new Set(input.orgNodeIds).size
      if (pairs > MAX_STAFF_PAIRS) return yield* new AccessInvalid({ reason: 'too-many' })
      // The role decides what they may do, so the role is what is checked.
      // Anything a batch is not allowed to hand out at all - administering the
      // batch, administering this very list - makes the whole role ineligible
      // rather than being quietly dropped from it.
      const carried = yield* rbac.getRolePermissions(tenantId, input.roleId)
      if (carried.length === 0) return yield* new AccessInvalid({ reason: 'role-not-usable' })
      for (const code of carried) {
        if (!BATCH_STAFF_CODES.includes(code as never)) {
          return yield* new AccessInvalid({ reason: 'permission-not-delegatable' })
        }
      }
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            // the lock every write on this batch takes, and the status read
            // under it: a closed round appoints nobody
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const nodes = yield* nodesByIds(tenantId, input.orgNodeIds)
            if (nodes.length !== new Set(input.orgNodeIds).size) {
              return yield* new AccessInvalid({ reason: 'node-not-found' })
            }
            const people = yield* namesOf(tenantId, input.userIds)
            if (people.length !== new Set(input.userIds).size) {
              return yield* new AccessInvalid({ reason: 'user-not-found' })
            }
            // The batch's own question, and the only one this module still
            // answers: is this a unit the round is actually in. Otherwise
            // staffing a batch is a way of granting authority anywhere in
            // the tenant. Everything about WHO may hand WHAT to WHOM -
            // grant-manage reach, the appointment rules, eligibility, the
            // no-escalation measure, nobody appointing themselves - runs
            // inside rbac when the grant is created, the same path every
            // org-side grant walks (§CLAUDE 访问模型).
            const units = yield* batchUnits(
              tenantId,
              batchId,
              yield* rbac.listAuthorizedScope(as, MANAGE),
            )
            for (const orgNodeId of new Set(input.orgNodeIds)) {
              if (!units.some((unit) => unit.id === orgNodeId)) {
                return yield* new AccessInvalid({ reason: 'node-out-of-batch' })
              }
            }
            // What already stands, asked before anything is written. The
            // unique index would catch it, but as a constraint violation the
            // port turns into a refusal of authority - so an administrator
            // who may do this, and whose only mistake is that it is already
            // done, was told they were not allowed to.
            const standing = yield* rbac.listApplicableAssignments({
              tenantId,
              codes: [...BATCH_STAFF_CODES],
              nodeIds: [...new Set(input.orgNodeIds)],
              resource: batchResource(batchId),
            })
            const alreadyHeld = new Set(
              standing
                .filter(
                  (held) =>
                    held.resourceId === batchId &&
                    held.roleId === input.roleId &&
                    held.coverage === 'subtree',
                )
                .map((held) => `${held.userId}:${held.orgNodeId}`),
            )
            for (const userId of new Set(input.userIds)) {
              for (const orgNodeId of new Set(input.orgNodeIds)) {
                if (alreadyHeld.has(`${userId}:${orgNodeId}`)) {
                  return yield* new AccessInvalid({ reason: 'already-staffed' })
                }
              }
            }
            // Every pair, in one transaction: half of a request nobody
            // finished is worse than none of it, because what is missing is
            // invisible next to what went in.
            for (const userId of new Set(input.userIds)) {
              for (const orgNodeId of new Set(input.orgNodeIds)) {
                // One act, two records: the tenant's assignment, confined to
                // this batch, and this batch accepting exactly what it carries
                // today. Even here the ceiling is written down - a shared
                // reviewer role that gains a capability next month must not
                // widen this round.
                const assignmentId = yield* rbac.createScopedAssignment({
                  tenantId,
                  subjectId: userId,
                  roleId: input.roleId,
                  orgNodeId,
                  includeDescendants: true,
                  resource: batchResource(batchId),
                  ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
                  actor: as,
                })
                yield* acceptAccessSource({
                  tenantId,
                  batchId,
                  roleAssignmentId: assignmentId,
                  subjectId: userId,
                  origin: 'explicit',
                  permissions: carried,
                  acceptedBy: as.userId,
                })
              }
            }
            return asSeenBy(yield* readAccess(tenantId, batchId), as)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    removeStaff: Effect.fn('Assessment.removeStaff')(function* (tenantId, batchId, sourceId, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            // Open on a closed round too. It only narrows, and an appointment
            // this batch made can be revoked nowhere else: refusing it here
            // would leave the grant standing for as long as the archive does.
            const source = yield* oneAccessSource(tenantId, batchId, sourceId)
            if (!source) return yield* new AccessInvalid({ reason: 'source-not-found' })
            if (source.subjectId === as.userId) {
              return yield* new AccessInvalid({ reason: 'self-adjustment' })
            }
            // Only what this batch handed out itself. An inherited assignment
            // belongs to the tenant: the batch can refuse what it offers, and
            // that is what a deny is for.
            if (source.origin !== 'explicit') {
              return yield* new AccessInvalid({ reason: 'source-not-explicit' })
            }
            yield* rbac.revokeAssignment({
              tenantId,
              assignmentId: source.roleAssignmentId,
              actorId: as.userId,
            })
            yield* dropAccessSource(tenantId, source.id)
            return asSeenBy(yield* readAccess(tenantId, batchId), as)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    deleteBatch: Effect.fn('Assessment.deleteBatch')(function* (tenantId, batchId, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* requireRosterReach(as, tenantId, batchId)
            const from = locked.status
            // Only a draft, which is exactly the batch that never ran: the
            // first schedule takes it out of draft, and withdrawing that
            // schedule is how somebody gets back here. Everything on it is
            // configuration - names, descriptions, permissions, a template
            // somebody applied - and none of it is anybody's history.
            if (from !== 'draft') {
              return yield* new BatchStatusInvalid({
                from,
                to: 'deleted',
                refusal: 'already-started',
              })
            }
            const entered = (yield* listPhaseRows(tenantId, batchId)).some(
              (row) => row.actualEntryAt !== null,
            )
            if (entered) {
              return yield* new BatchStatusInvalid({
                from,
                to: 'deleted',
                refusal: 'already-started',
              })
            }
            // The appointments this batch made go with it. Their records
            // are removed with the batch, and a grant bound to a batch that
            // no longer exists could not be revoked by anybody afterwards -
            // while it kept its role from being deleted and its holder from
            // changing type.
            for (const assignmentId of yield* explicitAssignments(tenantId, batchId, 'all')) {
              yield* rbac.revokeAssignment({ tenantId, assignmentId, actorId: as.userId })
            }
            yield* deleteBatchRow(tenantId, batchId)
            yield* audit.record(BatchDeleted, {
              tenantId,
              actor: { kind: 'user', userId: as.userId },
              target: { id: batchId },
              details: {},
            })
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    getPlan: Effect.fn('Assessment.getPlan')(function* (tenantId, batchId, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      return yield* dieQuery(withDb(readPlan(tenantId, batchId)))
    }),

    replacePlan: Effect.fn('Assessment.replacePlan')(function* (tenantId, batchId, body, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* requireRosterReach(as, tenantId, batchId)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const draft = locked.status === 'draft'
            const rows = yield* readPlan(tenantId, batchId)
            const existingById = new Map(rows.map((row) => [row.id, row]))
            const participants = yield* batchParticipantIds(tenantId, batchId)
            const batchItems = yield* batchItemIds(tenantId, batchId)
            const now = yield* Clock.currentTimeMillis
            const actorId = as.userId

            if (body.fromTemplateId !== undefined) {
              // application is a copy with provenance; only a plan nobody
              // lives in yet may be replaced wholesale
              if (!draft) {
                return yield* new PlanInvalid({
                  refusals: [{ reason: 'template-requires-draft', phaseId: null }],
                })
              }
              const template = yield* oneTemplate(tenantId, body.fromTemplateId)
              if (!template) return yield* new TemplateNotFound()
              // a phase template describes one phase's options, not a plan;
              // only a timeline may replace the timeline
              if (template.kind !== 'timeline') {
                return yield* new PlanInvalid({
                  refusals: [{ reason: 'template-not-a-timeline', phaseId: null }],
                })
              }
              // a timeline template adds its phases to the end of the plan,
              // unscheduled: it says which business states usually follow one
              // another, never when this batch reaches them (32.41)
              const added = template.phases as unknown as readonly PhaseSpecInput[]
              // each template fits on its own; appended to what is already
              // there, it may not
              if (rows.length + added.length > MAX_PLAN_PHASES) return yield* planTooLong()
              const review = reviewPlan(added.map(specToEngine))
              if (review.refusals.length > 0) {
                return yield* new PlanInvalid({ refusals: review.refusals })
              }
              // the existing rows are re-stated only to hold their places
              // ahead of the appended ones; what this projection leaves out
              // keeps the value already stored (specOver), because appending
              // a template is not an edit of the phases already there
              const kept = rows.map((row): PhaseSpecInput => ({
                id: row.id,
                phaseKey: row.phaseKey,
                displayName: row.displayName,
                description: row.description,
                permissionProfile: row.permissionProfile,
              }))
              yield* writePlanOrder(tenantId, batchId, [...kept, ...added], existingById, {
                events: false,
                actorId,
                provenance: template,
              })
              yield* announce(tenantId, batchId, [{ kind: 'plan-changed' }])
              const phases = yield* readPlan(tenantId, batchId)
              return { phases, warnings: review.warnings }
            }

            const specs = body.specs ?? []
            // whichever way the plan is written, what it holds afterwards is
            // what was submitted
            if (specs.length > MAX_PLAN_PHASES) return yield* planTooLong()
            // A whole-plan write restates every phase, so one composed over a
            // plan somebody has since changed would put the old plan back:
            // their new phase deleted, a stage's actions reverted, and nobody
            // told. The editor names the plan it started from.
            if (
              body.expectedFingerprint !== undefined &&
              body.expectedFingerprint !== planFingerprintOf(rows)
            ) {
              return yield* new PlanInvalid({
                refusals: [{ reason: 'plan-changed', phaseId: null }],
              })
            }
            const unknown = specs.find(
              (spec) => spec.id !== undefined && !existingById.has(spec.id),
            )
            if (unknown) {
              return yield* new PlanInvalid({
                refusals: [{ reason: 'phase-not-found', phaseId: unknown.id! }],
              })
            }
            // One phase, named twice. writePlanOrder finalizes ordinals by
            // spec index, so the second mention overwrites the first and the
            // row lands wherever it was last named - past rows that were
            // never scheduled, which is the corrupt shape normalizePlan
            // refuses to read. Naming each phase once is also what makes the
            // prefix comparison below total: every committed id is present,
            // present once, and the first ones are in their committed order.
            const named = new Set<string>()
            const duplicated: PlanRefusal[] = []
            for (const [index, spec] of specs.entries()) {
              if (spec.id === undefined) continue
              if (named.has(spec.id))
                duplicated.push({ reason: 'phase-duplicated', phaseId: spec.id, index })
              named.add(spec.id)
            }
            if (duplicated.length > 0) return yield* new PlanInvalid({ refusals: duplicated })

            if (draft) {
              // a draft plan is replaced as a whole: ids are kept where
              // given, rows absent from the submission go away
              const review = reviewPlan(specs.map(specToEngine))
              const scoped = scopeRefusals(specs, existingById, participants, batchItems, new Set())
              if (review.refusals.length + scoped.length > 0) {
                return yield* new PlanInvalid({ refusals: [...review.refusals, ...scoped] })
              }
              const submitted = new Set(
                specs.flatMap((spec) => (spec.id !== undefined ? [spec.id] : [])),
              )
              yield* deletePhases(
                tenantId,
                batchId,
                [...existingById.keys()].filter((id) => !submitted.has(id)),
              )
              yield* writePlanOrder(tenantId, batchId, specs, existingById, {
                events: false,
                actorId,
              })
              // the timetable was restructured; same wake-up as a schedule
              // edit, because the same readers hold the same stale answer
              yield* announce(tenantId, batchId, [{ kind: 'plan-changed' }])
              const phases = yield* readPlan(tenantId, batchId)
              return { phases, warnings: review.warnings }
            }

            // Active: a surgical diff. Nothing is removed or reordered,
            // triggers and keys hold still; fields change and phases insert
            // under the engine's rules, reviewed against the plan as it
            // becomes.
            const refusals: PlanRefusal[] = []
            const warnings: EditWarning[] = []
            const submittedIds = specs.flatMap((spec) => (spec.id !== undefined ? [spec.id] : []))
            // structure is free where nothing has been promised: the phases
            // that carry a time keep their order and their existence, and the
            // unscheduled suffix behind them may be rewritten at will (32.41)
            const committed = rows.filter(
              (row) => row.actualEntryAt !== null || row.plannedEntryAt !== null,
            )
            for (const row of committed) {
              if (!submittedIds.includes(row.id)) {
                refusals.push({ reason: 'phase-removed', phaseId: row.id })
              }
            }
            const committedIds = committed.map((row) => row.id)
            // the scheduled phases keep their order and their place at the
            // front. Comparing them only against each other let an unscheduled
            // row be interleaved among them, and writePlanOrder then wrote the
            // ordinals as submitted: the result is a plan normalizePlan calls
            // corrupt, which kills every read of the batch and of every list
            // it appears in, and which this endpoint can no longer be used to
            // repair. So the refusal has to come before the write.
            if (
              JSON.stringify(submittedIds.slice(0, committedIds.length)) !==
              JSON.stringify(committedIds)
            ) {
              refusals.push({ reason: 'reorder-not-allowed', phaseId: null })
            }
            if (refusals.length > 0) return yield* new PlanInvalid({ refusals })

            const effective = effectiveState(toSnapshots(rows), now)
            const endedIds = new Set(
              rows.filter((_, index) => index < effective.index).map((row) => row.id),
            )
            refusals.push(...scopeRefusals(specs, existingById, participants, batchItems, endedIds))

            let working = toSnapshots(rows)
            for (const [index, spec] of specs.entries()) {
              if (spec.id !== undefined) {
                const existing = existingById.get(spec.id)!
                if (spec.phaseKey !== existing.phaseKey) {
                  refusals.push({ reason: 'phase-key-immutable', phaseId: spec.id })
                }
                for (const edit of fieldEditsOf(existing, spec)) {
                  const review = reviewPlanEdit(working, now, edit)
                  refusals.push(...review.refusals)
                  warnings.push(...review.warnings)
                  if (review.refusals.length === 0) working = applyToPlan(working, edit)
                }
              } else {
                const engineSpec = specToEngine(spec)
                const review = reviewInsertion(working, now, index, engineSpec)
                refusals.push(...review.refusals.map((refusal) => ({ ...refusal, index })))
                warnings.push(...review.warnings.map((warning) => ({ ...warning, index })))
                if (review.refusals.length === 0) {
                  working = [
                    ...working.slice(0, index),
                    {
                      id: `#inserted-${index}`,
                      ordinal: index,
                      phaseKey: engineSpec.phaseKey,
                      displayName: engineSpec.displayName,
                      description: engineSpec.description ?? '',
                      entryNote: engineSpec.entryNote ?? '',
                      plannedEntryAt: null,
                      actualEntryAt: null,
                      permissionProfile: engineSpec.permissionProfile ?? [],
                    },
                    ...working.slice(index),
                  ]
                }
              }
            }
            if (refusals.length > 0) return yield* new PlanInvalid({ refusals })

            // rows dropped from the unscheduled suffix go away, the way they
            // do in a draft: nothing was promised about them
            const kept = new Set(submittedIds)
            yield* deletePhases(
              tenantId,
              batchId,
              rows.flatMap((row) => (kept.has(row.id) ? [] : [row.id])),
            )
            yield* writePlanOrder(tenantId, batchId, specs, existingById, {
              events: true,
              actorId,
            })

            // a plan change on an active batch is a configuration change:
            // one event, one counter move, same door as every other config
            const editedIds = specs.flatMap((spec) => {
              if (spec.id === undefined) return []
              const existing = existingById.get(spec.id)!
              const over = specOver(spec, existing)
              const fieldsChanged = fieldEditsOf(existing, spec).length > 0
              const scopesChanged =
                JSON.stringify(over.itemScope) !== JSON.stringify(existing.itemScope) ||
                JSON.stringify(over.participantScope) !== JSON.stringify(existing.participantScope)
              return fieldsChanged || scopesChanged ? [spec.id] : []
            })
            const insertedKeys = specs.flatMap((spec) =>
              spec.id === undefined ? [spec.phaseKey] : [],
            )
            if (editedIds.length + insertedKeys.length > 0) {
              yield* recordConfigChange(
                tenantId,
                batchId,
                locked.status,
                { phasePlan: { edited: editedIds, inserted: insertedKeys } },
                actorId,
                null,
              )
            }
            yield* announce(tenantId, batchId, [{ kind: 'plan-changed' }])
            const phases = yield* readPlan(tenantId, batchId)
            return { phases, warnings }
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    /**
     * Commits or withdraws one phase's time. The plan's shape does the
     * deciding: a time may only be committed to the first phase that has
     * none, and only withdrawn from the last that has one - so the plan is
     * always an entered prefix, a scheduled prefix and an unscheduled
     * suffix, which is a sentence a screen can say out loud (32.41).
     */
    schedulePhase: Effect.fn('Assessment.schedulePhase')(
      function* (tenantId, batchId, phaseId, plannedEntryAt, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              const locked = yield* lockBatch(tenantId, batchId)
              if (!locked) return yield* new BatchNotFound()
              yield* requireRosterReach(as, tenantId, batchId)
              if (locked.status === 'archived') return yield* new BatchReadOnly()
              const now = yield* Clock.currentTimeMillis
              const plan = toSnapshots(yield* listPhaseRows(tenantId, batchId))
              if (!plan.some((phase) => phase.id === phaseId)) return yield* new PhaseNotFound()
              // the clock first, so a boundary that already fired is history
              // rather than something still being scheduled
              yield* ratifyPending(tenantId, batchId, plan, now)
              const current = toSnapshots(yield* listPhaseRows(tenantId, batchId))
              const review = reviewPlanEdit(current, now, {
                kind: 'set-planned',
                phaseId,
                plannedEntryAt,
              })
              if (review.refusals.length > 0) {
                return yield* new PlanInvalid({ refusals: review.refusals })
              }
              // The first time somebody puts a phase in the diary, the batch
              // stops being a draft. Nothing is created here: the roster and
              // the access baseline were settled when the batch was created,
              // so this only checks that there is somebody to enroll and puts
              // the batch into service.
              if (locked.status === 'draft' && plannedEntryAt !== null) {
                if ((yield* rosterAnchors(tenantId, batchId)).length === 0) {
                  return yield* new BatchNoParticipants()
                }
                yield* updateBatchFields(tenantId, batchId, { status: 'active' })
              }
              yield* updatePhaseFields(tenantId, phaseId, { plannedEntryAt })
              yield* insertPhaseEvent({
                tenantId,
                phaseId,
                kind: plannedEntryAt === null ? 'unscheduled' : 'scheduled',
                plannedAt: plannedEntryAt,
                actorId: as.userId,
              })
              // the timetable moved: screens showing it re-read, and the
              // scheduler re-aims its alarm at whatever is now next
              yield* announce(tenantId, batchId, [{ kind: 'plan-changed' }])
              // And withdrawing the last of them releases it again. Only a
              // batch that never actually entered a phase can go back: once
              // something has happened, it happened. The roster stays - a
              // draft has one too now, and throwing it away would lose
              // whatever the administrator had adjusted on it.
              if (plannedEntryAt === null && locked.status === 'active') {
                const after = yield* listPhaseRows(tenantId, batchId)
                const running = after.some(
                  (row) => row.actualEntryAt !== null || row.plannedEntryAt !== null,
                )
                if (!running) {
                  yield* updateBatchFields(tenantId, batchId, { status: 'draft' })
                }
              }
              yield* recordConfigChange(
                tenantId,
                batchId,
                locked.status,
                { phaseSchedule: { phaseId, plannedEntryAt } },
                as.userId,
                null,
              )
              return yield* readPlan(tenantId, batchId)
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    advancePhase: Effect.fn('Assessment.advancePhase')(function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* requireRosterReach(as, tenantId, batchId)
            if (locked.status === 'archived') {
              return yield* new AdvanceInvalid({ reason: 'batch-not-active' })
            }
            const now = yield* Clock.currentTimeMillis
            const plan = toSnapshots(yield* listPhaseRows(tenantId, batchId))
            const targetIndex = plan.findIndex((phase) => phase.id === input.to)
            if (targetIndex === -1) return yield* new PhaseNotFound()
            const target = plan[targetIndex]!
            // Starting the first phase by hand is the other half of the same
            // commitment a first schedule makes: the batch runs from here.
            // What it runs on - the roster, the access baseline - has existed
            // since it was created.
            if (locked.status === 'draft') {
              if (targetIndex !== 0) {
                return yield* new AdvanceInvalid({ reason: 'batch-not-active' })
              }
              if ((yield* rosterAnchors(tenantId, batchId)).length === 0) {
                return yield* new AdvanceInvalid({ reason: 'batch-not-active' })
              }
              yield* updateBatchFields(tenantId, batchId, { status: 'active' })
            }

            // the clock's crossings are ratified first, so "next" means next
            const { state } = yield* ratifyPending(tenantId, batchId, plan, now)
            if (targetIndex !== state.index + 1) {
              return yield* new AdvanceInvalid({ reason: 'target-not-next' })
            }
            // entering a phase that has a time by hand overrides its own
            // clock; that is the forced path, and it must say why. An
            // unscheduled phase has promised nobody anything, so entering it
            // now is simply how a batch is moved along
            if (target.plannedEntryAt !== null && input.force !== true) {
              return yield* new AdvanceInvalid({ reason: 'force-required' })
            }
            if (input.force === true) {
              // Measured the way managing the round is: over the units it
              // is run from and the place everybody on it stood when they
              // were taken on. Asked of each unit's live position instead,
              // one unit moved to another college mid-round left the
              // administrators who still ran the round unable to force it.
              // A round with no units and nobody on it is nobody's in
              // particular, so only authority over the whole tenant reaches
              // it - never "holds the permission somewhere".
              const held = yield* rbac.listAuthorizedScope(as, FORCE_ADVANCE)
              if (!((yield* batchWithinReach(tenantId, batchId, held)) ?? held.tenantWide)) {
                return yield* new AccessDenied({ reason: FORCE_ADVANCE })
              }
              if (input.reason === undefined || input.reason.trim() === '') {
                return yield* new AdvanceInvalid({ reason: 'reason-required' })
              }
            }

            yield* setPhaseActual(tenantId, target.id, now)
            yield* insertPhaseEvent({
              tenantId,
              phaseId: target.id,
              kind: 'entered',
              actualAt: now,
              processedAt: now,
              actorId: as.userId,
              reason: input.reason ?? null,
            })
            yield* setCurrentPhase(tenantId, batchId, target.id)
            yield* announce(tenantId, batchId, [{ kind: 'phase-changed' }])

            return yield* readPlan(tenantId, batchId)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    timeline: Effect.fn('Assessment.timeline')(function* (tenantId, batchId) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      const now = yield* Clock.currentTimeMillis
      const plan = toSnapshots(yield* dieQuery(withDb(listPhaseRows(tenantId, batchId))))
      return deriveTimeline(
        plan,
        now,
        yield* dieQuery(withDb(effectivePhaseIndex(tenantId, batch, plan, now))),
      )
    }),

    gate: Effect.fn('Assessment.gate')(function* (tenantId, batchId, code, ctx) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      const now = yield* Clock.currentTimeMillis
      const view = yield* dieQuery(withDb(gateView(tenantId, batch, now)))
      return decide(view, code, ctx)
    }),

    authorizeEntryAction: authorizeAction,

    listTemplates: Effect.fn('Assessment.listTemplates')(function* (tenantId, filter, as) {
      // reading what the tenant offers is part of building a round anywhere
      // in it; only writing one is the whole tenant's business
      yield* roundsHeld(as)
      return yield* dieQuery(withDb(listTemplatesPage(tenantId, filter)))
    }),

    createTemplate: Effect.fn('Assessment.createTemplate')(function* (tenantId, input, as) {
      yield* templatePermission(as)
      if (input.phases.length > MAX_PLAN_PHASES) return yield* planTooLong()
      const kind = input.kind ?? 'timeline'
      // structural rules only; the clock is judged at application. Scopes
      // name batch-local rows, so a tenant-level template cannot carry them.
      const review = reviewPlan(input.phases.map(specToEngine))
      const scoped = templateScopeRefusals(input.phases)
      const shaped = kind === 'phase' ? phaseTemplateShapeRefusals(input.phases) : []
      if (review.refusals.length + scoped.length + shaped.length > 0) {
        return yield* new PlanInvalid({
          refusals: [...review.refusals, ...scoped, ...shaped],
        })
      }
      return yield* withDb(
        insertTemplate({ tenantId, name: input.name, kind, phases: input.phases }),
      ).pipe(
        translateConstraints(templateConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
    }),

    updateTemplate: Effect.fn('Assessment.updateTemplate')(
      function* (tenantId, templateId, input, as) {
        yield* templatePermission(as)
        if (input.phases !== undefined) {
          if (input.phases.length > MAX_PLAN_PHASES) return yield* planTooLong()
          const existing = yield* dieQuery(withDb(oneTemplate(tenantId, templateId)))
          if (!existing) return yield* new TemplateNotFound()
          const review = reviewPlan(input.phases.map(specToEngine))
          const scoped = templateScopeRefusals(input.phases)
          const shaped = existing.kind === 'phase' ? phaseTemplateShapeRefusals(input.phases) : []
          if (review.refusals.length + scoped.length + shaped.length > 0) {
            return yield* new PlanInvalid({
              refusals: [...review.refusals, ...scoped, ...shaped],
            })
          }
        }
        const updated = yield* withDb(updateTemplateRow(tenantId, templateId, input)).pipe(
          translateConstraints(templateConstraints),
          Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        )
        if (!updated) return yield* new TemplateNotFound()
        return updated
      },
    ),

    deleteTemplate: Effect.fn('Assessment.deleteTemplate')(function* (tenantId, templateId, as) {
      yield* templatePermission(as)
      const deleted = yield* dieQuery(withDb(deleteTemplateRow(tenantId, templateId)))
      if (!deleted) return yield* new TemplateNotFound()
    }),

    getParticipant: Effect.fn('Assessment.getParticipant')(
      function* (tenantId, batchId, participantId, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        // administering the roster is the door, asked before the row is
        // looked up: a reader without reach learns nothing about who is on
        // it, not even whether an id they hold is one of them
        yield* requireRosterReach(as, tenantId, batchId)
        const participant = yield* dieQuery(
          withDb(oneParticipant(tenantId, batchId, participantId)),
        )
        if (participant === null) return yield* new ParticipantNotFound()
        return participant
      },
    ),

    listAdministrativeEntries: Effect.fn('Assessment.listAdministrativeEntries')(
      function* (tenantId, batchId, filter, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        // the same two doors the roster has: administering the round reads
        // all of it, recording on it reads what may be recorded on
        const administers = yield* Effect.match(requireRosterReach(as, tenantId, batchId), {
          onSuccess: () => true,
          onFailure: () => false,
        })
        if (!administers) {
          const records = (yield* batchAuthority(tenantId, batchId, as.userId)).has(
            'assessment.entry.record',
          )
          if (!records) yield* requireRosterReach(as, tenantId, batchId)
        }
        const rows = yield* dieQuery(
          withDb(
            listAdministrativeEntriesPage({
              tenantId,
              batchId,
              ...filter,
              ...(administers
                ? {}
                : { reach: { userId: as.userId, permissionCode: 'assessment.entry.record' } }),
            }),
          ),
        )
        if (rows.length === 0) return []
        // What each fact currently stands determined as, read through the
        // question version it was JUDGED under - never the question as it
        // stands today. A determination read through a schema it was not
        // made against is a determination misread, and three months is long
        // enough for a paper to have moved.
        const determinations = yield* dieQuery(
          withDb(
            currentRecognitionsOfEntries(
              tenantId,
              rows.map((row) => row.entryId),
            ),
          ),
        )
        const byEntry = new Map(determinations.map((one) => [one.entryId, one]))
        const revisionIds = [...new Set(rows.map((row) => row.itemRevisionId))]
        const revisions = yield* dieQuery(withDb(revisionsByIdOf(tenantId, revisionIds)))
        const fieldsOfRevision = new Map<
          string,
          readonly { readonly id: string; readonly schema: unknown }[]
        >()
        for (const [id, revision] of revisions) {
          // a revision whose plan will not read is an operational defect, not
          // a reason this page cannot be drawn: it shows the values without
          // the words for them rather than refusing the whole book
          const plan = yield* Effect.option(readScoringPlan(revision))
          const fields = plan._tag === 'Some' ? recognitionFormFields(plan.value) : null
          fieldsOfRevision.set(id, fields ?? [])
        }
        return rows.map((row): AdministrativeEntryView => {
          const determined = byEntry.get(row.entryId)
          return {
            entryId: row.entryId,
            participant: {
              id: row.participantId,
              userId: row.participantUserId,
              displayName: row.participantName,
              businessNo: row.participantBusinessNo,
            },
            item: { id: row.itemId, title: row.itemTitle },
            source: row.source,
            status: row.status,
            revision: {
              id: row.revisionId,
              payload: row.payload,
              note: row.note,
              actorId: row.actorId,
              actorName: row.actorName,
              createdAt: new Date(row.recordedAt).toISOString(),
            },
            recognition:
              determined === undefined
                ? null
                : {
                    id: determined.id,
                    itemRevisionId: row.itemRevisionId,
                    values: determined.values,
                    fields: fieldsOfRevision.get(row.itemRevisionId) ?? [],
                    source: determined.source,
                    actorName: determined.createdByName,
                    createdAt: new Date(determined.createdAt).toISOString(),
                  },
            importId: row.importId,
            operationId: row.operationId,
            cursor: [row.cursorAt, row.entryId] as const,
          }
        })
      },
    ),

    listParticipants: Effect.fn('Assessment.listParticipants')(
      function* (tenantId, batchId, filter, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        // administering the roster reads it; so does recording on it - a
        // staff member filing an administrative fact has to be able to name
        // whom it is about. The write itself still checks anchored reach.
        // Administering the roster reads all of it. Recording on it reads
        // the part the recorder may record on: the authority is anchored,
        // so the reading is anchored too - in sql, because a page filtered
        // afterwards has already read and counted everybody else's people.
        const administers = yield* Effect.match(requireRosterReach(as, tenantId, batchId), {
          onSuccess: () => true,
          onFailure: () => false,
        })
        if (!administers) {
          const records = (yield* batchAuthority(tenantId, batchId, as.userId)).has(
            'assessment.entry.record',
          )
          if (!records) yield* requireRosterReach(as, tenantId, batchId)
        }
        return yield* dieQuery(
          withDb(
            listParticipantsPage(tenantId, batchId, {
              ...filter,
              ...(administers
                ? {}
                : { reach: { userId: as.userId, permissionCode: 'assessment.entry.record' } }),
            }),
          ),
        )
      },
    ),

    listRosterUnits: Effect.fn('Assessment.listRosterUnits')(
      function* (tenantId, batchId, filter, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        // the same two ways in as the roster itself: administering it reads
        // all of it, recording on it reads the part that may be recorded on
        const administers = yield* Effect.match(requireRosterReach(as, tenantId, batchId), {
          onSuccess: () => true,
          onFailure: () => false,
        })
        if (!administers) {
          const records = (yield* batchAuthority(tenantId, batchId, as.userId)).has(
            'assessment.entry.record',
          )
          if (!records) yield* requireRosterReach(as, tenantId, batchId)
        }
        const found = yield* dieQuery(
          withDb(
            listRosterUnits(tenantId, batchId, {
              ...filter,
              ...(administers
                ? {}
                : { reach: { userId: as.userId, permissionCode: 'assessment.entry.record' } }),
            }),
          ),
        )
        return found.rows
      },
    ),

    addParticipants: Effect.fn('Assessment.addParticipants')(
      function* (tenantId, batchId, userIds, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              yield* rosterWriteGuards(tenantId, batchId, as)
              if (userIds.length === 0) return { added: 0, skipped: 0 }
              const { admitted, wanted } = yield* admit(tenantId, batchId, userIds, as)
              return { added: admitted.length, skipped: wanted - admitted.length }
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    previewImport: Effect.fn('Assessment.previewImport')(
      function* (tenantId, batchId, selection, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        yield* requireRosterReach(as, tenantId, batchId)
        for (const nodeId of selection.orgNodeIds) yield* rbac.requireAt(as, MANAGE, nodeId)
        const candidates = yield* dieQuery(
          withDb(
            importCandidates(
              tenantId,
              batchId,
              selection.orgNodeIds,
              selection.userTypeIds,
              yield* rbac.listAuthorizedScope(as, MANAGE),
            ),
          ),
        )
        return { candidates: candidates.length }
      },
    ),

    importParticipants: Effect.fn('Assessment.importParticipants')(
      function* (tenantId, batchId, selection, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              yield* rosterWriteGuards(tenantId, batchId, as)
              const nodes = yield* validateScopeSelection(tenantId, selection.orgNodeIds)
              for (const node of nodes) yield* rbac.requireAt(as, MANAGE, node.id)
              const nodeIds = nodes.map((node) => node.id)
              const userTypeIds = [...new Set(selection.userTypeIds)]
              // counted again here rather than trusted from the preview: the
              // number somebody confirmed was true when they read it, and this
              // is the run that decides
              const added = yield* insertParticipants(
                tenantId,
                batchId,
                yield* importCandidates(
                  tenantId,
                  batchId,
                  nodeIds,
                  userTypeIds,
                  yield* rbac.listAuthorizedScope(as, MANAGE),
                ),
                as.userId,
              )
              yield* recordAdmissions(tenantId, batchId, added, as.userId)
              yield* insertRosterImport({
                tenantId,
                batchId,
                orgNodeIds: nodeIds,
                userTypeIds,
                importedCount: added.length,
                actorId: as.userId,
              })
              return { added: added.length }
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    listImports: Effect.fn('Assessment.listImports')(function* (tenantId, batchId, page, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      const fingerprint = `imports:${batchId}`
      const key = readQueryCursor(page.cursor, fingerprint, ['timestamp', 'uuid'])
      if (key === null) return yield* cursorUnusable()
      const limit = pageSize(page.limit, DEFAULT_PAGE_SIZE)
      const found = yield* dieQuery(
        withDb(
          rosterImports(tenantId, batchId, {
            ...(key === undefined ? {} : { after: [key[0]!, key[1]!] as const }),
            limit: limit + 1,
          }),
        ),
      )
      const rows = found.slice(0, limit)
      const last = rows[rows.length - 1]
      // ids in, names out, and only the names this reader may see: the record
      // says what somebody once asked for, not where else the tree goes
      const held = yield* rbac.listAuthorizedScope(as, MANAGE)
      const [nodes, types] = yield* Effect.all([
        dieQuery(
          withDb(
            reachableNodeNames(tenantId, [...new Set(rows.flatMap((row) => row.orgNodeIds))], held),
          ),
        ),
        dieQuery(withDb(userTypeOptionRows(tenantId))),
      ])
      const typeNames = new Map(types.map((type) => [type.id, type.name]))
      return {
        items: rows.map((row) => ({
          id: row.id,
          units: row.orgNodeIds.flatMap((nodeId) => {
            const name = nodes.get(nodeId)
            return name === undefined ? [] : [name]
          }),
          userTypes: row.userTypeIds.flatMap((typeId) => {
            const name = typeNames.get(typeId)
            return name === undefined ? [] : [name]
          }),
          importedCount: row.importedCount,
          actorId: row.actorId,
          occurredAt: row.occurredAt,
        })),
        nextCursor:
          found.length > limit && last !== undefined
            ? encodeQueryCursor(fingerprint, [last.cursorAt, last.id])
            : null,
      }
    }),

    setParticipantStatus: Effect.fn('Assessment.setParticipantStatus')(
      function* (tenantId, batchId, participantId, to, reason, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              yield* rosterWriteGuards(tenantId, batchId, as)
              const existing = yield* oneParticipant(tenantId, batchId, participantId)
              if (!existing) return yield* new ParticipantNotFound()
              // an idempotent replacement: saying what already holds changes nothing
              if (existing.status === to) return existing
              if (to === 'active') {
                // Readmission goes through the one admission path there is,
                // so it is the same act however it was asked for: the anchor
                // and the user type are taken again from where the person
                // stands now, because the round is answerable for that from
                // here (§32.47). A person who cannot be admitted at all -
                // disabled, or standing nowhere - is not readmitted either.
                // the readmission records its own event, so nothing more is
                // written below: two entries for one act would read as two
                const { admitted } = yield* admit(
                  tenantId,
                  batchId,
                  [existing.userId],
                  as,
                  reason ?? null,
                )
                if (admitted.length === 0) {
                  return yield* new ParticipantInvalid({ reason: 'user-not-eligible' })
                }
              } else {
                yield* setParticipantStatus(
                  tenantId,
                  participantId,
                  to,
                  yield* Clock.currentTimeMillis,
                  { userId: as.userId, reason: reason ?? null },
                )
                // the row keeps the current state and loses the last one;
                // this is where both survive
                yield* insertParticipantEvents({
                  tenantId,
                  batchId,
                  events: [{ participantId, kind: 'excluded' }],
                  actorId: as.userId,
                  reason: reason ?? null,
                })
              }
              return (yield* oneParticipant(tenantId, batchId, participantId))!
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    listParticipantPlacements: Effect.fn('Assessment.listParticipantPlacements')(
      function* (tenantId, batchId, page, as) {
        yield* requireBatchAdministration(tenantId, batchId, as)
        // the comparison is over the whole roster either way - there is no
        // partial answer to "who stands elsewhere" - so the page is over its
        // result, and exists so a screen is not handed a college at once
        const found = [...(yield* dieQuery(withDb(participantPlacements(tenantId, batchId))))].sort(
          (a, b) => (comesAfter(placementKey(a), placementKey(b)) ? 1 : -1),
        )
        const fingerprint = `placements:${batchId}`
        const key = readQueryCursor(page.cursor, fingerprint, ['text', 'text', 'text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        // the first row past the key, not the row after the one it names: a
        // difference somebody settled between two pages has left the list
        const after =
          key === undefined ? 0 : found.findIndex((row) => comesAfter(placementKey(row), key))
        const from = after === -1 ? found.length : after
        const size = pageSize(page.limit, DEFAULT_PAGE_SIZE)
        const rows = found.slice(from, from + size)
        const last = rows.at(-1)
        return {
          items: yield* placementDifferences(tenantId, rows, as),
          nextCursor:
            from + size < found.length && last !== undefined
              ? encodeQueryCursor(fingerprint, placementKey(last))
              : null,
          changedTotal: found.filter((row) => row.unavailable === null).length,
          unavailableTotal: found.filter((row) => row.unavailable !== null).length,
        }
      },
    ),

    reconcileParticipantPlacements: Effect.fn('Assessment.reconcileParticipantPlacements')(
      function* (tenantId, batchId, input, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              // the same guard every roster change takes: a placement taken
              // into the round moves its routing and its ranking partition
              yield* rosterWriteGuards(tenantId, batchId, as)
              const decisions = new Map(input.decisions.map((row) => [row.participantId, row]))
              const found = new Map(
                (yield* participantPlacements(tenantId, batchId, [...decisions.keys()])).map(
                  (row) => [row.participantId, row],
                ),
              )
              const events: {
                participantId: string
                kind: 'placement-synced' | 'placement-kept'
                details: Record<string, unknown>
              }[] = []
              for (const decision of decisions.values()) {
                const row = found.get(decision.participantId)
                // not in this round, or no longer a member of it
                if (!row) return yield* new ParticipantNotFound()
                // nowhere to take them to, and nothing to have looked at
                if (row.live === null || row.liveFingerprint === null) {
                  return yield* new ParticipantInvalid({ reason: 'user-not-eligible' })
                }
                if (row.liveFingerprint !== decision.observedFingerprint) {
                  return yield* new ParticipantPlacementChanged({
                    participantId: decision.participantId,
                  })
                }
                if (decision.decision === 'sync') {
                  // managing this round is not managing wherever its people
                  // went: taking the placement in needs reach at both ends
                  if (!(yield* rbac.canAt(as, MANAGE, row.live.nodeId))) {
                    return yield* new ParticipantInvalid({ reason: 'user-out-of-scope' })
                  }
                  const written = yield* syncParticipantPlacement(
                    tenantId,
                    batchId,
                    row.participantId,
                    decision.observedFingerprint,
                  )
                  if (!written) {
                    return yield* new ParticipantPlacementChanged({
                      participantId: decision.participantId,
                    })
                  }
                  events.push({
                    participantId: row.participantId,
                    kind: 'placement-synced',
                    details: { previous: row.frozen, observed: row.live, result: row.live },
                  })
                } else {
                  const written = yield* keepParticipantPlacement(
                    tenantId,
                    batchId,
                    row.participantId,
                    decision.observedFingerprint,
                  )
                  if (!written) {
                    return yield* new ParticipantPlacementChanged({
                      participantId: decision.participantId,
                    })
                  }
                  events.push({
                    participantId: row.participantId,
                    kind: 'placement-kept',
                    details: { round: row.frozen, observed: row.live },
                  })
                }
              }
              yield* insertParticipantEvents({
                tenantId,
                batchId,
                events,
                actorId: as.userId,
                reason: input.reason ?? null,
              })
              return {
                synced: events.filter((event) => event.kind === 'placement-synced').length,
                kept: events.filter((event) => event.kind === 'placement-kept').length,
              }
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    scopeOptions: Effect.fn('Assessment.scopeOptions')(function* (tenantId, as) {
      // no separate permission: what a batch may face is what this caller may
      // manage, so the authorization scope IS the option list
      const held = yield* roundsHeld(as)
      // the whole authorized projection, uncapped. A ceiling here protected
      // nothing - org serves the same rows of the same table to the same
      // tenant with more columns and no ceiling - while costing an
      // administrator at a school of more than five hundred units the ability
      // to name their own unit: path order is pre-order, so a cut leaves a
      // coherent tree that is simply missing everything after the cut, and
      // nothing on the screen says so.
      return yield* dieQuery(withDb(scopeOptionRows(tenantId, held)))
    }),

    /**
     * What a question's configuration may point at: the tenant's unit types
     * for the review stage's level, and the active org roles that can hold
     * it. Served here so the configuration screen needs no authority over
     * the organization domain beyond running its own batch.
     */
    itemOptions: Effect.fn('Assessment.itemOptions')(function* (tenantId, batchId, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      const orgTypes = yield* dieQuery(
        withDb(
          db.query((k) =>
            k
              .selectFrom('OrgType')
              .select(['id', 'name'])
              .where('tenantId', '=', tenantId)
              .orderBy('name')
              .execute(),
          ),
        ),
      )
      const roles = yield* dieQuery(
        withDb(
          db.query((k) =>
            k
              .selectFrom('Role')
              .select(['id', 'name'])
              .where('tenantId', '=', tenantId)
              .where('kind', '=', 'org')
              .where('status', '=', 'active')
              .orderBy('name')
              .execute(),
          ),
        ),
      )
      return {
        orgTypes: orgTypes.map((row) => ({ id: row.id, name: row.name })),
        roles: roles.map((row) => ({ id: row.id, name: row.name })),
      }
    }),

    /**
     * Whether a review stage, as it is being composed, has anybody in it.
     *
     * Asked of the same definition submission and the queue ask, with a
     * subject nobody can be, so the count is "who could judge here at all"
     * rather than "who could judge this person". A level with no unit and a
     * unit with no reviewer are both answers an administrator can act on -
     * and the only moment acting is cheap is while the question is open.
     */
    reviewCoverage: Effect.fn('Assessment.reviewCoverage')(function* (
      tenantId: string,
      batchId: string,
      stage: { nodeTypeId: string; roleIds: readonly string[] },
      as: Principal,
    ) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      const nodes = yield* dieQuery(
        withDb(stageNodesOf({ tenantId, batchId, nodeTypeId: stage.nodeTypeId })),
      )
      const counted: { id: string; name: string; reviewers: number }[] = []
      for (const node of nodes) {
        const holders = yield* dieQuery(
          withDb(
            reviewersAt({
              tenantId,
              batchId,
              nodeId: node.id,
              roleIds: stage.roleIds,
              // a subject nobody is, so the self-review exclusion takes
              // nobody out of a count that is about the stage, not a filing
              subjectUserId: NOBODY,
              actorId: NOBODY,
            }),
          ),
        )
        counted.push({ id: node.id, name: node.name, reviewers: holders.length })
      }
      return { nodes: counted }
    }),

    userTypeOptions: Effect.fn('Assessment.userTypeOptions')(function* (tenantId, as) {
      yield* roundsHeld(as)
      return yield* dieQuery(withDb(userTypeOptionRows(tenantId)))
    }),

    /**
     * The patrol (§14): the one mechanism trusted to keep the queues true.
     *
     * Nothing hooks the writes that change who can review - granting a role,
     * revoking one, moving the tree, editing a policy, disabling a user -
     * because a hook missed is a round stuck forever and a hook added is
     * this logic scattered across ten write paths in two plugins. Instead
     * every open round's current stage is re-resolved on a cadence and the
     * state follows what it finds, in both directions: appoint somebody and
     * the stuck rounds wake by themselves, revoke the last holder and the
     * rounds say so. Idempotent, re-entrant, and safe beside a human doing
     * the same thing - each write is conditional on the state it read.
     */
    patrolReviewRounds: Effect.gen(function* () {
      const tenants = yield* dieQuery(withDb(tenantsWithOpenRounds))
      let blocked = 0
      let released = 0
      for (const tenantId of tenants) {
        const rounds = yield* dieQuery(withDb(openInstances(tenantId)))
        // one membership resolution per (batch, roles, node) rather than per
        // round: a class with forty waiting entries asks the same question
        // forty times. Membership only - the per-filing exclusions are per
        // round. The batch belongs in the key because membership is a batch
        // question: acceptance and denies are recorded per batch, so two
        // batches standing at the same class with the same role can hold
        // different answers, and this loop sees every batch of the tenant.
        const staffing = new Map<string, number>()
        for (const round of rounds) {
          // A round stopped at a step that resolved to no unit has nothing
          // here to ask about: membership is a question about a unit, and
          // this one has none. It is already blocked for want of an
          // assignee, and the way out is an administrator rerouting it onto
          // the current policy once somebody holds the role - which resolves
          // the step again rather than rewriting what it froze (§32.62).
          if (round.currentNodeId === null) continue
          const nodeId = round.currentNodeId
          const key = `${round.batchId}:${nodeId}:${[...round.currentRoleIds].sort().join(',')}`
          let members = staffing.get(key)
          if (members === undefined) {
            members = (yield* dieQuery(
              withDb(
                reviewersAt({
                  tenantId,
                  batchId: round.batchId,
                  nodeId,
                  roleIds: round.currentRoleIds,
                  subjectUserId: NOBODY,
                  actorId: NOBODY,
                }),
              ),
            )).length
            staffing.set(key, members)
          }
          // Who could act on this very round: the filing's own people out,
          // and on an escalation step whoever already judged an earlier one.
          // Every answer below belongs to the step this round stood on when
          // the sweep read it, so every write below names that step and
          // simply misses a round that has moved on since - the next tick
          // will look at it where it now is.
          const eligible =
            members === 0
              ? ([] as readonly string[])
              : yield* dieQuery(
                  withDb(
                    reviewersAt({
                      tenantId,
                      batchId: round.batchId,
                      nodeId,
                      roleIds: round.currentRoleIds,
                      subjectUserId: round.subjectUserId,
                      actorId: round.actorId,
                      ...(round.currentRoute === 'escalation'
                        ? { excludeJudgedOfInstanceId: round.id }
                        : {}),
                    }),
                  ),
                )
          const stage = stageById(round.effectivePolicy, round.currentRoute, round.currentStageId)
          let actionable = eligible.length > 0
          let reason = members === 0 ? 'no-assignee' : 'no-independent-reviewer'
          if (stage !== null && stage.quorum.type === 'all') {
            const panel = yield* dieQuery(
              withDb(
                openPanelOf(tenantId, round.id, {
                  route: round.currentRoute,
                  stageId: round.currentStageId,
                }),
              ),
            )
            if (panel !== null) {
              // A constituted sitting: the question is no longer "is anyone
              // eligible" but "can this sitting still complete". Seats whose
              // unvoted occupants lost standing are freed here, so the
              // vacancy is visible to whoever could fill it.
              const seats = yield* dieQuery(withDb(livePanelSeats(tenantId, panel.id)))
              const still = new Set(eligible)
              const occupied = new Set<string>()
              let workable = 0
              let held = 0
              for (const seat of seats) {
                if (seat.voted !== null) {
                  held += 1
                  occupied.add(seat.userId)
                  continue
                }
                if (still.has(seat.userId)) {
                  held += 1
                  workable += 1
                  occupied.add(seat.userId)
                  continue
                }
                const freed = yield* dieQuery(
                  withDb(
                    endPanelAssignment({
                      tenantId,
                      assignmentId: seat.assignmentId,
                      reason: 'eligibility-lost',
                    }),
                  ),
                )
                // a freeing that lost its race means the seat spoke after all
                if (!freed) {
                  held += 1
                  occupied.add(seat.userId)
                }
              }
              const vacancies = panel.seatCount - held
              const fillable = eligible.filter((one) => !occupied.has(one))
              actionable = workable > 0 || (vacancies > 0 && fillable.length > 0)
              if (members > 0) reason = 'panel-seat-unfilled'
            }
          }
          // The move and the event it is, in one transaction. Written as two
          // autocommits they could come apart: a crash in between left a
          // round blocked with nothing in its history saying why, and that
          // history is the only account the person waiting on it has.
          const moveRound = (
            from: 'active' | 'blocked',
            to: 'active' | 'blocked',
            kind: string,
            blockedReason: string | null,
          ) =>
            dieQuery(
              withDb(
                transaction(
                  Effect.gen(function* () {
                    const moved = yield* setInstanceState({
                      tenantId,
                      instanceId: round.id,
                      from,
                      to,
                      blockedReason,
                      at: { route: round.currentRoute, stageId: round.currentStageId },
                    })
                    if (!moved) return false
                    yield* insertReviewEvent({
                      tenantId,
                      reviewInstanceId: round.id,
                      kind,
                      actorId: null,
                    })
                    return true
                  }),
                ),
              ),
            )
          if (round.state === 'active' && !actionable) {
            if (yield* moveRound('active', 'blocked', 'assignee-not-found', reason)) blocked += 1
          } else if (round.state === 'blocked' && actionable) {
            if (yield* moveRound('blocked', 'active', 'assignee-found', null)) released += 1
          }
        }
      }
      return { blocked, released }
    }).pipe(Effect.withSpan('Assessment.patrolReviewRounds')),

    /** the rounds nobody can act on, as the batch's own alert panel reads them */
    reviewAlerts: Effect.fn('Assessment.reviewAlerts')(function* (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      const groups = yield* dieQuery(withDb(blockedGroups(tenantId, batchId)))
      const roleNames = yield* dieQuery(
        withDb(
          chainNames({
            tenantId,
            nodeIds: [],
            roleIds: groups.flatMap((group) => group.roleIds),
          }),
        ),
      )
      return {
        groups: groups.map((group) => ({
          nodeId: group.nodeId,
          nodeName: group.nodeName,
          roleNames: group.roleIds.map((roleId) => roleNames.roles.get(roleId) ?? roleId),
          reason: group.reason,
          waiting: group.waiting,
        })),
      }
    }),

    nextDueBoundary: withDb(nextDueBoundaryAt).pipe(
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      Effect.withSpan('Assessment.nextDueBoundary'),
    ),

    sweepDueBoundaries: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      // One candidate query, then one transaction per batch. Sweeping every
      // due batch in a single transaction would hold a lock across tenants
      // for as long as the slowest one takes; per batch, a failure costs that
      // batch this minute and nothing else.
      const candidates = yield* dieQuery(withDb(batchesWithDueBoundaries(now, SWEEP_BATCH_LIMIT)))
      let ratified = 0
      for (const candidate of candidates) {
        ratified += yield* withDb(
          transaction(
            Effect.gen(function* () {
              const locked = yield* lockBatch(candidate.tenantId, candidate.id)
              // gone or no longer active since the candidate query read it
              if (!locked || locked.status !== 'active') return 0
              const plan = toSnapshots(yield* listPhaseRows(candidate.tenantId, candidate.id))
              const swept = yield* ratifyPending(candidate.tenantId, candidate.id, plan, now)
              // the gate flipped at the planned second regardless; this tells
              // the browsers that were drawn before it did
              if (swept.ratified > 0) {
                yield* announce(candidate.tenantId, candidate.id, [{ kind: 'phase-changed' }])
              }
              return swept.ratified
            }),
          ),
        ).pipe(
          Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
          // One batch at a time, and one batch's trouble is its own. Without
          // this the loop carried the first failure out of the sweep and
          // every candidate after it - ordered by id, so the same ones every
          // tick - simply stopped having their boundaries ratified. A
          // deadline that has passed is not a thing to stay quiet about, so
          // it is logged by name and the sweep goes on.
          Effect.catchCause((cause) =>
            Effect.logError('a batch could not be swept', cause).pipe(
              Effect.annotateLogs({ tenantId: candidate.tenantId, batchId: candidate.id }),
              Effect.as(0),
            ),
          ),
        )
      }
      return { scanned: candidates.length, ratified }
    }).pipe(Effect.withSpan('Assessment.sweepDueBoundaries')),
  })
})

// The scoring boot barrier is registered by the runtime provider
// (scoring/runtime-provider.ts): its hook must close over the runtime
// catalog, and only the layer constructing that catalog can hand the value
// straight into the hook's run.
export const serviceLayer: Layer.Layer<
  Assessment,
  never,
  Orm | Rbac | Audit | ItemTypeCatalog | ScoringDefinitionCatalog | Storage | Assembled
> = Layer.effect(Assessment, make())

// --- api ---

const isoOf = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

const parseInstant = (value: string) => {
  const ms = Date.parse(value)
  return Number.isNaN(ms)
    ? Effect.fail(new BadRequest({ message: `unreadable instant: ${value}` }))
    : Effect.succeed(ms)
}

/** one of them or several: a repeated query parameter is a list either way */
const listed = (value: string | readonly string[] | undefined): string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : [...value]

/** the wire's target, with its id lists normalised to arrays */
const targetOf = (
  target:
    | { readonly kind: 'people'; readonly participantIds: string | readonly string[] }
    | {
        readonly kind: 'organization'
        readonly orgNodeIds: string | readonly string[]
        readonly userTypeIds: string | readonly string[]
      },
) =>
  target.kind === 'people'
    ? ({ kind: 'people', participantIds: listed(target.participantIds) } as const)
    : ({
        kind: 'organization',
        orgNodeIds: listed(target.orgNodeIds),
        userTypeIds: listed(target.userTypeIds),
      } as const)

const entryDto = (entry: EntryView) => ({
  id: entry.id,
  batchId: entry.batchId,
  itemId: entry.itemId,
  participantId: entry.participantId,
  status: entry.status,
  source: entry.source,
  currentRevision:
    entry.currentRevision === null
      ? null
      : {
          id: entry.currentRevision.id,
          revisionNo: entry.currentRevision.revisionNo,
          itemRevisionId: entry.currentRevision.itemRevisionId,
          payload: entry.currentRevision.payload,
          note: entry.currentRevision.note,
          source: entry.currentRevision.source,
          actorId: entry.currentRevision.actorId,
          subjectId: entry.currentRevision.subjectId,
          attachments: entry.currentRevision.attachments,
          createdAt: new Date(entry.currentRevision.createdAt).toISOString(),
        },
  currentReviewInstanceId: entry.currentReviewInstanceId,
  createdAt: new Date(entry.createdAt).toISOString(),
  openRound: entry.openRound === null ? null : { origin: entry.openRound.origin },
  recognition:
    entry.recognition === null
      ? null
      : {
          id: entry.recognition.id,
          source: entry.recognition.source,
          entryRevisionId: entry.recognition.entryRevisionId,
          fields: entry.recognition.fields.map((field) => ({
            id: field.id,
            schema: field.schema,
          })),
          values: entry.recognition.values,
          createdAt: new Date(entry.recognition.createdAt).toISOString(),
          actorName: entry.recognition.actorName,
        },
  supplement:
    entry.supplement === null
      ? null
      : {
          requestId: entry.supplement.requestId,
          instanceId: entry.supplement.instanceId,
          requestNo: entry.supplement.requestNo,
          instructions: entry.supplement.instructions,
          requirements: entry.supplement.requirements,
          requestedByName: entry.supplement.requestedByName,
          requestedAt: new Date(entry.supplement.requestedAt).toISOString(),
        },
  refusal:
    entry.refusal === null
      ? null
      : { ...entry.refusal, at: new Date(entry.refusal.at).toISOString() },
  capabilities: entry.capabilities,
})

const reviewDto = (review: ReviewDetailView) => ({
  id: review.id,
  state: review.state,
  outcome: review.outcome,
  roundNo: review.roundNo,
  entryId: review.entryId,
  batchId: review.batchId,
  itemId: review.itemId,
  itemTitle: review.itemTitle,
  participantName: review.participantName,
  businessNo: review.businessNo,
  unitName: review.unitName,
  submittedAt: new Date(review.submittedAt).toISOString(),
  completedAt: review.completedAt === null ? null : new Date(review.completedAt).toISOString(),
  revision: review.revision,
  form: review.form,
  chain: {
    route: review.chain.route,
    stageId: review.chain.stageId,
    normal: review.chain.normal.map(stageDto),
    escalation: review.chain.escalation.map(stageDto),
  },
  actions: review.actions,
  context:
    review.context === null
      ? null
      : {
          worth: review.context.worth,
          siblings: review.context.siblings,
          previous:
            review.context.previous === null
              ? null
              : {
                  roundNo: review.context.previous.roundNo,
                  kind: review.context.previous.kind,
                  reason: review.context.previous.reason,
                  comment: review.context.previous.comment,
                  actorName: review.context.previous.actorName,
                  at: new Date(review.context.previous.at).toISOString(),
                },
          previousRevision: review.context.previousRevision,
          earlier: review.context.earlier.map((one) => ({
            ...one,
            at: new Date(one.at).toISOString(),
          })),
        },
  events: review.events.map((event) => ({
    kind: event.kind,
    actorId: event.actorId,
    actorName: event.actorName,
    reason: event.reason,
    comment: event.comment,
    suggestedPayload: event.suggestedPayload,
    at: new Date(event.at).toISOString(),
  })),
  supplements: review.supplements.map(supplementDto),
  recognitionForm: review.recognitionForm,
  capabilities: review.capabilities,
})

/** one step of a route on the wire; only the times change shape */
const stageDto = (stage: ReviewDetailView['chain']['normal'][number]) => ({
  ...stage,
  opinions:
    stage.opinions === null
      ? null
      : stage.opinions.map((opinion) => ({
          ...opinion,
          at: new Date(opinion.at).toISOString(),
        })),
})

/** one ask and its answer, on the wire: the workbench and the claim's story
 *  read the same shape, so a change to it reaches both */
const supplementDto = (supplement: ReviewDetailView['supplements'][number]) => ({
  id: supplement.id,
  requestNo: supplement.requestNo,
  status: supplement.status,
  instructions: supplement.instructions,
  requirements: supplement.requirements,
  requestedBy: supplement.requestedBy,
  requestedByName: supplement.requestedByName,
  requestedAt: new Date(supplement.requestedAt).toISOString(),
  answeredAt: supplement.answeredAt === null ? null : new Date(supplement.answeredAt).toISOString(),
  cancelledAt:
    supplement.cancelledAt === null ? null : new Date(supplement.cancelledAt).toISOString(),
  response:
    supplement.response === null
      ? null
      : {
          payload: supplement.response.payload,
          attachments: supplement.response.attachments,
          respondedAt: new Date(supplement.response.respondedAt).toISOString(),
        },
})

const itemDto = (item: ItemView) => ({
  id: item.id,
  batchId: item.batchId,
  itemType: item.itemType,
  title: item.title,
  scoreGroupId: item.scoreGroupId,
  maxEntries: item.maxEntries,
  sortOrder: item.sortOrder,
  status: item.status,
  voidReason: item.voidReason,
  currentRevision:
    item.currentRevision === null
      ? null
      : {
          id: item.currentRevision.id,
          revisionNo: item.currentRevision.revisionNo,
          entryChannels: item.currentRevision.entryChannels,
          formConfig: item.currentRevision.formConfig,
          scoringConfig: item.currentRevision.scoringConfig,
          reviewPolicy: item.currentRevision.reviewPolicy,
          displayConfig: item.currentRevision.displayConfig,
          reason: item.currentRevision.reason,
          createdAt: new Date(item.currentRevision.createdAt).toISOString(),
        },
  createdAt: new Date(item.createdAt).toISOString(),
})

/** exactOptionalPropertyTypes: an absent displayConfig stays absent */
const configInput = (config: {
  entryChannels: readonly ('participant' | 'administrative')[]
  formConfig: unknown
  scoringConfig: unknown
  reviewPolicy: unknown
  displayConfig?: unknown
}) => ({
  entryChannels: config.entryChannels,
  formConfig: config.formConfig,
  scoringConfig: config.scoringConfig,
  reviewPolicy: config.reviewPolicy,
  ...(config.displayConfig !== undefined ? { displayConfig: config.displayConfig } : {}),
})

/** a user id nobody has, so a per-person exclusion excludes nobody */
const NOBODY = '00000000-0000-0000-0000-000000000000'

const toBatchDto = (detail: BatchDetail) => ({
  id: detail.id,
  name: detail.name,
  descriptionMd: detail.descriptionMd,
  materialRange: detail.materialRange,
  timezone: detail.timezone,
  status: detail.status,
  configRevision: detail.configRevision,
  manageable: detail.manageable,
  currentPhaseId: detail.currentPhaseId,
  currentPhaseName: detail.currentPhaseName,
  participantCount: detail.participantCount,
  reviewReasons: detail.reviewReasons,
  createdAt: new Date(detail.createdAt).toISOString(),
})

const toPhaseDto = (row: PlanPhase) => ({
  id: row.id,
  ordinal: row.ordinal,
  phaseKey: row.phaseKey,
  displayName: row.displayName,
  description: row.description,
  entryNote: row.entryNote,
  plannedEntryAt: isoOf(row.plannedEntryAt),
  actualEntryAt: isoOf(row.actualEntryAt),
  permissionProfile: row.permissionProfile,
  itemScope: row.itemScope,
  participantScope: row.participantScope,
  sourceTemplateId: row.sourceTemplateId,
  sourceTemplateVersion: row.sourceTemplateVersion,
})

const toParticipantDto = (row: ParticipantRow) => ({
  id: row.id,
  userId: row.userId,
  displayName: row.displayName,
  businessNo: row.businessNo,
  userTypeId: row.userTypeId,
  anchorNodeId: row.anchorNodeId,
  anchorPath: row.anchorPath,
  anchorLineage: row.anchorLineage,
  status: row.status as 'active' | 'excluded',
  includedAt: new Date(row.includedAt).toISOString(),
  excludedAt: isoOf(row.excludedAt),
  placement: row.placement,
})

const toWarningDto = (warning: EditWarning) => ({
  reason: warning.reason,
  phaseId: warning.phaseId,
  ...(warning.index !== undefined ? { index: warning.index } : {}),
})

interface WirePhaseSpec {
  readonly id?: string
  readonly phaseKey: string
  readonly displayName: string
  readonly description?: string
  readonly entryNote?: string
  readonly permissionProfile?: readonly string[]
  readonly itemScope?: readonly string[]
  readonly participantScope?: readonly string[]
}

// Absent survives this boundary. specOver reads an omitted field as "leave
// what is stored", and a caller can only omit what this mapping does not
// invent: filling description/entryNote/permissionProfile with their empty
// values here silently turned every name-only projection into an explicit
// clear - refused on an ended phase, worse on a live one.
export const parseSpec = (spec: WirePhaseSpec) =>
  Effect.gen(function* () {
    const parsed: PhaseSpecInput = {
      ...(spec.id !== undefined ? { id: spec.id } : {}),
      phaseKey: spec.phaseKey,
      displayName: spec.displayName,
      ...(spec.description !== undefined ? { description: spec.description } : {}),
      ...(spec.entryNote !== undefined ? { entryNote: spec.entryNote } : {}),
      ...(spec.permissionProfile !== undefined
        ? { permissionProfile: spec.permissionProfile }
        : {}),
      ...(spec.itemScope !== undefined ? { itemScope: spec.itemScope } : {}),
      ...(spec.participantScope !== undefined ? { participantScope: spec.participantScope } : {}),
    }
    return parsed
  })

/** a stored spec (epoch ms) back to the wire (iso) */
const specDto = (spec: PhaseSpecInput) => ({
  ...(spec.id !== undefined ? { id: spec.id } : {}),
  phaseKey: spec.phaseKey,
  displayName: spec.displayName,
  description: spec.description ?? '',
  permissionProfile: spec.permissionProfile ?? [],
})

const templateDto = (row: TemplateRow) => ({
  id: row.id,
  name: row.name,
  kind: row.kind as 'timeline' | 'phase',
  version: row.version,
  phases: (row.phases as unknown as readonly PhaseSpecInput[]).map(specDto),
})

/**
 * An opened file as a download.
 *
 * The response wears the file's own name: the url ends in /content, and
 * without a disposition every save would be called "content" with no
 * extension. A download, never a document, and never in the uploader's own
 * words about the type (§19) - a cited file is written by whoever is being
 * reviewed, and a workbook by whoever filled it in. Previewing does not need
 * the door to relax: a picture draws through `<img>`, which ignores the
 * disposition, and the document viewer fetches the bytes and types the blob
 * itself.
 */
const downloadOf = (opened: {
  readonly meta: { readonly filename: string; readonly declaredMime: string; readonly size: bigint }
  readonly target: { readonly kind: 'stream'; readonly body: AsyncIterable<Uint8Array> }
}) => {
  const filename = opened.meta.filename
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replaceAll('"', "'")
  // RFC 5987: percent-encode everything outside attr-char, including the
  // quote/paren/star set encodeURIComponent leaves alone
  const starred = encodeURIComponent(filename).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return HttpServerResponse.stream(
    Stream.fromAsyncIterable(opened.target.body, (error) => error),
    {
      contentType: servedTypeOf(opened.meta.declaredMime),
      contentLength: Number(opened.meta.size),
      headers: {
        'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${starred}`,
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

const local = Api.local(assessmentApiGroup)

export const assessmentApiHandlers = HttpApiBuilder.group(local, 'assessment', (handlers) =>
  handlers
    .handle(
      'listBatches',
      Effect.fn('assessment.listBatches.handler')(function* ({ query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.batches:${query.status ?? ''}:${query.q ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        // handed on as the text it was minted from: the shape was already
        // checked by the cursor reader, and parsing it into milliseconds here
        // is what threw away the microseconds the column actually holds
        const after = key === undefined ? undefined : { createdAt: key[0]!, id: key[1]! }
        const found = yield* assessment.listBatches(
          principal.tenantId,
          {
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(query.q !== undefined ? { q: query.q } : {}),
            ...(after !== undefined ? { after } : {}),
            limit: limit + 1,
          },
          principal,
        )
        // the page and how many rows the filter matches: this list is walked
        // by page number, so it has to know how many pages there are
        const total = yield* assessment.countBatches(
          principal.tenantId,
          {
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(query.q !== undefined ? { q: query.q } : {}),
          },
          principal,
        )
        // the filter chips say how many of each kind the search matches,
        // whichever chip is currently pressed
        const statusCounts = yield* assessment.countBatchesByStatus(
          principal.tenantId,
          query.q !== undefined ? { q: query.q } : {},
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          total,
          statusCounts,
          capabilities: { create: yield* assessment.canCreateBatch(principal) },
          items: page.map((row) => ({
            id: row.id,
            name: row.name,
            descriptionMd: row.descriptionMd,
            participantCount: row.participantCount,
            materialRange: parseRange(row.materialRange),
            timezone: row.timezone,
            status: row.status as 'draft' | 'active' | 'archived',
            configRevision: row.configRevision,
            manageable: row.manageable,
            currentPhaseId: row.currentPhaseId,
            currentPhaseName: row.currentPhaseName,
            timeline: row.timeline.map((entry) => ({
              phaseId: entry.phaseId,
              displayName: entry.displayName,
              status: entry.status,
              entry: {
                kind: entry.entry.kind,
                at: entry.entry.kind === 'pending' ? null : new Date(entry.entry.at).toISOString(),
              },
            })),
            createdAt: new Date(row.createdAt).toISOString(),
          })),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.cursorAt, last.id])
              : null,
        }
      }),
    )
    .handle(
      'createBatch',
      Effect.fn('assessment.createBatch.handler')(function* ({ payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        if (payload.materialRange.start >= payload.materialRange.end) {
          return yield* new BadRequest({ message: 'the material range must be non-empty' })
        }
        const detail = yield* assessment.createBatch(
          principal.tenantId,
          {
            name: payload.name,
            ...(payload.descriptionMd !== undefined
              ? { descriptionMd: payload.descriptionMd }
              : {}),
            materialRange: payload.materialRange,
            ...(payload.timezone !== undefined ? { timezone: payload.timezone } : {}),
            import: payload.import,
          },
          principal,
        )
        const capabilities = yield* assessment.capabilitiesFor(
          principal.tenantId,
          detail.id,
          detail.manageable,
          principal,
        )
        return { batch: { ...toBatchDto(detail), capabilities } }
      }),
    )
    .handle(
      'watchBatch',
      Effect.fn('assessment.watchBatch.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const live = yield* AssessmentLive
        const principal = yield* CurrentUser
        yield* assessment.assertVisible(principal.tenantId, params.batchId, principal)
        // Standing is read once, at connect. `capabilitiesFor` is coarse on
        // purpose - "a reviewer here" does not flicker with the phases - so
        // a connection is not re-judged per event; someone stripped of a
        // role mid-connection keeps hearing bare wake-ups until the stream's
        // lifetime ends it and the page dials again, and every read those
        // wake-ups trigger is authorized on its own.
        const standing = yield* assessment.capabilitiesFor(
          principal.tenantId,
          params.batchId,
          false,
          principal,
        )
        const wanted = (event: AssessmentLiveEvent): boolean => {
          if (event.tenantId !== principal.tenantId || event.batchId !== params.batchId) {
            return false
          }
          switch (event.kind) {
            case 'review-inbox-changed':
            case 'review-instance-changed':
              return standing.review
            case 'entries-changed':
            case 'result-changed':
              // A participant hears about their own. The people who work the
              // round hear about all of it: a recorder's list and a
              // reviewer's queue are drawn from exactly the facts these
              // announce, and gated on membership alone the staff screens
              // never woke at all. Nothing is disclosed by hearing - what
              // goes down the wire is the kind and nothing else.
              return (
                standing.review ||
                standing.record ||
                (standing.personal &&
                  (event.subjectUserId === null || event.subjectUserId === principal.userId))
              )
            case 'item-changed':
              return true
            // which phase the batch is in - and what the timetable says -
            // is not a secret from anybody who may watch the batch at all
            case 'phase-changed':
            case 'plan-changed':
              return true
          }
        }
        const changes = live.events.pipe(
          Stream.filter(wanted),
          Stream.map((event) => ({ kind: event.kind })),
        )
        const heartbeat = Stream.tick('25 seconds').pipe(
          Stream.map(() => ({ kind: 'heartbeat' as const })),
        )
        // sync first, always: whatever this connection missed - including
        // everything, on a fresh page - the instruction is to read again
        const sync = Stream.succeed({ kind: 'sync' as const })
        // Counted against the session and the process, and ended once its
        // lifetime is up so the next dial is authenticated afresh. Refused,
        // the page is told to read once and goes on polling.
        return live.connections.admit(
          principal.sessionId,
          Stream.concat(sync, Stream.merge(changes, heartbeat)),
          sync,
        )
      }),
    )
    .handle(
      'getBatch',
      Effect.fn('assessment.getBatch.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const detail = yield* assessment.getBatch(principal.tenantId, params.batchId, principal)
        return { batch: { ...toBatchDto(detail), capabilities: detail.capabilities } }
      }),
    )
    .handle(
      'updateBatch',
      Effect.fn('assessment.updateBatch.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        if (
          payload.materialRange !== undefined &&
          payload.materialRange.start >= payload.materialRange.end
        ) {
          return yield* new BadRequest({ message: 'the material range must be non-empty' })
        }
        const detail = yield* assessment.updateBatch(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
        const capabilities = yield* assessment.capabilitiesFor(
          principal.tenantId,
          detail.id,
          detail.manageable,
          principal,
        )
        return { batch: { ...toBatchDto(detail), capabilities } }
      }),
    )
    .handle(
      'setBatchStatus',
      Effect.fn('assessment.setBatchStatus.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const detail = yield* assessment.setBatchStatus(
          principal.tenantId,
          params.batchId,
          payload.status === 'archived'
            ? {
                status: 'archived',
                ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
              }
            : {
                status: 'active',
                reason: payload.reason,
                phase: payload.phase,
                plannedEntryAt:
                  payload.plannedEntryAt === null
                    ? null
                    : yield* parseInstant(payload.plannedEntryAt),
              },
          principal,
        )
        const capabilities = yield* assessment.capabilitiesFor(
          principal.tenantId,
          detail.id,
          detail.manageable,
          principal,
        )
        return { batch: { ...toBatchDto(detail), capabilities } }
      }),
    )
    .handle(
      'listAccess',
      Effect.fn('assessment.listAccess.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.listAccess(principal.tenantId, params.batchId, query, principal)
      }),
    )
    .handle(
      'previewAccessSync',
      Effect.fn('assessment.previewAccessSync.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.previewAccessSync(
          principal.tenantId,
          params.batchId,
          query,
          principal,
        )
      }),
    )
    .handle(
      'applyAccessSync',
      Effect.fn('assessment.applyAccessSync.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.applyAccessSync(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
      }),
    )
    .handle(
      'setAccessDeny',
      Effect.fn('assessment.setAccessDeny.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.setAccessDeny(
          principal.tenantId,
          params.batchId,
          {
            userId: params.userId,
            permission: params.permission,
            denied: payload.denied,
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
          },
          principal,
        )
      }),
    )
    .handle(
      'staffOptions',
      Effect.fn('assessment.staffOptions.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.staffOptions(principal.tenantId, params.batchId, query, principal)
      }),
    )
    .handle(
      'addStaff',
      Effect.fn('assessment.addStaff.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.addStaff(
          principal.tenantId,
          params.batchId,
          {
            userIds: payload.userIds,
            orgNodeIds: payload.orgNodeIds,
            roleId: payload.roleId,
            ...(payload.validUntil !== undefined
              ? { validUntil: yield* parseInstant(payload.validUntil) }
              : {}),
          },
          principal,
        )
      }),
    )
    .handle(
      'removeStaff',
      Effect.fn('assessment.removeStaff.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.removeStaff(
          principal.tenantId,
          params.batchId,
          params.sourceId,
          principal,
        )
      }),
    )
    .handle(
      'deleteBatch',
      Effect.fn('assessment.deleteBatch.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        yield* assessment.deleteBatch(principal.tenantId, params.batchId, principal)
        return { deleted: true }
      }),
    )
    .handle(
      'getPhases',
      Effect.fn('assessment.getPhases.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const phases = yield* assessment.getPlan(principal.tenantId, params.batchId, principal)
        return { phases: phases.map(toPhaseDto), planFingerprint: planFingerprintOf(phases) }
      }),
    )
    .handle(
      'putPhases',
      Effect.fn('assessment.putPhases.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const specs =
          payload.phases === undefined
            ? undefined
            : yield* Effect.forEach(payload.phases, parseSpec)
        const result = yield* assessment.replacePlan(
          principal.tenantId,
          params.batchId,
          {
            ...(payload.fromTemplateId !== undefined
              ? { fromTemplateId: payload.fromTemplateId }
              : {}),
            ...(specs !== undefined ? { specs } : {}),
            ...(payload.expectedPlanFingerprint !== undefined
              ? { expectedFingerprint: payload.expectedPlanFingerprint }
              : {}),
          },
          principal,
        )
        return {
          phases: result.phases.map(toPhaseDto),
          warnings: result.warnings.map(toWarningDto),
        }
      }),
    )
    .handle(
      'schedulePhase',
      Effect.fn('assessment.schedulePhase.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const at =
          payload.plannedEntryAt === null ? null : yield* parseInstant(payload.plannedEntryAt)
        const phases = yield* assessment.schedulePhase(
          principal.tenantId,
          params.batchId,
          params.phaseId,
          at,
          principal,
        )
        return { phases: phases.map(toPhaseDto) }
      }),
    )
    .handle(
      'advancePhase',
      Effect.fn('assessment.advancePhase.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const phases = yield* assessment.advancePhase(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
        return { phases: phases.map(toPhaseDto) }
      }),
    )
    .handle(
      'getTimeline',
      Effect.fn('assessment.getTimeline.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        // the plan of a batch is readable by whoever the batch is readable
        // by, which is not the same as whoever knows an id
        yield* assessment.assertVisible(principal.tenantId, params.batchId, principal)
        const timeline = yield* assessment.timeline(principal.tenantId, params.batchId)
        return {
          timeline: timeline.map((entry) => ({
            phaseId: entry.phaseId,
            displayName: entry.displayName,
            description: entry.description,
            entryNote: entry.entryNote,
            status: entry.status,
            entry: {
              kind: entry.entry.kind,
              at: 'at' in entry.entry ? isoOf(entry.entry.at) : null,
            },
          })),
        }
      }),
    )
    .handle(
      'administrativeImportTemplate',
      Effect.fn('assessment.administrativeImportTemplate.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        // the workbook's own headings are the product's Chinese ones; the
        // locale only chooses the words for enum choices inside it
        const template = yield* assessment.administrativeImportTemplate(
          principal.tenantId,
          params.itemId,
          'zh-CN',
          principal,
        )
        return downloadOf({
          meta: {
            filename: template.filename,
            declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: BigInt(template.bytes.byteLength),
          },
          target: {
            kind: 'stream',
            body: (async function* () {
              yield template.bytes
            })(),
          },
        })
      }),
    )
    .handle(
      'prepareAdministrativeImportUpload',
      Effect.fn('assessment.prepareAdministrativeImportUpload.handler')(function* ({
        params,
        payload,
      }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const ticket = yield* assessment.prepareAdministrativeImportUpload(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
        return {
          reservationId: ticket.reservationId,
          attachmentId: ticket.attachmentId,
          grant: { driver: ticket.grant.driver, payload: ticket.grant.payload },
          expiresAt: new Date(ticket.expiresAt).toISOString(),
        }
      }),
    )
    .handle(
      'completeAdministrativeImportUpload',
      Effect.fn('assessment.completeAdministrativeImportUpload.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.completeAdministrativeImportUpload(
          principal.tenantId,
          params.reservationId,
          principal,
        )
      }),
    )
    .handle(
      'commitAdministrativeImport',
      Effect.fn('assessment.commitAdministrativeImport.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.commitAdministrativeImport(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
      }),
    )
    .handle(
      'previewAdministrativeImport',
      Effect.fn('assessment.previewAdministrativeImport.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.previewAdministrativeImport(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
      }),
    )
    .handle(
      'listAdministrativeImports',
      Effect.fn('assessment.listAdministrativeImports.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.administrative-imports:${params.batchId}`
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listAdministrativeImports(
          principal.tenantId,
          params.batchId,
          {
            ...(key !== undefined ? { after: [key[0]!, key[1]!] as const } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map(({ cursor: _cursor, ...row }) => row),
          nextCursor:
            found.length > limit && last ? encodeQueryCursor(fingerprint, [...last.cursor]) : null,
        }
      }),
    )
    .handle(
      'getAdministrativeImport',
      Effect.fn('assessment.getAdministrativeImport.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.getAdministrativeImport(
          principal.tenantId,
          params.importId,
          principal,
        )
      }),
    )
    .handle(
      'listAdministrativeImportRows',
      Effect.fn('assessment.listAdministrativeImportRows.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.administrative-import-rows:${params.importId}`
        const key = readQueryCursor(query.cursor, fingerprint, ['text'])
        if (key === null) return yield* cursorUnusable()
        // a row number, and nothing that merely parses as one
        const after = key === undefined ? undefined : key[0]!
        if (after !== undefined && !/^\d{1,9}$/.test(after)) return yield* cursorUnusable()
        const found = yield* assessment.listAdministrativeImportRows(
          principal.tenantId,
          params.importId,
          {
            ...(after !== undefined ? { afterRowNo: Number(after) } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page,
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [String(last.rowNo)])
              : null,
        }
      }),
    )
    .handle(
      'describeAdministrativeImportSource',
      Effect.fn('assessment.describeAdministrativeImportSource.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.describeAdministrativeImportSource(
          principal.tenantId,
          params.importId,
          principal,
        )
      }),
    )
    .handle(
      'getAdministrativeImportSourceContent',
      Effect.fn('assessment.getAdministrativeImportSourceContent.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const opened = yield* assessment.openAdministrativeImportSource(
          principal.tenantId,
          params.importId,
          principal,
        )
        // a store that signs its own urls has no bytes to hand this process;
        // the descriptor already said where to go
        if (opened.target.kind === 'redirect') return yield* new AttachmentUnavailable()
        return downloadOf({ meta: opened.meta, target: opened.target })
      }),
    )
    .handle(
      'reverseAdministrativeImport',
      Effect.fn('assessment.reverseAdministrativeImport.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.reverseAdministrativeImport(
          principal.tenantId,
          params.importId,
          payload,
          principal,
        )
      }),
    )
    .handle(
      'listAdministrativeEntries',
      Effect.fn('assessment.listAdministrativeEntries.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const units = listed(query.orgNodeIds).sort()
        // every filter in the fingerprint, or a cursor from one question
        // applied to another silently skips or repeats rows
        const fingerprint = `assessment.administrative-entries:${params.batchId}:${query.q ?? ''}:${query.entryId ?? ''}:${query.itemId ?? ''}:${query.source ?? ''}:${query.status ?? ''}:${units.join(',')}:${query.orgScope ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listAdministrativeEntries(
          principal.tenantId,
          params.batchId,
          {
            ...(query.q !== undefined ? { q: query.q } : {}),
            ...(query.entryId !== undefined ? { entryId: query.entryId } : {}),
            ...(query.itemId !== undefined ? { itemId: query.itemId } : {}),
            ...(query.source !== undefined ? { source: query.source } : {}),
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(units.length > 0 ? { orgNodeIds: units } : {}),
            ...(query.orgScope !== undefined ? { orgScope: query.orgScope } : {}),
            ...(key !== undefined ? { after: [key[0]!, key[1]!] as const } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          entries: page.map(({ cursor: _cursor, ...row }) => row),
          nextCursor:
            found.length > limit && last ? encodeQueryCursor(fingerprint, [...last.cursor]) : null,
        }
      }),
    )
    .handle(
      'listUserBatches',
      Effect.fn('assessment.listUserBatches.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.user-batches:${params.userId}`
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listUserBatches(
          principal.tenantId,
          params.userId,
          {
            ...(key === undefined ? {} : { after: { includedAt: key[0]!, id: key[1]! } }),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map((row) => ({
            batch: {
              id: row.batchId,
              name: row.name,
              status: row.status as 'draft' | 'active' | 'archived',
              materialRange: parseRange(row.materialRange),
              timezone: row.timezone,
              currentPhaseId: row.currentPhaseId,
              currentPhaseName: row.currentPhaseName,
              manageable: row.manageable === true,
            },
            membership: {
              status: row.membershipStatus as 'active' | 'excluded',
              includedAt: new Date(row.includedAt).toISOString(),
              excludedAt: row.excludedAt == null ? null : new Date(row.excludedAt).toISOString(),
              anchorNodeName: row.anchorNodeName ?? null,
            },
          })),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.cursorAt, last.membershipId])
              : null,
        }
      }),
    )
    .handle(
      'listMyBatches',
      Effect.fn('assessment.listMyBatches.handler')(function* ({ query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = 'assessment.my-batches'
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listUserBatches(
          principal.tenantId,
          principal.userId,
          {
            ...(key === undefined ? {} : { after: { includedAt: key[0]!, id: key[1]! } }),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map((row) => ({
            batch: {
              id: row.batchId,
              name: row.name,
              status: row.status as 'draft' | 'active' | 'archived',
              materialRange: parseRange(row.materialRange),
              timezone: row.timezone,
              currentPhaseId: row.currentPhaseId,
              currentPhaseName: row.currentPhaseName,
              manageable: row.manageable === true,
            },
            membership: {
              status: row.membershipStatus as 'active' | 'excluded',
              includedAt: new Date(row.includedAt).toISOString(),
              excludedAt: row.excludedAt == null ? null : new Date(row.excludedAt).toISOString(),
              anchorNodeName: row.anchorNodeName ?? null,
            },
          })),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.cursorAt, last.membershipId])
              : null,
        }
      }),
    )
    .handle(
      'listUserEntries',
      Effect.fn('assessment.listUserEntries.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.user-entries:${params.userId}`
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listUserEntries(
          principal.tenantId,
          params.userId,
          {
            ...(key === undefined ? {} : { after: { createdAt: key[0]!, id: key[1]! } }),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map((row) => ({
            id: row.id,
            batchId: row.batchId,
            batchName: row.batchName,
            itemId: row.itemId,
            itemTitle: row.itemTitle,
            status: row.status as
              | 'draft'
              | 'in_review'
              | 'needs_revision'
              | 'approved'
              | 'rejected'
              | 'voided',
            source: row.source as 'self' | 'proxy' | 'record' | 'import' | 'system',
            createdAt: new Date(row.createdAt).toISOString(),
            updatedAt: new Date(row.updatedAt).toISOString(),
          })),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.cursorAt, last.id])
              : null,
        }
      }),
    )
    .handle(
      'listParticipants',
      Effect.fn('assessment.listParticipants.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        // every filter in the fingerprint: a cursor from one question applied
        // to another silently skips or repeats people
        const units = listed(query.orgNodeIds).sort()
        const fingerprint = `assessment.participants:${params.batchId}:${query.status ?? ''}:${query.q ?? ''}:${units.join(',')}:${query.orgScope ?? ''}:${query.userTypeId ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listParticipants(
          principal.tenantId,
          params.batchId,
          {
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(query.q !== undefined ? { q: query.q } : {}),
            ...(units.length > 0 ? { orgNodeIds: units } : {}),
            ...(query.orgScope !== undefined ? { orgScope: query.orgScope } : {}),
            ...(query.userTypeId !== undefined ? { userTypeId: query.userTypeId } : {}),
            ...(key !== undefined ? { after: { path: key[0]!, id: key[1]! } } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map(toParticipantDto),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.anchorPath, last.id])
              : null,
        }
      }),
    )
    .handle(
      'previewAdministrativeRecord',
      Effect.fn('assessment.previewAdministrativeRecord.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const seen = yield* assessment.previewAdministrativeRecord(
          principal.tenantId,
          params.batchId,
          {
            itemId: payload.itemId,
            expectedItemRevisionId: payload.expectedItemRevisionId,
            target: targetOf(payload.target),
            ...(payload.excludedParticipantIds === undefined
              ? {}
              : { excludedParticipantIds: listed(payload.excludedParticipantIds) }),
            payload: payload.payload,
            ...(payload.recognition === undefined ? {} : { recognition: payload.recognition }),
            basis: payload.basis,
          },
          principal,
        )
        return {
          item: seen.item,
          requestedCount: seen.requestedCount,
          eligibleCount: seen.eligibleCount,
          blocked: seen.blocked,
          targetFingerprint: seen.targetFingerprint,
        }
      }),
    )
    .handle(
      'previewRecordDetermination',
      Effect.fn('assessment.previewRecordDetermination.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.previewRecordDetermination(
          principal.tenantId,
          params.batchId,
          payload.itemId,
          payload.values,
          principal,
        )
      }),
    )
    .handle(
      'recordAdministrativeBatch',
      Effect.fn('assessment.recordAdministrativeBatch.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.recordAdministrativeBatch(
          principal.tenantId,
          params.batchId,
          {
            itemId: payload.itemId,
            expectedItemRevisionId: payload.expectedItemRevisionId,
            target: targetOf(payload.target),
            ...(payload.excludedParticipantIds === undefined
              ? {}
              : { excludedParticipantIds: listed(payload.excludedParticipantIds) }),
            expectedTargetFingerprint: payload.expectedTargetFingerprint,
            idempotencyKey: payload.idempotencyKey,
            payload: payload.payload,
            ...(payload.recognition === undefined ? {} : { recognition: payload.recognition }),
            basis: payload.basis,
          },
          principal,
        )
      }),
    )
    .handle(
      'listAdministrativeRecords',
      Effect.fn('assessment.listAdministrativeRecords.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.administrative-records:${params.batchId}`
        const key = readQueryCursor(query.cursor, fingerprint, ['timestamp', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listAdministrativeRecords(
          principal.tenantId,
          params.batchId,
          {
            ...(key !== undefined ? { after: [key[0]!, key[1]!] as const } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map((row) => ({
            id: row.id,
            itemId: row.itemId,
            itemTitle: row.itemTitle,
            targetKind: row.targetKind,
            recordedCount: row.recordedCount,
            voidedCount: row.voidedCount,
            actorName: row.actorName,
            createdAt: row.createdAt,
          })),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.createdAt, last.id])
              : null,
        }
      }),
    )
    .handle(
      'getAdministrativeRecord',
      Effect.fn('assessment.getAdministrativeRecord.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const act = yield* assessment.getAdministrativeRecord(
          principal.tenantId,
          params.operationId,
          principal,
          query.rowsCursor,
        )
        return {
          id: act.id,
          batchId: act.batchId,
          itemId: act.itemId,
          itemTitle: act.itemTitle,
          itemRevisionId: act.itemRevisionId,
          targetKind: act.targetKind,
          recordedCount: act.recordedCount,
          voidedCount: act.voidedCount,
          createdAt: act.createdAt,
          actorName: act.actorName,
          rowsNextCursor: act.rowsNextCursor,
          rows: act.rows,
          events: act.events,
        }
      }),
    )
    .handle(
      'reverseAdministrativeRecord',
      Effect.fn('assessment.reverseAdministrativeRecord.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.reverseAdministrativeRecord(
          principal.tenantId,
          params.operationId,
          { reason: payload.reason },
          principal,
        )
      }),
    )
    .handle(
      'listRosterUnits',
      Effect.fn('assessment.listRosterUnits.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const units = yield* assessment.listRosterUnits(
          principal.tenantId,
          params.batchId,
          query.userTypeId === undefined ? {} : { userTypeId: query.userTypeId },
          principal,
        )
        return { units }
      }),
    )
    .handle(
      'getParticipant',
      Effect.fn('assessment.getParticipant.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const participant = yield* assessment.getParticipant(
          principal.tenantId,
          params.batchId,
          params.participantId,
          principal,
        )
        return { participant: toParticipantDto(participant) }
      }),
    )
    .handle(
      'listParticipantEntries',
      Effect.fn('assessment.listParticipantEntries.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const page = yield* assessment.listParticipantEntries(
          principal.tenantId,
          params.batchId,
          params.participantId,
          {
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
          },
          principal,
        )
        return {
          participantId: page.participantId,
          entries: page.entries.map((one) => ({
            entry: entryDto(one.entry),
            recognition: one.recognition,
          })),
          nextCursor: page.nextCursor,
        }
      }),
    )
    .handle(
      'getParticipantResult',
      Effect.fn('assessment.getParticipantResult.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const result = yield* assessment.getParticipantResult(
          principal.tenantId,
          params.batchId,
          params.participantId,
          principal,
        )
        return {
          mode: result.mode,
          total: result.total,
          groups: result.groups,
          lines: result.lines,
        }
      }),
    )
    .handle(
      'addParticipants',
      Effect.fn('assessment.addParticipants.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.addParticipants(
          principal.tenantId,
          params.batchId,
          payload.userIds,
          principal,
        )
      }),
    )
    .handle(
      'previewImport',
      Effect.fn('assessment.previewImport.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.previewImport(
          principal.tenantId,
          params.batchId,
          {
            orgNodeIds: listed(query.orgNodeIds),
            userTypeIds: listed(query.userTypeIds),
          },
          principal,
        )
      }),
    )
    .handle(
      'importParticipants',
      Effect.fn('assessment.importParticipants.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.importParticipants(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
      }),
    )
    .handle(
      'listImports',
      Effect.fn('assessment.listImports.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const page = yield* assessment.listImports(
          principal.tenantId,
          params.batchId,
          query,
          principal,
        )
        return {
          imports: page.items.map((row) => ({
            ...row,
            occurredAt: new Date(row.occurredAt).toISOString(),
          })),
          nextCursor: page.nextCursor,
        }
      }),
    )
    .handle(
      'setParticipantStatus',
      Effect.fn('assessment.setParticipantStatus.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const participant = yield* assessment.setParticipantStatus(
          principal.tenantId,
          params.batchId,
          params.participantId,
          payload.status,
          payload.reason,
          principal,
        )
        return { participant: toParticipantDto(participant) }
      }),
    )
    .handle(
      'listParticipantPlacements',
      Effect.fn('assessment.listParticipantPlacements.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.listParticipantPlacements(
          principal.tenantId,
          params.batchId,
          query,
          principal,
        )
      }),
    )
    .handle(
      'reconcileParticipantPlacements',
      Effect.fn('assessment.reconcileParticipantPlacements.handler')(function* ({
        params,
        payload,
      }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.reconcileParticipantPlacements(
          principal.tenantId,
          params.batchId,
          payload,
          principal,
        )
      }),
    )
    .handle(
      'listScopeOptions',
      Effect.fn('assessment.listScopeOptions.handler')(function* () {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return { nodes: yield* assessment.scopeOptions(principal.tenantId, principal) }
      }),
    )
    .handle(
      'listUserTypeOptions',
      Effect.fn('assessment.listUserTypeOptions.handler')(function* () {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return { userTypes: yield* assessment.userTypeOptions(principal.tenantId, principal) }
      }),
    )
    .handle(
      'listTemplates',
      Effect.fn('assessment.listTemplates.handler')(function* ({ query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = 'assessment.phase-templates'
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listTemplates(
          principal.tenantId,
          {
            ...(query.kind !== undefined ? { kind: query.kind } : {}),
            ...(key !== undefined ? { after: { name: key[0]!, id: key[1]! } } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map(templateDto),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.name, last.id])
              : null,
        }
      }),
    )
    .handle(
      'createTemplate',
      Effect.fn('assessment.createTemplate.handler')(function* ({ payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const template = yield* assessment.createTemplate(
          principal.tenantId,
          {
            name: payload.name,
            ...(payload.kind !== undefined ? { kind: payload.kind } : {}),
            phases: yield* Effect.forEach(payload.phases, parseSpec),
          },
          principal,
        )
        return { template: templateDto(template) }
      }),
    )
    .handle(
      'updateTemplate',
      Effect.fn('assessment.updateTemplate.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const template = yield* assessment.updateTemplate(
          principal.tenantId,
          params.templateId,
          {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.phases !== undefined
              ? { phases: yield* Effect.forEach(payload.phases, parseSpec) }
              : {}),
          },
          principal,
        )
        return { template: templateDto(template) }
      }),
    )
    .handle(
      'deleteTemplate',
      Effect.fn('assessment.deleteTemplate.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        yield* assessment.deleteTemplate(principal.tenantId, params.templateId, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'prepareAttachmentUpload',
      Effect.fn('assessment.prepareAttachmentUpload.handler')(function* ({ payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const ticket = yield* assessment.prepareAttachmentUpload(
          principal.tenantId,
          {
            batchId: payload.batchId,
            itemId: payload.itemId,
            filename: payload.filename,
            declaredMime: payload.declaredMime,
            size: BigInt(payload.size),
          },
          principal,
        )
        return {
          reservationId: ticket.reservationId,
          attachmentId: ticket.attachmentId,
          grant: { driver: ticket.grant.driver, payload: ticket.grant.payload },
          expiresAt: new Date(ticket.expiresAt).toISOString(),
        }
      }),
    )
    .handle(
      'completeAttachmentUpload',
      Effect.fn('assessment.completeAttachmentUpload.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.completeAttachmentUpload(
          principal.tenantId,
          params.reservationId,
          principal,
        )
      }),
    )
    .handle(
      'listAttachmentDescriptors',
      Effect.fn('assessment.listAttachmentDescriptors.handler')(function* ({ query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        // bounded loudly rather than truncated quietly: a page that asks for
        // more than this is a page bug, and half an answer would hide it
        if (query.id.length > 60) {
          return yield* new BadRequest({ message: 'at most 60 attachments per request' })
        }
        return {
          attachments: yield* assessment.describeAttachments(
            principal.tenantId,
            query.id,
            principal,
          ),
        }
      }),
    )
    .handle(
      'describeAttachment',
      Effect.fn('assessment.describeAttachment.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.describeAttachment(
          principal.tenantId,
          params.attachmentId,
          principal,
        )
      }),
    )
    .handle(
      'getAttachmentContent',
      Effect.fn('assessment.getAttachmentContent.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const opened = yield* assessment.openAttachment(
          principal.tenantId,
          params.attachmentId,
          principal,
        )
        if (opened.target.kind === 'redirect') {
          // a store that signs its own urls has no bytes to hand this
          // process; the descriptor endpoint already said where to go
          return yield* new AttachmentUnavailable()
        }
        return downloadOf({ meta: opened.meta, target: opened.target })
      }),
    )
    .handle(
      'listMyEntries',
      Effect.fn('assessment.listMyEntries.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const page = yield* assessment.listMyEntries(
          principal.tenantId,
          params.batchId,
          {
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
          },
          principal,
        )
        return {
          participantId: page.participantId,
          entries: page.entries.map(entryDto),
          filing: page.filing,
          nextCursor: page.nextCursor,
          attention: page.attention,
        }
      }),
    )
    .handle(
      'getEntryHistory',
      Effect.fn('assessment.getEntryHistory.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const history = yield* assessment.getEntryHistory(
          principal.tenantId,
          params.entryId,
          principal,
        )
        return {
          reviewersShown: history.reviewersShown,
          entry: entryDto(history.entry),
          revisions: history.revisions.map((revision) => ({
            id: revision.id,
            revisionNo: revision.revisionNo,
            itemRevisionId: revision.itemRevisionId,
            payload: revision.payload,
            note: revision.note,
            source: revision.source,
            actorId: revision.actorId,
            subjectId: revision.subjectId,
            attachments: revision.attachments,
            createdAt: new Date(revision.createdAt).toISOString(),
            formConfig: revision.formConfig,
          })),
          events: history.events.map((event) => ({
            kind: event.kind,
            actorId: event.actorId,
            actorName: event.actorName,
            reason: event.reason,
            at: new Date(event.at).toISOString(),
          })),
          rounds: history.rounds.map((round) => ({
            id: round.id,
            roundNo: round.roundNo,
            state: round.state,
            outcome: round.outcome,
            revisionId: round.revisionId,
            origin: round.origin,
            supersedesInstanceId: round.supersedesInstanceId,
            appealedInstanceId: round.appealedInstanceId,
            appealedRecognitionId: round.appealedRecognitionId,
            submittedAt: new Date(round.submittedAt).toISOString(),
            completedAt:
              round.completedAt === null ? null : new Date(round.completedAt).toISOString(),
            supplements: round.supplements.map(supplementDto),
            events: round.events.map((event) => ({
              kind: event.kind,
              actorId: event.actorId,
              actorName: event.actorName,
              byRound: event.byRound,
              reason: event.reason,
              comment: event.comment,
              suggestedPayload: event.suggestedPayload,
              at: new Date(event.at).toISOString(),
            })),
          })),
        }
      }),
    )
    .handle(
      'createEntry',
      Effect.fn('assessment.createEntry.handler')(function* ({ payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const entry = yield* assessment.createEntry(
          principal.tenantId,
          {
            itemId: payload.itemId,
            participantId: payload.participantId,
            payload: payload.payload,
            ...(payload.expectedItemRevisionId !== undefined
              ? { expectedItemRevisionId: payload.expectedItemRevisionId }
              : {}),
            ...(payload.note !== undefined ? { note: payload.note } : {}),
            ...(payload.recognition !== undefined ? { recognition: payload.recognition } : {}),
            // what the member of staff filing this determined by filing it:
            // dropping it here would quietly store the plan's defaults under
            // their name, and a complete set of defaults would make that
            // succeed rather than fail
          },
          principal,
        )
        return { entry: entryDto(entry) }
      }),
    )
    .handle(
      'getEntry',
      Effect.fn('assessment.getEntry.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const entry = yield* assessment.getEntry(principal.tenantId, params.entryId, principal)
        return { entry: entryDto(entry) }
      }),
    )
    .handle(
      'reviseEntry',
      Effect.fn('assessment.reviseEntry.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const entry = yield* assessment.appendEntryRevision(
          principal.tenantId,
          params.entryId,
          {
            payload: payload.payload,
            ...(payload.expectedItemRevisionId !== undefined
              ? { expectedItemRevisionId: payload.expectedItemRevisionId }
              : {}),
            ...(payload.expectedEntryRevisionId !== undefined
              ? { expectedEntryRevisionId: payload.expectedEntryRevisionId }
              : {}),
            ...(payload.note !== undefined ? { note: payload.note } : {}),
          },
          principal,
        )
        return { entry: entryDto(entry) }
      }),
    )
    .handle(
      'markMyEntryRead',
      Effect.fn('assessment.markMyEntryRead.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.markMyEntryRead(
          principal.tenantId,
          params.batchId,
          params.itemId,
          principal,
        )
      }),
    )
    .handle(
      'listMyStanding',
      Effect.fn('assessment.listMyStanding.handler')(function* () {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.listMyStanding(principal.tenantId, principal)
      }),
    )
    .handle(
      'getMyOverview',
      Effect.fn('assessment.getMyOverview.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.getMyOverview(principal.tenantId, params.batchId, principal)
      }),
    )
    .handle(
      'listMyActivity',
      Effect.fn('assessment.listMyActivity.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.listMyActivity(
          principal.tenantId,
          params.batchId,
          {
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
            ...(query.perspective !== undefined ? { perspective: query.perspective } : {}),
          },
          principal,
        )
      }),
    )
    .handle(
      'setEntryStatus',
      Effect.fn('assessment.setEntryStatus.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const entry = yield* assessment.setEntryStatus(
          principal.tenantId,
          params.entryId,
          payload.status,
          principal,
          payload.expectedItemRevisionId,
          payload.expectedEntryRevisionId,
        )
        return { entry: entryDto(entry) }
      }),
    )
    .handle(
      'interveneOnEntry',
      Effect.fn('assessment.interveneOnEntry.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const entry = yield* assessment.interveneOnEntry(
          principal.tenantId,
          params.entryId,
          payload,
          principal,
        )
        return { entry: entryDto(entry) }
      }),
    )
    .handle(
      'listReviewInbox',
      Effect.fn('assessment.listReviewInbox.handler')(function* ({ query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const page = yield* assessment.listReviewInbox(
          principal.tenantId,
          {
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
            ...(query.batchId !== undefined ? { batchId: query.batchId } : {}),
          },
          principal,
        )
        return {
          items: page.items.map((item) => ({
            ...item,
            submittedAt: new Date(item.submittedAt).toISOString(),
          })),
          nextCursor: page.nextCursor,
          handledToday: page.handledToday,
        }
      }),
    )
    .handle(
      'listAwaitingSupplements',
      Effect.fn('assessment.listAwaitingSupplements.handler')(function* ({ query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const page = yield* assessment.listAwaitingSupplements(
          principal.tenantId,
          {
            batchId: query.batchId,
            ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
          },
          principal,
        )
        return {
          items: page.items.map((item) => ({
            ...item,
            requestedAt: new Date(item.requestedAt).toISOString(),
            answeredAt: item.answeredAt === null ? null : new Date(item.answeredAt).toISOString(),
          })),
          nextCursor: page.nextCursor,
        }
      }),
    )
    .handle(
      'getReviewInstance',
      Effect.fn('assessment.getReviewInstance.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const review = yield* assessment.getReviewInstance(
          principal.tenantId,
          params.instanceId,
          principal,
        )
        return { review: reviewDto(review) }
      }),
    )
    .handle(
      'previewDetermination',
      Effect.fn('assessment.previewDetermination.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.previewDetermination(
          principal.tenantId,
          params.instanceId,
          payload.values,
          principal,
        )
      }),
    )
    .handle(
      'decideReview',
      Effect.fn('assessment.decideReview.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const review = yield* assessment.decideReview(
          principal.tenantId,
          params.instanceId,
          {
            decision: payload.decision,
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
            ...(payload.comment !== undefined ? { comment: payload.comment } : {}),
            ...(payload.suggestedPayload !== undefined
              ? { suggestedPayload: payload.suggestedPayload }
              : {}),
            ...(payload.recognition !== undefined
              ? {
                  recognition: {
                    values: payload.recognition.values,
                    ...(payload.recognition.reason !== undefined
                      ? { reason: payload.recognition.reason }
                      : {}),
                  },
                }
              : {}),
          },
          principal,
        )
        return { review: reviewDto(review) }
      }),
    )
    .handle(
      'reviewAlerts',
      Effect.fn('assessment.reviewAlerts.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.reviewAlerts(principal.tenantId, params.batchId, principal)
      }),
    )
    .handle(
      'reviewCoverage',
      Effect.fn('assessment.reviewCoverage.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.reviewCoverage(
          principal.tenantId,
          params.batchId,
          { nodeTypeId: query.nodeTypeId, roleIds: listed(query.roleIds) },
          principal,
        )
      }),
    )
    .handle(
      'itemOptions',
      Effect.fn('assessment.itemOptions.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.itemOptions(principal.tenantId, params.batchId, principal)
      }),
    )
    .handle(
      'deleteItem',
      Effect.fn('assessment.deleteItem.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        yield* assessment.deleteItem(principal.tenantId, params.itemId, principal)
        return {}
      }),
    )
    .handle(
      'setItemStatus',
      Effect.fn('assessment.setItemStatus.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const item = yield* assessment.setItemStatus(
          principal.tenantId,
          params.itemId,
          payload.status === 'voided'
            ? { status: 'voided', reason: payload.reason }
            : { status: 'active' },
          principal,
        )
        return { item: itemDto(item) }
      }),
    )
    .handle(
      'getMyResult',
      Effect.fn('assessment.getMyResult.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const result = yield* assessment.getMyResult(principal.tenantId, params.batchId, principal)
        return {
          mode: result.mode,
          total: result.total,
          groups: result.groups,
          lines: result.lines,
        }
      }),
    )
    .handle(
      'appealEntry',
      Effect.fn('assessment.appealEntry.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const review = yield* assessment.appealEntry(
          principal.tenantId,
          params.entryId,
          payload,
          principal,
        )
        return { review: reviewDto(review) }
      }),
    )
    .handle(
      'requestSupplement',
      Effect.fn('assessment.requestSupplement.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const review = yield* assessment.requestSupplement(
          principal.tenantId,
          params.instanceId,
          { instructions: payload.instructions, requirements: payload.requirements },
          principal,
        )
        return { review: reviewDto(review) }
      }),
    )
    .handle(
      'cancelSupplement',
      Effect.fn('assessment.cancelSupplement.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const review = yield* assessment.cancelSupplement(
          principal.tenantId,
          params.requestId,
          principal,
        )
        return { review: reviewDto(review) }
      }),
    )
    .handle(
      'answerSupplement',
      Effect.fn('assessment.answerSupplement.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const review = yield* assessment.answerSupplement(
          principal.tenantId,
          params.requestId,
          { payload: payload.payload },
          principal,
        )
        return { review: reviewDto(review) }
      }),
    )
    .handle(
      'listItems',
      Effect.fn('assessment.listItems.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const found = yield* assessment.listItems(principal.tenantId, params.batchId, principal)
        return {
          items: found.items.map(itemDto),
          capabilities: found.capabilities,
        }
      }),
    )
    .handle(
      'createItem',
      Effect.fn('assessment.createItem.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const item = yield* assessment.createItem(
          principal.tenantId,
          params.batchId,
          {
            itemType: payload.itemType,
            title: payload.title,
            scoreGroupId: payload.scoreGroupId,
            maxEntries: payload.maxEntries ?? null,
            ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
            config: configInput(payload.config),
          },
          principal,
        )
        return { item: itemDto(item) }
      }),
    )
    .handle(
      'getRecognitionContract',
      Effect.fn('assessment.getRecognitionContract.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const contract = yield* assessment.getRecognitionContract(
          principal.tenantId,
          params.itemId,
          principal,
        )
        return { contract }
      }),
    )
    .handle(
      'getItem',
      Effect.fn('assessment.getItem.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const item = yield* assessment.getItem(principal.tenantId, params.itemId, principal)
        return { item: itemDto(item), capabilities: { canManage: item.manageable } }
      }),
    )
    .handle(
      'updateItem',
      Effect.fn('assessment.updateItem.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const item = yield* assessment.updateItem(
          principal.tenantId,
          params.itemId,
          {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.itemType !== undefined ? { itemType: payload.itemType } : {}),
            ...(payload.scoreGroupId !== undefined ? { scoreGroupId: payload.scoreGroupId } : {}),
            ...(payload.maxEntries !== undefined ? { maxEntries: payload.maxEntries } : {}),
            ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
            ...(payload.config !== undefined ? { config: configInput(payload.config) } : {}),
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
            ...(payload.expectedRevisionId !== undefined
              ? { expectedRevisionId: payload.expectedRevisionId }
              : {}),
            ...(payload.effects !== undefined ? { effects: payload.effects } : {}),
          },
          principal,
        )
        return { item: itemDto(item) }
      }),
    )
    .handle(
      'previewScoring',
      Effect.fn('assessment.previewScoring.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.previewScoring(
          principal.tenantId,
          params.batchId,
          {
            itemType: payload.itemType,
            formConfig: payload.formConfig,
            calculator: payload.calculator,
            ...(payload.itemId !== undefined ? { itemId: payload.itemId } : {}),
          },
          principal,
        )
      }),
    )
    .handle(
      'checkItem',
      Effect.fn('assessment.checkItem.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.checkItem(
          principal.tenantId,
          params.batchId,
          {
            itemType: payload.itemType,
            scoreGroupId: payload.scoreGroupId,
            config: payload.config,
            ...(payload.itemId !== undefined ? { itemId: payload.itemId } : {}),
          },
          principal,
        )
      }),
    )
    .handle(
      'listScoreGroups',
      Effect.fn('assessment.listScoreGroups.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.listScoreGroups(principal.tenantId, params.batchId, principal)
      }),
    )
    .handle(
      'replaceScoreGroups',
      Effect.fn('assessment.replaceScoreGroups.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.replaceScoreGroups(
          principal.tenantId,
          params.batchId,
          {
            groups: payload.groups.map((group) => ({
              ...(group.id !== undefined ? { id: group.id } : {}),
              parentGroupId: group.parentGroupId,
              name: group.name,
              cap: group.cap,
              floor: group.floor,
              ...(group.sortOrder !== undefined ? { sortOrder: group.sortOrder } : {}),
            })),
            expectedVersion: payload.expectedVersion,
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
          },
          principal,
        )
      }),
    ),
)
