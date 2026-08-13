import { Effect } from 'effect'
import { Db } from '@qualy/plugin-database/plugin'
import { sql } from 'kysely'
import { scopeCoverage, type AuthorizationScope } from '@qualy/rbac-contract'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities } from '../db/entities.ts'

// What assessment's queries may reach: its own tables plus org's, auth's and
// rbac's, because the roster freezes org positions, enrolls auth users, and
// the chain precheck (and later, stage membership) joins role grants; the
// descriptor declares database dependencies on all three.
//
// Instants cross this boundary as epoch milliseconds, extracted in sql: the
// engine reasons in numbers, and the driver's string format for timestamptz
// is not a contract worth parsing.

const closure = [...orgEntities, ...authEntities, ...rbacEntities, ...entities] as const

export const db = Db.scope(closure)

/** a timestamptz column as epoch milliseconds, exact at our precision */
const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

/**
 * An instant as the row hands it over, normalized to epoch milliseconds.
 *
 * The scoped kysely hydrates result columns through the entity metadata, so
 * an epoch alias that happens to share a datetime property's name comes back
 * as a Date - handing that to the engine turned addition into string
 * concatenation. Normalizing here keeps the numeric contract honest whatever
 * the hydration does.
 */
const msOf = (value: unknown): number | null =>
  value == null ? null : value instanceof Date ? value.getTime() : Number(value)

/** an epoch-millisecond instant as a bindable timestamptz value */
const instant = (ms: number) => sql`to_timestamp(${ms} / 1000.0)`

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

/** serializes writes on one batch; also how "does it exist" is asked before one */
export const lockBatch = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentBatch')
        .select(['id', 'status', 'configRevision'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', batchId)
        .forUpdate()
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row ?? null))

export interface BatchRow {
  id: string
  name: string
  descriptionMd: string | null
  materialRange: string
  timezone: string
  status: string
  configRevision: number
  currentPhaseId: string | null
  /** what that phase is called, so a list can say where a batch has got to */
  currentPhaseName: string | null
  /** people currently on the roster; zero until the batch is activated */
  participantCount: number
  createdAt: number
  /** whether the reader this row was selected for may administer it */
  manageable: boolean
}

const batchSelection = (k: Parameters<Parameters<typeof db.query>[0]>[0]) =>
  k
    .selectFrom('AssessmentBatch')
    .select([
      'id',
      'name',
      'descriptionMd',
      'timezone',
      'status',
      'configRevision',
      'currentPhaseId',
    ])
    .select([
      sql<string>`material_range::text`.as('materialRange'),
      epoch('created_at').as('createdAt'),
      sql<string>`(
        select count(*) from batch_participants bp
        where bp.tenant_id = assessment_batches.tenant_id
          and bp.batch_id = assessment_batches.id
          and bp.status = 'active'
      )`.as('participantCount'),
      // the first thing anybody asks of a running batch is where it has got
      // to, and an id does not answer that
      sql<string | null>`(
        select p.display_name from batch_phases p
        where p.tenant_id = assessment_batches.tenant_id
          and p.id = assessment_batches.current_phase_id
      )`.as('currentPhaseName'),
    ])

const toBatchRow = (row: Record<string, unknown>): BatchRow =>
  ({
    ...row,
    createdAt: msOf(row.createdAt),
    participantCount: Number(row.participantCount ?? 0),
    manageable: row.manageable === true,
  }) as BatchRow

export const oneBatch = (
  tenantId: string,
  batchId: string,
  viewer?: { held: AuthorizationScope },
) =>
  db
    .query((k) =>
      (viewer === undefined
        ? batchSelection(k).select(sql<boolean>`false`.as('manageable'))
        : batchSelection(k).select(withinReach(viewer.held).as('manageable'))
      )
        .where('tenantId', '=', tenantId)
        .where('id', '=', batchId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row === undefined ? null : toBatchRow(row as never))))

/**
 * A batch every one of whose people stands inside this person's reach.
 *
 * The roster is the batch's only population, so it is also the only thing
 * administration can be measured against: managing a round means managing
 * everybody in it. A round nobody has been added to yet is reachable by
 * anyone holding the permission at all - there is nothing yet to be outside
 * of, and a draft its author could not open would be unusable.
 */
/**
 * A batch this person administers: the units it is run from, and everybody
 * on it today.
 *
 * Both halves are needed, and neither is enough on its own. Containment of
 * the roster alone is vacuously true of a round with nobody in it, which made
 * an empty draft everybody's - including an administrator of some other
 * college, who could then fill it with their own people. The frozen anchors
 * are what an empty round still belongs to; the roster is what it has become.
 */
const withinReach = (held: AuthorizationScope) =>
  held.tenantWide
    ? sql<boolean>`true`
    : held.anchors.length > 0
      ? sql<boolean>`(
        not exists (
          select 1 from batch_management_anchors ma
          join org_nodes mn on mn.tenant_id = ma.tenant_id and mn.id = ma.org_node_id
          where ma.tenant_id = assessment_batches.tenant_id
            and ma.batch_id = assessment_batches.id
            and not ${scopeCoverage(held, {
              id: sql.ref('mn.id') as never,
              tenantId: sql.ref('mn.tenant_id') as never,
              path: sql.ref('mn.path') as never,
            })}
        )
        and not exists (
          select 1 from batch_participants bp
          where bp.tenant_id = assessment_batches.tenant_id
            and bp.batch_id = assessment_batches.id
            and bp.status = 'active'
            and not ${scopeCoverage(held, {
              id: sql.ref('bp.assessment_anchor_node_id') as never,
              tenantId: sql.ref('bp.tenant_id') as never,
              path: sql.ref('bp.anchor_path') as never,
            })}
        )
        -- and it has to belong to somewhere: a round with no boundary and
        -- nobody on it is nobody's, and "nobody's" must not resolve to
        -- "anybody holding the permission somewhere". Tenant-wide authority
        -- reads it above; a scoped administrator does not.
        and exists (
          select 1 from batch_management_anchors ma
          where ma.tenant_id = assessment_batches.tenant_id
            and ma.batch_id = assessment_batches.id
          union all
          select 1 from batch_participants bp
          where bp.tenant_id = assessment_batches.tenant_id
            and bp.batch_id = assessment_batches.id
            and bp.status = 'active'
        )
      )`
      : sql<boolean>`false`

/**
 * Whether a stage of this round has actually begun, by the clock.
 *
 * The same question the gate asks, asked the same way: a stage is in effect
 * from its own instant, whether or not the sweeper has got round to writing
 * that down. Reading the materialized projection instead left a window every
 * morning in which the stage had opened its actions and the round it belongs
 * to was still invisible.
 *
 * Stages that began before the round was last closed do not count: reopening
 * keeps them, and they belong to the round as it was.
 */
const hasBegun = sql<boolean>`exists (
  select 1 from batch_phases ph
  where ph.tenant_id = assessment_batches.tenant_id
    and ph.batch_id = assessment_batches.id
    and coalesce(ph.actual_entry_at, ph.planned_entry_at) <= now()
    and coalesce(ph.actual_entry_at, ph.planned_entry_at) > coalesce(
      (select max(le.occurred_at) from batch_lifecycle_events le
        where le.tenant_id = assessment_batches.tenant_id
          and le.batch_id = assessment_batches.id
          and le.kind = 'archived'),
      '-infinity'::timestamptz
    )
)`

/**
 * A batch a participant is in, or was in.
 *
 * Any membership row, not only a live one (§32.56). Being taken off the list
 * ends what somebody may do in the round; it does not unsay that they were in
 * it, and everything they filed while they were is still theirs to look at.
 * What they may still DO is a different question, asked of a different query
 * (activeParticipantByUser) and answered by the authority layer.
 *
 * They are told about the round when it begins - a date in the diary is a
 * plan its administrators are still writing - and they keep it afterwards: a
 * round is archived to stop the work, not to take back what happened in it.
 */
