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

/** what acting on one specific round adds to stage membership */
export interface RoundActorRefs extends ReviewerRefs {
  /** the instance's id, as a value or column reference */
  readonly instanceId: RawBuilder<unknown>
  /** the route the round currently walks */
  readonly route: RawBuilder<unknown>
}

/** the event kinds that count as a formal judgment by their actor */
const JUDGED_KINDS = `('approved', 'rejected', 'escalated', 'opinion-rejected')`

/**
 * Same-round independence (§32.66): once a round is in the escalation
 * process, no later step of it may be worked by somebody who already made
 * a formal judgment at an earlier step of THIS round - the班委 who
 * approved, the reviewer who escalated, the panel member who voted. The
 * ordinary route resolves people live and keeps no such memory, and an
 * appeal is a new round that starts clean: the prior round's deciders are
 * eligible again, on purpose.
 *
 * Two sources of "already judged", because panels record votes rather
 * than events: the round's formal events, and votes in any of its panels
 * that still count (a superseded panel's votes were about evidence that
 * has since changed, and voting again after a supplement is the point).
 */
const independentAt = (r: RoundActorRefs) => sql<boolean>`(
  ${r.route} <> 'escalation'
  or not (
    exists (
      select 1 from review_events xe
      where xe.tenant_id = ${r.tenantId}
        and xe.review_instance_id = ${r.instanceId}
        and xe.actor_id = ${r.userId}
        and xe.kind in ${sql.raw(JUDGED_KINDS)}
    )
    or exists (
      select 1 from review_votes xv
      join review_panels xp on xp.tenant_id = xv.tenant_id and xp.id = xv.panel_id
      where xv.tenant_id = ${r.tenantId}
        and xp.review_instance_id = ${r.instanceId}
        and xv.voter_user_id = ${r.userId}
        and xp.state <> 'superseded'
    )
  )
)`

/**
 * A sitting panel admits its own unvoted members and lets a newcomer fill
 * an empty seat; it never widens. Composed after `independentAt`, which
 * already turns away everyone who voted, so the branches here only ask
 * about seats. No open panel means the stage is not a sitting at all (or
 * the sitting has not been constituted yet), and membership alone decides.
 */
const seatedOrSeatable = (r: {
  readonly tenantId: RawBuilder<unknown>
  readonly instanceId: RawBuilder<unknown>
  readonly userId: RawBuilder<unknown>
}) => sql<boolean>`(
  not exists (
    select 1 from review_panels op
    where op.tenant_id = ${r.tenantId}
      and op.review_instance_id = ${r.instanceId}
      and op.state = 'open'
  )
  or exists (
    select 1 from review_panels op
    join review_panel_assignments pa
      on pa.tenant_id = op.tenant_id and pa.panel_id = op.id
    where op.tenant_id = ${r.tenantId}
      and op.review_instance_id = ${r.instanceId}
      and op.state = 'open'
      and pa.user_id = ${r.userId}
      and pa.ended_at is null
  )
  or exists (
    select 1 from review_panels op
    where op.tenant_id = ${r.tenantId}
      and op.review_instance_id = ${r.instanceId}
      and op.state = 'open'
      and (
        select count(*) from review_panel_assignments pa2
        where pa2.tenant_id = op.tenant_id and pa2.panel_id = op.id and pa2.ended_at is null
      ) < op.seat_count
      and not exists (
        select 1 from review_panel_assignments pa3
        where pa3.tenant_id = op.tenant_id and pa3.panel_id = op.id
          and pa3.user_id = ${r.userId} and pa3.ended_at is null
      )
  )
)`

/**
 * The whole of "may act on this round now": stage membership, same-round
 * independence, and a seat where the stage is a sitting. Every reader and
 * writer of a round's queue asks this one composition, so "the queue
 * shows what the decision refuses" cannot be written.
 */
const mayActOn = (r: RoundActorRefs) => sql<boolean>`(
  ${mayReview(r)}
  and ${independentAt(r)}
  and ${seatedOrSeatable(r)}
)`

