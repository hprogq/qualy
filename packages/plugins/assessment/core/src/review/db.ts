import { Effect } from 'effect'
import { sql, type RawBuilder } from 'kysely'
import { db } from '../server/db.ts'
import { readResolved, type ResolvedPolicy } from './chain.ts'

// The review rows and the one definition of who may judge them.
//
// Same conventions as the neighbouring modules: epoch milliseconds out,
// jsonb parsed, no floats.

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

const uuidArray = (ids: readonly string[]) => sql`${sql.val(`{${ids.join(',')}}`)}::uuid[]`

/** what the predicate is asked about; values or column references alike */
export interface ReviewerRefs {
  readonly tenantId: RawBuilder<unknown>
  readonly batchId: RawBuilder<unknown>
  readonly nodeId: RawBuilder<unknown>
  /** a uuid[] expression: the stage's roles */
  readonly roleIds: RawBuilder<unknown>
  readonly userId: RawBuilder<unknown>
  readonly subjectUserId: RawBuilder<unknown>
  readonly actorId: RawBuilder<unknown>
}

/**
 * The one definition of "may review this stage" (§11.3). Submit's arrival
 * check, the inbox and the decision endpoints all ask this same fragment,
 * so "the submit found a reviewer the inbox never shows" cannot be written.
 *
 * One assignment carries the whole answer. Standing: one of the stage's
 * roles anchored at exactly the stage's node - exact on purpose (§14,
 * §32.23): a grant anchored higher up does not reach down into the stage,
 * however wide its coverage, or a role mis-granted at the college would
 * quietly review every class below it. Coverage itself says nothing about
 * membership either way, so the ordinary subtree grant an administrator
 * writes at that unit is a member like any other - live, role active,
 * holder enabled, resource general or this batch. And
 * the batch accepted assessment.review.process from THAT assignment, not
 * merely from some assignment of theirs: acceptance names sources one by
 * one, so a new stage grant may not walk in on an older assignment's
 * acceptance - it becomes reviewable when it is itself accepted. Minus what
 * the batch took back, minus distance: neither the subject nor whoever
 * authored the revision under judgment.
 *
 * The phase gate is deliberately not in here: it answers "is this act open
 * this minute" and binds the acts (inbox, decisions), while this fragment
 * also answers submit's "does anyone exist to receive this" - asked during
 * an entry phase, when the review phase has usually not begun.
 */
const mayReview = (r: ReviewerRefs) => sql<boolean>`(
  exists (
    select 1
    from role_grants rg
    join roles ro on ro.tenant_id = rg.tenant_id and ro.id = rg.role_id
    join users u on u.tenant_id = rg.tenant_id and u.id = rg.user_id
    join batch_access_sources bas
      on bas.tenant_id = rg.tenant_id
      and bas.role_assignment_id = rg.id
      and bas.batch_id = ${r.batchId}
      and bas.subject_id = rg.user_id
    join batch_access_source_permissions sp
      on sp.tenant_id = bas.tenant_id
      and sp.source_id = bas.id
      and sp.permission_code = 'assessment.review.process'
    where rg.tenant_id = ${r.tenantId}
      and rg.user_id = ${r.userId}
      and rg.org_node_id = ${r.nodeId}
      and rg.role_id = any(${r.roleIds})
      and rg.revoked_at is null
      and (rg.valid_from is null or rg.valid_from <= now())
      and (rg.valid_until is null or rg.valid_until > now())
      and ro.status = 'active'
      and u.enabled
      and (
        ro.permission_mode = 'all-active'
        or exists (
          select 1 from role_permissions rp
          join permissions pe on pe.id = rp.permission_id
          where rp.tenant_id = ro.tenant_id and rp.role_id = ro.id
            and pe.code = sp.permission_code
        )
      )
      and not exists (
        select 1 from batch_access_denies dn
        where dn.tenant_id = bas.tenant_id and dn.batch_id = bas.batch_id
          and dn.subject_id = bas.subject_id
          and dn.permission_code = sp.permission_code
      )
      and (
        rg.resource_namespace is null
        or (
          rg.resource_namespace = 'assessment'
          and rg.resource_type = 'batch'
          and rg.resource_id = ${r.batchId}
        )
      )
  )
  and ${r.userId} <> ${r.subjectUserId}
  and ${r.actorId} is distinct from ${r.userId}
)`