const isParticipant = (userId: string) =>
  sql<boolean>`(
    (assessment_batches.status = 'archived' or (assessment_batches.status = 'active' and ${hasBegun}))
    and exists (
      select 1 from batch_participants bp
      where bp.tenant_id = assessment_batches.tenant_id
        and bp.batch_id = assessment_batches.id
        and bp.user_id = ${userId}::uuid
    )
  )`

/**
 * A batch somebody works on, measured by what they can actually do in it.
 *
 * The same arithmetic the batch's own authority uses - what the assignment
 * still carries, intersected with what this batch accepted, minus what it
 * has taken back - rather than a shorter question about whether the grant
 * looks alive. A member of staff whose role has since lost every capability
 * this round accepted has no authority here, and reading the round is one of
 * the things authority is for.
 */
const isStaff = (userId: string) =>
  sql<boolean>`exists (
    select 1
    from batch_access_sources bas
    join role_grants rg
      on rg.tenant_id = bas.tenant_id and rg.id = bas.role_assignment_id
    join roles ro on ro.tenant_id = rg.tenant_id and ro.id = rg.role_id
    join batch_access_source_permissions sp
      on sp.tenant_id = bas.tenant_id and sp.source_id = bas.id
    where bas.tenant_id = assessment_batches.tenant_id
      and bas.batch_id = assessment_batches.id
      and bas.subject_id = ${userId}::uuid
      and rg.user_id = ${userId}::uuid
      and rg.revoked_at is null
      and (rg.valid_from is null or rg.valid_from <= now())
      and (rg.valid_until is null or rg.valid_until > now())
      and ro.status = 'active'
      and (
        ro.permission_mode = 'all-active'
        or exists (
          select 1 from role_permissions rp
          join permissions pe on pe.id = rp.permission_id
          where rp.tenant_id = ro.tenant_id
            and rp.role_id = ro.id
            and pe.code = sp.permission_code
        )
      )
      and not exists (
        select 1 from batch_access_denies dn
        where dn.tenant_id = bas.tenant_id
          and dn.batch_id = bas.batch_id
          and dn.subject_id = bas.subject_id
          and dn.permission_code = sp.permission_code
      )
  )`

/**
 * What one person may see of the batches.
 *
 * Three separate ways in, each with its own rule: administering the whole
 * roster, working on it under an authority that still stands, or being in it
 * once it has begun. They were one predicate before, and the shortest of the
 * three quietly decided the other two.
 */
export const visibleTo = (viewer: { held: AuthorizationScope; userId: string }) =>
  sql<boolean>`(
    ${withinReach(viewer.held)}
    or ${isStaff(viewer.userId)}
    or ${isParticipant(viewer.userId)}
  )`

/** whether one batch is one this person may read at all */
export const batchVisibleTo = (
  tenantId: string,
  batchId: string,
  viewer: { held: AuthorizationScope; userId: string },
) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentBatch')
        .select(sql<boolean>`true`.as('visible'))
        .where('tenantId', '=', tenantId)
        .where('id', '=', batchId)
        .where(visibleTo(viewer))
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** the filters the list and its count share, beyond the keyset window */
const batchFilters = <Q extends { where: (...args: never[]) => Q }>(
  query: Q,
  filter: { status?: string; q?: string },
): Q => {
  let found = query
  if (filter.status !== undefined) {
    found = found.where(...(['status', '=', filter.status] as never[]))
  }
  if (filter.q !== undefined) {
    // a plain substring match; wildcards in the input stay literal
    const escaped = filter.q.replace(/[\\%_]/g, (match) => `\\${match}`)
    found = found.where(...(['name', 'ilike', `%${escaped}%`] as never[]))
  }
  return found
}

/** how many batches match, for a list a person navigates by page number */
export const countBatches = (
  tenantId: string,
  viewer: { held: AuthorizationScope; userId: string },
  filter: { status?: string; q?: string },
) =>
  db
    .query((k) =>
      batchFilters(
        k
          .selectFrom('AssessmentBatch')
          .select(({ fn }) => fn.countAll<string>().as('total'))
          .where('tenantId', '=', tenantId)
          .where(visibleTo(viewer)),
        filter,
      ).executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => Number(row.total)))

/**
 * One page of the batches this person may see, newest first. The
 * authorization scope is pushed into the statement: the database intersects,
 * nothing is fetched and filtered.
 */
export const listBatchesPage = (
  tenantId: string,
  viewer: { held: AuthorizationScope; userId: string },
  filter: {
    status?: string
    q?: string
    after?: { createdAt: number; id: string }
    limit: number
  },
) =>
  db
    .query((k) => {
      let query = batchFilters(
        batchSelection(k)
          .select(withinReach(viewer.held).as('manageable'))
          .where('tenantId', '=', tenantId)
          .where(visibleTo(viewer)),
        filter,
      )
      if (filter.after !== undefined) {
        query = query.where(
          sql<boolean>`(assessment_batches.created_at, assessment_batches.id)
            < (${instant(filter.after.createdAt)}, ${filter.after.id}::uuid)`,
        )
      }
      return query.orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(filter.limit).execute()
    })
    .pipe(Effect.map((found) => (found as unknown as Record<string, unknown>[]).map(toBatchRow)))

export const insertBatch = (input: {
  tenantId: string
  name: string
  descriptionMd: string | null
  materialStart: string
  materialEnd: string
  timezone?: string
}) =>
  db.query((k) =>
    k
      .insertInto('AssessmentBatch')
      .values({
        tenantId: input.tenantId,
        name: input.name,
        descriptionMd: input.descriptionMd,
        materialRange: sql`daterange(${input.materialStart}::date, ${input.materialEnd}::date)`,
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow(),
  )

/** idempotent replacement of the population definition */
/**
 * The distinct units the people in a batch stand at, as frozen when they were
 * added. What a round is anchored to, now that nothing else is.
 */
/** the units a round is administered from, frozen when it was created */
export const managementAnchors = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchManagementAnchor')
        .select('orgNodeId')
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.orgNodeId as string)))

export const insertManagementAnchors = (
  tenantId: string,
  batchId: string,
  orgNodeIds: readonly string[],
) =>
  orgNodeIds.length === 0
    ? Effect.void
    : db
        .query((k) =>
          k
            .insertInto('BatchManagementAnchor')
            .values(
              [...new Set(orgNodeIds)].map((orgNodeId) => ({
                tenantId,
                batchId,
                orgNodeId,
              })) as never,
            )
            .onConflict((conflict) => conflict.doNothing())
            .execute(),
        )
        .pipe(Effect.asVoid)

export const rosterAnchors = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .select('assessmentAnchorNodeId')
        .distinct()
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .where('status', '=', 'active')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.assessmentAnchorNodeId as string)))

export const nodesByIds = (tenantId: string, nodeIds: readonly string[]) =>
  nodeIds.length === 0
    ? Effect.succeed([] as { id: string; path: string }[])
    : db
        .query((k) =>
          k
            .selectFrom('OrgNode')
            .select(['id', 'path'])
            .where('tenantId', '=', tenantId)
            .where('id', 'in', nodeIds)
            .execute(),
        )
        .pipe(Effect.map((found) => found as { id: string; path: string }[]))

export const updateBatchFields = (
  tenantId: string,
  batchId: string,
  fields: {
    name?: string
    descriptionMd?: string | null
    materialStart?: string
    materialEnd?: string
    timezone?: string
    status?: string
  },
) =>
  db.query((k) =>
    k
      .updateTable('AssessmentBatch')
      .set({
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.descriptionMd !== undefined ? { descriptionMd: fields.descriptionMd } : {}),
        ...(fields.materialStart !== undefined
          ? {
              materialRange: sql`daterange(${fields.materialStart}::date, ${fields.materialEnd}::date)`,
            }
          : {}),
        ...(fields.timezone !== undefined ? { timezone: fields.timezone } : {}),
        ...(fields.status !== undefined ? { status: fields.status } : {}),
        updatedAt: sql`now()`,
      } as never)
      .where('tenantId', '=', tenantId)
      .where('id', '=', batchId)
      .execute(),
  )