/** the stage's judges as submit must find them: enumerate, then hold each to the definition */
export const reviewersAt = (input: {
  tenantId: string
  batchId: string
  nodeId: string
  roleIds: readonly string[]
  subjectUserId: string
  actorId: string
  /**
   * Apply same-round independence against this round: whoever already made
   * a formal judgment at an earlier step of it is not counted. Passed only
   * when the stage being asked about is an escalation step of that round.
   */
  excludeJudgedOfInstanceId?: string
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
              and ${
                input.excludeJudgedOfInstanceId === undefined
                  ? sql<boolean>`true`
                  : independentAt({
                      tenantId: sql`${input.tenantId}`,
                      batchId: sql`${input.batchId}`,
                      nodeId: sql`${input.nodeId}`,
                      roleIds: uuidArray(input.roleIds),
                      userId: sql.ref('rg0.user_id'),
                      subjectUserId: sql`${input.subjectUserId}`,
                      actorId: sql`${input.actorId}`,
                      instanceId: sql`${input.excludeJudgedOfInstanceId}`,
                      route: sql`${'escalation'}`,
                    })
              }
          `.execute(k),
        )
        .pipe(Effect.map(({ rows }) => rows.map((row) => String(row.user_id))))

/**
 * The states in which a round still belongs to its stage's reviewers.
 *
 * This list is the reviewer's read-and-act boundary in one place: a
 * reviewer's reach is their unfinished duty, not their history, so the
 * moment a decision hands the round on or ends it, the stage they matched
 * stops answering for them. An open ask (`awaiting_supplement`) keeps the
 * round theirs, because their task has not ended; a stalled stage
 * (`blocked`) likewise still awaits somebody at it.
 */
export const OPEN_REVIEW_STATES = ['active', 'blocked', 'awaiting_supplement'] as const

/** whether the state still has reviewers at all, for the read predicates */
export const isOpenReviewState = (state: string): boolean =>
  (OPEN_REVIEW_STATES as readonly string[]).includes(state)

/** one person against one instance's stage, for the decision endpoints */
export const userMayReview = (input: {
  tenantId: string
  userId: string
  instance: {
    id: string
    batchId: string
    currentRoute: 'normal' | 'escalation'
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
            select ${mayActOn({
              tenantId: sql`${input.tenantId}`,
              batchId: sql`${input.instance.batchId}`,
              nodeId: sql`${input.instance.currentNodeId}`,
              roleIds: uuidArray(input.instance.currentRoleIds),
              userId: sql`${input.userId}`,
              subjectUserId: sql`${input.instance.subjectUserId}`,
              actorId: sql`${input.instance.actorId}`,
              instanceId: sql`${input.instance.id}`,
              route: sql`${input.instance.currentRoute}`,
            })} as ok
          `.execute(k),
        )
        .pipe(Effect.map(({ rows }) => Boolean(rows[0]!.ok)))

export interface ReviewInstanceDetailRow {
  id: string
  state: 'active' | 'blocked' | 'awaiting_supplement' | 'completed'
  outcome: string | null
  currentRoute: 'normal' | 'escalation'
  currentStageId: string
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

/**
 * Whether real review work has begun on these rounds, and where each came
 * from.
 *
 * "Begun" is a formal act by a reviewer - a decision, an escalation, an
 * opinion climbing a ladder, an ask for more material, or any ballot cast
 * in a sitting - and it survives re-routing: a continuation round carries
 * its predecessors' work along the `supersedes_instance_id` lineage, or a
 * policy edit would quietly re-open a door the work had closed. Arrival
 * noise (submitted, assignee-not-found, stage-skipped) is not work.
 */
const WORK_KINDS = `('approved', 'rejected', 'escalated', 'opinion-rejected', 'supplement-requested')`

export const withdrawStandingsOf = (tenantId: string, instanceIds: readonly string[]) =>
  instanceIds.length === 0
    ? Effect.succeed(new Map<string, { origin: string; begun: boolean }>())
    : db
        .query((k) =>
          sql<{ id: string; origin: string; begun: boolean }>`
            with recursive lineage (root_id, id) as (
              select ri.id, ri.id from review_instances ri
              where ri.tenant_id = ${tenantId} and ri.id = any(${uuidArray(instanceIds)})
              union all
              select l.root_id, prior.id
              from lineage l
              join review_instances cur
                on cur.tenant_id = ${tenantId} and cur.id = l.id
              join review_instances prior
                on prior.tenant_id = ${tenantId} and prior.id = cur.supersedes_instance_id
            )
            select ri.id, ri.origin,
              (
                exists (
                  select 1 from review_events ev
                  join lineage l on l.root_id = ri.id and l.id = ev.review_instance_id
                  where ev.tenant_id = ${tenantId}
                    and ev.kind in ${sql.raw(WORK_KINDS)}
                )
                or exists (
                  select 1 from review_votes v
                  join review_panels pn on pn.tenant_id = v.tenant_id and pn.id = v.panel_id
                  join lineage l2 on l2.root_id = ri.id and l2.id = pn.review_instance_id
                  where v.tenant_id = ${tenantId}
                )
              ) as begun
            from review_instances ri
            where ri.tenant_id = ${tenantId} and ri.id = any(${uuidArray(instanceIds)})
          `.execute(k),
        )
        .pipe(
          Effect.map(
            ({ rows }) =>
              new Map(rows.map((row) => [row.id, { origin: row.origin, begun: row.begun }])),
          ),
        )

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
              mayActOn({
                tenantId: sql`${input.tenantId}`,
                batchId: sql.ref('e.batch_id'),
                nodeId: sql.ref('ri.current_node_id'),
                roleIds: sql.ref('ri.current_role_ids'),
                userId: sql`${input.userId}`,
                subjectUserId: sql.ref('bp.user_id'),
                actorId: sql.ref('er.actor_id'),
                instanceId: sql.ref('ri.id'),
                route: sql.ref('ri.current_route'),
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
  /** where the round stood when this was said; null on round-level events */
  stageId: string | null
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
          're.stageId',
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
          stageId: row.stageId,
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
  currentRoute: 'normal' | 'escalation'
  currentStageId: string
  /** the frozen routes, for reading the current stage's quorum */
  effectivePolicy: ResolvedPolicy
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
          'ri.currentRoute',
          'ri.currentStageId',
          'ri.effectiveChain',
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
          currentRoute: row.currentRoute as PatrolRow['currentRoute'],
          currentStageId: row.currentStageId,
          effectivePolicy: readResolved(row.effectiveChain),
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
  /** why nobody can act, when blocking; cleared on release */
  blockedReason: string | null
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({
          state: input.to,
          blockedReason: input.to === 'blocked' ? input.blockedReason : null,
        })
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
      sql<{
        node_id: string
        node_name: string
        role_ids: string[]
        reason: string | null
        waiting: string
      }>`
        select ri.current_node_id as node_id, n.name as node_name,
               ri.current_role_ids as role_ids, ri.blocked_reason as reason,
               count(*)::text as waiting
        from review_instances ri
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        join org_nodes n on n.tenant_id = ri.tenant_id and n.id = ri.current_node_id
        where ri.tenant_id = ${tenantId} and e.batch_id = ${batchId} and ri.state = 'blocked'
        group by ri.current_node_id, n.name, ri.current_role_ids, ri.blocked_reason
        order by n.name
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row) => ({
          nodeId: String(row.node_id),
          nodeName: String(row.node_name),
          roleIds: row.role_ids.map(String),
          // why these wait: a staffing gap and a conflict rule read differently
          reason: (row.reason ?? 'no-assignee') as
            'no-assignee' | 'no-independent-reviewer' | 'panel-seat-unfilled',
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
        // Only what has been handed in. A draft is the participant's own
        // desk: it has never been submitted, and a reviewer reading it would
        // be reading something nobody showed them. Voided claims left the
        // paper entirely.
        .where('e.status', 'not in', ['voided', 'draft'])
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
/**
 * The version filed just before the judged one, with the form it answered.
 *
 * Served with the review rather than fetched after it: the workbench opens
 * with the comparison on, and a comparison that arrives a request later
 * flashes into a page the reviewer is already reading. Its own form, not the
 * judged one's - the question may have changed between versions.
 */
export const revisionBefore = (tenantId: string, entryId: string, beforeRevisionNo: number) =>
  db.query((k) =>
    k
      .selectFrom('EntryRevision as er')
      .innerJoin('AssessmentItemRevision as ir', (join) =>
        join.onRef('ir.tenantId', '=', 'er.tenantId').onRef('ir.id', '=', 'er.itemRevisionId'),
      )
      .select(['er.id', 'er.revisionNo', 'er.payload', 'ir.formConfig'])
      .where('er.tenantId', '=', tenantId)
      .where('er.entryId', '=', entryId)
      .where('er.revisionNo', '<', beforeRevisionNo)
      .orderBy('er.revisionNo', 'desc')
      .limit(1)
      .executeTakeFirst(),
  )

export interface PreviousConclusionRow {
  roundNo: number
  kind: string
  reason: string | null
  comment: string | null
  actorName: string | null
  createdAt: number
}

/**
 * Earlier rounds, one row per ROUND, never per event.
 *
 * This used to be an event query with a whitelist of "conclusion kinds",
 * and a round that ended a way the list did not name - a policy re-route,
 * most recently - vanished from the workbench whole: the summary skipped to
 * the round before it and presented that one's reasons as "the previous
 * round". The round is the unit a reviewer reasons about, so the question
 * is asked of review_instances: every earlier round exists exactly once
 * here, and its concluding word is whatever its last event was - a kind
 * nobody taught the display yet still shows up as a round that ended.
 */
const roundSummaries = (tenantId: string, entryId: string, beforeRound: number) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance as ri')
        .leftJoinLateral(
          (eb) =>
            eb
              .selectFrom('ReviewEvent as re')
              .select(['re.kind', 're.reason', 're.comment', 're.actorId'])
              .whereRef('re.tenantId', '=', 'ri.tenantId')
              .whereRef('re.reviewInstanceId', '=', 'ri.id')
              .orderBy('re.createdAt', 'desc')
              .orderBy('re.id', 'desc')
              .limit(1)
              .as('last'),
          (join) => join.onTrue(),
        )
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'ri.tenantId').onRef('u.id', '=', 'last.actorId'),
        )
        .select([
          'ri.roundNo',
          'ri.outcome',
          'last.kind',
          'last.reason',
          'last.comment',
          'u.displayName as actorName',
        ])
        .select([
          sql<
            number | null
          >`(extract(epoch from coalesce(ri.completed_at, ri.created_at)) * 1000)::float8`.as(
            'endedMs',
          ),
        ])
        .where('ri.tenantId', '=', tenantId)
        .where('ri.entryId', '=', entryId)
        .where('ri.roundNo', '<', beforeRound)
        .orderBy('ri.roundNo', 'desc')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): PreviousConclusionRow => ({
          roundNo: row.roundNo,
          // the last event is the concluding word; a round somehow bare of
          // events still reports how it ended rather than vanishing
          kind: row.kind ?? row.outcome ?? 'completed',
          reason: row.reason ?? null,
          comment: row.comment ?? null,
          actorName: row.actorName,
          createdAt: msOf(row.endedMs),
        })),
      ),
    )

/** the round just before this one - exactly the one, whatever ended it */
export const previousConclusion = (tenantId: string, entryId: string, beforeRound: number) =>
  roundSummaries(tenantId, entryId, beforeRound).pipe(Effect.map((rows) => rows[0] ?? null))

/**
 * How every earlier round of this claim ended, newest first: one line per
 * round - a reviewer looking at a fifth submission wants to know whether
 * the same thing has been asked for three times, and a round must never be
 * missing from that count because of how it happened to end.
 */
export const earlierConclusions = (tenantId: string, entryId: string, beforeRound: number) =>
  roundSummaries(tenantId, entryId, beforeRound).pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        roundNo: row.roundNo,
        kind: row.kind,
        reason: row.reason,
        actorName: row.actorName,
        at: row.createdAt,
      })),
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
          and re.kind in ('approved', 'rejected', 'escalated', 'opinion-rejected', 'comment',
                          'recommend-approve', 'recommend-reject')
          and re.created_at >=
            date_trunc('day', now() at time zone ${input.timezone}) at time zone ${input.timezone}
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.count)))

/**
 * Panel votes this person cast on this batch today - counted beside the
 * event-shaped decisions, because a vote deliberately writes no event of
 * its own until its sitting concludes, and thirty filings judged in a
 * morning must not greet their judge as zero.
 */
export const votesToday = (input: {
  tenantId: string
  batchId: string
  userId: string
  timezone: string
}) =>
  db
    .query((k) =>
      sql<{ count: string }>`
        select count(*) as count
        from review_votes v
        join review_panels p on p.tenant_id = v.tenant_id and p.id = v.panel_id
        join review_instances ri on ri.tenant_id = p.tenant_id and ri.id = p.review_instance_id
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        where v.tenant_id = ${input.tenantId}
          and e.batch_id = ${input.batchId}
          and v.voter_user_id = ${input.userId}
          and v.created_at >=
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
/** one asked-for piece of a supplement: text or file, nothing else */
export interface SupplementRequirement {
  key: string
  label: string
  kind: 'text' | 'file'
  required: boolean
}

/** the requirements list off the jsonb, defensively */
export const requirementsOf = (value: unknown): readonly SupplementRequirement[] =>
  Array.isArray(value)
    ? value.flatMap((one): SupplementRequirement[] => {
        const record = (one ?? {}) as Record<string, unknown>
        const kind = record['kind']
        if (
          typeof record['key'] !== 'string' ||
          typeof record['label'] !== 'string' ||
          (kind !== 'text' && kind !== 'file')
        ) {
          return []
        }
        return [
          {
            key: record['key'],
            label: record['label'],
            kind,
            required: record['required'] === true,
          },
        ]
      })
    : []

export interface SupplementRow {
  id: string
  requestNo: number
  status: 'open' | 'answered' | 'cancelled'
  instructions: string
  requirements: readonly SupplementRequirement[]
  requestedBy: string
  requestedByName: string | null
  requestedAt: number
  answeredAt: number | null
  cancelledAt: number | null
  response: {
    payload: unknown
    attachments: readonly { attachmentId: string; position: number }[]
    respondedAt: number
  } | null
}

/**
 * Every ask these rounds made, oldest first within each, with its answer.
 *
 * Batched over rounds because the claim's whole story asks for all of them
 * at once: a round at a time would put a query per round behind one screen.
 */
export const supplementsOfInstances = (tenantId: string, instanceIds: readonly string[]) =>
  Effect.gen(function* () {
    const byInstance = new Map<string, SupplementRow[]>()
    if (instanceIds.length === 0) return byInstance as ReadonlyMap<string, readonly SupplementRow[]>
    const requests = yield* db.query((k) =>
      k
        .selectFrom('ReviewSupplementRequest as sr')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'sr.tenantId').onRef('u.id', '=', 'sr.requestedBy'),
        )
        .leftJoin('ReviewSupplementResponse as re', (join) =>
          join.onRef('re.tenantId', '=', 'sr.tenantId').onRef('re.requestId', '=', 'sr.id'),
        )
        .select([
          'sr.id',
          'sr.reviewInstanceId',
          'sr.requestNo',
          'sr.status',
          'sr.instructions',
          'sr.requirements',
          'sr.requestedBy',
          'u.displayName as requestedByName',
          're.id as responseId',
          're.payload as responsePayload',
        ])
        .select([
          epoch('sr.created_at').as('requestedMs'),
          epoch('sr.answered_at').as('answeredMs'),
          epoch('sr.cancelled_at').as('cancelledMs'),
          epoch('re.created_at').as('respondedMs'),
        ])
        .where('sr.tenantId', '=', tenantId)
        .where('sr.reviewInstanceId', 'in', [...instanceIds])
        .orderBy('sr.requestNo')
        .execute(),
    )
    const responseIds = requests.flatMap((row) => (row.responseId === null ? [] : [row.responseId]))
    const cited =
      responseIds.length === 0
        ? []
        : yield* db.query((k) =>
            k
              .selectFrom('ReviewSupplementAttachment')
              .select(['responseId', 'attachmentId', 'position'])
              .where('tenantId', '=', tenantId)
              .where('responseId', 'in', responseIds)
              .orderBy('position')
              .execute(),
          )
    for (const row of requests) {
      const bucket = byInstance.get(row.reviewInstanceId) ?? []
      bucket.push({
        id: row.id,
        requestNo: row.requestNo,
        status: row.status as SupplementRow['status'],
        instructions: row.instructions,
        requirements: requirementsOf(row.requirements),
        requestedBy: row.requestedBy,
        requestedByName: row.requestedByName,
        requestedAt: msOf(row.requestedMs),
        answeredAt: row.answeredMs == null ? null : msOf(row.answeredMs),
        cancelledAt: row.cancelledMs == null ? null : msOf(row.cancelledMs),
        response:
          row.responseId === null
            ? null
            : {
                payload: row.responsePayload,
                attachments: cited
                  .filter((one) => one.responseId === row.responseId)
                  .map((one) => ({ attachmentId: one.attachmentId, position: one.position })),
                respondedAt: msOf(row.respondedMs),
              },
      })
      byInstance.set(row.reviewInstanceId, bucket)
    }
    return byInstance as ReadonlyMap<string, readonly SupplementRow[]>
  })

/** the same for one round, which is what the workbench reads */
export const supplementsOf = (tenantId: string, instanceId: string) =>
  supplementsOfInstances(tenantId, [instanceId]).pipe(
    Effect.map((byInstance) => byInstance.get(instanceId) ?? []),
  )

/** one request with the round it belongs to, for the answer and cancel doors */
export interface SupplementRequestRow {
  id: string
  reviewInstanceId: string
  requestNo: number
  status: 'open' | 'answered' | 'cancelled'
  instructions: string
  requirements: readonly SupplementRequirement[]
  requestedBy: string
}

export const supplementRequestOf = (tenantId: string, requestId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementRequest')
        .select([
          'id',
          'reviewInstanceId',
          'requestNo',
          'status',
          'instructions',
          'requirements',
          'requestedBy',
        ])
        .where('tenantId', '=', tenantId)
        .where('id', '=', requestId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: row.id,
              reviewInstanceId: row.reviewInstanceId,
              requestNo: row.requestNo,
              status: row.status as SupplementRequestRow['status'],
              instructions: row.instructions,
              requirements: requirementsOf(row.requirements),
              requestedBy: row.requestedBy,
            } satisfies SupplementRequestRow),
      ),
    )