/** the stage's judges as submit must find them: enumerate, then hold each to the definition */
export const reviewersAt = (input: {
  tenantId: string
  batchId: string
  nodeId: string
  roleIds: readonly string[]
  subjectUserId: string
  actorId: string
}) =>
  input.roleIds.length === 0
    ? Effect.succeed([] as readonly string[])
    : db
        .query((k) =>
          sql<{ user_id: string }>`
            select distinct rg0.user_id
            from role_grants rg0
            where rg0.tenant_id = ${input.tenantId}
              and rg0.org_node_id = ${input.nodeId}
              and rg0.role_id = any(${uuidArray(input.roleIds)})
              and rg0.revoked_at is null
              and ${mayReview({
                tenantId: sql`${input.tenantId}`,
                batchId: sql`${input.batchId}`,
                nodeId: sql`${input.nodeId}`,
                roleIds: uuidArray(input.roleIds),
                userId: sql.ref('rg0.user_id'),
                subjectUserId: sql`${input.subjectUserId}`,
                actorId: sql`${input.actorId}`,
              })}
          `.execute(k),
        )
        .pipe(Effect.map(({ rows }) => rows.map((row) => String(row.user_id))))

/** one person against one instance's stage, for the decision endpoints */
export const userMayReview = (input: {
  tenantId: string
  userId: string
  instance: {
    batchId: string
    currentNodeId: string
    currentRoleIds: readonly string[]
    subjectUserId: string
    actorId: string
  }
}) =>
  input.instance.currentRoleIds.length === 0
    ? Effect.succeed(false)
    : db
        .query((k) =>
          sql<{ ok: boolean }>`
            select ${mayReview({
              tenantId: sql`${input.tenantId}`,
              batchId: sql`${input.instance.batchId}`,
              nodeId: sql`${input.instance.currentNodeId}`,
              roleIds: uuidArray(input.instance.currentRoleIds),
              userId: sql`${input.userId}`,
              subjectUserId: sql`${input.instance.subjectUserId}`,
              actorId: sql`${input.instance.actorId}`,
            })} as ok
          `.execute(k),
        )
        .pipe(Effect.map(({ rows }) => Boolean(rows[0]!.ok)))

export interface ReviewInstanceDetailRow {
  id: string
  state: 'active' | 'blocked' | 'completed'
  outcome: string | null
  currentRoute: 'normal' | 'escalation'
  currentStageId: string
  rejectPolicy: 'any-stage' | 'terminal-only'
  effectivePolicy: ResolvedPolicy
  roundNo: number
  entryId: string
  revisionId: string
  currentNodeId: string
  currentRoleIds: readonly string[]
  createdAt: number
  completedAt: number | null
  batchId: string
  batchStatus: string
  itemId: string
  itemTitle: string
  itemType: string
  participantId: string
  subjectUserId: string
  subjectName: string
  subjectBusinessNo: string | null
  /** the unit the participant stands in, by the live tree; null if it went */
  unitName: string | null
  actorId: string
  itemRevisionId: string
  maxEntries: number | null
  scoreGroupId: string
  batchMaterialRange: string
  /** {reject?: string[], escalate?: string[]} as configured on the batch */
  batchReviewReasons: unknown
}