export const setCurrentPhase = (tenantId: string, batchId: string, phaseId: string | null) =>
  db.query((k) =>
    k
      .updateTable('AssessmentBatch')
      .set({ currentPhaseId: phaseId, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', batchId)
      .execute(),
  )

export const bumpConfigRevision = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .updateTable('AssessmentBatch')
        .set({ configRevision: sql`config_revision + 1`, updatedAt: sql`now()` })
        .where('tenantId', '=', tenantId)
        .where('id', '=', batchId)
        .returning('configRevision')
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => row.configRevision as number))

export const insertConfigEvent = (input: {
  tenantId: string
  batchId: string
  revision: number
  actorId: string | null
  diff: Record<string, unknown>
  reason: string | null
}) =>
  db.query((k) =>
    k
      .insertInto('BatchConfigRevision')
      .values({
        tenantId: input.tenantId,
        batchId: input.batchId,
        revision: input.revision,
        actorId: input.actorId,
        diff: jsonb(input.diff),
        reason: input.reason,
      } as never)
      .execute(),
  )

// --- phases ---

export interface PhaseRow {
  id: string
  ordinal: number
  phaseKey: string
  displayName: string
  description: string
  entryNote: string
  plannedEntryAt: number | null
  actualEntryAt: number | null
  permissionProfile: readonly string[]
  sourceTemplateId: string | null
  sourceTemplateVersion: number | null
}

/**
 * The phases of several batches at once, ordered within each.
 *
 * A list that shows where every batch has got to needs every batch's plan,
 * and asking per row is how a page of twenty becomes twenty-one round trips.
 */
export const phaseRowsForBatches = (tenantId: string, batchIds: readonly string[]) =>
  batchIds.length === 0
    ? Effect.succeed([] as (PhaseRow & { batchId: string })[])
    : db
        .query((k) =>
          k
            .selectFrom('BatchPhase')
            .select([
              'id',
              'batchId',
              'ordinal',
              'phaseKey',
              'displayName',
              'description',
              'entryNote',
              'permissionProfile',
              'sourceTemplateId',
              'sourceTemplateVersion',
            ])
            .select([
              epoch('planned_entry_at').as('plannedEntryAt'),
              epoch('actual_entry_at').as('actualEntryAt'),
            ])
            .where('tenantId', '=', tenantId)
            .where('batchId', 'in', batchIds as string[])
            .orderBy('batchId')
            .orderBy('ordinal')
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            (rows as unknown as Record<string, unknown>[]).map(
              (row) =>
                ({
                  ...row,
                  plannedEntryAt: msOf(row.plannedEntryAt),
                  actualEntryAt: msOf(row.actualEntryAt),
                }) as unknown as PhaseRow & { batchId: string },
            ),
          ),
        )

export const listPhaseRows = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchPhase')
        .select([
          'id',
          'ordinal',
          'phaseKey',
          'displayName',
          'description',
          'entryNote',
          'permissionProfile',
          'sourceTemplateId',
          'sourceTemplateVersion',
        ])
        .select([
          epoch('planned_entry_at').as('plannedEntryAt'),
          epoch('actual_entry_at').as('actualEntryAt'),
        ])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .orderBy('ordinal')
        .execute(),
    )
    .pipe(
      Effect.map((found) =>
        (found as unknown as Record<string, unknown>[]).map(
          (row) =>
            ({
              ...row,
              plannedEntryAt: msOf(row.plannedEntryAt),
              actualEntryAt: msOf(row.actualEntryAt),
            }) as unknown as PhaseRow,
        ),
      ),
    )

export const insertPhase = (input: {
  tenantId: string
  batchId: string
  ordinal: number
  phaseKey: string
  displayName: string
  description: string
  entryNote: string
  permissionProfile: readonly string[]
  sourceTemplateId?: string
  sourceTemplateVersion?: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('BatchPhase')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          ordinal: input.ordinal,
          phaseKey: input.phaseKey,
          displayName: input.displayName,
          description: input.description,
          entryNote: input.entryNote,
          permissionProfile: jsonb(input.permissionProfile),
          ...(input.sourceTemplateId !== undefined
            ? {
                sourceTemplateId: input.sourceTemplateId,
                sourceTemplateVersion: input.sourceTemplateVersion,
              }
            : {}),
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => row.id as string))

export const updatePhaseFields = (
  tenantId: string,
  phaseId: string,
  fields: {
    displayName?: string
    phaseKey?: string
    description?: string
    entryNote?: string
    plannedEntryAt?: number | null
    permissionProfile?: readonly string[]
    ordinal?: number
  },
) =>
  db.query((k) =>
    k
      .updateTable('BatchPhase')
      .set({
        ...(fields.displayName !== undefined ? { displayName: fields.displayName } : {}),
        ...(fields.phaseKey !== undefined ? { phaseKey: fields.phaseKey } : {}),
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.entryNote !== undefined ? { entryNote: fields.entryNote } : {}),
        ...(fields.plannedEntryAt !== undefined
          ? {
              plannedEntryAt:
                fields.plannedEntryAt === null ? null : instant(fields.plannedEntryAt),
            }
          : {}),
        ...(fields.permissionProfile !== undefined
          ? { permissionProfile: jsonb(fields.permissionProfile) }
          : {}),
        ...(fields.ordinal !== undefined ? { ordinal: fields.ordinal } : {}),
        updatedAt: sql`now()`,
      } as never)
      .where('tenantId', '=', tenantId)
      .where('id', '=', phaseId)
      .execute(),
  )

export const deletePhases = (tenantId: string, batchId: string, ids: readonly string[]) =>
  ids.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .deleteFrom('BatchPhase')
          .where('tenantId', '=', tenantId)
          .where('batchId', '=', batchId)
          .where('id', 'in', ids)
          .execute(),
      )

/**
 * Ratifies one boundary: the actual is written once and never overwritten,
 * so a concurrent ratification converges instead of rewriting history.
 * Returns whether this call was the one that wrote it.
 */
export const setPhaseActual = (tenantId: string, phaseId: string, actualMs: number) =>
  db
    .query((k) =>
      k
        .updateTable('BatchPhase')
        .set({ actualEntryAt: instant(actualMs), updatedAt: sql`now()` } as never)
        .where('tenantId', '=', tenantId)
        .where('id', '=', phaseId)
        .where('actualEntryAt', 'is', null)
        .returning('id')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const insertPhaseEvent = (input: {
  tenantId: string
  phaseId: string
  kind: string
  plannedAt?: number | null
  actualAt?: number
  processedAt?: number
  actorId?: string | null
  reason?: string | null
}) =>
  db.query((k) =>
    k
      .insertInto('PhaseEvent')
      .values({
        tenantId: input.tenantId,
        phaseId: input.phaseId,
        kind: input.kind,
        plannedAt: input.plannedAt == null ? null : instant(input.plannedAt),
        actualAt: input.actualAt === undefined ? null : instant(input.actualAt),
        processedAt: input.processedAt === undefined ? null : instant(input.processedAt),
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
      } as never)
      .execute(),
  )

// --- who may work on this batch -------------------------------------------

export interface AccessSourceRow {
  id: string
  roleAssignmentId: string
  subjectId: string
  origin: 'inherited' | 'explicit'
  acceptedAt: number
  /** the ceiling: what this batch said yes to, whatever the role carries now */
  accepted: readonly string[]
}

/** what this batch has accepted, with the ceiling each source carries */
/**
 * One page of the people who may work on this batch, by name.
 *
 * The rows behind them are per source and per permission, so the page has to
 * be over subjects: a limit on sources would cut somebody in half and show
 * one of their two roles.
 */
export const accessSubjectPage = (
  tenantId: string,
  batchId: string,
  page: { after?: readonly string[]; limit: number },
) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('BatchAccessSource as s')
        .innerJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 's.tenantId').onRef('u.id', '=', 's.subjectId'),
        )
        .select(['s.subjectId as userId', 'u.displayName'])
        .distinct()
        .where('s.tenantId', '=', tenantId)
        .where('s.batchId', '=', batchId)
        .orderBy('u.displayName')
        .orderBy('s.subjectId')
        .limit(page.limit)
      if (page.after !== undefined) {
        const [name, id] = [page.after[0] ?? '', page.after[1] ?? '']
        query = query.where(sql<boolean>`(u.display_name, s.subject_id) > (${name}, ${id}::uuid)`)
      }
      return query.execute()
    })
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({ userId: row.userId as string, displayName: row.displayName })),
      ),
    )

