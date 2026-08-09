import { Context, Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { BadRequest, cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { CurrentUser } from '@qualy/plugin-auth/server/session'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { assessmentApiGroup } from '../api.ts'
import {
  reviewInsertion,
  reviewPlan,
  reviewPlanEdit,
  reviewPlanShape,
  type EditWarning,
  type NewPhaseSpec,
  type PlanEdit,
} from '../phase/engine/edits.ts'
import { materializeOffsets } from '../phase/engine/materialize.ts'
import { effectiveState, normalizePlan } from '../phase/engine/queue.ts'
import { deriveTimeline, type TimelineEntry } from '../phase/engine/timeline.ts'
import type {
  EntryOffset,
  EpochMillis,
  PhasePlan,
  PublicationLookup,
} from '../phase/engine/types.ts'
import { gateAllows, type GateContext, type GateDecision } from '../phase/gate.ts'
import {
  AdvanceInvalid,
  BatchNoUserTypes,
  BatchNotFound,
  BatchReadOnly,
  BatchReferenceInvalid,
  BatchScopeLocked,
  BatchStatusInvalid,
  PhaseNotFound,
  PlanInvalid,
  TemplateConflict,
  TemplateNotFound,
  batchConstraints,
  templateConstraints,
  type AdvancePhaseError,
  type CreateBatchError,
  type ReplacePlanError,
  type SetBatchStatusError,
  type UpdateBatchError,
} from './errors.ts'
import {
  batchParticipantIds,
  bumpConfigRevision,
  deletePhases,
  deleteTemplateRow,
  generateRoster,
  insertBatch,
  insertConfigEvent,
  insertPhase,
  insertPhaseEvent,
  insertTemplate,
  listBatchUserTypes,
  listBatchesPage,
  listPhaseRows,
  listTemplatesPage,
  lockBatch,
  oneBatch,
  oneOrgNode,
  oneTemplate,
  phaseScopes,
  replaceBatchUserTypes,
  replacePhaseScopes,
  scopesForBatch,
  setCurrentPhase,
  setPhaseActual,
  updateBatchFields,
  updatePhaseFields,
  updateTemplateRow,
  type BatchRow,
  type PhaseRow,
  type TemplateRow,
} from './db.ts'

// The assessment service: the engine's answers, wired to rows. Every write
// serializes on its batch row, "entered" is decided by the clock, and the
// engine's structured refusals go to the wire as they are.

/** publications do not exist yet; a bound boundary in the database is corrupt */
const NO_PUBLICATIONS: PublicationLookup = new Map()

export interface MaterialRange {
  readonly start: string
  readonly end: string
}

export interface BatchDetail {
  readonly id: string
  readonly name: string
  readonly descriptionMd: string | null
  readonly scopeNodeId: string
  readonly materialRange: MaterialRange
  readonly timezone: string
  readonly status: 'draft' | 'active' | 'archived'
  readonly configRevision: number
  readonly currentPhaseId: string | null
  readonly userTypeIds: readonly string[]
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
  readonly scopeNodeId: string
  readonly materialRange: MaterialRange
  readonly timezone?: string
  readonly userTypeIds: readonly string[]
}

export interface UpdateBatchInput {
  readonly name?: string
  readonly descriptionMd?: string | null
  readonly scopeNodeId?: string
  readonly materialRange?: MaterialRange
  readonly timezone?: string
  readonly userTypeIds?: readonly string[]
  readonly reason?: string
}

/** an allowance as a set: order and repetition carry no meaning */
const normalScope = (ids: readonly string[] | undefined): readonly string[] =>
  [...new Set(ids ?? [])].sort()

export type ActionDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly layer: 'rbac' | 'gate' | 'policy'; readonly reason: string }

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
      entryTrigger: row.entryTrigger,
      plannedEntryAt: row.plannedEntryAt,
      actualEntryAt: row.actualEntryAt,
      entryOffset: row.entryOffset,
      estimatedEntryAt: row.estimatedEntryAt,
      opensPublicationId: row.opensPublicationId,
      permissionProfile: row.permissionProfile,
    })),
  )