/** an instance with everything around it that reading or judging it needs */
export const instanceOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('AssessmentBatch as b', (join) =>
          join.onRef('b.tenantId', '=', 'e.tenantId').onRef('b.id', '=', 'e.batchId'),
        )
        .innerJoin('AssessmentItem as i', (join) =>
          join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .innerJoin('User as su', (join) =>
          join.onRef('su.tenantId', '=', 'bp.tenantId').onRef('su.id', '=', 'bp.userId'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .leftJoin('OrgNode as un', (join) =>
          join
            .onRef('un.tenantId', '=', 'bp.tenantId')
            .onRef('un.id', '=', 'bp.assessmentAnchorNodeId'),
        )
        .select([
          'ri.id',
          'ri.state',
          'ri.outcome',
          'ri.currentRoute',
          'ri.currentStageId',
          'ri.rejectPolicy',
          'ri.effectiveChain',
          'ri.roundNo',
          'ri.entryId',
          'ri.revisionId',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'e.batchId',
          'b.status as batchStatus',
          'b.reviewReasons as batchReviewReasons',
          'e.itemId',
          'i.title as itemTitle',
          'i.itemType',
          'i.maxEntries',
          'i.scoreGroupId',
          'e.participantId',
          'bp.userId as subjectUserId',
          'su.displayName as subjectName',
          'su.businessNo as subjectBusinessNo',
          'un.name as unitName',
          'er.actorId',
          'er.itemRevisionId',
        ])
        .select([
          sql<string>`b.material_range::text`.as('batchMaterialRange'),
          epoch('ri.created_at').as('createdMs'),
          epoch('ri.completed_at').as('completedMs'),
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('ri.id', '=', instanceId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: row.id,
              state: row.state as ReviewInstanceDetailRow['state'],
              outcome: row.outcome,
              currentRoute: row.currentRoute as ReviewInstanceDetailRow['currentRoute'],
              currentStageId: row.currentStageId,
              rejectPolicy: row.rejectPolicy as ReviewInstanceDetailRow['rejectPolicy'],
              // rounds opened before the split stored one list with a marker
              effectivePolicy: readResolved(row.effectiveChain),
              roundNo: row.roundNo,
              entryId: row.entryId,
              revisionId: row.revisionId,
              currentNodeId: row.currentNodeId,
              currentRoleIds: row.currentRoleIds,
              createdAt: msOf(row.createdMs),
              completedAt: row.completedMs == null ? null : msOf(row.completedMs),
              batchId: row.batchId,
              batchStatus: row.batchStatus as string,
              itemId: row.itemId,
              itemTitle: row.itemTitle,
              itemType: row.itemType,
              participantId: row.participantId,
              subjectUserId: row.subjectUserId,
              subjectName: row.subjectName,
              subjectBusinessNo: row.subjectBusinessNo,
              unitName: row.unitName,
              actorId: row.actorId,
              itemRevisionId: row.itemRevisionId,
              maxEntries: row.maxEntries,
              scoreGroupId: row.scoreGroupId,
              batchMaterialRange: String(row.batchMaterialRange),
              batchReviewReasons: row.batchReviewReasons ?? {},
            } satisfies ReviewInstanceDetailRow),
      ),
    )

export interface InboxRow {
  instanceId: string
  entryId: string
  batchId: string
  batchName: string
  itemId: string
  itemTitle: string
  participantName: string
  businessNo: string | null
  unitId: string | null
  unitName: string | null
  roundNo: number
  route: 'normal' | 'escalation'
  /** the judged revision's answers, for the service to project into columns */
  payload: unknown
  /** the form those answers were filed under, for the labels */
  formConfig: unknown
  attachmentCount: number
  submittedAt: number
  submittedAtIso: string
}

/** the batches that currently hold work in this tenant, for the gate to sort */
export const activeReviewBatches = (tenantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .select(['e.batchId'])
        .distinct()
        .where('ri.tenantId', '=', tenantId)
        .where('ri.state', '=', 'active')
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.batchId)))

/**
 * One reviewer's queue, oldest first: every active round whose stage the
 * caller may judge, in batches where judging is open now. Pull model - the
 * stage names roles, never a person, so nothing here is assigned, only
 * answered.
 */