/** who is holding the open ask on this round, if anybody is */
export const openAskRequesterOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementRequest')
        .select('requestedBy')
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .where('status', '=', 'open')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.requestedBy ?? null))

export const nextSupplementNo = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      sql<{ next: string }>`
        select coalesce(max(request_no), 0) + 1 as next from review_supplement_requests
        where tenant_id = ${tenantId} and review_instance_id = ${instanceId}
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.next)))

export const insertSupplementRequest = (input: {
  tenantId: string
  reviewInstanceId: string
  requestNo: number
  requestedBy: string
  instructions: string
  requirements: readonly SupplementRequirement[]
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into review_supplement_requests
          (tenant_id, review_instance_id, request_no, requested_by, instructions, requirements)
        values (${input.tenantId}, ${input.reviewInstanceId}, ${input.requestNo},
                ${input.requestedBy}, ${input.instructions},
                ${sql.val(JSON.stringify(input.requirements))}::jsonb)
        returning id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => String(rows[0]!.id)))

/**
 * The round pausing itself to ask, or picking work back up. Conditional on
 * the state it is leaving, so two reviewers pressing at once cannot both
 * succeed - the loser is told the round has moved.
 */
export const setInstanceSupplementState = (input: {
  tenantId: string
  instanceId: string
  from: 'active' | 'awaiting_supplement'
  to: 'active' | 'awaiting_supplement'
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

/** closes the ask, exactly once; the loser of a race writes nothing */
export const closeSupplementRequest = (input: {
  tenantId: string
  requestId: string
  outcome: 'answered' | 'cancelled'
  cancelledBy?: string
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewSupplementRequest')
        .set(
          input.outcome === 'answered'
            ? { status: 'answered', answeredAt: sql`now()` }
            : {
                status: 'cancelled',
                cancelledAt: sql`now()`,
                cancelledBy: input.cancelledBy ?? null,
              },
        )
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.requestId)
        .where('status', '=', 'open')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const insertSupplementResponse = (input: {
  tenantId: string
  requestId: string
  payload: unknown
  respondedBy: string
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into review_supplement_responses (tenant_id, request_id, payload, responded_by)
        values (${input.tenantId}, ${input.requestId},
                ${sql.val(JSON.stringify(input.payload))}::jsonb, ${input.respondedBy})
        returning id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => String(rows[0]!.id)))

export const insertSupplementAttachments = (input: {
  tenantId: string
  responseId: string
  attachmentIds: readonly string[]
}) =>
  input.attachmentIds.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .insertInto('ReviewSupplementAttachment')
          .values(
            input.attachmentIds.map(
              (attachmentId, position) =>
                ({
                  tenantId: input.tenantId,
                  responseId: input.responseId,
                  attachmentId,
                  position,
                }) as never,
            ),
          )
          .execute(),
      )

/** one outstanding ask, as the reviewer's own list of them reads it */
export interface AwaitingRow {
  requestId: string
  instanceId: string
  entryId: string
  requestNo: number
  /** open: still with the participant. answered: back here, not yet judged. */
  status: 'open' | 'answered'
  participantName: string
  businessNo: string | null
  itemTitle: string
  /** the labels of what was asked for, for the one line that says it */
  asks: readonly string[]
  requestedAt: number
  requestedAtIso: string
  answeredAt: number | null
}

/**
 * What this reviewer's step is waiting on somebody else for (§32.65 ⑤).
 *
 * Two kinds of row, and they are the same fact at two moments: an ask still
 * with the person who filed, and one they have answered - which puts the
 * round back in the ordinary queue, where it would otherwise arrive looking
 * like any other and give no sign that it is the answer to a question this
 * step asked.
 *
 * Standing is the same `mayReview` the queue asks, not "requests I made":
 * a step is held by whoever holds the role there, so a colleague's ask is
 * this reviewer's business too.
 */
/**
 * The two numbers the overview's reviewer branch states (§32.73): how many
 * claims stand in this reviewer's queue now, and how many of their own
 * asks have come back answered on rounds they may still act on.
 */
export const reviewerDeskCountsOf = (input: {
  tenantId: string
  batchId: string
  userId: string
}) =>
  db
    .query((k) =>
      sql<{ pending: number; answered: number }>`
        select
          (select count(*)::int
           from review_instances ri
           join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
           join batch_participants bp
             on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
           join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
           where ri.tenant_id = ${input.tenantId}
             and e.batch_id = ${input.batchId}
             and ri.state = 'active'
             and ${mayActOn({
               tenantId: sql`${input.tenantId}`,
               batchId: sql.ref('e.batch_id'),
               nodeId: sql.ref('ri.current_node_id'),
               roleIds: sql.ref('ri.current_role_ids'),
               userId: sql`${input.userId}`,
               subjectUserId: sql.ref('bp.user_id'),
               actorId: sql.ref('er.actor_id'),
               instanceId: sql.ref('ri.id'),
               route: sql.ref('ri.current_route'),
             })}
          ) as pending,
          (select count(*)::int
           from review_supplement_requests sr
           join review_instances ri
             on ri.tenant_id = sr.tenant_id and ri.id = sr.review_instance_id
           join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
           join batch_participants bp
             on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
           join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
           where sr.tenant_id = ${input.tenantId}
             and e.batch_id = ${input.batchId}
             and sr.requested_by = ${input.userId}
             and sr.status = 'answered'
             and ri.state in ('active', 'blocked')
             and ${mayActOn({
               tenantId: sql`${input.tenantId}`,
               batchId: sql.ref('e.batch_id'),
               nodeId: sql.ref('ri.current_node_id'),
               roleIds: sql.ref('ri.current_role_ids'),
               userId: sql`${input.userId}`,
               subjectUserId: sql.ref('bp.user_id'),
               actorId: sql.ref('er.actor_id'),
               instanceId: sql.ref('ri.id'),
               route: sql.ref('ri.current_route'),
             })}
          ) as answered
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) => ({
        pendingCount: rows[0]?.pending ?? 0,
        answeredAskCount: rows[0]?.answered ?? 0,
      })),
    )