export const accessSources = (tenantId: string, batchId: string, subjectIds?: readonly string[]) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchAccessSource as s')
        .select(['s.id', 's.roleAssignmentId', 's.subjectId', 's.origin'])
        .select([
          epoch('s.accepted_at').as('acceptedAt'),
          sql<string[]>`coalesce((select array_agg(sp.permission_code order by sp.permission_code)
            from batch_access_source_permissions sp
            where sp.tenant_id = s.tenant_id and sp.source_id = s.id), '{}')`.as('accepted'),
        ])
        .where('s.tenantId', '=', tenantId)
        .where('s.batchId', '=', batchId)
        .$if(subjectIds !== undefined, (query) =>
          query.where('s.subjectId', 'in', (subjectIds ?? []) as string[]),
        )
        .orderBy('s.acceptedAt')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map(
          (row) => ({ ...row, acceptedAt: msOf(row.acceptedAt) }) as unknown as AccessSourceRow,
        ),
      ),
    )

/** accepting an assignment into this batch, with the ceiling it comes in at */
export const acceptAccessSource = (input: {
  tenantId: string
  batchId: string
  roleAssignmentId: string
  subjectId: string
  origin: 'inherited' | 'explicit'
  permissions: readonly string[]
  acceptedBy: string | null
}) =>
  db
    .query((k) =>
      k
        .insertInto('BatchAccessSource')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          roleAssignmentId: input.roleAssignmentId,
          subjectId: input.subjectId,
          origin: input.origin,
          acceptedBy: input.acceptedBy,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow(),
    )
    .pipe(
      Effect.flatMap((row) =>
        acceptPermissions(input.tenantId, row.id as string, input.permissions).pipe(
          Effect.as(row.id as string),
        ),
      ),
    )

/** raising a source's ceiling, which is the only thing a synchronisation does */
export const acceptPermissions = (
  tenantId: string,
  sourceId: string,
  permissions: readonly string[],
) =>
  permissions.length === 0
    ? Effect.void
    : db
        .query((k) =>
          k
            .insertInto('BatchAccessSourcePermission')
            .values(
              permissions.map((permissionCode) => ({
                tenantId,
                sourceId,
                permissionCode,
              })) as never,
            )
            .onConflict((conflict) => conflict.doNothing())
            .execute(),
        )
        .pipe(Effect.asVoid)

/** what the batch has taken back, per person */
export const accessDenies = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchAccessDeny')
        .select(['subjectId', 'permissionCode'])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .execute(),
    )
    .pipe(Effect.map((rows) => rows as unknown as { subjectId: string; permissionCode: string }[]))

export const setAccessDeny = (input: {
  tenantId: string
  batchId: string
  subjectId: string
  permissionCode: string
  denied: boolean
  actorId: string | null
  reason: string | null
}) =>
  input.denied
    ? db.query((k) =>
        k
          .insertInto('BatchAccessDeny')
          .values({
            tenantId: input.tenantId,
            batchId: input.batchId,
            subjectId: input.subjectId,
            permissionCode: input.permissionCode,
            createdBy: input.actorId,
            reason: input.reason,
          } as never)
          .onConflict((conflict) => conflict.doNothing())
          .execute(),
      )
    : db.query((k) =>
        k
          .deleteFrom('BatchAccessDeny')
          .where('tenantId', '=', input.tenantId)
          .where('batchId', '=', input.batchId)
          .where('subjectId', '=', input.subjectId)
          .where('permissionCode', '=', input.permissionCode)
          .execute(),
      )

export const oneAccessSource = (tenantId: string, batchId: string, sourceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchAccessSource')
        .select(['id', 'subjectId', 'roleAssignmentId', 'origin'])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .where('id', '=', sourceId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map(
        (row) =>
          (row ?? null) as {
            id: string
            subjectId: string
            roleAssignmentId: string
            origin: 'inherited' | 'explicit'
          } | null,
      ),
    )

/** a draft's acceptances, cleared before they are drawn again */
export const clearAccessSources = (tenantId: string, batchId: string) =>
  db.query((k) =>
    k
      .deleteFrom('BatchAccessSource')
      .where('tenantId', '=', tenantId)
      .where('batchId', '=', batchId)
      .execute(),
  )

/** a draft's roster, likewise: it is derived from a definition that changed */
export const clearRoster = (tenantId: string, batchId: string) =>
  db.query((k) =>
    k
      .deleteFrom('BatchParticipant')
      .where('tenantId', '=', tenantId)
      .where('batchId', '=', batchId)
      .execute(),
  )

/**
 * Letting go of what the organization has taken back.
 *
 * The ceiling records what this batch agreed to take from an assignment. Once
 * the organization stops carrying a capability the agreement is about nothing,
 * and keeping it would mean a later re-grant flows in unasked - the batch said
 * yes to something that has since been withdrawn, not to whatever comes back.
 */
export const dropAcceptedPermissions = (
  tenantId: string,
  sourceId: string,
  permissions: readonly string[],
) =>
  permissions.length === 0
    ? Effect.void
    : db
        .query((k) =>
          k
            .deleteFrom('BatchAccessSourcePermission')
            .where('tenantId', '=', tenantId)
            .where('sourceId', '=', sourceId)
            .where('permissionCode', 'in', permissions as string[])
            .execute(),
        )
        .pipe(Effect.asVoid)

/** a source that carries nothing is not a record of anything */
export const dropEmptyAccessSources = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      sql`delete from batch_access_sources s
        where s.tenant_id = ${tenantId}::uuid
          and s.batch_id = ${batchId}::uuid
          and not exists (
            select 1 from batch_access_source_permissions p
            where p.tenant_id = s.tenant_id and p.source_id = s.id
          )`.execute(k),
    )
    .pipe(Effect.asVoid)

export const dropAccessSource = (tenantId: string, sourceId: string) =>
  db.query((k) =>
    k
      .deleteFrom('BatchAccessSource')
      .where('tenantId', '=', tenantId)
      .where('id', '=', sourceId)
      .execute(),
  )

/** the display names the access page needs; the closure already reaches users */
export const namesOf = (tenantId: string, userIds: readonly string[]) =>
  userIds.length === 0
    ? Effect.succeed([] as { id: string; displayName: string; businessNo: string | null }[])
    : db
        .query((k) =>
          k
            .selectFrom('User')
            .select(['id', 'displayName', 'businessNo'])
            .where('tenantId', '=', tenantId)
            .where('id', 'in', userIds as string[])
            .execute(),
        )
        .pipe(
          Effect.map(
            (rows) =>
              rows as unknown as { id: string; displayName: string; businessNo: string | null }[],
          ),
        )

/**
 * When this round was last closed, if it ever was.
 *
 * A reopened round keeps every stage it ran before, entry instants and all,
 * so "which stage is in effect" computed from the plan alone would answer
 * with the one it ended on - and that stage's profile would be live again
 * the moment somebody reopened the round for a date next week.
 */