export const inboxPage = (input: {
  tenantId: string
  userId: string
  batchIds: readonly string[]
  after?: readonly [string, string] | undefined
  limit: number
}) =>
  input.batchIds.length === 0
    ? Effect.succeed([] as readonly InboxRow[])
    : db
        .query((k) => {
          let query = k
            .selectFrom('ReviewInstance as ri')
            .innerJoin('Entry as e', (join) =>
              join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
            )
            .innerJoin('AssessmentBatch as b', (join) =>
              join.onRef('b.tenantId', '=', 'e.tenantId').onRef('b.id', '=', 'e.batchId'),
            )
            .innerJoin('AssessmentItem as i', (join) =>
              join.onRef('i.tenantId', '=', 'e.tenantId').onRef('i.id', '=', 'e.itemId'),
            )
            .innerJoin('BatchParticipant as bp', (join) =>
              join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
            )
            .innerJoin('User as su', (join) =>
              join.onRef('su.tenantId', '=', 'bp.tenantId').onRef('su.id', '=', 'bp.userId'),
            )
            .innerJoin('EntryRevision as er', (join) =>
              join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
            )
            .innerJoin('AssessmentItemRevision as ir', (join) =>
              join
                .onRef('ir.tenantId', '=', 'er.tenantId')
                .onRef('ir.id', '=', 'er.itemRevisionId'),
            )
            .leftJoin('OrgNode as un', (join) =>
              join
                .onRef('un.tenantId', '=', 'bp.tenantId')
                .onRef('un.id', '=', 'bp.assessmentAnchorNodeId'),
            )
            .select([
              'ri.id as instanceId',
              'ri.entryId',
              'ri.roundNo',
              'ri.currentRoute',
              'e.batchId',
              'b.name as batchName',
              'e.itemId',
              'i.title as itemTitle',
              'su.displayName as participantName',
              'su.businessNo',
              'un.id as unitId',
              'un.name as unitName',
              'er.payload',
              'ir.formConfig',
            ])
            .select([
              epoch('ri.created_at').as('submittedMs'),
              sql<string>`ri.created_at::text`.as('submittedIso'),
              sql<string>`(
                select count(*) from entry_revision_attachments era
                where era.tenant_id = ri.tenant_id and era.revision_id = ri.revision_id
              )`.as('attachmentCount'),
            ])
            .where('ri.tenantId', '=', input.tenantId)
            .where('ri.state', '=', 'active')
            .where('e.batchId', 'in', [...input.batchIds])
            .where(
              mayReview({
                tenantId: sql`${input.tenantId}`,
                batchId: sql.ref('e.batch_id'),
                nodeId: sql.ref('ri.current_node_id'),
                roleIds: sql.ref('ri.current_role_ids'),
                userId: sql`${input.userId}`,
                subjectUserId: sql.ref('bp.user_id'),
                actorId: sql.ref('er.actor_id'),
              }),
            )
            .orderBy('ri.createdAt')
            .orderBy('ri.id')
            .limit(input.limit)
          if (input.after !== undefined) {
            query = query.where(
              sql<boolean>`(ri.created_at, ri.id) > (${input.after[0]}::timestamptz, ${input.after[1]}::uuid)`,
            )
          }
          return query.execute()
        })
        .pipe(
          Effect.map((rows) =>
            rows.map((row): InboxRow => ({
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
              route: row.currentRoute as InboxRow['route'],
              payload: row.payload,
              formConfig: row.formConfig,
              attachmentCount: Number(row.attachmentCount ?? 0),
              submittedAt: msOf(row.submittedMs),
              submittedAtIso: row.submittedIso,
            })),
          ),
        )

/**
 * The decision itself, first writer wins: the round closes exactly once,
 * and the loser of any race - a second reviewer, a withdrawal - is told the
 * round is no longer theirs to close rather than having their word appended
 * to a closed history.
 */
export const completeInstance = (input: {
  tenantId: string
  instanceId: string
  outcome: 'approved' | 'rejected'
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({ state: 'completed', outcome: input.outcome, completedAt: sql`now()` })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.instanceId)
        .where('state', '=', 'active')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export interface ReviewEventRow {
  id: string
  kind: string
  actorId: string | null
  /** who did it, by name: an id in a trail explains nothing to a reader */
  actorName: string | null
  reason: string | null
  comment: string | null
  suggestedPayload: unknown
  createdAt: number
}

export const reviewEventsOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewEvent as re')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 're.tenantId').onRef('u.id', '=', 're.actorId'),
        )
        .select([
          're.id',
          're.kind',
          're.actorId',
          're.reason',
          're.comment',
          're.suggestedPayload',
          'u.displayName as actorName',
        ])
        .select([epoch('re.created_at').as('createdMs')])
        .where('re.tenantId', '=', tenantId)
        .where('re.reviewInstanceId', '=', instanceId)
        .orderBy('re.createdAt')
        .orderBy('re.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): ReviewEventRow => ({
          id: row.id,
          kind: row.kind,
          actorId: row.actorId,
          actorName: row.actorName,
          reason: row.reason,
          comment: row.comment,
          suggestedPayload: row.suggestedPayload ?? null,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )

/**
 * The units of one level this round actually reaches, for a stage being
 * composed. Distinct because many participants share a unit, and drawn from
 * the frozen lineages rather than the live tree: the round judges people
 * where they stood when they joined it.
 */