export const awaitingPage = (input: {
  tenantId: string
  batchId: string
  userId: string
  after?: readonly [string, string] | undefined
  limit: number
}) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('ReviewSupplementRequest as sr')
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'sr.tenantId').onRef('ri.id', '=', 'sr.reviewInstanceId'),
        )
        .innerJoin('Entry as e', (join) =>
          join.onRef('e.tenantId', '=', 'ri.tenantId').onRef('e.id', '=', 'ri.entryId'),
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
        .select([
          'sr.id as requestId',
          'sr.reviewInstanceId as instanceId',
          'ri.entryId',
          'sr.requestNo',
          'sr.status',
          'sr.requirements',
          'su.displayName as participantName',
          'su.businessNo',
          'i.title as itemTitle',
        ])
        .select([
          epoch('sr.created_at').as('requestedMs'),
          sql<string>`sr.created_at::text`.as('requestedIso'),
          epoch('sr.answered_at').as('answeredMs'),
        ])
        .where('sr.tenantId', '=', input.tenantId)
        .where('e.batchId', '=', input.batchId)
        .where((eb) =>
          eb.or([
            // an open ask is one reviewer's unfinished business, not the
            // stage's: only its sender is waiting on it (§32.70)
            eb.and([
              eb('sr.status', '=', 'open'),
              eb('ri.state', '=', 'awaiting_supplement'),
              eb('sr.requestedBy', '=', input.userId),
            ]),
            // answered, and the round it belongs to is back open here -
            // back in the shared pool, so every eligible reviewer sees it
            eb.and([eb('sr.status', '=', 'answered'), eb('ri.state', 'in', ['active', 'blocked'])]),
          ]),
        )
        .where(
          mayActOn({
            tenantId: sql`${input.tenantId}`,
            batchId: sql.ref('e.batch_id'),
            nodeId: sql.ref('ri.current_node_id'),
            roleIds: sql.ref('ri.current_role_ids'),
            userId: sql`${input.userId}`,
            subjectUserId: sql.ref('bp.user_id'),
            actorId: sql.ref('er.actor_id'),
            instanceId: sql.ref('ri.id'),
            route: sql.ref('ri.current_route'),
          }),
        )
        // newest ask first: the list is read as "what did I send out lately"
        .orderBy('sr.createdAt', 'desc')
        .orderBy('sr.id', 'desc')
        .limit(input.limit)
      if (input.after !== undefined) {
        query = query.where(
          sql<boolean>`(sr.created_at, sr.id) < (${input.after[0]}::timestamptz, ${input.after[1]}::uuid)`,
        )
      }
      return query.execute()
    })
    .pipe(
      Effect.map((rows) =>
        rows.map((row): AwaitingRow => ({
          requestId: row.requestId,
          instanceId: row.instanceId,
          entryId: row.entryId,
          requestNo: row.requestNo,
          status: row.status as AwaitingRow['status'],
          participantName: row.participantName,
          businessNo: row.businessNo,
          itemTitle: row.itemTitle,
          asks: requirementsOf(row.requirements).map((asked) => asked.label),
          requestedAt: msOf(row.requestedMs),
          requestedAtIso: row.requestedIso,
          answeredAt: row.answeredMs == null ? null : msOf(row.answeredMs),
        })),
      ),
    )