export const lastArchivedAt = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchLifecycleEvent')
        .select([epoch('occurred_at').as('occurredAt')])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .where('kind', '=', 'archived')
        .orderBy('occurredAt', 'desc')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined ? null : msOf((row as unknown as Record<string, unknown>).occurredAt),
      ),
    )

/** when each of these rounds was last closed, for the ones that ever were */
export const lastArchivedFor = (tenantId: string, batchIds: readonly string[]) =>
  batchIds.length === 0
    ? Effect.succeed([] as { batchId: string; occurredAt: number }[])
    : db
        .query((k) =>
          k
            .selectFrom('BatchLifecycleEvent')
            .select('batchId')
            .select([
              sql<number>`(extract(epoch from max(occurred_at)) * 1000)::float8`.as('occurredAt'),
            ])
            .where('tenantId', '=', tenantId)
            .where('kind', '=', 'archived')
            .where('batchId', 'in', batchIds as string[])
            .groupBy('batchId')
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            (rows as unknown as Record<string, unknown>[]).map((row) => ({
              batchId: row.batchId as string,
              occurredAt: msOf(row.occurredAt),
            })),
          ),
        )

export const insertLifecycleEvent = (input: {
  tenantId: string
  batchId: string
  kind: 'archived' | 'reopened'
  occurredAt: number
  actorId?: string | null
  reason?: string | null
}) =>
  db.query((k) =>
    k
      .insertInto('BatchLifecycleEvent')
      .values({
        tenantId: input.tenantId,
        batchId: input.batchId,
        kind: input.kind,
        occurredAt: instant(input.occurredAt),
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
      } as never)
      .execute(),
  )

/** what has happened to a batch as a whole, oldest first */
export const lifecycleEvents = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchLifecycleEvent')
        .select(['kind', 'occurredAt', 'actorId', 'reason'])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .orderBy('occurredAt', 'asc')
        .execute(),
    )
    .pipe(
      Effect.map(
        (rows) =>
          rows as unknown as {
            kind: string
            occurredAt: string
            actorId: string | null
            reason: string | null
          }[],
      ),
    )

/** a draft nobody ever started, removed with the rows that hang off it */
export const deleteBatchRow = (tenantId: string, batchId: string) =>
  db.query((k) =>
    k
      .deleteFrom('AssessmentBatch')
      .where('tenantId', '=', tenantId)
      .where('id', '=', batchId)
      .execute(),
  )

/** every scope row of a batch's phases, for the plan read */
export const scopesForBatch = (tenantId: string, batchId: string) =>
  Effect.all({
    items: db
      .query((k) =>
        k
          .selectFrom('PhaseItemScope')
          .innerJoin('BatchPhase', (join) =>
            join
              .onRef('BatchPhase.id', '=', 'PhaseItemScope.phaseId')
              .onRef('BatchPhase.tenantId', '=', 'PhaseItemScope.tenantId'),
          )
          .select(['PhaseItemScope.phaseId', 'PhaseItemScope.itemId'])
          .where('PhaseItemScope.tenantId', '=', tenantId)
          .where('BatchPhase.batchId', '=', batchId)
          .orderBy('PhaseItemScope.itemId')
          .execute(),
      )
      .pipe(Effect.map((found) => found as { phaseId: string; itemId: string }[])),
    participants: db
      .query((k) =>
        k
          .selectFrom('PhaseParticipantScope')
          .innerJoin('BatchPhase', (join) =>
            join
              .onRef('BatchPhase.id', '=', 'PhaseParticipantScope.phaseId')
              .onRef('BatchPhase.tenantId', '=', 'PhaseParticipantScope.tenantId'),
          )
          .select(['PhaseParticipantScope.phaseId', 'PhaseParticipantScope.participantId'])
          .where('PhaseParticipantScope.tenantId', '=', tenantId)
          .where('BatchPhase.batchId', '=', batchId)
          .orderBy('PhaseParticipantScope.participantId')
          .execute(),
      )
      .pipe(Effect.map((found) => found as { phaseId: string; participantId: string }[])),
  })

/** idempotent replacement of one phase's two allowances */
export const replacePhaseScopes = (
  tenantId: string,
  phaseId: string,
  scopes: { items: readonly string[]; participants: readonly string[] },
) =>
  Effect.gen(function* () {
    yield* db.query((k) =>
      k
        .deleteFrom('PhaseItemScope')
        .where('tenantId', '=', tenantId)
        .where('phaseId', '=', phaseId)
        .execute(),
    )
    yield* db.query((k) =>
      k
        .deleteFrom('PhaseParticipantScope')
        .where('tenantId', '=', tenantId)
        .where('phaseId', '=', phaseId)
        .execute(),
    )
    if (scopes.items.length > 0) {
      yield* db.query((k) =>
        k
          .insertInto('PhaseItemScope')
          .values(scopes.items.map((itemId) => ({ tenantId, phaseId, itemId })))
          .execute(),
      )
    }
    if (scopes.participants.length > 0) {
      yield* db.query((k) =>
        k
          .insertInto('PhaseParticipantScope')
          .values(
            scopes.participants.map((participantId) => ({ tenantId, phaseId, participantId })),
          )
          .execute(),
      )
    }
  })

/** the items of a batch, for validating an item allowance */
export const batchItemIds = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentItem')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .execute(),
    )
    .pipe(Effect.map((found) => new Set(found.map((row) => row.id as string))))

/** the participant rows of a batch, for validating a participant allowance */
export const batchParticipantIds = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .execute(),
    )
    .pipe(Effect.map((found) => new Set(found.map((row) => row.id as string))))

/** the two allowances of one phase, for the gate */
export const phaseScopes = (tenantId: string, phaseId: string) =>
  Effect.all({
    items: db
      .query((k) =>
        k
          .selectFrom('PhaseItemScope')
          .select('itemId')
          .where('tenantId', '=', tenantId)
          .where('phaseId', '=', phaseId)
          .execute(),
      )
      .pipe(Effect.map((found) => new Set(found.map((row) => row.itemId as string)))),
    participants: db
      .query((k) =>
        k
          .selectFrom('PhaseParticipantScope')
          .select('participantId')
          .where('tenantId', '=', tenantId)
          .where('phaseId', '=', phaseId)
          .execute(),
      )
      .pipe(Effect.map((found) => new Set(found.map((row) => row.participantId as string)))),
  })

// --- roster ---

/**
 * The roster, generated by one statement at activation: every enabled user
 * of an enrolled type standing under any of the batch's living scope nodes,
 * with the anchor path and the (nodeId, nodeTypeId) lineage frozen from the
 * live tree as of this transaction. EXISTS over the scope set: a nested
 * selection is refused at write, so subtrees are disjoint, and a dangling
 * scope row simply matches nothing.
 */
/**
 * The people one import would add: everybody under these units with one of
 * these types, minus whoever is already taking part.
 *
 * Run twice - once to count for the confirmation, once to insert - and the
 * second run is the one that decides, so a person who arrives between the
 * two is simply not in this import.
 */