export const stageNodesOf = (input: { tenantId: string; batchId: string; nodeTypeId: string }) =>
  db
    .query((k) =>
      sql<{ node_id: string; name: string }>`
        select distinct step.node_id, n.name
        from batch_participants bp
        cross join lateral (
          select (element->>'nodeId')::uuid as node_id, element->>'nodeTypeId' as node_type_id
          from jsonb_array_elements(bp.anchor_lineage) as element
        ) as step
        join org_nodes n on n.tenant_id = bp.tenant_id and n.id = step.node_id
        where bp.tenant_id = ${input.tenantId}
          and bp.batch_id = ${input.batchId}
          and bp.status = 'active'
          and step.node_type_id = ${input.nodeTypeId}
        order by n.name
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row) => ({ id: String(row.node_id), name: String(row.name) })),
      ),
    )

/**
 * The nearest holder of one role along a frozen lineage, walking outward
 * from where the participant stood. This is the selector for roles that
 * genuinely inherit - a counsellor granted over a whole faculty answers for
 * everyone under it - and it is why `nearestRole` exists beside `roleAt`
 * (§14): the anchor is wherever the holder actually is, not a level named
 * in the configuration.
 */
export const nearestRoleNode = (input: {
  tenantId: string
  batchId: string
  roleId: string
  lineage: readonly { nodeId: string }[]
}) =>
  input.lineage.length === 0
    ? Effect.succeed(null)
    : db
        .query((k) =>
          sql<{ node_id: string; ord: number }>`
            select steps.node_id, steps.ord
            from unnest(${sql.val(`{${input.lineage.map((step) => step.nodeId).join(',')}}`)}::uuid[])
              with ordinality as steps(node_id, ord)
            where exists (
              select 1
              from role_grants rg
              join roles ro on ro.tenant_id = rg.tenant_id and ro.id = rg.role_id
              join users u on u.tenant_id = rg.tenant_id and u.id = rg.user_id
              where rg.tenant_id = ${input.tenantId}
                and rg.org_node_id = steps.node_id
                and rg.role_id = ${input.roleId}
                and rg.revoked_at is null
                and (rg.valid_from is null or rg.valid_from <= now())
                and (rg.valid_until is null or rg.valid_until > now())
                and ro.status = 'active'
                and u.enabled
                and (
                  rg.resource_namespace is null
                  or (
                    rg.resource_namespace = 'assessment'
                    and rg.resource_type = 'batch'
                    and rg.resource_id = ${input.batchId}
                  )
                )
            )
            order by steps.ord
            limit 1
          `.execute(k),
        )
        .pipe(Effect.map(({ rows }) => (rows[0] ? String(rows[0].node_id) : null)))

/** names for the units and roles a chain snapshot refers to by id */
export const chainNames = (input: {
  tenantId: string
  nodeIds: readonly string[]
  roleIds: readonly string[]
}) =>
  Effect.gen(function* () {
    const nodes =
      input.nodeIds.length === 0
        ? []
        : yield* db.query((k) =>
            k
              .selectFrom('OrgNode')
              .select(['id', 'name'])
              .where('tenantId', '=', input.tenantId)
              .where('id', 'in', [...new Set(input.nodeIds)])
              .execute(),
          )
    const roles =
      input.roleIds.length === 0
        ? []
        : yield* db.query((k) =>
            k
              .selectFrom('Role')
              .select(['id', 'name'])
              .where('tenantId', '=', input.tenantId)
              .where('id', 'in', [...new Set(input.roleIds)])
              .execute(),
          )
    return {
      nodes: new Map(nodes.map((row) => [row.id, row.name])),
      roles: new Map(roles.map((row) => [row.id, row.name])),
    }
  })

export interface PatrolRow {
  id: string
  batchId: string
  state: 'active' | 'blocked'
  currentNodeId: string
  currentRoleIds: readonly string[]
  subjectUserId: string
  actorId: string
}

/** every open round in a tenant, with what deciding its stage needs */
export const openInstances = (tenantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
        )
        .innerJoin('BatchParticipant as bp', (join) =>
          join.onRef('bp.tenantId', '=', 'e.tenantId').onRef('bp.id', '=', 'e.participantId'),
        )
        .innerJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'ri.tenantId').onRef('er.id', '=', 'ri.revisionId'),
        )
        .select([
          'ri.id',
          'ri.state',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'e.batchId',
          'bp.userId as subjectUserId',
          'er.actorId',
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('ri.state', 'in', ['active', 'blocked'])
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): PatrolRow => ({
          id: row.id,
          batchId: row.batchId,
          state: row.state as PatrolRow['state'],
          currentNodeId: row.currentNodeId,
          currentRoleIds: row.currentRoleIds,
          subjectUserId: row.subjectUserId,
          actorId: row.actorId,
        })),
      ),
    )

/** the patrol's one write: a round changes state only if it is still where it was read */
export const setInstanceState = (input: {
  tenantId: string
  instanceId: string
  from: 'active' | 'blocked'
  to: 'active' | 'blocked'
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({ state: input.to })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.instanceId)
        .where('state', '=', input.from)
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** the rounds nobody can currently act on, grouped the way an alert panel reads them */
export const blockedGroups = (tenantId: string, batchId: string) =>
  db
    .query((k) =>
      sql<{ node_id: string; node_name: string; role_ids: string[]; waiting: string }>`
        select ri.current_node_id as node_id, n.name as node_name,
               ri.current_role_ids as role_ids, count(*)::text as waiting
        from review_instances ri
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        join org_nodes n on n.tenant_id = ri.tenant_id and n.id = ri.current_node_id
        where ri.tenant_id = ${tenantId} and e.batch_id = ${batchId} and ri.state = 'blocked'
        group by ri.current_node_id, n.name, ri.current_role_ids
        order by n.name
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row) => ({
          nodeId: String(row.node_id),
          nodeName: String(row.node_name),
          roleIds: row.role_ids.map(String),
          waiting: Number(row.waiting),
        })),
      ),
    )