/**
 * Every attachment a supplement answer of this entry's rounds ever cited.
 * The reuse set beside entry_revision_attachments: a file already part of
 * this claim's story may be cited again by a later answer, and only those.
 */
export const supplementAttachmentHistory = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewSupplementAttachment as rsa')
        .innerJoin('ReviewSupplementResponse as re', (join) =>
          join.onRef('re.tenantId', '=', 'rsa.tenantId').onRef('re.id', '=', 'rsa.responseId'),
        )
        .innerJoin('ReviewSupplementRequest as sr', (join) =>
          join.onRef('sr.tenantId', '=', 're.tenantId').onRef('sr.id', '=', 're.requestId'),
        )
        .innerJoin('ReviewInstance as ri', (join) =>
          join.onRef('ri.tenantId', '=', 'sr.tenantId').onRef('ri.id', '=', 'sr.reviewInstanceId'),
        )
        .select(['rsa.attachmentId'])
        .where('rsa.tenantId', '=', tenantId)
        .where('ri.entryId', '=', entryId)
        .execute(),
    )
    .pipe(Effect.map((rows) => new Set(rows.map((row) => String(row.attachmentId)))))

/**
 * The one open ask on the round an entry is currently in, for the entry
 * screens: this is how the person who filed learns they are being asked.
 * Answerability is exactly this join - request open AND round still waiting -
 * so a round that was cancelled or re-routed under an open ask stops
 * offering it without anybody sweeping.
 */