const specToEngine = (spec: PhaseSpecInput): NewPhaseSpec => ({
  phaseKey: spec.phaseKey,
  displayName: spec.displayName,
  entryTrigger: spec.entryTrigger,
  plannedEntryAt: spec.plannedEntryAt ?? null,
  entryOffset: spec.entryOffset ?? null,
  estimatedEntryAt: spec.estimatedEntryAt ?? null,
  permissionProfile: spec.permissionProfile ?? [],
})

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
        after?: { createdAt: EpochMillis; id: string }
        limit: number
      },
      as: Principal,
    ) => Effect.Effect<readonly BatchRow[]>
    readonly getBatch: (
      tenantId: string,
      batchId: string,
      as: Principal,
    ) => Effect.Effect<BatchDetail, BatchNotFound | AccessDenied>
    readonly updateBatch: (
      tenantId: string,
      batchId: string,
      input: UpdateBatchInput,
      as: Principal,
    ) => Effect.Effect<BatchDetail, UpdateBatchError>
    readonly setBatchStatus: (
      tenantId: string,
      batchId: string,
      to: 'active' | 'archived',
      as: Principal,
    ) => Effect.Effect<BatchDetail, SetBatchStatusError>
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
      filter: { after?: { name: string; id: string }; limit: number },
      as: Principal,
    ) => Effect.Effect<readonly TemplateRow[], AccessDenied>
    readonly createTemplate: (
      tenantId: string,
      input: { name: string; phases: readonly PhaseSpecInput[] },
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

  const readDetail = (tenantId: string, batch: BatchRow) =>
    Effect.map(listBatchUserTypes(tenantId, batch.id), (userTypeIds): BatchDetail => ({
      id: batch.id,
      name: batch.name,
      descriptionMd: batch.descriptionMd,
      scopeNodeId: batch.scopeNodeId,
      materialRange: parseRange(batch.materialRange),
      timezone: batch.timezone,
      status: batch.status as BatchDetail['status'],
      configRevision: batch.configRevision,
      currentPhaseId: batch.currentPhaseId,
      userTypeIds,
      createdAt: batch.createdAt,
    }))

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
      const state = effectiveState(plan, NO_PUBLICATIONS, now)
      for (const pending of state.pending) {
        const wrote = yield* setPhaseActual(tenantId, pending.phaseId, pending.actualEntryAt)
        if (wrote) {
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
      return state
    })

  const fieldEditsOf = (existing: PhaseRow, spec: PhaseSpecInput): PlanEdit[] => {
    const edits: PlanEdit[] = []
    if (spec.displayName !== existing.displayName) {
      edits.push({ kind: 'rename', phaseId: existing.id, displayName: spec.displayName })
    }
    const planned = spec.plannedEntryAt ?? null
    if (planned !== existing.plannedEntryAt) {
      edits.push({ kind: 'set-planned', phaseId: existing.id, plannedEntryAt: planned })
    }
    const offset = spec.entryOffset ?? null
    if (JSON.stringify(offset) !== JSON.stringify(existing.entryOffset)) {
      edits.push({ kind: 'set-offset', phaseId: existing.id, entryOffset: offset })
    }
    const estimated = spec.estimatedEntryAt ?? null
    if (estimated !== existing.estimatedEntryAt) {
      edits.push({ kind: 'set-estimated', phaseId: existing.id, estimatedEntryAt: estimated })
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
      case 'set-offset':
        return { kind: 'offset-changed' }
      case 'set-estimated':
        return { kind: 'estimated-changed' }
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
        case 'set-offset':
          return { ...phase, entryOffset: edit.entryOffset }
        case 'set-estimated':
          return { ...phase, estimatedEntryAt: edit.estimatedEntryAt }
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
            entryTrigger: spec.entryTrigger,
            plannedEntryAt: spec.plannedEntryAt ?? null,
            entryOffset: (spec.entryOffset ?? null) as Record<string, unknown> | null,
            estimatedEntryAt: spec.estimatedEntryAt ?? null,
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
            entryTrigger: spec.entryTrigger,
            plannedEntryAt: spec.plannedEntryAt ?? null,
            entryOffset: (spec.entryOffset ?? null) as Record<string, unknown> | null,
            estimatedEntryAt: spec.estimatedEntryAt ?? null,
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
      const state = effectiveState(plan, NO_PUBLICATIONS, now)
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

  const templatePermission = (as: Principal) =>
    Effect.flatMap(rbac.hasPermission(as, MANAGE), (held) =>
      held
        ? Effect.void
        : Effect.fail(new AccessDenied({ reason: 'cannot manage assessment batches' })),
    )

  return Assessment.of({
    createBatch: Effect.fn('Assessment.createBatch')(function* (tenantId, input, as) {
      yield* rbac.requireAt(as, MANAGE, input.scopeNodeId)
      const node = yield* dieQuery(withDb(oneOrgNode(tenantId, input.scopeNodeId)))
      if (!node) return yield* new BatchReferenceInvalid({ reference: 'scope-node' })
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const created = yield* insertBatch({
              tenantId,
              name: input.name,
              descriptionMd: input.descriptionMd ?? null,
              scopeNodeId: input.scopeNodeId,
              scopePath: node.path,
              materialStart: input.materialRange.start,
              materialEnd: input.materialRange.end,
              ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            })
            yield* replaceBatchUserTypes(tenantId, created.id as string, [
              ...new Set(input.userTypeIds),
            ])
            const batch = yield* oneBatch(tenantId, created.id as string)
            return yield* readDetail(tenantId, batch!)
          }),
        ),
      ).pipe(
        translateConstraints(batchConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
    }),

    listBatches: Effect.fn('Assessment.listBatches')(function* (tenantId, filter, as) {
      const held = yield* rbac.listAuthorizedScope(as, MANAGE)
      return yield* dieQuery(withDb(listBatchesPage(tenantId, held, filter)))
    }),

    getBatch: Effect.fn('Assessment.getBatch')(function* (tenantId, batchId, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* rbac.requireAt(as, MANAGE, batch.scopeNodeId)
      return yield* dieQuery(withDb(readDetail(tenantId, batch)))
    }),

    updateBatch: Effect.fn('Assessment.updateBatch')(function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* rbac.requireAt(as, MANAGE, locked.scopeNodeId as string)
            if (locked.status === 'archived') return yield* new BatchReadOnly()

            const before = (yield* oneBatch(tenantId, batchId))!
            const beforeTypes = yield* listBatchUserTypes(tenantId, batchId)

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
            const nextTypes =
              input.userTypeIds === undefined ? undefined : [...new Set(input.userTypeIds)].sort()
            if (
              nextTypes !== undefined &&
              JSON.stringify(nextTypes) !== JSON.stringify(beforeTypes)
            ) {
              diff.userTypeIds = [beforeTypes, nextTypes]
            }

            // the scope is repointable exactly while no roster depends on it
            let scopeMove: { scopeNodeId: string; scopePath: string } | undefined
            if (input.scopeNodeId !== undefined && input.scopeNodeId !== before.scopeNodeId) {
              if (locked.status !== 'draft') return yield* new BatchScopeLocked()
              yield* rbac.requireAt(as, MANAGE, input.scopeNodeId)
              const node = yield* oneOrgNode(tenantId, input.scopeNodeId)
              if (!node) return yield* new BatchReferenceInvalid({ reference: 'scope-node' })
              scopeMove = { scopeNodeId: node.id, scopePath: node.path }
              diff.scopeNodeId = [before.scopeNodeId, node.id]
            }

            yield* updateBatchFields(tenantId, batchId, {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.descriptionMd !== undefined ? { descriptionMd: input.descriptionMd } : {}),
              ...(scopeMove !== undefined ? scopeMove : {}),
              ...(input.materialRange !== undefined
                ? {
                    materialStart: input.materialRange.start,
                    materialEnd: input.materialRange.end,
                  }
                : {}),
              ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            })
            if (nextTypes !== undefined) {
              yield* replaceBatchUserTypes(tenantId, batchId, nextTypes)
            }

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

    setBatchStatus: Effect.fn('Assessment.setBatchStatus')(function* (tenantId, batchId, to, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* rbac.requireAt(as, MANAGE, locked.scopeNodeId as string)
            const from = locked.status as string
            const now = Date.now()

            if (to === 'active') {
              if (from !== 'draft') return yield* new BatchStatusInvalid({ from, to })
              const userTypes = yield* listBatchUserTypes(tenantId, batchId)
              if (userTypes.length === 0) return yield* new BatchNoUserTypes()
              const rows = yield* listPhaseRows(tenantId, batchId)
              if (rows.length === 0) {
                return yield* new PlanInvalid({
                  refusals: [{ reason: 'plan-empty', phaseId: null }],
                })
              }
              // the whole plan, revalidated against the activation clock: a
              // draft saved with future dates may have gone stale on the
              // shelf, and a phase must not begin before its batch exists
              const review = reviewPlan(
                rows.map((row) => ({
                  phaseKey: row.phaseKey,
                  displayName: row.displayName,
                  entryTrigger: row.entryTrigger,
                  plannedEntryAt: row.plannedEntryAt,
                  entryOffset: row.entryOffset,
                  estimatedEntryAt: row.estimatedEntryAt,
                  permissionProfile: row.permissionProfile,
                })),
                now,
              )
              if (review.refusals.length > 0) {
                return yield* new PlanInvalid({ refusals: review.refusals })
              }
              // the roster in one statement, frozen as of this transaction
              yield* generateRoster(tenantId, batchId, locked.scopeNodeId as string)
              yield* updateBatchFields(tenantId, batchId, { status: 'active' })
            } else {
              if (from !== 'active') return yield* new BatchStatusInvalid({ from, to })
              const plan = toSnapshots(yield* listPhaseRows(tenantId, batchId))
              // stand-in for the archive gate: the batch must have reached
              // its terminal phase; publication conditions arrive with them
              const state = yield* ratifyPending(tenantId, batchId, plan, now)
              if (state.index !== plan.length - 1) {
                return yield* new BatchStatusInvalid({ from, to })
              }
              yield* updateBatchFields(tenantId, batchId, { status: 'archived' })
            }

            const batch = yield* oneBatch(tenantId, batchId)
            return yield* readDetail(tenantId, batch!)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    getPlan: Effect.fn('Assessment.getPlan')(function* (tenantId, batchId, as) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      yield* rbac.requireAt(as, MANAGE, batch.scopeNodeId)
      return yield* dieQuery(withDb(readPlan(tenantId, batchId)))
    }),

    replacePlan: Effect.fn('Assessment.replacePlan')(function* (tenantId, batchId, body, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* rbac.requireAt(as, MANAGE, locked.scopeNodeId as string)
            if (locked.status === 'archived') return yield* new BatchReadOnly()
            const draft = locked.status === 'draft'
            const rows = yield* readPlan(tenantId, batchId)
            const existingById = new Map(rows.map((row) => [row.id, row]))
            const participants = yield* batchParticipantIds(tenantId, batchId)
            const now = Date.now()
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
              const specs = template.phases as unknown as readonly PhaseSpecInput[]
              const review = reviewPlan(specs.map(specToEngine), now)
              if (review.refusals.length > 0) {
                return yield* new PlanInvalid({ refusals: review.refusals })
              }
              yield* deletePhases(tenantId, batchId, [...existingById.keys()])
              yield* writePlanOrder(tenantId, batchId, specs, new Map(), {
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
              const review = reviewPlan(specs.map(specToEngine), now)
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
            for (const row of rows) {
              if (!submittedIds.includes(row.id)) {
                refusals.push({ reason: 'phase-removed', phaseId: row.id })
              }
            }
            if (
              JSON.stringify(submittedIds) !==
              JSON.stringify(rows.map((row) => row.id).filter((id) => submittedIds.includes(id)))
            ) {
              refusals.push({ reason: 'reorder-not-allowed', phaseId: null })
            }
            if (refusals.length > 0) return yield* new PlanInvalid({ refusals })

            const effective = effectiveState(toSnapshots(rows), NO_PUBLICATIONS, now)
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
                if (spec.entryTrigger !== existing.entryTrigger) {
                  refusals.push({ reason: 'trigger-immutable', phaseId: spec.id })
                }
                for (const edit of fieldEditsOf(existing, spec)) {
                  const review = reviewPlanEdit(working, NO_PUBLICATIONS, now, edit)
                  refusals.push(...review.refusals)
                  warnings.push(...review.warnings)
                  if (review.refusals.length === 0) working = applyToPlan(working, edit)
                }
              } else {
                const engineSpec = specToEngine(spec)
                const review = reviewInsertion(working, NO_PUBLICATIONS, now, index, engineSpec)
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
                      entryTrigger: engineSpec.entryTrigger,
                      plannedEntryAt: engineSpec.plannedEntryAt ?? null,
                      actualEntryAt: null,
                      entryOffset: engineSpec.entryOffset ?? null,
                      estimatedEntryAt: engineSpec.estimatedEntryAt ?? null,
                      opensPublicationId: null,
                      permissionProfile: engineSpec.permissionProfile ?? [],
                    },
                    ...working.slice(index),
                  ]
                }
              }
            }
            if (refusals.length > 0) return yield* new PlanInvalid({ refusals })

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

    advancePhase: Effect.fn('Assessment.advancePhase')(function* (tenantId, batchId, input, as) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            const locked = yield* lockBatch(tenantId, batchId)
            if (!locked) return yield* new BatchNotFound()
            yield* rbac.requireAt(as, MANAGE, locked.scopeNodeId as string)
            if (locked.status !== 'active') {
              return yield* new AdvanceInvalid({ reason: 'batch-not-active' })
            }
            const now = Date.now()
            const plan = toSnapshots(yield* listPhaseRows(tenantId, batchId))
            const targetIndex = plan.findIndex((phase) => phase.id === input.to)
            if (targetIndex === -1) return yield* new PhaseNotFound()
            const target = plan[targetIndex]!

            // the clock's crossings are ratified first, so "next" means next
            const state = yield* ratifyPending(tenantId, batchId, plan, now)
            if (targetIndex !== state.index + 1) {
              return yield* new AdvanceInvalid({ reason: 'target-not-next' })
            }
            // a publication boundary enters when its publication becomes
            // effective, and through nothing else - force is authority over
            // the clock, not over the invariant. The publication workflow
            // owns that entry (its actual is the publish instant).
            if (target.entryTrigger === 'publication') {
              return yield* new AdvanceInvalid({ reason: 'publication-boundary' })
            }
            // entering a scheduled boundary by hand overrides its own clock;
            // that is the forced path, and it must say why
            if (target.entryTrigger === 'scheduled' && input.force !== true) {
              return yield* new AdvanceInvalid({ reason: 'force-required' })
            }
            if (input.force === true) {
              yield* rbac.requireAt(as, FORCE_ADVANCE, locked.scopeNodeId as string)
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

            // the fresh actual is a determined anchor; offsets below become plans
            const advanced = toSnapshots(yield* listPhaseRows(tenantId, batchId))
            for (const update of materializeOffsets(advanced, NO_PUBLICATIONS)) {
              yield* updatePhaseFields(tenantId, update.phaseId, {
                plannedEntryAt: update.plannedEntryAt,
              })
              yield* insertPhaseEvent({
                tenantId,
                phaseId: update.phaseId,
                kind: 'offset-materialized',
                plannedAt: update.plannedEntryAt,
              })
            }
            return yield* readPlan(tenantId, batchId)
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),

    timeline: Effect.fn('Assessment.timeline')(function* (tenantId, batchId) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      const plan = toSnapshots(yield* dieQuery(withDb(listPhaseRows(tenantId, batchId))))
      return deriveTimeline(plan, NO_PUBLICATIONS, Date.now())
    }),

    gate: Effect.fn('Assessment.gate')(function* (tenantId, batchId, code, ctx) {
      const batch = yield* dieQuery(withDb(oneBatch(tenantId, batchId)))
      if (!batch) return yield* new BatchNotFound()
      const view = yield* dieQuery(withDb(gateView(tenantId, batch, Date.now())))
      return decide(view, code, ctx)
    }),

    authorizeEntryAction: Effect.fn('Assessment.authorizeEntryAction')(
      function* (principal, code, batchId, ctx) {
        // Layer one: identity authority. M1 asks "held at all"; anchored
        // resolution against a participant's frozen lineage arrives with
        // entries, which is also when org-node codes get a real target.
        const held = yield* rbac.hasPermission(principal, code)
        if (!held) {
          return { allowed: false, layer: 'rbac', reason: 'permission-not-held' } as const
        }
        // Layer two: the phase gate.
        const batch = yield* dieQuery(withDb(oneBatch(principal.tenantId, batchId)))
        if (!batch) return yield* new BatchNotFound()
        const view = yield* dieQuery(withDb(gateView(principal.tenantId, batch, Date.now())))
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
      // structural rules only; the clock is judged at application. Scopes
      // name batch-local rows, so a tenant-level template cannot carry them.
      const review = reviewPlan(input.phases.map(specToEngine), null)
      const scoped = templateScopeRefusals(input.phases)
      if (review.refusals.length + scoped.length > 0) {
        return yield* new PlanInvalid({ refusals: [...review.refusals, ...scoped] })
      }
      return yield* withDb(
        insertTemplate({ tenantId, name: input.name, phases: input.phases }),
      ).pipe(
        translateConstraints(templateConstraints),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
    }),

    updateTemplate: Effect.fn('Assessment.updateTemplate')(
      function* (tenantId, templateId, input, as) {
        yield* templatePermission(as)
        if (input.phases !== undefined) {
          const review = reviewPlan(input.phases.map(specToEngine), null)
          const scoped = templateScopeRefusals(input.phases)
          if (review.refusals.length + scoped.length > 0) {
            return yield* new PlanInvalid({ refusals: [...review.refusals, ...scoped] })
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
  scopeNodeId: detail.scopeNodeId,
  materialRange: detail.materialRange,
  timezone: detail.timezone,
  status: detail.status,
  configRevision: detail.configRevision,
  currentPhaseId: detail.currentPhaseId,
  userTypeIds: detail.userTypeIds,
  createdAt: new Date(detail.createdAt).toISOString(),
})

const toPhaseDto = (row: PlanPhase) => ({
  id: row.id,
  ordinal: row.ordinal,
  phaseKey: row.phaseKey,
  displayName: row.displayName,
  entryTrigger: row.entryTrigger,
  plannedEntryAt: isoOf(row.plannedEntryAt),
  actualEntryAt: isoOf(row.actualEntryAt),
  entryOffset: row.entryOffset,
  estimatedEntryAt: isoOf(row.estimatedEntryAt),
  opensPublicationId: row.opensPublicationId,
  permissionProfile: row.permissionProfile,
  itemScope: row.itemScope,
  participantScope: row.participantScope,
  sourceTemplateId: row.sourceTemplateId,
  sourceTemplateVersion: row.sourceTemplateVersion,
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
  readonly entryTrigger: 'scheduled' | 'manual' | 'publication'
  readonly plannedEntryAt?: string | null
  readonly entryOffset?: EntryOffset | null
  readonly estimatedEntryAt?: string | null
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
      entryTrigger: spec.entryTrigger,
      plannedEntryAt: spec.plannedEntryAt == null ? null : yield* parseInstant(spec.plannedEntryAt),
      entryOffset: spec.entryOffset ?? null,
      estimatedEntryAt:
        spec.estimatedEntryAt == null ? null : yield* parseInstant(spec.estimatedEntryAt),
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
  entryTrigger: spec.entryTrigger,
  plannedEntryAt: spec.plannedEntryAt == null ? null : isoOf(spec.plannedEntryAt),
  entryOffset: spec.entryOffset ?? null,
  estimatedEntryAt: spec.estimatedEntryAt == null ? null : isoOf(spec.estimatedEntryAt),
  permissionProfile: spec.permissionProfile ?? [],
})

const templateDto = (row: TemplateRow) => ({
  id: row.id,
  name: row.name,
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
        const fingerprint = `assessment.batches:${query.status ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const after =
          key === undefined ? undefined : { createdAt: Date.parse(key[0]!), id: key[1]! }
        if (after !== undefined && Number.isNaN(after.createdAt)) return yield* cursorUnusable()
        const found = yield* assessment.listBatches(
          principal.tenantId,
          {
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(after !== undefined ? { after } : {}),
            limit: limit + 1,
          },
          principal,
        )
        const page = found.slice(0, limit)
        const last = page[page.length - 1]
        return {
          items: page.map((row) => ({
            id: row.id,
            name: row.name,
            descriptionMd: row.descriptionMd,
            scopeNodeId: row.scopeNodeId,
            materialRange: parseRange(row.materialRange),
            timezone: row.timezone,
            status: row.status as 'draft' | 'active' | 'archived',
            configRevision: row.configRevision,
            currentPhaseId: row.currentPhaseId,
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
            scopeNodeId: payload.scopeNodeId,
            materialRange: payload.materialRange,
            ...(payload.timezone !== undefined ? { timezone: payload.timezone } : {}),
            userTypeIds: payload.userTypeIds,
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
          payload.status,
          principal,
        )
        return { batch: toBatchDto(detail) }
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
        const timeline = yield* assessment.timeline(principal.tenantId, params.batchId)
        return {
          timeline: timeline.map((entry) => ({
            phaseId: entry.phaseId,
            phaseKey: entry.phaseKey,
            displayName: entry.displayName,
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
          { name: payload.name, phases: yield* Effect.forEach(payload.phases, parseSpec) },
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
