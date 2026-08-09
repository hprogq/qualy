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
  /** the configured set, dangling ids included: this is the intent */
  scopeNodeIds: readonly string[]
  materialRange: string
  timezone: string
  status: string
  configRevision: number
  anchorAutoSync: boolean
  currentPhaseId: string | null
  createdAt: number
}

/** the batch's scope as the row carries it on the wire-facing reads */
const scopeNodeIdsOf = sql<readonly string[]>`coalesce(
  (select jsonb_agg(bsn.node_id order by bsn.node_id)
     from batch_scope_nodes bsn
    where bsn.tenant_id = assessment_batches.tenant_id
      and bsn.batch_id = assessment_batches.id),
  '[]'::jsonb)`

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
      'anchorAutoSync',
      'currentPhaseId',
    ])
    .select([
      sql<string>`material_range::text`.as('materialRange'),
      epoch('created_at').as('createdAt'),
      scopeNodeIdsOf.as('scopeNodeIds'),
    ])

const toBatchRow = (row: Record<string, unknown>): BatchRow =>
  ({ ...row, createdAt: msOf(row.createdAt) }) as BatchRow

export const oneBatch = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      batchSelection(k)
        .where('tenantId', '=', tenantId)
        .where('id', '=', batchId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row === undefined ? null : toBatchRow(row as never))))

/**
 * One page of the batches every one of whose existing scope nodes the
 * caller's grants reach, newest first. The authorization scope is pushed
 * into the statement: the database intersects, nothing is fetched and
 * filtered. A dangling scope row defines nobody, so it neither blocks nor
 * grants visibility here; it surfaces as an integrity warning instead.
 */
export const listBatchesPage = (
  tenantId: string,
  held: AuthorizationScope,
  filter: { status?: string; after?: { createdAt: number; id: string }; limit: number },
) =>
  db
    .query((k) => {
      let query = batchSelection(k)
        .where('tenantId', '=', tenantId)
        .where(
          sql<boolean>`not exists (
            select 1 from batch_scope_nodes bsn
            join org_nodes scope on scope.tenant_id = bsn.tenant_id and scope.id = bsn.node_id
            where bsn.tenant_id = assessment_batches.tenant_id
              and bsn.batch_id = assessment_batches.id
              and not ${scopeCoverage(held, {
                id: sql.ref('scope.id') as never,
                tenantId: sql.ref('scope.tenant_id') as never,
                path: sql.ref('scope.path') as never,
              })}
          )`,
        )
      if (filter.status !== undefined) {
        query = query.where('status', '=', filter.status)
      }
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
  anchorAutoSync?: boolean
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
        ...(input.anchorAutoSync !== undefined ? { anchorAutoSync: input.anchorAutoSync } : {}),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow(),
  )

/** idempotent replacement of the population definition */
export const replaceBatchScopeNodes = (
  tenantId: string,
  batchId: string,
  nodeIds: readonly string[],
) =>
  Effect.gen(function* () {
    yield* db.query((k) =>
      k
        .deleteFrom('BatchScopeNode')
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .execute(),
    )
    if (nodeIds.length === 0) return
    yield* db.query((k) =>
      k
        .insertInto('BatchScopeNode')
        .values(nodeIds.map((nodeId) => ({ tenantId, batchId, nodeId })))
        .execute(),
    )
  })

/** the scope rows that still name a living unit, with where those units are now */
export const scopeNodeRows = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchScopeNode')
        .innerJoin('OrgNode as n', (join) =>
          join
            .onRef('n.id', '=', 'BatchScopeNode.nodeId')
            .onRef('n.tenantId', '=', 'BatchScopeNode.tenantId'),
        )
        .select(['n.id', 'n.path'])
        .where('BatchScopeNode.tenantId', '=', tenantId)
        .where('BatchScopeNode.batchId', '=', batchId)
        .orderBy('n.id')
        .execute(),
    )
    .pipe(Effect.map((found) => found as { id: string; path: string }[]))

/** the named nodes that exist in this tenant, for validating a selection */
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
    anchorAutoSync?: boolean
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
        ...(fields.anchorAutoSync !== undefined ? { anchorAutoSync: fields.anchorAutoSync } : {}),
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

export const listBatchUserTypes = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchUserType')
        .select('userTypeId')
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .orderBy('userTypeId')
        .execute(),
    )
    .pipe(Effect.map((found) => found.map((row) => row.userTypeId as string)))

