import { Clock, Context, Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import type { ApplicableAssignment } from '@qualy/rbac-contract/effect'
import { assessmentApiGroup } from '../api.ts'
import {
  reviewInsertion,
  reviewPlan,
  reviewPlanEdit,
  type EditWarning,
  type NewPhaseSpec,
  type PlanEdit,
} from '../phase/engine/edits.ts'
import { effectiveState, normalizePlan } from '../phase/engine/queue.ts'
import { deriveTimeline, type TimelineEntry } from '../phase/engine/timeline.ts'
import type { EpochMillis, PhasePlan } from '../phase/engine/types.ts'
import { gateAllows, type GateContext, type GateDecision } from '../phase/gate.ts'
import { PARTICIPANT_CODES, STAFF_CODES } from '../permissions.ts'
import {
  AccessInvalid,
  AdvanceInvalid,
  BatchNoParticipants,
  BatchNotFound,
  BatchReadOnly,
  BatchReferenceInvalid,
  BatchStatusInvalid,
  ParticipantInvalid,
  ParticipantNotFound,
  PhaseNotFound,
  PlanInvalid,
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
} from './errors.ts'
import {
  activeElsewhere,
  batchParticipantIds,
  batchesWithDueBoundaries,
  bumpConfigRevision,
  deletePhases,
  deleteTemplateRow,
  insertBatch,
  insertParticipants,
  insertRosterImport,
  importCandidates,
  rosterImports,
  reachableNodeNames,
  insertConfigEvent,
  insertPhase,
  insertLifecycleEvent,
  accessSources,
  acceptAccessSource,
  acceptPermissions,
  accessDenies,
  setAccessDeny as setAccessDenyRow,
  oneAccessSource,
  dropAccessSource,
  namesOf,
  deleteBatchRow,
  insertPhaseEvent,
  insertTemplate,
  batchVisibleTo,
  countBatches,
  listBatchesPage,
  listParticipantsPage,
  listPhaseRows,
  phaseRowsForBatches,
  listTemplatesPage,
  lockBatch,
  nodesByIds,
  oneBatch,
  oneParticipant,
  oneTemplate,
  participantByUser,
  phaseScopes,
  roleHoldersAt,
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

// The assessment service: the engine's answers, wired to rows. Every write
// serializes on its batch row, "entered" is decided by the clock, and the
// engine's structured refusals go to the wire as they are.

export interface MaterialRange {
  readonly start: string
  readonly end: string
}

/** a batch as a list shows it: the row, plus where the batch has got to */
export interface BatchListRow extends BatchRow {
  readonly timeline: readonly TimelineEntry[]
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
}

/** one phase as a plan write states it; instants already parsed to epoch ms */
export interface PhaseSpecInput extends NewPhaseSpec {
  readonly id?: string
  /** supplementary-phase allowances; empty or absent means unrestricted */
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
  permissionProfile: spec.permissionProfile ?? [],
})

const MANAGE = 'assessment.batch.manage'
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

export type ActionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly layer: 'rbac' | 'gate' | 'policy'; readonly reason: string }

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

/** how many nodes a scope picker is willing to render at once */
const SCOPE_OPTION_LIMIT = 500

/** one level of the lineage being frozen, with who could act there today */
export interface ChainPreviewStep {
  readonly nodeId: string
  readonly nodeTypeId: string
  /** people holding any role anchored exactly here; real chains arrive M3 */
  readonly holders: number
}