export interface OpenSupplementRow {
  entryId: string
  requestId: string
  instanceId: string
  requestNo: number
  instructions: string
  requirements: readonly SupplementRequirement[]
  /** who asked, by name: the card says whose request this is */
  requestedByName: string | null
  requestedAt: number
}

export const openSupplementsOfEntries = (tenantId: string, entryIds: readonly string[]) =>
  entryIds.length === 0
    ? Effect.succeed([] as readonly OpenSupplementRow[])
    : db
        .query((k) =>
          k
            .selectFrom('ReviewSupplementRequest as sr')
            .innerJoin('ReviewInstance as ri', (join) =>
              join
                .onRef('ri.tenantId', '=', 'sr.tenantId')
                .onRef('ri.id', '=', 'sr.reviewInstanceId'),
            )
            .leftJoin('User as u', (join) =>
              join.onRef('u.tenantId', '=', 'sr.tenantId').onRef('u.id', '=', 'sr.requestedBy'),
            )
            .select([
              'ri.entryId',
              'sr.id as requestId',
              'sr.reviewInstanceId as instanceId',
              'sr.requestNo',
              'sr.instructions',
              'sr.requirements',
              'u.displayName as requestedByName',
            ])
            .select([epoch('sr.created_at').as('requestedMs')])
            .where('sr.tenantId', '=', tenantId)
            .where('sr.status', '=', 'open')
            .where('ri.state', '=', 'awaiting_supplement')
            .where('ri.entryId', 'in', [...entryIds])
            .execute(),
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row): OpenSupplementRow => ({
              entryId: row.entryId,
              requestId: row.requestId,
              instanceId: row.instanceId,
              requestNo: row.requestNo,
              instructions: row.instructions,
              requirements: requirementsOf(row.requirements),
              requestedByName: row.requestedByName,
              requestedAt: msOf(row.requestedMs),
            })),
          ),
        )

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
            and ri.state in (${sql.join(OPEN_REVIEW_STATES.map((state) => sql`${state}`))})
            and ${mayActOn({
              tenantId: sql`${input.tenantId}`,
              batchId: sql.ref('e.batch_id'),
              nodeId: sql.ref('ri.current_node_id'),
              roleIds: sql.ref('ri.current_role_ids'),
              userId: sql`${input.userId}`,
              subjectUserId: sql.ref('bp.user_id'),
              actorId: sql.ref('er.actor_id'),
              instanceId: sql.ref('ri.id'),
              route: sql.ref('ri.current_route'),
            })}
        ) as ok
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Boolean(rows[0]!.ok)))