export const replaceBatchUserTypes = (
  tenantId: string,
  batchId: string,
  userTypeIds: readonly string[],
) =>
  Effect.gen(function* () {
    yield* db.query((k) =>
      k
        .deleteFrom('BatchUserType')
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .execute(),
    )
    if (userTypeIds.length === 0) return
    yield* db.query((k) =>
      k
        .insertInto('BatchUserType')
        .values(userTypeIds.map((userTypeId) => ({ tenantId, batchId, userTypeId })))
        .execute(),
    )
  })

/** bumps the monotonic counter and returns the revision the event will carry */
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
  entryTrigger: 'scheduled' | 'manual' | 'publication'
  plannedEntryAt: number | null
  actualEntryAt: number | null
  entryOffset: { days?: number; hours?: number; minutes?: number } | null
  estimatedEntryAt: number | null
  opensPublicationId: string | null
  permissionProfile: readonly string[]
  sourceTemplateId: string | null
  sourceTemplateVersion: number | null
}

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
          'entryTrigger',
          'entryOffset',
          'opensPublicationId',
          'permissionProfile',
          'sourceTemplateId',
          'sourceTemplateVersion',
        ])
        .select([
          epoch('planned_entry_at').as('plannedEntryAt'),
          epoch('actual_entry_at').as('actualEntryAt'),
          epoch('estimated_entry_at').as('estimatedEntryAt'),
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
              estimatedEntryAt: msOf(row.estimatedEntryAt),
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
  entryTrigger: string
  plannedEntryAt: number | null
  entryOffset: Record<string, unknown> | null
  estimatedEntryAt: number | null
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
          entryTrigger: input.entryTrigger,
          plannedEntryAt: input.plannedEntryAt === null ? null : instant(input.plannedEntryAt),
          entryOffset: input.entryOffset === null ? null : jsonb(input.entryOffset),
          estimatedEntryAt:
            input.estimatedEntryAt === null ? null : instant(input.estimatedEntryAt),
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
    entryTrigger?: string
    plannedEntryAt?: number | null
    entryOffset?: Record<string, unknown> | null
    estimatedEntryAt?: number | null
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
        ...(fields.entryTrigger !== undefined ? { entryTrigger: fields.entryTrigger } : {}),
        ...(fields.plannedEntryAt !== undefined
          ? {
              plannedEntryAt:
                fields.plannedEntryAt === null ? null : instant(fields.plannedEntryAt),
            }
          : {}),
        ...(fields.entryOffset !== undefined
          ? { entryOffset: fields.entryOffset === null ? null : jsonb(fields.entryOffset) }
          : {}),
        ...(fields.estimatedEntryAt !== undefined
          ? {
              estimatedEntryAt:
                fields.estimatedEntryAt === null ? null : instant(fields.estimatedEntryAt),
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
export const generateRoster = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      sql`
        insert into batch_participants
          (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
        select
          u.tenant_id,
          ${batchId}::uuid,
          u.id,
          u.primary_org_node_id,
          n.path,
          (select jsonb_agg(jsonb_build_object('nodeId', a.id, 'nodeTypeId', a.org_type_id)
                            order by a.depth desc)
             from org_nodes a
            where a.tenant_id = u.tenant_id and a.path @> n.path),
          u.user_type_id
        from users u
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        join batch_user_types enrolled
          on enrolled.tenant_id = u.tenant_id
         and enrolled.batch_id = ${batchId}::uuid
         and enrolled.user_type_id = u.user_type_id
        where u.tenant_id = ${tenantId}::uuid
          and u.enabled
          and exists (
            select 1 from batch_scope_nodes bsn
            join org_nodes scope on scope.tenant_id = bsn.tenant_id and scope.id = bsn.node_id
            where bsn.tenant_id = u.tenant_id
              and bsn.batch_id = ${batchId}::uuid
              and n.path <@ scope.path
          )
      `.execute(k),
    )
    .pipe(
      Effect.map((result) => Number((result as { numAffectedRows?: bigint }).numAffectedRows ?? 0)),
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
  version: number
  phases: readonly Record<string, unknown>[]
}

const templateColumns = ['id', 'name', 'version', 'phases'] as const

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
  filter: { after?: { name: string; id: string }; limit: number },
) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('PhaseTemplate')
        .select(templateColumns)
        .where('tenantId', '=', tenantId)
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
  phases: readonly unknown[]
}) =>
  db
    .query((k) =>
      k
        .insertInto('PhaseTemplate')
        .values({
          tenantId: input.tenantId,
          name: input.name,
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
              and due.entry_trigger = 'scheduled'
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
// The diff queries below are derived views, computed on read: the roster
// never moves on its own, so these answer "what has drifted" and a person
// applies or ignores each line. Every one compares the frozen snapshot
// against the live tree through the living scope set.

/** membership in the living scope, as a fragment both sides of the diff use */
const inScope = (batchId: string, tenantRef: string, pathRef: string) => sql<boolean>`exists (
  select 1 from batch_scope_nodes bsn
  join org_nodes scope on scope.tenant_id = bsn.tenant_id and scope.id = bsn.node_id
  where bsn.tenant_id = ${sql.ref(tenantRef)}
    and bsn.batch_id = ${batchId}::uuid
    and ${sql.ref(pathRef)} <@ scope.path
)`

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
  filter: { status?: string; after?: { path: string; id: string }; limit: number },
) =>
  db
    .query((k) => {
      let query = participantSelection(k)
        .where('BatchParticipant.tenantId', '=', tenantId)
        .where('BatchParticipant.batchId', '=', batchId)
      if (filter.status !== undefined) {
        query = query.where('BatchParticipant.status', '=', filter.status)
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
export const participantByUser = (tenantId: string, batchId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .select(['id', 'status'])
        .where('tenantId', '=', tenantId)
        .where('batchId', '=', batchId)
        .where('userId', '=', userId)
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
export const positionInScope = (tenantId: string, batchId: string, nodePath: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchScopeNode')
        .innerJoin('OrgNode as scope', (join) =>
          join
            .onRef('scope.id', '=', 'BatchScopeNode.nodeId')
            .onRef('scope.tenantId', '=', 'BatchScopeNode.tenantId'),
        )
        .select('BatchScopeNode.nodeId')
        .where('BatchScopeNode.tenantId', '=', tenantId)
        .where('BatchScopeNode.batchId', '=', batchId)
        .where(sql<boolean>`${nodePath}::ltree <@ scope.path`)
        .limit(1)
        .execute(),
    )
    .pipe(Effect.map((found) => found.length > 0))

/** the other non-archived batches where this person already participates */
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
export const insertParticipant = (tenantId: string, batchId: string, userId: string) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into batch_participants
          (tenant_id, batch_id, user_id, assessment_anchor_node_id, anchor_path, anchor_lineage, user_type_id)
        select
          u.tenant_id,
          ${batchId}::uuid,
          u.id,
          u.primary_org_node_id,
          n.path,
          (select jsonb_agg(jsonb_build_object('nodeId', a.id, 'nodeTypeId', a.org_type_id)
                            order by a.depth desc)
             from org_nodes a
            where a.tenant_id = u.tenant_id and a.path @> n.path),
          u.user_type_id
        from users u
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        where u.tenant_id = ${tenantId}::uuid and u.id = ${userId}::uuid
        returning id
      `.execute(k),
    )
    .pipe(Effect.map((result) => (result.rows[0] ?? null) as { id: string } | null))

/** re-freezes one participant's snapshot - anchor, lineage and type - from live */
export const refreshParticipantSnapshot = (tenantId: string, participantId: string) =>
  db.query((k) =>
    sql`
      update batch_participants p
      set assessment_anchor_node_id = u.primary_org_node_id,
          anchor_path = n.path,
          anchor_lineage =
            (select jsonb_agg(jsonb_build_object('nodeId', a.id, 'nodeTypeId', a.org_type_id)
                              order by a.depth desc)
               from org_nodes a
              where a.tenant_id = u.tenant_id and a.path @> n.path),
          user_type_id = u.user_type_id,
          updated_at = now()
      from users u
      join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
      where p.tenant_id = ${tenantId}::uuid
        and p.id = ${participantId}::uuid
        and u.tenant_id = p.tenant_id
        and u.id = p.user_id
    `.execute(k),
  )

export const setParticipantStatus = (
  tenantId: string,
  participantId: string,
  to: 'active' | 'excluded',
  nowMs: number,
) =>
  db.query((k) =>
    k
      .updateTable('BatchParticipant')
      .set(
        to === 'excluded'
          ? ({ status: 'excluded', excludedAt: instant(nowMs), updatedAt: sql`now()` } as never)
          : ({
              status: 'active',
              excludedAt: null,
              includedAt: instant(nowMs),
              updatedAt: sql`now()`,
            } as never),
      )
      .where('tenantId', '=', tenantId)
      .where('id', '=', participantId)
      .execute(),
  )

// --- the roster diff, class by class ---

export interface NewArrivalRow {
  userId: string
  displayName: string
  businessNo: string | null
  userTypeId: string
  nodeId: string
  nodePath: string
  activeElsewhere: readonly { batchId: string; name: string }[]
}

export const diffNewArrivals = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      sql<NewArrivalRow>`
        select
          u.id as "userId",
          u.display_name as "displayName",
          u.business_no as "businessNo",
          u.user_type_id as "userTypeId",
          n.id as "nodeId",
          n.path::text as "nodePath",
          coalesce(
            (select jsonb_agg(jsonb_build_object('batchId', b2.id, 'name', b2.name) order by b2.id)
               from batch_participants p2
               join assessment_batches b2 on b2.tenant_id = p2.tenant_id and b2.id = p2.batch_id
              where p2.tenant_id = u.tenant_id and p2.user_id = u.id
                and p2.status = 'active' and p2.batch_id <> ${batchId}::uuid
                and b2.status <> 'archived'),
            '[]'::jsonb) as "activeElsewhere"
        from users u
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        join batch_user_types enrolled
          on enrolled.tenant_id = u.tenant_id
         and enrolled.batch_id = ${batchId}::uuid
         and enrolled.user_type_id = u.user_type_id
        where u.tenant_id = ${tenantId}::uuid
          and u.enabled
          and ${inScope(batchId, 'u.tenant_id', 'n.path')}
          and not exists (
            select 1 from batch_participants p
            where p.tenant_id = u.tenant_id and p.batch_id = ${batchId}::uuid and p.user_id = u.id)
        order by n.path, u.id
      `.execute(k),
    )
    .pipe(Effect.map((result) => result.rows as NewArrivalRow[]))

export interface DriftRow {
  participantId: string
  userId: string
  displayName: string
  frozenNodeId: string
  frozenPath: string
  frozenUserTypeId: string
  liveNodeId: string
  livePath: string
  liveUserTypeId: string
}

/** every active participant whose live position or type differs from the frozen one */
export const diffDriftedParticipants = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      sql<DriftRow & { inScope: boolean }>`
        select
          p.id as "participantId",
          u.id as "userId",
          u.display_name as "displayName",
          p.assessment_anchor_node_id as "frozenNodeId",
          p.anchor_path::text as "frozenPath",
          p.user_type_id as "frozenUserTypeId",
          n.id as "liveNodeId",
          n.path::text as "livePath",
          u.user_type_id as "liveUserTypeId",
          ${inScope(batchId, 'u.tenant_id', 'n.path')} as "inScope"
        from batch_participants p
        join users u on u.tenant_id = p.tenant_id and u.id = p.user_id
        join org_nodes n on n.tenant_id = u.tenant_id and n.id = u.primary_org_node_id
        where p.tenant_id = ${tenantId}::uuid
          and p.batch_id = ${batchId}::uuid
          and p.status = 'active'
          and (n.id <> p.assessment_anchor_node_id
               or n.path <> p.anchor_path
               or u.user_type_id <> p.user_type_id
               or not ${inScope(batchId, 'u.tenant_id', 'n.path')})
        order by p.anchor_path, p.id
      `.execute(k),
    )
    .pipe(Effect.map((result) => result.rows as (DriftRow & { inScope: boolean })[]))

/** scope rows whose unit no longer exists: the definition itself has a hole */
export const diffScopeIntegrity = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchScopeNode')
        .leftJoin('OrgNode as n', (join) =>
          join
            .onRef('n.id', '=', 'BatchScopeNode.nodeId')
            .onRef('n.tenantId', '=', 'BatchScopeNode.tenantId'),
        )
        .select('BatchScopeNode.nodeId')
        .where('BatchScopeNode.tenantId', '=', tenantId)
        .where('BatchScopeNode.batchId', '=', batchId)
        .where('n.id', 'is', null)
        .orderBy('BatchScopeNode.nodeId')
        .execute(),
    )
    .pipe(Effect.map((found) => found.map((row) => row.nodeId as string)))

/**
 * How many people hold any role anchored exactly at each of these nodes.
 *
 * The degraded stand-in for chain validation until review policies exist
 * (M3): it cannot know which roles matter, so it reports whether each level
 * of a lineage has anyone at all. Exact-anchor on purpose - the same
 * membership rule stage resolution will use.
 */
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