export class Assessment extends Context.Service<
  Assessment,
  {
    readonly createBatch: (
      tenantId: string,
      input: CreateBatchInput,
      as: Principal,
    ) => Effect.Effect<BatchDetail, CreateBatchError>
    readonly listBatches: (
      tenantId: string,
      filter: {
        status?: 'draft' | 'active' | 'archived'
        q?: string
        after?: { createdAt: EpochMillis; id: string }
        limit: number
      },
      as: Principal,
    ) => Effect.Effect<readonly BatchListRow[]>
    readonly countBatches: (
      tenantId: string,
      filter: { status?: 'draft' | 'active' | 'archived'; q?: string },
      as: Principal,
    ) => Effect.Effect<number>
    readonly getBatch: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<BatchDetail, BatchNotFound | AccessDenied>
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
      as: Principal,
    ) => Effect.Effect<BatchAccessView, BatchNotFound | AccessDenied>
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
    ) => Effect.Effect<{ merged: number }, BatchNotFound | AccessDenied>
    /** takes one capability back from a person, whichever source offered it */
    readonly setAccessDeny: (
      tenantId: string,
      batchId: string,
      input: { userId: string; permission: string; denied: boolean; reason?: string },
      as: Principal,
    ) => Effect.Effect<BatchAccessView, BatchNotFound | AccessInvalid | AccessDenied>
    /**
     * Somebody brought in for this round: an ordinary role assignment confined
     * to this batch, accepted into it in the same transaction.
     */
    readonly addStaff: (
      tenantId: string,
      batchId: string,
      input: {
        userId: string
        roleId: string
        orgNodeId: string
        validUntil?: EpochMillis
      },
      as: Principal,
    ) => Effect.Effect<BatchAccessView, BatchNotFound | AccessInvalid | AccessDenied>
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
      body: { fromTemplateId?: string; specs?: readonly PhaseSpecInput[] },
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
    readonly listParticipants: (
      tenantId: string,
      batchId: string,
      filter: {
        status?: 'active' | 'excluded'
        after?: { path: string; id: string }
        limit: number
      },
      as: Principal,
    ) => Effect.Effect<readonly ParticipantRow[], BatchNotFound | AccessDenied>
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
      as: Principal,
    ) => Effect.Effect<
      readonly {
        id: string
        units: readonly string[]
        userTypes: readonly string[]
        importedCount: number
        actorId: string | null
        occurredAt: number
      }[],
      BatchNotFound | AccessDenied
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
  }
>()('@qualy/plugin-assessment/Assessment') {}