// --- panels -----------------------------------------------------------------
//
// The sitting's rows and nothing else: who constitutes it, who took over a
// seat, who said what. The service owns the arithmetic (when it resolves,
// what a resolution means); these helpers own the races - every claim and
// every conclusion is conditional, and the partial unique indexes are the
// referee of last resort.

/** the round row itself, taken for update: panel votes serialize on it */
export const lockReviewInstance = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        select id from review_instances
        where tenant_id = ${tenantId} and id = ${instanceId}
        for update
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => rows.length > 0))

export interface PanelRow {
  id: string
  reviewInstanceId: string
  route: 'normal' | 'escalation'
  stageId: string
  seatCount: number
  state: 'open' | 'resolved' | 'superseded'
  resolution: string | null
}

export const openPanelOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewPanel')
        .select(['id', 'reviewInstanceId', 'route', 'stageId', 'seatCount', 'state', 'resolution'])
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .where('state', '=', 'open')
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row === undefined
          ? null
          : ({
              id: row.id,
              reviewInstanceId: row.reviewInstanceId,
              route: row.route as PanelRow['route'],
              stageId: row.stageId,
              seatCount: row.seatCount,
              state: row.state as PanelRow['state'],
              resolution: row.resolution,
            } satisfies PanelRow),
      ),
    )

/**
 * Constitutes the sitting: one panel, one seat per member found eligible at
 * this moment. The seat count is frozen here and never changes; membership
 * afterwards is replacement, not growth (§32.66).
 */
export const createPanel = (input: {
  tenantId: string
  reviewInstanceId: string
  route: 'normal' | 'escalation'
  stageId: string
  members: readonly string[]
}) =>
  Effect.gen(function* () {
    const panel = yield* db.query((k) =>
      sql<{ id: string }>`
        insert into review_panels (tenant_id, review_instance_id, route, stage_id, seat_count)
        values (${input.tenantId}, ${input.reviewInstanceId}, ${input.route}, ${input.stageId},
                ${input.members.length})
        returning id
      `.execute(k),
    )
    const panelId = String(panel.rows[0]!.id)
    for (const [index, userId] of input.members.entries()) {
      yield* db.query((k) =>
        sql`
          insert into review_panel_assignments (tenant_id, panel_id, seat_no, user_id)
          values (${input.tenantId}, ${panelId}, ${index + 1}, ${userId})
        `.execute(k),
      )
    }
    return panelId
  })

export interface PanelSeatRow {
  assignmentId: string
  seatNo: number
  userId: string
  /** the vote this occupancy cast, if it has */
  voted: 'approve' | 'reject' | null
}