/** the tenants with open rounds at all, so the patrol visits nothing empty */
export const tenantsWithOpenRounds = () =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select(['tenantId'])
        .distinct()
        .where('state', 'in', ['active', 'blocked'])
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.tenantId)))

/**
 * The people a stage's roles are on right now, by name, for an explanation.
 * The round's own subject and author are required rather than optional: the
 * explanation answers the same question the queue and the decision endpoint
 * answer, and a stage that named somebody those two refuse would be
 * explaining a queue nobody has.
 */
export const holderNamesAt = (input: {
  tenantId: string
  batchId: string
  nodeId: string
  roleIds: readonly string[]
  subjectUserId: string
  actorId: string
}) =>
  Effect.gen(function* () {
    if (input.roleIds.length === 0) return [] as readonly string[]
    const ids = yield* reviewersAt({
      tenantId: input.tenantId,
      batchId: input.batchId,
      nodeId: input.nodeId,
      roleIds: input.roleIds,
      subjectUserId: input.subjectUserId,
      actorId: input.actorId,
    })
    if (ids.length === 0) return [] as readonly string[]
    const rows = yield* db.query((k) =>
      k
        .selectFrom('User')
        .select(['displayName'])
        .where('tenantId', '=', input.tenantId)
        .where('id', 'in', [...ids])
        .orderBy('displayName')
        .execute(),
    )
    const names: readonly string[] = rows.map((row) => row.displayName)
    return names
  })

/** one claim beside the judged one: what it says and where it stands */
export interface SiblingEntryRow {
  entryId: string
  status: string
  /** the latest revision's answers; null for a claim never yet written */
  payload: unknown
  /** the form those answers were filed under, for the labels */
  formConfig: unknown
}

/**
 * Every claim this participant holds on this question, the judged one
 * included. Read from each entry's own latest revision - what the person
 * has said, not what some round froze - because the aside answers "what
 * else are they claiming here", which is a present-tense question.
 */
export const siblingEntries = (tenantId: string, itemId: string, participantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry as e')
        .leftJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'e.tenantId').onRef('er.id', '=', 'e.currentRevisionId'),
        )
        .leftJoin('AssessmentItemRevision as ir', (join) =>
          join.onRef('ir.tenantId', '=', 'er.tenantId').onRef('ir.id', '=', 'er.itemRevisionId'),
        )
        .select(['e.id as entryId', 'e.status', 'er.payload', 'ir.formConfig'])
        .where('e.tenantId', '=', tenantId)
        .where('e.itemId', '=', itemId)
        .where('e.participantId', '=', participantId)
        .where('e.status', '<>', 'voided')
        .orderBy('e.createdAt')
        .orderBy('e.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): SiblingEntryRow => ({
          entryId: row.entryId,
          status: row.status,
          payload: row.payload ?? null,
          formConfig: row.formConfig ?? null,
        })),
      ),
    )