export const importCandidates = (
  tenantId: string,
  batchId: string,
  nodeIds: readonly string[],
  userTypeIds: readonly string[],
  held: AuthorizationScope,
) =>
  db
    .query((k) =>
      sql<{ id: string; nodeId: string }>`
        select u.id, u.primary_org_node_id as "nodeId"
          from users u
          join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
         where u.tenant_id = ${tenantId}::uuid
           and u.enabled
           and u.user_type_id = any(${userTypeIds as string[]}::uuid[])
           and exists (
             select 1 from org_nodes scope
              where scope.tenant_id = u.tenant_id
                and scope.id = any(${nodeIds as string[]}::uuid[])
                and n.path <@ scope.path
           )
           -- and inside the caller's own reach, not merely under a node they
           -- may act at: authority at a college held with self coverage does
           -- not reach the classes beneath it, and asking for the college
           -- would otherwise have swept them all in
           and ${scopeCoverage(held, {
             id: sql.ref('n.id') as never,
             tenantId: sql.ref('n.tenant_id') as never,
             path: sql.ref('n.path') as never,
           })}
           and not exists (
             select 1 from batch_participants bp
              where bp.tenant_id = u.tenant_id
                and bp.batch_id = ${batchId}::uuid
                and bp.user_id = u.id
                and bp.status = 'active'
           )
         order by u.display_name, u.id
      `.execute(k),
    )
    .pipe(
      Effect.map((result) => result.rows.map((row) => ({ userId: row.id, nodeId: row.nodeId }))),
    )

/**
 * Adding people to a roster, by name of the people themselves.
 *
 * One insertion path for both ways in: importing from the organization
 * resolves its units to people first, so nothing here knows what a unit is.
 * Each row freezes where its person stood and what they were when they were
 * added - the round is answerable for the people it admitted, not for who
 * they became afterwards.
 */
/**
 * Admitting people to a roster, at the positions they were authorized at.
 *
 * The node is part of the statement, not only of the check before it: a
 * person who moves between the two would otherwise be admitted at wherever
 * they had moved to, on the strength of a check made about where they were.
 * A row that no longer matches is simply not written, and the caller sees it
 * in the count.
 */
export const insertParticipants = (
  tenantId: string,
  batchId: string,
  admitting: readonly { userId: string; nodeId: string }[],
  actorId: string | null,
) =>
  db
    .query((k) =>
      sql<{ id: string; inserted: boolean }>`
        insert into batch_participants
          (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path,
           anchor_lineage, user_type_id, included_by)
        select
          u.tenant_id, ${batchId}::uuid, u.id, u.primary_org_node_id, n.path,
          (select jsonb_agg(jsonb_build_object('nodeId', a.id, 'nodeTypeId', a.org_type_id)
                            order by a.depth desc)
             from org_nodes a
            where a.tenant_id = u.tenant_id and a.path @> n.path),
          u.user_type_id, ${actorId}::uuid
        from users u
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        join unnest(${admitting.map((row) => row.userId)}::uuid[],
                    ${admitting.map((row) => row.nodeId)}::uuid[])
             as wanted(user_id, node_id)
          on wanted.user_id = u.id and wanted.node_id = u.primary_org_node_id
        where u.tenant_id = ${tenantId}::uuid
          and u.enabled
        -- Somebody taken off the list keeps their row: the round is answerable
        -- for having admitted them, and everything they did hangs off it. So
        -- adding them again restores that row rather than inserting a second
        -- one, which the uniqueness rule would refuse outright - the reason
        -- re-adding an excluded person used to fail instead of working.
        on conflict (tenant_id, batch_id, user_id) do update
           set status = 'active',
               included_at = now(),
               included_by = excluded.included_by,
               excluded_at = null,
               excluded_by = null,
               exclusion_reason = null,
               -- re-admission is an admission: where they stand now is what
               -- this round is answerable for from here
               assessment_anchor_node_id = excluded.assessment_anchor_node_id,
               anchor_path = excluded.anchor_path,
               anchor_lineage = excluded.anchor_lineage,
               user_type_id = excluded.user_type_id,
               updated_at = now()
         where batch_participants.status <> 'active'
        -- xmax is zero on a row this statement inserted: it is the only way
        -- an upsert can say which half of itself happened, and the roster's
        -- history needs "joined" and "came back" told apart
        returning id, (xmax = 0) as inserted
      `.execute(k),
    )
    .pipe(
      Effect.map((result) =>
        result.rows.map((row) => ({ id: row.id, inserted: row.inserted === true })),
      ),
    )

/** what somebody once imported, and on what grounds; history, never a rule */
export const insertRosterImport = (input: {
  tenantId: string
  batchId: string
  orgNodeIds: readonly string[]
  userTypeIds: readonly string[]
  importedCount: number
  actorId: string | null
}) =>
  db.query((k) =>
    k
      .insertInto('RosterImport')
      .values({
        tenantId: input.tenantId,
        batchId: input.batchId,
        // cast explicitly: without it the driver sends the text and postgres
        // stores a json string rather than the json array it spells
        orgNodeIds: sql`${JSON.stringify(input.orgNodeIds)}::jsonb`,
        userTypeIds: sql`${JSON.stringify(input.userTypeIds)}::jsonb`,
        importedCount: input.importedCount,
        actorId: input.actorId,
      } as never)
      .execute(),
  )

export const rosterImports = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('RosterImport')
        .select(['id', 'orgNodeIds', 'userTypeIds', 'importedCount', 'actorId'])
        .select([epoch('occurred_at').as('occurredAt')])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .orderBy('occurredAt', 'desc')
        .limit(50)
        .execute(),
    )
    .pipe(
      Effect.map(
        (found) =>
          found as unknown as {
            id: string
            orgNodeIds: readonly string[]
            userTypeIds: readonly string[]
            importedCount: number
            actorId: string | null
            occurredAt: number
          }[],
      ),
    )

/**
 * The units a batch can be staffed at: where its people stand, and every
 * unit above them, narrowed to what this caller may manage.
 *
 * The anchors alone would be wrong. A round whose people sit in three classes
 * would need the same reviewer appointed three times, and a college-level one
 * could not be appointed at all - while the college plainly covers everybody
 * in it. Going up is safe because the assignment this feeds is confined to
 * the batch: authority given at the college reaches nothing outside the round.
 */
export const batchUnits = (tenantId: string, batchId: string, held: AuthorizationScope) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode as unit')
        .select(['unit.id', 'unit.name', 'unit.depth', 'unit.parentId', 'unit.orgTypeId'])
        .distinct()
        .where('unit.tenantId', '=', tenantId)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('BatchParticipant as bp')
              .innerJoin('OrgNode as anchor', (join) =>
                join
                  .onRef('anchor.tenantId', '=', 'bp.tenantId')
                  .onRef('anchor.id', '=', 'bp.assessmentAnchorNodeId'),
              )
              .select(sql<number>`1`.as('one'))
              .whereRef('bp.tenantId', '=', 'unit.tenantId')
              .where('bp.batchId', '=', batchId)
              .where('bp.status', '=', 'active')
              .where(sql<boolean>`unit.path @> anchor.path`),
          ),
        )
        .where((eb) =>
          scopeCoverage(held, {
            id: eb.ref('unit.id'),
            tenantId: eb.ref('unit.tenantId'),
            path: eb.ref('unit.path'),
          }),
        )
        .orderBy('unit.depth')
        .orderBy('unit.name')
        .execute(),
    )
    .pipe(
      Effect.map((rows) => {
        const within = new Set(rows.map((row) => row.id as string))
        return rows.map((row) => ({
          id: row.id as string,
          name: row.name as string,
          // a parent outside this set is not named: the tree a reader is shown
          // starts where the batch, and their own authority, does
          parentId: within.has(row.parentId as string) ? (row.parentId as string) : null,
          // what kind of unit it is, so a picker fed these can label and
          // filter by kind the way it does with the whole tree
          orgTypeId: row.orgTypeId as string,
        }))
      }),
    )

/** the names of these units, leaving out the ones this reader cannot reach */
export const reachableNodeNames = (
  tenantId: string,
  nodeIds: readonly string[],
  held: AuthorizationScope,
) =>
  nodeIds.length === 0
    ? Effect.succeed(new Map<string, string>())
    : db
        .query((k) =>
          k
            .selectFrom('OrgNode')
            .select(['id', 'name'])
            .where('tenantId', '=', tenantId)
            .where('id', 'in', nodeIds as string[])
            .where((eb) =>
              scopeCoverage(held, {
                id: eb.ref('OrgNode.id'),
                tenantId: eb.ref('OrgNode.tenantId'),
                path: eb.ref('OrgNode.path'),
              }),
            )
            .execute(),
        )
        .pipe(
          Effect.map((rows) => new Map(rows.map((row) => [row.id as string, row.name as string]))),
        )

