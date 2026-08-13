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
 * Three conjuncts. Standing: one of the stage's roles granted at exactly
 * the stage's node - exact on purpose (§32.23), a subtree grant participates
 * in jurisdiction, never in stage membership - live, role active, holder
 * enabled, and the grant's resource, if it names one, is this batch.
 * Authority: the batch accepted assessment.review.process from a live
 * assignment of theirs and has not taken it back. Distance: they are neither
 * the subject nor whoever authored the revision under judgment.
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
        rg.resource_namespace is null
        or (
          rg.resource_namespace = 'assessment'
          and rg.resource_type = 'batch'
          and rg.resource_id = ${r.batchId}
        )
      )
  )
  and exists (
    select 1
    from batch_access_sources bas
    join role_grants rg2
      on rg2.tenant_id = bas.tenant_id and rg2.id = bas.role_assignment_id
    join roles ro2 on ro2.tenant_id = rg2.tenant_id and ro2.id = rg2.role_id
    join batch_access_source_permissions sp
      on sp.tenant_id = bas.tenant_id and sp.source_id = bas.id
    where bas.tenant_id = ${r.tenantId}
      and bas.batch_id = ${r.batchId}
      and bas.subject_id = ${r.userId}
      and rg2.user_id = ${r.userId}
      and rg2.revoked_at is null
      and (rg2.valid_from is null or rg2.valid_from <= now())
      and (rg2.valid_until is null or rg2.valid_until > now())
      and ro2.status = 'active'
      and sp.permission_code = 'assessment.review.process'
      and (
        ro2.permission_mode = 'all-active'
        or exists (
          select 1 from role_permissions rp
          join permissions pe on pe.id = rp.permission_id
          where rp.tenant_id = ro2.tenant_id and rp.role_id = ro2.id
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
        rg2.resource_namespace is null
        or (
          rg2.resource_namespace = 'assessment'
          and rg2.resource_type = 'batch'
          and rg2.resource_id = ${r.batchId}
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
      sql`
        select ri.id, ri.state, ri.outcome, ri.round_no, ri.entry_id, ri.revision_id,
               ri.current_node_id, ri.current_role_ids,
               ${epoch('ri.created_at')} as created_ms,
               ${epoch('ri.completed_at')} as completed_ms,
               e.batch_id, b.status as batch_status, e.item_id, i.title as item_title,
               i.item_type, e.participant_id, bp.user_id as subject_user_id,
               su.display_name as subject_name, er.actor_id, er.item_revision_id
        from review_instances ri
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        join assessment_batches b on b.tenant_id = e.tenant_id and b.id = e.batch_id
        join assessment_items i on i.tenant_id = e.tenant_id and i.id = e.item_id
        join batch_participants bp on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
        join users su on su.tenant_id = bp.tenant_id and su.id = bp.user_id
        join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
        where ri.tenant_id = ${tenantId} and ri.id = ${instanceId}
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) => {
        const row = rows[0] as Record<string, unknown> | undefined
        if (row === undefined) return null
        return {
          id: String(row['id']),
          state: String(row['state']),
          outcome: row['outcome'] == null ? null : String(row['outcome']),
          roundNo: Number(row['round_no']),
          entryId: String(row['entry_id']),
          revisionId: String(row['revision_id']),
          currentNodeId: String(row['current_node_id']),
          currentRoleIds: (row['current_role_ids'] as readonly string[]).map(String),
          createdAt: msOf(row['created_ms']),
          completedAt: row['completed_ms'] == null ? null : msOf(row['completed_ms']),
          batchId: String(row['batch_id']),
          batchStatus: String(row['batch_status']),
          itemId: String(row['item_id']),
          itemTitle: String(row['item_title']),
          itemType: String(row['item_type']),
          participantId: String(row['participant_id']),
          subjectUserId: String(row['subject_user_id']),
          subjectName: String(row['subject_name']),
          actorId: String(row['actor_id']),
          itemRevisionId: String(row['item_revision_id']),
        } as ReviewInstanceDetailRow
      }),
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
      sql<{ batch_id: string }>`
        select distinct e.batch_id
        from review_instances ri
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        where ri.tenant_id = ${tenantId} and ri.state = 'active'
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => rows.map((row) => String(row.batch_id))))

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
        .query((k) =>
          sql`
            select ri.id, ri.entry_id, ri.round_no,
                   ${epoch('ri.created_at')} as submitted_ms,
                   ri.created_at::text as submitted_iso,
                   e.batch_id, b.name as batch_name, e.item_id, i.title as item_title,
                   su.display_name as participant_name
            from review_instances ri
            join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
            join assessment_batches b on b.tenant_id = e.tenant_id and b.id = e.batch_id
            join assessment_items i on i.tenant_id = e.tenant_id and i.id = e.item_id
            join batch_participants bp on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
            join users su on su.tenant_id = bp.tenant_id and su.id = bp.user_id
            join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
            where ri.tenant_id = ${input.tenantId}
              and ri.state = 'active'
              and e.batch_id = any(${uuidArray(input.batchIds)})
              and ${mayReview({
                tenantId: sql`${input.tenantId}`,
                batchId: sql.ref('e.batch_id'),
                nodeId: sql.ref('ri.current_node_id'),
                roleIds: sql.ref('ri.current_role_ids'),
                userId: sql`${input.userId}`,
                subjectUserId: sql.ref('bp.user_id'),
                actorId: sql.ref('er.actor_id'),
              })}
              ${
                input.after !== undefined
                  ? sql`and (ri.created_at, ri.id) > (${input.after[0]}::timestamptz, ${input.after[1]}::uuid)`
                  : sql``
              }
            order by ri.created_at, ri.id
            limit ${sql.raw(String(input.limit))}
          `.execute(k),
        )
        .pipe(
          Effect.map(({ rows }) =>
            (rows as Record<string, unknown>[]).map((row): InboxRow => ({
              instanceId: String(row['id']),
              entryId: String(row['entry_id']),
              batchId: String(row['batch_id']),
              batchName: String(row['batch_name']),
              itemId: String(row['item_id']),
              itemTitle: String(row['item_title']),
              participantName: String(row['participant_name']),
              roundNo: Number(row['round_no']),
              submittedAt: msOf(row['submitted_ms']),
              submittedAtIso: String(row['submitted_iso']),
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
      sql`
        select id, kind, actor_id, comment, suggested_payload,
               ${epoch('created_at')} as created_ms
        from review_events
        where tenant_id = ${tenantId} and review_instance_id = ${instanceId}
        order by created_at, id
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        (rows as Record<string, unknown>[]).map((row): ReviewEventRow => ({
          id: String(row['id']),
          kind: String(row['kind']),
          actorId: row['actor_id'] == null ? null : String(row['actor_id']),
          comment: row['comment'] == null ? null : String(row['comment']),
          suggestedPayload: row['suggested_payload'] ?? null,
          createdAt: msOf(row['created_ms']),
        })),
      ),
    )