/** how the round before this one ended, with the word that ended it */
export interface PreviousConclusionRow {
  kind: string
  reason: string | null
  comment: string | null
  actorName: string | null
  createdAt: number
}

/**
 * The previous round's concluding word on the same entry: the latest event
 * that decided something on the newest earlier instance. Shown over a
 * resubmission so the reviewer reads it against what was asked last time.
 */
export const previousConclusion = (tenantId: string, entryId: string, beforeRound: number) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewEvent as re')
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 're.tenantId').onRef('ri.id', '=', 're.reviewInstanceId'),
        )
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 're.tenantId').onRef('u.id', '=', 're.actorId'),
        )
        .select(['re.kind', 're.reason', 're.comment', 'u.displayName as actorName'])
        .select([epoch('re.created_at').as('createdMs')])
        .where('re.tenantId', '=', tenantId)
        .where('ri.entryId', '=', entryId)
        .where('ri.roundNo', '<', beforeRound)
        .where('re.kind', 'in', [
          'approved',
          'rejected',
          'returned-for-revision',
          'revision-required',
          'cancelled-by-submitter',
        ])
        .orderBy('ri.roundNo', 'desc')
        .orderBy('re.createdAt', 'desc')
        .orderBy('re.id', 'desc')
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              kind: row.kind,
              reason: row.reason,
              comment: row.comment,
              actorName: row.actorName,
              createdAt: msOf(row.createdMs),
            } satisfies PreviousConclusionRow),
      ),
    )

/**
 * Decisions this person recorded on this batch today, on the batch's own
 * calendar. "Today" is the batch timezone's day, not the server's: the
 * counter greets whoever sits down in the morning, and mornings are local.
 */
export const decisionsToday = (input: {
  tenantId: string
  batchId: string
  userId: string
  timezone: string
}) =>
  db
    .query((k) =>
      sql<{ count: string }>`
        select count(*) as count
        from review_events re
        join review_instances ri
          on ri.tenant_id = re.tenant_id and ri.id = re.review_instance_id
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        where re.tenant_id = ${input.tenantId}
          and e.batch_id = ${input.batchId}
          and re.actor_id = ${input.userId}
          and re.kind in ('approved', 'rejected', 'escalated', 'comment',
                          'recommend-approve', 'recommend-reject')
          and re.created_at >=
            date_trunc('day', now() at time zone ${input.timezone}) at time zone ${input.timezone}
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.count)))

/** the group a question adds into, for the aside that says what it may total */
export const scoreGroupOf = (tenantId: string, groupId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ScoreGroup')
        .select(['name'])
        .select([sql<string | null>`cap::text`.as('cap')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', groupId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : { name: row.name, cap: row.cap === null ? null : String(row.cap) },
      ),
    )

/**
 * Whether this person may judge some open round of this claim right now.
 *
 * The door to the claim's whole history: reading how a filing got here is
 * part of judging it, and the one definition of "may review" answers that
 * too. Open rounds only - having judged something last term is not standing
 * to read it today.
 */
export const mayReviewEntry = (input: { tenantId: string; userId: string; entryId: string }) =>
  db
    .query((k) =>
      sql<{ ok: boolean }>`
        select exists (
          select 1
          from review_instances ri
          join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
          join batch_participants bp on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
          join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
          where ri.tenant_id = ${input.tenantId}
            and ri.entry_id = ${input.entryId}
            and ri.state in ('active', 'blocked')
            and ${mayReview({
              tenantId: sql`${input.tenantId}`,
              batchId: sql.ref('e.batch_id'),
              nodeId: sql.ref('ri.current_node_id'),
              roleIds: sql.ref('ri.current_role_ids'),
              userId: sql`${input.userId}`,
              subjectUserId: sql.ref('bp.user_id'),
              actorId: sql.ref('er.actor_id'),
            })}
        ) as ok
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Boolean(rows[0]!.ok)))