export const oneOrgNode = (tenantId: string, nodeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode')
        .select(['id', 'path'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', nodeId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ?? null) as { id: string; path: string } | null))

// --- templates ---

export interface TemplateRow {
  id: string
  name: string
  kind: string
  version: number
  phases: readonly Record<string, unknown>[]
}

const templateColumns = ['id', 'name', 'kind', 'version', 'phases'] as const

export const oneTemplate = (tenantId: string, templateId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('PhaseTemplate')
        .select(templateColumns)
        .where('tenantId', '=', tenantId)
        .where('id', '=', templateId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ?? null) as TemplateRow | null))

export const listTemplatesPage = (
  tenantId: string,
  filter: { kind?: string; after?: { name: string; id: string }; limit: number },
) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('PhaseTemplate')
        .select(templateColumns)
        .where('tenantId', '=', tenantId)
      if (filter.kind !== undefined) {
        query = query.where('kind', '=', filter.kind)
      }
      if (filter.after !== undefined) {
        query = query.where(
          sql<boolean>`(phase_templates.name, phase_templates.id) > (${filter.after.name}, ${filter.after.id}::uuid)`,
        )
      }
      return query.orderBy('name').orderBy('id').limit(filter.limit).execute()
    })
    .pipe(Effect.map((found) => found as unknown as TemplateRow[]))

export const insertTemplate = (input: {
  tenantId: string
  name: string
  kind: string
  phases: readonly unknown[]
}) =>
  db
    .query((k) =>
      k
        .insertInto('PhaseTemplate')
        .values({
          tenantId: input.tenantId,
          name: input.name,
          kind: input.kind,
          phases: jsonb(input.phases),
        } as never)
        .returning(templateColumns)
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => row as unknown as TemplateRow))

export const updateTemplateRow = (
  tenantId: string,
  templateId: string,
  fields: { name?: string; phases?: readonly unknown[] },
) =>
  db
    .query((k) =>
      k
        .updateTable('PhaseTemplate')
        .set({
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.phases !== undefined
            ? { phases: jsonb(fields.phases), version: sql`version + 1` }
            : {}),
          updatedAt: sql`now()`,
        } as never)
        .where('tenantId', '=', tenantId)
        .where('id', '=', templateId)
        .returning(templateColumns)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ?? null) as TemplateRow | null))

export const deleteTemplateRow = (tenantId: string, templateId: string) =>
  db
    .query((k) =>
      k
        .deleteFrom('PhaseTemplate')
        .where('tenantId', '=', tenantId)
        .where('id', '=', templateId)
        .returning('id')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * Every batch that may have a boundary the clock has crossed, across tenants.
 *
 * The scheduler acts as the system rather than for a principal, so this one
 * query is deliberately not tenant-scoped. It is a candidate query and may
 * over-approximate: the engine decides inside each batch's transaction what
 * actually crosses. It may never under-approximate, which is why the
 * predicate is the weakest one a crossing implies - an unentered scheduled
 * phase whose planned instant has passed. The armed-prefix rule (a manual
 * boundary ahead of it) is the engine's to apply, not this statement's.
 */
export const batchesWithDueBoundaries = (now: number, limit: number) =>
  db
    .query((k) =>
      k
        .selectFrom('AssessmentBatch')
        .select(['AssessmentBatch.tenantId', 'AssessmentBatch.id'])
        .where('AssessmentBatch.status', '=', 'active')
        .where(
          sql<boolean>`exists (
            select 1 from batch_phases due
            where due.tenant_id = assessment_batches.tenant_id
              and due.batch_id = assessment_batches.id
              and due.actual_entry_at is null
              and due.planned_entry_at is not null
              and due.planned_entry_at <= ${instant(now)}
          )`,
        )
        .orderBy('AssessmentBatch.id')
        .limit(limit)
        .execute(),
    )
    .pipe(Effect.map((found) => found as { tenantId: string; id: string }[]))

// --- roster management ---
//
// The roster is the batch's population and its only truth (§32.45): drawn
// once when the round is created, and changed afterwards only by somebody
// deciding to. There is no drift to compute and nothing to reconcile against
// the live tree.

export interface ParticipantRow {
  id: string
  userId: string
  displayName: string
  businessNo: string | null
  userTypeId: string
  anchorNodeId: string
  anchorPath: string
  anchorLineage: readonly { nodeId: string; nodeTypeId: string }[]
  status: string
  includedAt: number
  excludedAt: number | null
}

const participantSelection = (k: Parameters<Parameters<typeof db.query>[0]>[0]) =>
  k
    .selectFrom('BatchParticipant')
    .innerJoin('User as u', (join) =>
      join
        .onRef('u.id', '=', 'BatchParticipant.userId')
        .onRef('u.tenantId', '=', 'BatchParticipant.tenantId'),
    )
    .select([
      'BatchParticipant.id',
      'BatchParticipant.userId',
      'BatchParticipant.userTypeId',
      'BatchParticipant.anchorLineage',
      'BatchParticipant.status',
      'u.displayName',
      'u.businessNo',
    ])
    .select([
      sql<string>`batch_participants.assessment_anchor_node_id`.as('anchorNodeId'),
      sql<string>`batch_participants.anchor_path::text`.as('anchorPath'),
      epoch('batch_participants.included_at').as('includedAt'),
      epoch('batch_participants.excluded_at').as('excludedAt'),
    ])

const toParticipantRow = (row: Record<string, unknown>): ParticipantRow =>
  ({
    ...row,
    includedAt: msOf(row.includedAt),
    excludedAt: msOf(row.excludedAt),
  }) as ParticipantRow

export const listParticipantsPage = (
  tenantId: string,
  batchId: string,
  filter: {
    status?: string
    /** narrowed to the people frozen at, or under, these units */
    orgNodeIds?: readonly string[]
    orgScope?: 'self' | 'subtree'
    after?: { path: string; id: string }
    limit: number
  },
) =>
  db
    .query((k) => {
      let query = participantSelection(k)
        .where('BatchParticipant.tenantId', '=', tenantId)
        .where('BatchParticipant.batchId', '=', batchId)
      if (filter.status !== undefined) {
        query = query.where('BatchParticipant.status', '=', filter.status)
      }
      if (filter.orgNodeIds !== undefined && filter.orgNodeIds.length > 0) {
        // against the frozen anchor, not against where the person lives now:
        // the list says who this round admitted and from where
        query = query.where(
          sql<boolean>`exists (
            select 1 from org_nodes scope
             where scope.tenant_id = batch_participants.tenant_id
               and scope.id = any(${filter.orgNodeIds as string[]}::uuid[])
               and ${
                 filter.orgScope === 'self'
                   ? sql<boolean>`batch_participants.assessment_anchor_node_id = scope.id`
                   : sql<boolean>`batch_participants.anchor_path <@ scope.path`
               }
          )`,
        )
      }
      if (filter.after !== undefined) {
        query = query.where(
          sql<boolean>`(batch_participants.anchor_path::text, batch_participants.id)
            > (${filter.after.path}, ${filter.after.id}::uuid)`,
        )
      }
      return query
        .orderBy(sql`batch_participants.anchor_path`)
        .orderBy('BatchParticipant.id')
        .limit(filter.limit)
        .execute()
    })
    .pipe(
      Effect.map((found) => (found as unknown as Record<string, unknown>[]).map(toParticipantRow)),
    )

/** the row for one person in one batch, whatever its status */
/**
 * Somebody's live membership of a batch, which is the whole of what a
 * participant's capabilities are made of.
 *
 * Excluded rows are not membership. They are kept because what a person did
 * while they were in the round is theirs and the round's (§32.47), and a
 * query that returns them to an authorization check turns "taken off the
 * list" into "still allowed to file". Whoever wants the record of a past
 * membership asks the roster, which is where records belong.
 */
export const activeParticipantByUser = (tenantId: string, batchId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .select(['id', 'status'])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .where('userId', '=', userId)
        .where('status', '=', 'active')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ?? null) as { id: string; status: string } | null))