export const make = Effect.fn('Assessment.make')(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac

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

  const readDetail = (_tenantId: string, batch: BatchRow) =>
    Effect.succeed<BatchDetail>({
      id: batch.id,
      name: batch.name,
      descriptionMd: batch.descriptionMd,
      materialRange: parseRange(batch.materialRange),
      timezone: batch.timezone,
      status: batch.status as BatchDetail['status'],
      configRevision: batch.configRevision,
      manageable: batch.manageable,
      currentPhaseId: batch.currentPhaseId,
      currentPhaseName: batch.currentPhaseName,
      participantCount: batch.participantCount,
      createdAt: batch.createdAt,
    })

  /** the plan with its allowances, as every plan endpoint answers it */
  const readPlan = (tenantId: string, batchId: string) =>
    Effect.gen(function* () {
      const rows = yield* listPhaseRows(tenantId, batchId)
      const scopes = yield* scopesForBatch(tenantId, batchId)
      return rows.map((row): PlanPhase => ({
        ...row,
        itemScope: scopes.items
          .filter((entry) => entry.phaseId === row.id)
          .map((entry) => entry.itemId),
        participantScope: scopes.participants
          .filter((entry) => entry.phaseId === row.id)
          .map((entry) => entry.participantId),
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

  const fieldEditsOf = (existing: PhaseRow, spec: PhaseSpecInput): PlanEdit[] => {
    const edits: PlanEdit[] = []
    if (spec.displayName !== existing.displayName) {
      edits.push({ kind: 'rename', phaseId: existing.id, displayName: spec.displayName })
    }
    const description = spec.description ?? ''
    if (description !== existing.description) {
      edits.push({ kind: 'describe', phaseId: existing.id, description })
    }
    const profile = spec.permissionProfile ?? []
    if (JSON.stringify(profile) !== JSON.stringify(existing.permissionProfile)) {
      edits.push({ kind: 'set-profile', phaseId: existing.id, permissionProfile: profile })
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
      case 'set-profile':
        return { kind: 'profile-changed' }
      default:
        return { kind: 'edited' }
    }
  }

  /** the in-memory application of an accepted edit, for sequential review */
  const applyToPlan = (plan: PhasePlan, edit: PlanEdit): PhasePlan =>
    plan.map((phase) => {
      if (phase.id !== edit.phaseId) return phase
      switch (edit.kind) {
        case 'rename':
          return { ...phase, displayName: edit.displayName }
        case 'set-planned':
          return { ...phase, plannedEntryAt: edit.plannedEntryAt }
        case 'describe':
          return { ...phase, description: edit.description }
        case 'set-profile':
          return { ...phase, permissionProfile: edit.permissionProfile }
        default:
          return phase
      }
    })

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
        const itemScope = normalScope(spec.itemScope)
        const participantScope = normalScope(spec.participantScope)
        if (existing) {
          const edits = options.events ? fieldEditsOf(existing, spec) : []
          yield* updatePhaseFields(tenantId, existing.id, {
            ordinal: index,
            displayName: spec.displayName,
            phaseKey: spec.phaseKey,
            description: spec.description ?? '',
            permissionProfile: spec.permissionProfile ?? [],
          })
          const scopesChanged =
            JSON.stringify(itemScope) !== JSON.stringify(existing.itemScope) ||
            JSON.stringify(participantScope) !== JSON.stringify(existing.participantScope)
          if (scopesChanged) {
            yield* replacePhaseScopes(tenantId, existing.id, {
              items: itemScope,
              participants: participantScope,
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
            permissionProfile: spec.permissionProfile ?? [],
            ...(options.provenance
              ? {
                  sourceTemplateId: options.provenance.id,
                  sourceTemplateVersion: options.provenance.version,
                }
              : {}),
          })
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
      if (spec.id !== undefined && endedIds.has(spec.id)) {
        const existing = existingById.get(spec.id)!
        if (
          JSON.stringify(normalScope(spec.itemScope)) !== JSON.stringify(existing.itemScope) ||
          JSON.stringify(participantScope) !== JSON.stringify(existing.participantScope)
        ) {
          refusals.push({ reason: 'ended-phase-name-only', phaseId: spec.id, index })
        }
      }
    }
    return refusals
  }

  /** the current phase's profile and scopes, null before any phase is in effect */
  const gateView = (tenantId: string, batch: BatchRow, now: EpochMillis) =>
    Effect.gen(function* () {
      const plan = toSnapshots(yield* listPhaseRows(tenantId, batch.id))
      const state = effectiveState(plan, now)
      // a draft batch has no phase in effect whatever its rows say; an
      // archived one still answers by its terminal profile
      if (batch.status === 'draft' || state.phase === null) return null
      const scopes = yield* phaseScopes(tenantId, state.phase.id)
      return {
        profile: state.phase.permissionProfile,
        itemScope: scopes.items,
        participantScope: scopes.participants,
      }
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
  const chainPreviewOf = (
    tenantId: string,
    lineage: readonly { nodeId: string; nodeTypeId: string }[],
  ) =>
    Effect.map(
      roleHoldersAt(
        tenantId,
        lineage.map((step) => step.nodeId),
      ),
      (holders) =>
        lineage.map((step): ChainPreviewStep => ({
          nodeId: step.nodeId,
          nodeTypeId: step.nodeTypeId,
          holders: holders.get(step.nodeId) ?? 0,
        })),
    )

  /** the shared guards of every roster write, inside its transaction */
  const rosterWriteGuards = (tenantId: string, batchId: string, as: Principal) =>
    Effect.gen(function* () {
      const locked = yield* lockBatch(tenantId, batchId)
      if (!locked) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      if (locked.status === 'archived') return yield* new BatchReadOnly()
      // a draft has no roster to manage: activation is what creates one
      if (locked.status !== 'active') {
        return yield* new ParticipantInvalid({ reason: 'batch-not-active' })
      }
      return locked
    })

  const templatePermission = (as: Principal) =>
    Effect.flatMap(rbac.hasPermission(as, MANAGE), (held) =>
      held
        ? Effect.void
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
  const requireBatchVisible = Effect.fn('Assessment.requireBatchVisible')(function* (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) {
    const visible = yield* dieQuery(withDb(batchVisibleTo(tenantId, batchId, yield* viewerOf(as))))
    if (!visible) return yield* new AccessDenied({ reason: 'cannot see this batch' })
  })

  /**
   * Managing a round means managing everybody in it.
   *
   * The roster is the batch's only population, so it is the only thing this
   * can be measured against. A round nobody has been added to yet asks for
   * the permission itself: there is nothing to be outside of, and a draft its
   * own author could not open would be unusable.
   */
  const requireRosterReach = (as: Principal, tenantId: string, batchId: string) =>
    Effect.gen(function* () {
      const anchors = yield* dieQuery(withDb(rosterAnchors(tenantId, batchId)))
      if (anchors.length === 0) {
        const held = yield* rbac.hasPermission(as, MANAGE)
        if (!held) {
          return yield* new AccessDenied({ reason: 'cannot manage assessment batches' })
        }
        return
      }
      for (const nodeId of anchors) yield* rbac.requireAt(as, MANAGE, nodeId)
    })

  /** administering who may work on a batch is administering the batch */
  const requireBatchAdministration = (tenantId: string, batchId: string, as: Principal) =>
    Effect.gen(function* () {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
    })

  /** this batch, as an object authority can be confined to */
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
        codes: [...STAFF_CODES],
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
  ) {
    const [sources, denies, assignments] = yield* Effect.all([
      dieQuery(withDb(accessSources(tenantId, batchId))),
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
    const access = yield* readAccess(tenantId, batchId)
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
    const [sources, assignments] = yield* Effect.all([
      dieQuery(withDb(accessSources(tenantId, batchId))),
      applicableAssignments(tenantId, batchId),
    ])
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

  return Assessment.of({
    createBatch: Effect.fn('Assessment.createBatch')(function* (tenantId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const nodes = yield* validateScopeSelection(tenantId, input.import.orgNodeIds)
            for (const node of nodes) yield* rbac.requireAt(as, MANAGE, node.id)
            const created = yield* insertBatch({
              tenantId,
              name: input.name,
              descriptionMd: input.descriptionMd ?? null,
              materialStart: input.materialRange.start,
              materialEnd: input.materialRange.end,
              ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            })
            const batchId = created.id as string
            // The one place these units are used, and the last: they are the
            // query that fills the batch's two populations, not a definition
            // it will have to be kept in step with afterwards. Who takes part
            // is the roster from here on; who may work on it is what was
            // accepted here, and both are changed by somebody deciding to.
            const nodeIds = nodes.map((node) => node.id)
            const userTypeIds = [...new Set(input.import.userTypeIds)]
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
                codes: [...STAFF_CODES],
                nodeIds,
              }),
              'inherited',
              as.userId,
            )
            const batch = yield* oneBatch(tenantId, batchId)
            return yield* readDetail(tenantId, batch!)
          }),
        ),
      ).pipe(
        translateConstraints(batchConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
    }),

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
      const byBatch = new Map<string, PhaseRow[]>()
      for (const phase of phases) {
        byBatch.set(phase.batchId, [...(byBatch.get(phase.batchId) ?? []), phase])
      }
      return rows.map((row) => ({
        ...row,
        timeline: deriveTimeline(toSnapshots(byBatch.get(row.id) ?? []), now),
      }))
    }),

    countBatches: Effect.fn('Assessment.countBatches')(function* (tenantId, filter, as) {
      return yield* dieQuery(withDb(countBatches(tenantId, yield* viewerOf(as), filter)))
    }),

    assertVisible: requireBatchVisible,

    getBatch: Effect.fn('Assessment.getBatch')(function* (tenantId, batchId, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireBatchVisible(tenantId, batchId, as)
      return yield* dieQuery(withDb(readDetail(tenantId, batch)))
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
              diff.timezone = [before.timezone, input.timezone]
            }
            if (input.materialRange !== undefined) {
              const current = parseRange(before.materialRange)
              if (
                current.start !== input.materialRange.start ||
                current.end !== input.materialRange.end
              ) {
                diff.materialRange = [current, input.materialRange]
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
            })

            yield* recordConfigChange(
              tenantId,
              batchId,
              locked.status as string,
              diff,
              as.userId,
              input.reason ?? null,
            )

            const batch = yield* oneBatch(tenantId, batchId)
            return yield* readDetail(tenantId, batch!)
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
              const from = locked.status as string
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
                yield* updateBatchFields(tenantId, batchId, { status: 'archived' })
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
                const phaseId = yield* insertPhase({
                  tenantId,
                  batchId,
                  ordinal: rows.length,
                  phaseKey: freshPhaseKey(rows),
                  displayName: input.phase.displayName.trim(),
                  description: input.phase.description?.trim() ?? '',
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

              const batch = yield* oneBatch(tenantId, batchId)
              return yield* readDetail(tenantId, batch!)
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    listAccess: Effect.fn('Assessment.listAccess')(function* (tenantId, batchId, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      return asSeenBy(yield* readAccess(tenantId, batchId), as)
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
        const assignments = yield* applicableAssignments(tenantId, batchId)
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
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
              for (const choice of input.accept) {
                const change = offered.get(`${choice.kind}/${choice.id}`)
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
              return { merged }
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
      if (!STAFF_CODES.includes(input.permission as never)) {
        return yield* new AccessInvalid({ reason: 'permission-not-known' })
      }
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
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

    addStaff: Effect.fn('Assessment.addStaff')(function* (tenantId, batchId, input, as) {
      yield* requireBatchAdministration(tenantId, batchId, as)
      const now = yield* Clock.currentTimeMillis
      if (input.validUntil !== undefined && input.validUntil <= now) {
        return yield* new AccessInvalid({ reason: 'expiry-in-past' })
      }
      // The role decides what they may do, so the role is what is checked.
      // Anything a batch is not allowed to hand out at all - administering the
      // batch, administering this very list - makes the whole role ineligible
      // rather than being quietly dropped from it.
      const carried = yield* rbac.getRolePermissions(tenantId, input.roleId)
      if (carried.length === 0) return yield* new AccessInvalid({ reason: 'role-not-usable' })
      for (const code of carried) {
        if (!STAFF_CODES.includes(code as never)) {
          return yield* new AccessInvalid({ reason: 'permission-not-delegatable' })
        }
      }
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const [node] = yield* nodesByIds(tenantId, [input.orgNodeId])
            if (!node) return yield* new AccessInvalid({ reason: 'node-not-found' })
            const [user] = yield* namesOf(tenantId, [input.userId])
            if (!user) return yield* new AccessInvalid({ reason: 'user-not-found' })
            // Delegation, the plain rule: nobody hands out authority they do
            // not hold, over people they do not already administer.
            if (!(yield* rbac.canAt(as, MANAGE, input.orgNodeId))) {
              return yield* new AccessInvalid({ reason: 'node-out-of-reach' })
            }
            for (const code of carried) {
              if (!(yield* rbac.canAt(as, code, input.orgNodeId))) {
                return yield* new AccessInvalid({ reason: 'permission-not-held' })
              }
            }
            // One act, two records: the tenant's assignment, confined to this
            // batch, and this batch accepting exactly what it carries today.
            // Even here the ceiling is written down - a shared reviewer role
            // that gains a capability next month must not widen this round.
            const assignmentId = yield* rbac.createScopedAssignment({
              tenantId,
              subjectId: input.userId,
              roleId: input.roleId,
              orgNodeId: input.orgNodeId,
              includeDescendants: true,
              resource: batchResource(batchId),
              ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
              createdBy: as.userId,
            })
            yield* acceptAccessSource({
              tenantId,
              batchId,
              roleAssignmentId: assignmentId,
              subjectId: input.userId,
              origin: 'explicit',
              permissions: carried,
              acceptedBy: as.userId,
            })
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
            const from = locked.status as string
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
            yield* deleteBatchRow(tenantId, batchId)
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
              const review = reviewPlan(added.map(specToEngine))
              if (review.refusals.length > 0) {
                return yield* new PlanInvalid({ refusals: review.refusals })
              }
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
              const phases = yield* readPlan(tenantId, batchId)
              return { phases, warnings: review.warnings }
            }

            const specs = body.specs ?? []
            const unknown = specs.find(
              (spec) => spec.id !== undefined && !existingById.has(spec.id),
            )
            if (unknown) {
              return yield* new PlanInvalid({
                refusals: [{ reason: 'phase-not-found', phaseId: unknown.id! }],
              })
            }

            if (draft) {
              // a draft plan is replaced as a whole: ids are kept where
              // given, rows absent from the submission go away
              const review = reviewPlan(specs.map(specToEngine))
              const scoped = scopeRefusals(specs, existingById, participants, new Set())
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
            if (
              JSON.stringify(submittedIds.filter((id) => committedIds.includes(id))) !==
              JSON.stringify(committedIds)
            ) {
              refusals.push({ reason: 'reorder-not-allowed', phaseId: null })
            }
            if (refusals.length > 0) return yield* new PlanInvalid({ refusals })

            const effective = effectiveState(toSnapshots(rows), now)
            const endedIds = new Set(
              rows.filter((_, index) => index < effective.index).map((row) => row.id),
            )
            refusals.push(...scopeRefusals(specs, existingById, participants, endedIds))

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
              const fieldsChanged = fieldEditsOf(existing, spec).length > 0
              const scopesChanged =
                JSON.stringify(normalScope(spec.itemScope)) !==
                  JSON.stringify(existing.itemScope) ||
                JSON.stringify(normalScope(spec.participantScope)) !==
                  JSON.stringify(existing.participantScope)
              return fieldsChanged || scopesChanged ? [spec.id] : []
            })
            const insertedKeys = specs.flatMap((spec) =>
              spec.id === undefined ? [spec.phaseKey] : [],
            )
            if (editedIds.length + insertedKeys.length > 0) {
              yield* recordConfigChange(
                tenantId,
                batchId,
                locked.status as string,
                { phasePlan: { edited: editedIds, inserted: insertedKeys } },
                actorId,
                null,
              )
            }
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
                locked.status as string,
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
              for (const nodeId of yield* rosterAnchors(tenantId, batchId)) {
                yield* rbac.requireAt(as, FORCE_ADVANCE, nodeId)
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

            return yield* readPlan(tenantId, batchId)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    timeline: Effect.fn('Assessment.timeline')(function* (tenantId, batchId) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      const plan = toSnapshots(yield* dieQuery(withDb(listPhaseRows(tenantId, batchId))))
      return deriveTimeline(plan, yield* Clock.currentTimeMillis)
    }),

    gate: Effect.fn('Assessment.gate')(function* (tenantId, batchId, code, ctx) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      const now = yield* Clock.currentTimeMillis
      const view = yield* dieQuery(withDb(gateView(tenantId, batch, now)))
      return decide(view, code, ctx)
    }),

    authorizeEntryAction: Effect.fn('Assessment.authorizeEntryAction')(
      function* (principal, code, batchId, ctx) {
        // Layer one: authority in THIS batch, which is not the same question
        // as authority in the tenant.
        //
        // A participant needs no grant: being on the roster is what a
        // participant's capabilities are made of, and five hundred students
        // times five permissions would be two and a half thousand rows saying
        // it again. Everybody else holds what this batch accepted from the
        // tenant and has not taken back, or what this batch granted directly.
        //
        // Which node it applies to is not asked yet: entries do not exist, so
        // there is no object to locate. When they do, the participant's frozen
        // lineage is what the scopes here get compared against.
        const held = PARTICIPANT_CODES.includes(code as never)
          ? (yield* dieQuery(
              withDb(participantByUser(principal.tenantId, batchId, principal.userId)),
            )) !== null
          : (yield* batchAuthority(principal.tenantId, batchId, principal.userId)).has(code)
        if (!held) {
          return { allowed: false, layer: 'rbac', reason: 'permission-not-held' } as const
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
      },
    ),

    listTemplates: Effect.fn('Assessment.listTemplates')(function* (tenantId, filter, as) {
      yield* templatePermission(as)
      return yield* dieQuery(withDb(listTemplatesPage(tenantId, filter)))
    }),

    createTemplate: Effect.fn('Assessment.createTemplate')(function* (tenantId, input, as) {
      yield* templatePermission(as)
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

    listParticipants: Effect.fn('Assessment.listParticipants')(
      function* (tenantId, batchId, filter, as) {
        const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        yield* requireRosterReach(as, tenantId, batchId)
        return yield* dieQuery(withDb(listParticipantsPage(tenantId, batchId, filter)))
      },
    ),

    addParticipants: Effect.fn('Assessment.addParticipants')(
      function* (tenantId, batchId, userIds, as) {
        return yield* withDb(
          transaction(
            Effect.gen(function* () {
              yield* rosterWriteGuards(tenantId, batchId, as)
              const wanted = [...new Set(userIds)]
              if (wanted.length === 0) return { added: 0, skipped: 0 }
              // everybody added has to be somebody this caller administers:
              // the roster is what batch authority is measured against, so
              // adding a stranger would widen it by writing a row
              const positions = yield* Effect.forEach(wanted, (userId) =>
                userLivePosition(tenantId, userId),
              )
              for (const position of positions) {
                if (!position) return yield* new ParticipantInvalid({ reason: 'user-not-found' })
                if (!position.enabled) {
                  return yield* new ParticipantInvalid({ reason: 'user-not-eligible' })
                }
                if (!(yield* rbac.canAt(as, MANAGE, position.nodeId))) {
                  return yield* new ParticipantInvalid({ reason: 'user-out-of-scope' })
                }
              }
              const added = yield* insertParticipants(tenantId, batchId, wanted, as.userId)
              return { added: added.length, skipped: wanted.length - added.length }
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

    listImports: Effect.fn('Assessment.listImports')(function* (tenantId, batchId, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* requireRosterReach(as, tenantId, batchId)
      const rows = yield* dieQuery(withDb(rosterImports(tenantId, batchId)))
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
      return rows.map((row) => ({
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
      }))
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
              yield* setParticipantStatus(
                tenantId,
                participantId,
                to,
                yield* Clock.currentTimeMillis,
                { userId: as.userId, reason: reason ?? null },
              )
              return (yield* oneParticipant(tenantId, batchId, participantId))!
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      },
    ),

    scopeOptions: Effect.fn('Assessment.scopeOptions')(function* (tenantId, as) {
      // no separate permission: what a batch may face is what this caller may
      // manage, so the authorization scope IS the option list
      const held = yield* rbac.listAuthorizedScope(as, MANAGE)
      yield* templatePermission(as)
      return yield* dieQuery(withDb(scopeOptionRows(tenantId, held, SCOPE_OPTION_LIMIT)))
    }),

    userTypeOptions: Effect.fn('Assessment.userTypeOptions')(function* (tenantId, as) {
      yield* templatePermission(as)
      return yield* dieQuery(withDb(userTypeOptionRows(tenantId)))
    }),

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
              return swept.ratified
            }),
          ),
        ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
      }
      return { scanned: candidates.length, ratified }
    }).pipe(Effect.withSpan('Assessment.sweepDueBoundaries')),
  })
})

export const serviceLayer: Layer.Layer<Assessment, never, Orm | Rbac> = Layer.effect(
  Assessment,
  make(),
)

// --- api ---

const isoOf = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

const parseInstant = (value: string) => {
  const ms = Date.parse(value)
  return Number.isNaN(ms)
    ? Effect.fail(new BadRequest({ message: `unreadable instant: ${value}` }))
    : Effect.succeed(ms)
}

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
  createdAt: new Date(detail.createdAt).toISOString(),
})

const toPhaseDto = (row: PlanPhase) => ({
  id: row.id,
  ordinal: row.ordinal,
  phaseKey: row.phaseKey,
  displayName: row.displayName,
  description: row.description,
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
  readonly permissionProfile?: readonly string[]
  readonly itemScope?: readonly string[]
  readonly participantScope?: readonly string[]
}

const parseSpec = (spec: WirePhaseSpec) =>
  Effect.gen(function* () {
    const parsed: PhaseSpecInput = {
      ...(spec.id !== undefined ? { id: spec.id } : {}),
      phaseKey: spec.phaseKey,
      displayName: spec.displayName,
      description: spec.description ?? '',
      permissionProfile: spec.permissionProfile ?? [],
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
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const after =
          key === undefined ? undefined : { createdAt: Date.parse(key[0]!), id: key[1]! }
        if (after !== undefined && Number.isNaN(after.createdAt)) return yield* cursorUnusable()
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
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          total,
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
              ? encodeQueryCursor(fingerprint, [new Date(last.createdAt).toISOString(), last.id])
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
        return { batch: toBatchDto(detail) }
      }),
    )
    .handle(
      'getBatch',
      Effect.fn('assessment.getBatch.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const detail = yield* assessment.getBatch(principal.tenantId, params.batchId, principal)
        return { batch: toBatchDto(detail) }
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
        return { batch: toBatchDto(detail) }
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
                  payload.plannedEntryAt === null ? null : Date.parse(payload.plannedEntryAt),
              },
          principal,
        )
        return { batch: toBatchDto(detail) }
      }),
    )
    .handle(
      'listAccess',
      Effect.fn('assessment.listAccess.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.listAccess(principal.tenantId, params.batchId, principal)
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
      'addStaff',
      Effect.fn('assessment.addStaff.handler')(function* ({ params, payload }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        return yield* assessment.addStaff(
          principal.tenantId,
          params.batchId,
          {
            userId: payload.userId,
            roleId: payload.roleId,
            orgNodeId: payload.orgNodeId,
            ...(payload.validUntil !== undefined
              ? { validUntil: Date.parse(payload.validUntil) }
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
        return { phases: phases.map(toPhaseDto) }
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
            phaseKey: entry.phaseKey,
            displayName: entry.displayName,
            description: entry.description,
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
      'listParticipants',
      Effect.fn('assessment.listParticipants.handler')(function* ({ params, query }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const fingerprint = `assessment.participants:${params.batchId}:${query.status ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* assessment.listParticipants(
          principal.tenantId,
          params.batchId,
          {
            ...(query.status !== undefined ? { status: query.status } : {}),
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
        return yield* assessment.previewImport(principal.tenantId, params.batchId, query, principal)
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
      Effect.fn('assessment.listImports.handler')(function* ({ params }) {
        const assessment = yield* Assessment
        const principal = yield* CurrentUser
        const imports = yield* assessment.listImports(principal.tenantId, params.batchId, principal)
        return {
          imports: imports.map((row) => ({
            ...row,
            occurredAt: new Date(row.occurredAt).toISOString(),
          })),
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
    ),
)