/** the live seats of one panel, with whether each has spoken */
export const livePanelSeats = (tenantId: string, panelId: string) =>
  db
    .query((k) =>
      sql<{ id: string; seat_no: number; user_id: string; decision: string | null }>`
        select pa.id, pa.seat_no, pa.user_id, v.decision
        from review_panel_assignments pa
        left join review_votes v on v.tenant_id = pa.tenant_id and v.assignment_id = pa.id
        where pa.tenant_id = ${tenantId} and pa.panel_id = ${panelId} and pa.ended_at is null
        order by pa.seat_no
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): PanelSeatRow => ({
          assignmentId: String(row.id),
          seatNo: Number(row.seat_no),
          userId: String(row.user_id),
          voted: row.decision === null ? null : (String(row.decision) as 'approve' | 'reject'),
        })),
      ),
    )

/** ends an unvoted occupancy; a seat that has spoken is history and never ends */
export const endPanelAssignment = (input: {
  tenantId: string
  assignmentId: string
  reason: string
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        update review_panel_assignments pa
        set ended_at = now(), ended_reason = ${input.reason}
        where pa.tenant_id = ${input.tenantId} and pa.id = ${input.assignmentId}
          and pa.ended_at is null
          and not exists (select 1 from review_votes v where v.assignment_id = pa.id)
        returning pa.id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => rows.length > 0))

/**
 * Takes an empty seat, atomically: the seat number is whichever of 1..count
 * has no live occupant, and the partial unique index turns the second of
 * two simultaneous claims away.
 */
export const claimPanelSeat = (input: { tenantId: string; panelId: string; userId: string }) =>
  db
    .query((k) =>
      sql<{ id: string; seat_no: number }>`
        insert into review_panel_assignments (tenant_id, panel_id, seat_no, user_id)
        select ${input.tenantId}, ${input.panelId}, free.seat_no, ${input.userId}
        from (
          select gs.seat_no
          from review_panels p
          cross join lateral generate_series(1, p.seat_count) as gs(seat_no)
          where p.tenant_id = ${input.tenantId} and p.id = ${input.panelId}
            and not exists (
              select 1 from review_panel_assignments pa
              where pa.panel_id = p.id and pa.seat_no = gs.seat_no and pa.ended_at is null
            )
          order by gs.seat_no
          limit 1
        ) as free
        returning id, seat_no
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.length === 0 ? null : { assignmentId: String(rows[0]!.id), seatNo: rows[0]!.seat_no },
      ),
    )

export const insertVote = (input: {
  tenantId: string
  panelId: string
  assignmentId: string
  voterUserId: string
  decision: 'approve' | 'reject'
  reason: string | null
  comment: string | null
}) =>
  db.query((k) =>
    sql`
      insert into review_votes
        (tenant_id, panel_id, assignment_id, voter_user_id, decision, reason, comment)
      values (${input.tenantId}, ${input.panelId}, ${input.assignmentId}, ${input.voterUserId},
              ${input.decision}, ${input.reason}, ${input.comment})
    `.execute(k),
  )

export interface PanelVoteRow {
  voterUserId: string
  voterName: string | null
  decision: 'approve' | 'reject'
  reason: string | null
  comment: string | null
  createdAt: number
}

export const votesOfPanel = (tenantId: string, panelId: string) =>
  db
    .query((k) =>
      sql<{
        voter_user_id: string
        voter_name: string | null
        decision: string
        reason: string | null
        comment: string | null
        created_ms: number
      }>`
        select v.voter_user_id, u.display_name as voter_name, v.decision, v.reason, v.comment,
               (extract(epoch from v.created_at) * 1000)::float8 as created_ms
        from review_votes v
        left join users u on u.tenant_id = v.tenant_id and u.id = v.voter_user_id
        where v.tenant_id = ${tenantId} and v.panel_id = ${panelId}
        order by v.created_at, v.id
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): PanelVoteRow => ({
          voterUserId: String(row.voter_user_id),
          voterName: row.voter_name,
          decision: String(row.decision) as PanelVoteRow['decision'],
          reason: row.reason,
          comment: row.comment,
          createdAt: Number(row.created_ms),
        })),
      ),
    )

/** the sitting concludes, exactly once; the loser of a race writes nothing */
export const resolvePanel = (input: {
  tenantId: string
  panelId: string
  resolution: 'approved' | 'escalated'
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewPanel')
        .set({ state: 'resolved', resolution: input.resolution, closedAt: sql`now()` })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.panelId)
        .where('state', '=', 'open')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * Dissolves whatever sitting the round still holds, without a resolution:
 * the round left (withdrawn, rerouted, returned) or its evidence changed
 * under the sitting (a supplement was answered). Votes stay readable; they
 * count for nothing.
 */
export const supersedeOpenPanels = (tenantId: string, instanceId: string) =>
  db.query((k) =>
    k
      .updateTable('ReviewPanel')
      .set({ state: 'superseded', closedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('reviewInstanceId', '=', instanceId)
      .where('state', '=', 'open')
      .execute(),
  )

export interface StageOpinionRow {
  stageId: string
  votes: readonly PanelVoteRow[]
}

/**
 * What the concluded sittings of this round said, per stage, for the next
 * judge: a split panel's whole value is that the辅导员 reads both sides.
 * Resolved panels only - an open sitting's votes are sealed from everybody,
 * its own members first (§32.66), and a superseded sitting judged evidence
 * that has since changed.
 */
export const resolvedPanelOpinions = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      sql<{
        stage_id: string
        voter_user_id: string
        voter_name: string | null
        decision: string
        reason: string | null
        comment: string | null
        created_ms: number
      }>`
        select p.stage_id, v.voter_user_id, u.display_name as voter_name, v.decision,
               v.reason, v.comment,
               (extract(epoch from v.created_at) * 1000)::float8 as created_ms
        from review_panels p
        join review_votes v on v.tenant_id = p.tenant_id and v.panel_id = p.id
        left join users u on u.tenant_id = v.tenant_id and u.id = v.voter_user_id
        where p.tenant_id = ${tenantId} and p.review_instance_id = ${instanceId}
          and p.state = 'resolved'
        order by p.created_at, v.created_at, v.id
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) => {
        const byStage = new Map<string, PanelVoteRow[]>()
        for (const row of rows) {
          const bucket = byStage.get(String(row.stage_id)) ?? []
          bucket.push({
            voterUserId: String(row.voter_user_id),
            voterName: row.voter_name,
            decision: String(row.decision) as PanelVoteRow['decision'],
            reason: row.reason,
            comment: row.comment,
            createdAt: Number(row.created_ms),
          })
          byStage.set(String(row.stage_id), bucket)
        }
        return byStage as ReadonlyMap<string, readonly PanelVoteRow[]>
      }),
    )