export const oneParticipant = (tenantId: string, batchId: string, participantId: string) =>
  db
    .query((k) =>
      participantSelection(k)
        .where('BatchParticipant.tenantId', '=', tenantId)
        .where('BatchParticipant.batchId', '=', batchId)
        .where('BatchParticipant.id', '=', participantId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined ? null : toParticipantRow(row as Record<string, unknown>),
      ),
    )

/** where a person stands right now, and as what */
export const userLivePosition = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User')
        .innerJoin('OrgNode as n', (join) =>
          join
            .onRef('n.id', '=', 'User.primaryOrgNodeId')
            .onRef('n.tenantId', '=', 'User.tenantId'),
        )
        .select(['User.id', 'User.enabled', 'User.userTypeId'])
        .select([sql<string>`n.id`.as('nodeId'), sql<string>`n.path::text`.as('nodePath')])
        .where('User.tenantId', '=', tenantId)
        .where('User.id', '=', userId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map(
        (row) =>
          (row ?? null) as {
            id: string
            enabled: boolean
            userTypeId: string
            nodeId: string
            nodePath: string
          } | null,
      ),
    )

/** whether this live position falls under any living scope node of the batch */
export const activeElsewhere = (tenantId: string, userId: string, excludingBatchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .innerJoin('AssessmentBatch as b', (join) =>
          join
            .onRef('b.id', '=', 'BatchParticipant.batchId')
            .onRef('b.tenantId', '=', 'BatchParticipant.tenantId'),
        )
        .select([sql<string>`b.id`.as('batchId'), sql<string>`b.name`.as('name')])
        .where('BatchParticipant.tenantId', '=', tenantId)
        .where('BatchParticipant.userId', '=', userId)
        .where('BatchParticipant.status', '=', 'active')
        .where('BatchParticipant.batchId', '!=', excludingBatchId)
        .where('b.status', '!=', 'archived')
        .orderBy('b.id')
        .execute(),
    )
    .pipe(Effect.map((found) => found as { batchId: string; name: string }[]))

/**
 * The frozen snapshot for one person, taken now: one insert, the same shape
 * activation uses, scoped to a single user. Returns nothing when the user is
 * missing - eligibility and scope are the service's questions, asked first.
 */
/**
 * One thing that happened to somebody's membership, kept for good.
 *
 * The participant row says who is in the round now, and it says it by being
 * overwritten - a readmission clears the withdrawal it replaces. This is
 * where the fact that both happened survives.
 */
export const insertParticipantEvent = (input: {
  tenantId: string
  batchId: string
  participantId: string
  kind: 'included' | 'excluded' | 'readmitted'
  actorId: string | null
  reason?: string | null
}) =>
  db
    .query((k) =>
      k
        .insertInto('BatchParticipantEvent')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          participantId: input.participantId,
          kind: input.kind,
          actorId: input.actorId,
          reason: input.reason ?? null,
        } as never)
        .execute(),
    )
    .pipe(Effect.asVoid)

/** the membership history of one person in one round, oldest first */
export const participantEvents = (tenantId: string, participantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipantEvent')
        .select(['id', 'kind', 'actorId', 'reason'])
        .select([epoch('occurred_at').as('occurredAt')])
        .where('tenantId', '=', tenantId)
        .where('participantId', '=', participantId)
        .orderBy('occurredAt')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        (rows as unknown as Record<string, unknown>[]).map((row) => ({
          id: row.id as string,
          kind: row.kind as 'included' | 'excluded' | 'readmitted',
          actorId: (row.actorId ?? null) as string | null,
          reason: (row.reason ?? null) as string | null,
          occurredAt: msOf(row.occurredAt),
        })),
      ),
    )

export const setParticipantStatus = (
  tenantId: string,
  participantId: string,
  to: 'active' | 'excluded',
  nowMs: number,
  actor?: { userId: string | null; reason: string | null },
) =>
  db.query((k) =>
    k
      .updateTable('BatchParticipant')
      .set(
        to === 'excluded'
          ? ({
              status: 'excluded',
              excludedAt: instant(nowMs),
              excludedBy: actor?.userId ?? null,
              exclusionReason: actor?.reason ?? null,
              updatedAt: sql`now()`,
            } as never)
          : // brought back in: the withdrawal is cleared rather than kept
            // beside a live membership, and the record of it is the event log
            ({
              status: 'active',
              excludedAt: null,
              excludedBy: null,
              exclusionReason: null,
              includedAt: instant(nowMs),
              includedBy: actor?.userId ?? null,
              updatedAt: sql`now()`,
            } as never),
      )
      .where('tenantId', '=', tenantId)
      .where('id', '=', participantId)
      .execute(),
  )

export const roleHoldersAt = (tenantId: string, nodeIds: readonly string[]) =>
  nodeIds.length === 0
    ? Effect.succeed(new Map<string, number>())
    : db
        .query((k) =>
          k
            .selectFrom('RoleGrant')
            .select(['orgNodeId'])
            .select([sql<number>`count(distinct user_id)::int`.as('holders')])
            .where('tenantId', '=', tenantId)
            .where('orgNodeId', 'in', nodeIds)
            .groupBy('orgNodeId')
            .execute(),
        )
        .pipe(
          Effect.map(
            (found) =>
              new Map(
                (found as { orgNodeId: string; holders: number }[]).map((row) => [
                  row.orgNodeId,
                  row.holders,
                ]),
              ),
          ),
        )

// --- options for the batch form ---
//
// Served from this domain rather than by sending the screen to org and auth
// (§22): a batch administrator holds assessment.batch.manage and nothing
// else, so the options a batch form needs are read with that permission or
// they are not readable at all.

/**
 * The units a caller may put a batch in front of, as a tree they can walk.
 *
 * The parent is named rather than the materialized path. The path is the
 * database's own addressing scheme for making subtree queries fast; handing
 * it to a browser publishes the shape and naming of an organization to
 * whoever can see a single leaf of it, and the picker needs no more than
 * which node hangs under which.
 */
export const scopeOptions = (tenantId: string, held: AuthorizationScope, limit: number) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode')
        .select(['id', 'name', 'depth', 'orgTypeId'])
        .select([
          sql<string | null>`(
            select parent.id::text from org_nodes parent
            where parent.tenant_id = org_nodes.tenant_id
              and parent.path = subpath(org_nodes.path, 0, nlevel(org_nodes.path) - 1)
          )`.as('parentId'),
        ])
        .where('tenantId', '=', tenantId)
        .where((eb) =>
          scopeCoverage(held, {
            id: eb.ref('OrgNode.id'),
            tenantId: eb.ref('OrgNode.tenantId'),
            path: eb.ref('OrgNode.path'),
          }),
        )
        .orderBy(sql`org_nodes.path`)
        .limit(limit)
        .execute(),
    )
    .pipe(
      Effect.map(
        (found) =>
          found as {
            id: string
            name: string
            parentId: string | null
            depth: number
            orgTypeId: string
          }[],
      ),
    )

export const userTypeOptions = (tenantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('UserType')
        .select(['id', 'code', 'name'])
        .where('tenantId', '=', tenantId)
        .where('enabled', '=', true)
        .orderBy('sortOrder')
        .orderBy('name')
        .execute(),
    )
    .pipe(Effect.map((found) => found as { id: string; code: string; name: string }[]))
