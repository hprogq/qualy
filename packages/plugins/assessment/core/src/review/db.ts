import { Effect } from 'effect'
import { sql, type RawBuilder } from 'kysely'
import { db } from '../server/db.ts'

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
 * roles granted at exactly the stage's node with coverage `self` - exact on
 * purpose (§32.23), a subtree grant participates in jurisdiction, never in
 * stage membership, even when it is anchored on the stage node itself -
 * live, role active, holder enabled, resource general or this batch. And
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
      and rg.coverage = 'self'
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
  actorId: string
  itemRevisionId: string
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
        .select([
          'ri.id',
          'ri.state',
          'ri.outcome',
          'ri.roundNo',
          'ri.entryId',
          'ri.revisionId',
          'ri.currentNodeId',
          'ri.currentRoleIds',
          'e.batchId',
          'b.status as batchStatus',
          'e.itemId',
          'i.title as itemTitle',
          'i.itemType',
          'e.participantId',
          'bp.userId as subjectUserId',
          'su.displayName as subjectName',
          'er.actorId',
          'er.itemRevisionId',
        ])
        .select([
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
              actorId: row.actorId,
              itemRevisionId: row.itemRevisionId,
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
  roundNo: number
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
            .select([
              'ri.id as instanceId',
              'ri.entryId',
              'ri.roundNo',
              'e.batchId',
              'b.name as batchName',
              'e.itemId',
              'i.title as itemTitle',
              'su.displayName as participantName',
            ])
            .select([
              epoch('ri.created_at').as('submittedMs'),
              sql<string>`ri.created_at::text`.as('submittedIso'),
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
              roundNo: row.roundNo,
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
  comment: string | null
  suggestedPayload: unknown
  createdAt: number
}

export const reviewEventsOf = (tenantId: string, instanceId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewEvent')
        .select(['id', 'kind', 'actorId', 'comment', 'suggestedPayload'])
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('reviewInstanceId', '=', instanceId)
        .orderBy('createdAt')
        .orderBy('id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): ReviewEventRow => ({
          id: row.id,
          kind: row.kind,
          actorId: row.actorId,
          comment: row.comment,
          suggestedPayload: row.suggestedPayload ?? null,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )
