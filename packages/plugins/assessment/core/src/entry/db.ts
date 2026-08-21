import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'

// The entry rows and everything the resource policy needs to know about the
// people around them. Same conventions as the neighbouring modules: epoch
// milliseconds out, jsonb parsed, no floats.

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

export type EntryStatus =
  | 'draft'
  | 'in_review'
  /** sent back because the question changed under it, or by an intervention */
  | 'needs_revision'
  | 'approved'
  | 'rejected'
  | 'voided'
export type EntrySource = 'self' | 'proxy' | 'record' | 'import' | 'system'

export interface EntryRow {
  id: string
  batchId: string
  itemId: string
  participantId: string
  currentRevisionId: string | null
  currentReviewInstanceId: string | null
  status: EntryStatus
  source: EntrySource
  createdAt: number
}

const entryColumns = [
  'id',
  'batchId',
  'itemId',
  'participantId',
  'currentRevisionId',
  'currentReviewInstanceId',
  'status',
  'source',
] as const

const toEntry = (row: Record<string, unknown>): EntryRow => ({
  id: String(row['id']),
  batchId: String(row['batchId']),
  itemId: String(row['itemId']),
  participantId: String(row['participantId']),
  currentRevisionId: row['currentRevisionId'] == null ? null : String(row['currentRevisionId']),
  currentReviewInstanceId:
    row['currentReviewInstanceId'] == null ? null : String(row['currentReviewInstanceId']),
  status: String(row['status']) as EntryStatus,
  source: String(row['source']) as EntrySource,
  createdAt: msOf(row['createdMs']),
})

export const entryOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .select(entryColumns)
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', entryId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? toEntry(row as Record<string, unknown>) : null)))

/** entries one participant holds on one item, voided ones excepted */
export const entryCountOf = (tenantId: string, itemId: string, participantId: string) =>
  db
    .query((k) =>
      sql<{ count: string }>`
        select count(*) as count from entries
        where tenant_id = ${tenantId} and item_id = ${itemId}
          and participant_id = ${participantId} and status <> 'voided'
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.count)))

export const insertEntry = (input: {
  tenantId: string
  batchId: string
  itemId: string
  participantId: string
  source: EntrySource
  status: EntryStatus
}) =>
  db
    .query((k) =>
      k
        .insertInto('Entry')
        .values({
          tenantId: input.tenantId,
          batchId: input.batchId,
          itemId: input.itemId,
          participantId: input.participantId,
          source: input.source,
          status: input.status,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: unknown }).id)))

export interface EntryRevisionRow {
  id: string
  revisionNo: number
  itemRevisionId: string
  payload: unknown
  actorId: string
  subjectId: string
  source: EntrySource
  note: string | null
  createdAt: number
}

export const entryRevisionOf = (tenantId: string, revisionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevision')
        .select([
          'id',
          'revisionNo',
          'itemRevisionId',
          'payload',
          'actorId',
          'subjectId',
          'source',
          'note',
        ])
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', revisionId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row
          ? ({
              id: String((row as Record<string, unknown>)['id']),
              revisionNo: Number((row as Record<string, unknown>)['revisionNo']),
              itemRevisionId: String((row as Record<string, unknown>)['itemRevisionId']),
              payload: (row as Record<string, unknown>)['payload'],
              actorId: String((row as Record<string, unknown>)['actorId']),
              subjectId: String((row as Record<string, unknown>)['subjectId']),
              source: String((row as Record<string, unknown>)['source']) as EntrySource,
              note: (row as Record<string, unknown>)['note'] as string | null,
              createdAt: msOf((row as Record<string, unknown>)['createdMs']),
            } satisfies EntryRevisionRow)
          : null,
      ),
    )

export const nextEntryRevisionNo = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      sql<{ next: string }>`
        select coalesce(max(revision_no), 0) + 1 as next from entry_revisions
        where tenant_id = ${tenantId} and entry_id = ${entryId}
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.next)))

export const insertEntryRevision = (input: {
  tenantId: string
  entryId: string
  itemId: string
  itemRevisionId: string
  revisionNo: number
  payload: unknown
  actorId: string
  subjectId: string
  source: EntrySource
  note: string | null
}) =>
  db
    .query((k) =>
      k
        .insertInto('EntryRevision')
        .values({
          tenantId: input.tenantId,
          entryId: input.entryId,
          itemId: input.itemId,
          itemRevisionId: input.itemRevisionId,
          revisionNo: input.revisionNo,
          payload: jsonb(input.payload),
          actorId: input.actorId,
          subjectId: input.subjectId,
          source: input.source,
          note: input.note,
        } as never)
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: unknown }).id)))

export const insertRevisionAttachments = (
  tenantId: string,
  revisionId: string,
  refs: readonly { attachmentId: string; position: number }[],
) =>
  refs.length === 0
    ? Effect.void
    : db.query((k) =>
        k
          .insertInto('EntryRevisionAttachment')
          .values(
            refs.map((ref) => ({
              tenantId,
              revisionId,
              attachmentId: ref.attachmentId,
              position: ref.position,
            })),
          )
          .execute(),
      )

/** the attachment relation of one revision, in position order */
export const revisionAttachmentsOf = (tenantId: string, revisionId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevisionAttachment')
        .select(['attachmentId', 'position'])
        .where('tenantId', '=', tenantId)
        .where('revisionId', '=', revisionId)
        .orderBy('position')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          attachmentId: String((row as Record<string, unknown>)['attachmentId']),
          position: Number((row as Record<string, unknown>)['position']),
        })),
      ),
    )

/** every attachment any earlier revision of this entry has cited */
export const entryAttachmentHistory = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevisionAttachment')
        .innerJoin('EntryRevision', (join) =>
          join
            .onRef('EntryRevision.tenantId', '=', 'EntryRevisionAttachment.tenantId')
            .onRef('EntryRevision.id', '=', 'EntryRevisionAttachment.revisionId'),
        )
        .select(['EntryRevisionAttachment.attachmentId as attachmentId'])
        .where('EntryRevisionAttachment.tenantId', '=', tenantId)
        .where('EntryRevision.entryId', '=', entryId)
        .execute(),
    )
    .pipe(
      Effect.map(
        (rows) =>
          new Set(rows.map((row) => String((row as Record<string, unknown>)['attachmentId']))),
      ),
    )

/**
 * One more external fact its owner has not seen (§32.72). Called in the
 * same transaction as the change it announces, and only for changes made
 * TO the participant - their own acts never ring their own bell.
 */
export const bumpParticipantAttention = (tenantId: string, entryId: string) =>
  db.query((k) =>
    k
      .updateTable('Entry')
      .set({ participantAttentionRevision: sql`participant_attention_revision + 1` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', entryId)
      .execute(),
  )

/**
 * The owner has looked at this question's claims, all of them at once. A
 * change landing concurrently keeps its own bump - seen is set to the
 * attention value THIS statement reads, and a later increment stays ahead.
 */
export const markMyEntryReads = (input: {
  tenantId: string
  batchId: string
  itemId: string
  participantId: string
}) =>
  db.query((k) =>
    k
      .updateTable('Entry')
      .set({ participantSeenRevision: sql`participant_attention_revision` })
      .where('tenantId', '=', input.tenantId)
      .where('batchId', '=', input.batchId)
      .where('itemId', '=', input.itemId)
      .where('participantId', '=', input.participantId)
      .execute(),
  )

/** the questions holding anything their owner has not seen yet */
export const unreadItemIdsOf = (input: {
  tenantId: string
  batchId: string
  participantId: string
}) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .select('itemId')
        .distinct()
        .where('tenantId', '=', input.tenantId)
        .where('batchId', '=', input.batchId)
        .where('participantId', '=', input.participantId)
        .where(sql<boolean>`participant_attention_revision > participant_seen_revision`)
        .execute(),
    )
    .pipe(Effect.map((rows) => rows.map((row) => row.itemId)))

export const setEntryState = (input: {
  tenantId: string
  entryId: string
  from: readonly EntryStatus[]
  to: EntryStatus
  currentRevisionId?: string
  currentReviewInstanceId?: string | null
}) =>
  db
    .query((k) =>
      k
        .updateTable('Entry')
        .set({
          status: input.to,
          updatedAt: sql`now()`,
          ...(input.currentRevisionId !== undefined
            ? { currentRevisionId: input.currentRevisionId }
            : {}),
          ...(input.currentReviewInstanceId !== undefined
            ? { currentReviewInstanceId: input.currentReviewInstanceId }
            : {}),
        })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.entryId)
        .where('status', 'in', [...input.from])
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export interface ParticipantAnchor {
  id: string
  userId: string
  status: 'active' | 'excluded'
  anchorNodeId: string
  anchorPath: string
  anchorLineage: readonly { nodeId: string; nodeTypeId: string }[]
}

export const participantOf = (tenantId: string, batchId: string, participantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('BatchParticipant')
        .select(['id', 'userId', 'status', 'assessmentAnchorNodeId', 'anchorLineage'])
        .select([sql<string>`anchor_path::text`.as('anchorPathText')])
        .where('tenantId', '=', tenantId)
        // the batch is part of the identity: the same person holds a row per
        // round, and a row from another round must read as nothing here
        // rather than travel on to the foreign key
        .where('batchId', '=', batchId)
        .where('id', '=', participantId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) =>
        row
          ? ({
              id: String((row as Record<string, unknown>)['id']),
              userId: String((row as Record<string, unknown>)['userId']),
              status: String((row as Record<string, unknown>)['status']) as 'active' | 'excluded',
              anchorNodeId: String((row as Record<string, unknown>)['assessmentAnchorNodeId']),
              anchorPath: String((row as Record<string, unknown>)['anchorPathText']),
              anchorLineage: ((row as Record<string, unknown>)['anchorLineage'] ?? []) as readonly {
                nodeId: string
                nodeTypeId: string
              }[],
            } satisfies ParticipantAnchor)
          : null,
      ),
    )

/**
 * Whether this member of staff may act on this participant, with the whole
 * of the M1 authority arithmetic plus the half M1 could not ask: scope.
 *
 * What the assignment still carries, intersected with what this batch
 * accepted, minus what it took back - and now also: the assignment's anchor
 * covers the participant's frozen anchor (self = the very node, subtree =
 * the frozen path under the grant node's live path, tenant role = anywhere),
 * and the grant's resource, if it names one, is this batch. Holding
 * entry.record over college A says nothing about a participant frozen under
 * college B.
 */
export const staffReachesParticipant = (input: {
  tenantId: string
  batchId: string
  userId: string
  permissionCode: string
  participant: ParticipantAnchor
}) =>
  db
    .query((k) =>
      sql<{ reaches: boolean }>`
        select exists (
          select 1
          from batch_access_sources bas
          join role_grants rg
            on rg.tenant_id = bas.tenant_id and rg.id = bas.role_assignment_id
          join roles ro on ro.tenant_id = rg.tenant_id and ro.id = rg.role_id
          join batch_access_source_permissions sp
            on sp.tenant_id = bas.tenant_id and sp.source_id = bas.id
          where bas.tenant_id = ${input.tenantId}
            and bas.batch_id = ${input.batchId}
            and bas.subject_id = ${input.userId}
            and rg.user_id = ${input.userId}
            and rg.revoked_at is null
            and (rg.valid_from is null or rg.valid_from <= now())
            and (rg.valid_until is null or rg.valid_until > now())
            and ro.status = 'active'
            and sp.permission_code = ${input.permissionCode}
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
                and rg.resource_id = ${input.batchId}
              )
            )
            and (
              rg.org_node_id is null
              or (rg.coverage = 'self' and rg.org_node_id = ${input.participant.anchorNodeId})
              or (
                rg.coverage = 'subtree'
                and ${input.participant.anchorPath}::ltree <@ (
                  select path from org_nodes n
                  where n.tenant_id = rg.tenant_id and n.id = rg.org_node_id
                )
              )
            )
        ) as reaches
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Boolean(rows[0]!.reaches)))

/** the live path of a frozen node, or null when the node no longer exists */
export const nodePathOf = (tenantId: string, nodeId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('OrgNode')
        .select([sql<string>`path::text`.as('pathText')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', nodeId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? String((row as Record<string, unknown>)['pathText']) : null)))

/**
 * Serializes work on these attachments across every batch.
 *
 * Entry writes serialize on their batch row, but two batches share no lock,
 * and storage's bind is deliberately idempotent for the owner - so without
 * this, two rounds could each read "staged, never cited" and both bind the
 * same file. Sorted before locking so two requests holding overlapping sets
 * cannot deadlock.
 */
export const lockAttachments = (tenantId: string, attachmentIds: readonly string[]) => {
  const ordered = [...new Set(attachmentIds)].sort()
  return ordered.length === 0
    ? Effect.void
    : db.query((k) =>
        sql`
          select pg_advisory_xact_lock(
            ('x' || substr(md5('assessment:attachment:' || ${tenantId} || ':' || ids.id), 1, 16))::bit(64)::bigint
          )
          from unnest(${sql.val(`{${ordered.join(',')}}`)}::uuid[]) with ordinality as ids(id, ord)
          order by ids.ord
        `.execute(k),
      )
}

/** the last word said against a claim, when it is waiting on its owner */
export interface RefusalRow {
  entryId: string
  kind: string
  /** the label picked off the batch's list, when the act took one */
  reason: string | null
  comment: string | null
  actorName: string | null
  at: number
}

/**
 * Why a claim came back, for the person it came back to.
 *
 * Two different acts leave a claim in their hands and they are recorded in
 * two different places: a reviewer's rejection is an event of the round that
 * judged it, and an administrator sending it back because the question
 * changed is an event of the claim itself (§32.62), with no round at all.
 * A screen that showed only the first would leave the second as a status
 * word with no explanation anywhere near it.
 *
 * Raw sql for `distinct on`, which is how postgres says "the latest per
 * claim" without a window function and a wrapping select.
 */
export const latestRefusalOf = (tenantId: string, entryIds: readonly string[]) =>
  entryIds.length === 0
    ? Effect.succeed(new Map<string, RefusalRow>())
    : db
        .query((k) =>
          sql<{
            entry_id: string
            kind: string
            reason: string | null
            comment: string | null
            actor_name: string | null
            at_ms: number
          }>`
            with said as (
              select ri.entry_id, re.kind, re.reason, re.comment,
                     u.display_name as actor_name, re.created_at
              from review_events re
              join review_instances ri
                on ri.tenant_id = re.tenant_id and ri.id = re.review_instance_id
              left join users u on u.tenant_id = re.tenant_id and u.id = re.actor_id
              where re.tenant_id = ${tenantId}
                and ri.entry_id = any(${sql.val(`{${entryIds.join(',')}}`)}::uuid[])
                and re.kind = 'rejected'
              union all
              select ee.entry_id, ee.kind, ee.reason, null::text,
                     u.display_name as actor_name, ee.created_at
              from entry_events ee
              left join users u on u.tenant_id = ee.tenant_id and u.id = ee.actor_id
              where ee.tenant_id = ${tenantId}
                and ee.entry_id = any(${sql.val(`{${entryIds.join(',')}}`)}::uuid[])
                and ee.kind in ('revision-required', 'returned-for-revision')
            )
            select distinct on (entry_id)
              entry_id, kind, reason, comment, actor_name,
              (extract(epoch from created_at) * 1000)::float8 as at_ms
            from said
            order by entry_id, created_at desc
          `.execute(k),
        )
        .pipe(
          Effect.map(
            ({ rows }) =>
              new Map(
                rows.map((row): [string, RefusalRow] => [
                  String(row.entry_id),
                  {
                    entryId: String(row.entry_id),
                    kind: String(row.kind),
                    reason: row.reason,
                    comment: row.comment,
                    actorName: row.actor_name,
                    at: Number(row.at_ms ?? 0),
                  },
                ]),
              ),
          ),
        )

export const nextRoundNo = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      sql<{ next: string }>`
        select coalesce(max(round_no), 0) + 1 as next from review_instances
        where tenant_id = ${tenantId} and entry_id = ${entryId}
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => Number(rows[0]!.next)))

/**
 * Whether a round of this claim is still running.
 *
 * Not `entries.current_review_instance_id`: that keeps pointing at the last
 * round after it ends, which is what lets a reader find the decision. Open
 * means the round row says so, the same two states the partial unique index
 * counts.
 */
export const hasOpenRound = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .where('state', 'in', ['active', 'blocked', 'awaiting_supplement'])
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const insertReviewInstance = (input: {
  tenantId: string
  entryId: string
  revisionId: string
  roundNo: number
  /** why this round exists; 'initial' is a submission, 'appeal' contests one */
  origin?: 'initial' | 'appeal' | 'reroute'
  initiator?: 'participant' | 'staff'
  /** the round this one replaced, when a policy change opened it */
  supersedesInstanceId?: string | null
  /** the decision being contested, when this round is an appeal */
  appealedInstanceId?: string | null
  /** where this round may be ended; frozen when it opens (§32.63) */
  /** which version of the question's review policy this round walks */
  policyRevisionId: string
  /** both routes, resolved and frozen for the whole round */
  effectivePolicy: unknown
  route: 'normal' | 'escalation'
  stageId: string
  roleIds: readonly string[]
  nodeId: string
  nodePath: string
  state: 'active' | 'blocked'
  /** why nobody can act, when arriving blocked */
  blockedReason?: string | null
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into review_instances
          (tenant_id, entry_id, revision_id, round_no, origin, initiator,
           supersedes_instance_id, appealed_instance_id,
           policy_revision_id, effective_chain,
           current_route, current_stage_id, state, blocked_reason,
           current_role_ids, current_node_id, current_node_path)
        values (${input.tenantId}, ${input.entryId}, ${input.revisionId}, ${input.roundNo},
                ${input.origin ?? 'initial'}, ${input.initiator ?? 'participant'},
                ${input.supersedesInstanceId ?? null}, ${input.appealedInstanceId ?? null},
                ${input.policyRevisionId},
                ${jsonb(input.effectivePolicy)},
                ${input.route}, ${input.stageId}, ${input.state},
                ${input.state === 'blocked' ? (input.blockedReason ?? 'no-assignee') : null},
                ${sql.val(`{${input.roleIds.join(',')}}`)}::uuid[], ${input.nodeId},
                ${input.nodePath}::ltree)
        returning id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => String(rows[0]!.id)))

/**
 * Moves an open round to the step it just entered, whether that came of an
 * approval carrying it onward or of an escalation handing it to the other route.
 * Conditional on the round still standing where the caller read it, so two
 * decisions on one round cannot both advance it.
 */
export const advanceReviewInstance = (input: {
  tenantId: string
  instanceId: string
  fromRoute: 'normal' | 'escalation'
  fromStageId: string
  toRoute: 'normal' | 'escalation'
  toStageId: string
  roleIds: readonly string[]
  nodeId: string
  nodePath: string
  state: 'active' | 'blocked'
  /** why nobody can act at the step being entered, when arriving blocked */
  blockedReason?: string | null
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        update review_instances
        set current_route = ${input.toRoute},
            current_stage_id = ${input.toStageId},
            current_role_ids = ${sql.val(`{${input.roleIds.join(',')}}`)}::uuid[],
            current_node_id = ${input.nodeId},
            current_node_path = ${input.nodePath}::ltree,
            state = ${input.state},
            blocked_reason =
              ${input.state === 'blocked' ? (input.blockedReason ?? 'no-assignee') : null}
        where tenant_id = ${input.tenantId}
          and id = ${input.instanceId}
          and state in ('active', 'blocked')
          and current_route = ${input.fromRoute}
          and current_stage_id = ${input.fromStageId}
        returning id
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => rows.length > 0))

/**
 * Ends the open round, if it is still open; the loser of a race writes
 * nothing.
 *
 * Open means `active`, `blocked` or `awaiting_supplement`. Blocked is a
 * round waiting for somebody to be appointed to the level it stands at,
 * awaiting_supplement one that paused itself to ask the person who filed for
 * more backing - running states, not conclusions - and the partial unique
 * index that admits one open round per entry counts all three. Ending only
 * `active` rounds left every blocked one unendable: the person who filed it
 * could not withdraw it, and nobody could be appointed to release it either,
 * so the claim was stuck for good. A cancelled round's open supplement
 * request needs no sweeping: answering requires the round to still be
 * waiting, so the ask dies with the round by definition.
 */
export const cancelReviewInstance = (input: {
  tenantId: string
  instanceId: string
  outcome: string
}) =>
  db
    .query((k) =>
      // one statement, two writes: the round closes, and whatever sitting it
      // still held dissolves with it - a panel left open on a closed round
      // would go on admitting voters to nothing
      sql<{ id: string }>`
        with closed as (
          update review_instances
          set state = 'completed', outcome = ${input.outcome}, completed_at = now(),
              blocked_reason = null
          where tenant_id = ${input.tenantId} and id = ${input.instanceId}
            and state in ('active', 'blocked', 'awaiting_supplement')
          returning id
        ), dissolved as (
          update review_panels p
          set state = 'superseded', closed_at = now()
          from closed
          where p.tenant_id = ${input.tenantId}
            and p.review_instance_id = closed.id
            and p.state = 'open'
        )
        select id from closed
      `.execute(k),
    )
    .pipe(Effect.map(({ rows }) => rows.length > 0))

/**
 * Something that happened to a claim which no review round explains.
 *
 * Append-only, like every other log here. The reason it exists at all: an
 * approved claim sent back because the question changed has no open round to
 * record that in, and writing it into the rejections would put an
 * administrator's edit into the rejection rate (§32.62).
 */
export const insertEntryEvent = (input: {
  tenantId: string
  entryId: string
  kind: string
  actorId: string | null
  reason?: string | null
  /** the item revision that caused it, when a configuration change did */
  causeRevisionId?: string | null
}) =>
  db.query((k) =>
    k
      .insertInto('EntryEvent')
      .values({
        tenantId: input.tenantId,
        entryId: input.entryId,
        kind: input.kind,
        actorId: input.actorId,
        reason: input.reason ?? null,
        causeRevisionId: input.causeRevisionId ?? null,
      } as never)
      .execute(),
  )

export const insertReviewEvent = (input: {
  tenantId: string
  reviewInstanceId: string
  kind: string
  actorId: string | null
  /** where the round was standing; omitted for events that belong to the round */
  route?: 'normal' | 'escalation' | null
  stageId?: string | null
  /** the configured label the actor picked, copied verbatim */
  reason?: string | null
  comment?: string | null
  suggestedPayload?: unknown
}) =>
  db.query((k) =>
    k
      .insertInto('ReviewEvent')
      .values({
        tenantId: input.tenantId,
        reviewInstanceId: input.reviewInstanceId,
        kind: input.kind,
        actorId: input.actorId,
        route: input.route ?? null,
        stageId: input.stageId ?? null,
        reason: input.reason ?? null,
        comment: input.comment ?? null,
        ...(input.suggestedPayload !== undefined
          ? { suggestedPayload: jsonb(input.suggestedPayload) }
          : {}),
      } as never)
      .execute(),
  )

/** the open work a void sweeps: entries of this item still in someone's hands */
export const openEntriesOfItem = (tenantId: string, itemId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .select(['id', 'status', 'currentReviewInstanceId'])
        .where('tenantId', '=', tenantId)
        .where('itemId', '=', itemId)
        .where('status', 'in', ['draft', 'in_review'])
        .orderBy('id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: String((row as Record<string, unknown>)['id']),
          status: String((row as Record<string, unknown>)['status']) as EntryStatus,
          currentReviewInstanceId:
            (row as Record<string, unknown>)['currentReviewInstanceId'] == null
              ? null
              : String((row as Record<string, unknown>)['currentReviewInstanceId']),
        })),
      ),
    )

/** one participant's entries in a batch, oldest first, keyset-paged */
export const entriesOfParticipantPage = (input: {
  tenantId: string
  batchId: string
  participantId: string
  after?: readonly [string, string] | undefined
  limit: number
}) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('Entry')
        .select(entryColumns)
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', input.tenantId)
        .where('batchId', '=', input.batchId)
        .where('participantId', '=', input.participantId)
        .orderBy('createdAt')
        .orderBy('id')
        .limit(input.limit)
      if (input.after !== undefined) {
        query = query.where(
          sql<boolean>`(created_at, id) > (${input.after[0]}::timestamptz, ${input.after[1]}::uuid)`,
        )
      }
      return query.execute()
    })
    .pipe(Effect.map((rows) => rows.map((row) => toEntry(row as Record<string, unknown>))))

/** the creation instant as the keyset cursor needs it, exactly as stored */
export const entryCreatedIso = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry')
        .select([sql<string>`created_at::text`.as('createdIso')])
        .where('tenantId', '=', tenantId)
        .where('id', '=', entryId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? row.createdIso : null)))

/** every revision of one entry, in the order they were written */
export const entryRevisionsOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryRevision')
        .select([
          'id',
          'revisionNo',
          'itemRevisionId',
          'payload',
          'actorId',
          'subjectId',
          'source',
          'note',
        ])
        .select([epoch('created_at').as('createdMs')])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .orderBy('revisionNo')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): EntryRevisionRow => ({
          id: row.id,
          revisionNo: row.revisionNo,
          itemRevisionId: row.itemRevisionId,
          payload: row.payload,
          actorId: row.actorId,
          subjectId: row.subjectId,
          source: row.source as EntrySource,
          note: row.note,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )

/** the attachment relations of many revisions at once, grouped by revision */
export const attachmentsOfRevisions = (tenantId: string, revisionIds: readonly string[]) =>
  revisionIds.length === 0
    ? Effect.succeed(new Map<string, { attachmentId: string; position: number }[]>())
    : db
        .query((k) =>
          k
            .selectFrom('EntryRevisionAttachment')
            .select(['revisionId', 'attachmentId', 'position'])
            .where('tenantId', '=', tenantId)
            .where('revisionId', 'in', [...revisionIds])
            .orderBy('revisionId')
            .orderBy('position')
            .execute(),
        )
        .pipe(
          Effect.map((rows) => {
            const grouped = new Map<string, { attachmentId: string; position: number }[]>()
            for (const row of rows) {
              const bucket = grouped.get(row.revisionId)
              const item = { attachmentId: row.attachmentId, position: row.position }
              if (bucket === undefined) grouped.set(row.revisionId, [item])
              else bucket.push(item)
            }
            return grouped
          }),
        )

export interface EntryRoundRow {
  id: string
  roundNo: number
  state: string
  outcome: string | null
  revisionId: string
  /** how the round began: initial, appeal, reroute, reopen */
  origin: string
  supersedesInstanceId: string | null
  appealedInstanceId: string | null
  createdAt: number
  completedAt: number | null
}

/** every review round this entry has been through, oldest first */
export const roundsOfEntry = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select([
          'id',
          'state',
          'outcome',
          'roundNo',
          'revisionId',
          'origin',
          'supersedesInstanceId',
          'appealedInstanceId',
        ])
        .select([epoch('created_at').as('createdMs'), epoch('completed_at').as('completedMs')])
        .where('tenantId', '=', tenantId)
        .where('entryId', '=', entryId)
        .orderBy('roundNo')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): EntryRoundRow => ({
          id: row.id,
          roundNo: row.roundNo,
          state: row.state as string,
          outcome: row.outcome,
          revisionId: row.revisionId,
          origin: row.origin as string,
          supersedesInstanceId: row.supersedesInstanceId,
          appealedInstanceId: row.appealedInstanceId,
          createdAt: msOf(row.createdMs),
          completedAt: row.completedMs == null ? null : msOf(row.completedMs),
        })),
      ),
    )

/**
 * The claim's own log, oldest first: what happened to it that no round
 * explains.
 */
export const entryEventsOf = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('EntryEvent as ee')
        .leftJoin('User as u', (join) =>
          join.onRef('u.tenantId', '=', 'ee.tenantId').onRef('u.id', '=', 'ee.actorId'),
        )
        .select(['ee.kind', 'ee.actorId', 'ee.reason', 'u.displayName as actorName'])
        .select([epoch('ee.created_at').as('createdMs')])
        .where('ee.tenantId', '=', tenantId)
        .where('ee.entryId', '=', entryId)
        .orderBy('ee.createdAt')
        .orderBy('ee.id')
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          kind: row.kind,
          actorId: row.actorId,
          actorName: row.actorName,
          reason: row.reason,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )

/** the events of many rounds at once, grouped by round, oldest first */
export const eventsOfRounds = (tenantId: string, instanceIds: readonly string[]) =>
  instanceIds.length === 0
    ? Effect.succeed(
        new Map<
          string,
          {
            kind: string
            actorId: string | null
            actorName: string | null
            reason: string | null
            comment: string | null
            suggestedPayload: unknown
            createdAt: number
          }[]
        >(),
      )
    : db
        .query((k) =>
          k
            .selectFrom('ReviewEvent as re')
            .leftJoin('User as u', (join) =>
              join.onRef('u.tenantId', '=', 're.tenantId').onRef('u.id', '=', 're.actorId'),
            )
            .select([
              're.reviewInstanceId',
              're.kind',
              're.actorId',
              're.reason',
              're.comment',
              're.suggestedPayload',
              'u.displayName as actorName',
            ])
            .select([epoch('re.created_at').as('createdMs')])
            .where('re.tenantId', '=', tenantId)
            .where('re.reviewInstanceId', 'in', [...instanceIds])
            .orderBy('re.createdAt')
            .orderBy('re.id')
            .execute(),
        )
        .pipe(
          Effect.map((rows) => {
            const grouped = new Map<
              string,
              {
                kind: string
                actorId: string | null
                actorName: string | null
                reason: string | null
                comment: string | null
                suggestedPayload: unknown
                createdAt: number
              }[]
            >()
            for (const row of rows) {
              const event = {
                kind: row.kind,
                actorId: row.actorId,
                actorName: row.actorName,
                reason: row.reason,
                comment: row.comment,
                suggestedPayload: row.suggestedPayload ?? null,
                createdAt: msOf(row.createdMs),
              }
              const bucket = grouped.get(row.reviewInstanceId)
              if (bucket === undefined) grouped.set(row.reviewInstanceId, [event])
              else bucket.push(event)
            }
            return grouped
          }),
        )

// ---------------------------------------------------------------------------
// The participant's own story (§32.72): what needs their hand now, and what
// has happened to their claims lately. Read models over the append-only
// facts - revisions, events, rounds, asks - never a second table of them.

export interface MyActionRow {
  kind: 'supplement' | 'revision'
  entryId: string
  itemId: string
  itemTitle: string
  at: string
  atMs: number
  who: string | null
  summary: string | null
}

/** the open asks and the return-for-revision marks standing against this participant */
export const myActionRowsOf = (input: {
  tenantId: string
  batchId: string
  participantId: string
}) =>
  db
    .query((k) =>
      sql<{
        kind: string
        entry_id: string
        item_id: string
        item_title: string
        at: string
        at_ms: number
        who: string | null
        summary: string | null
      }>`
        select 'supplement' as kind,
               e.id as entry_id, e.item_id, i.title as item_title,
               sr.created_at::text as at,
               (extract(epoch from sr.created_at) * 1000)::float8 as at_ms,
               u.display_name as who,
               sr.instructions as summary
        from review_supplement_requests sr
        join review_instances ri
          on ri.tenant_id = sr.tenant_id and ri.id = sr.review_instance_id
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        join assessment_items i on i.tenant_id = e.tenant_id and i.id = e.item_id
        left join users u on u.tenant_id = sr.tenant_id and u.id = sr.requested_by
        where sr.tenant_id = ${input.tenantId}
          and e.batch_id = ${input.batchId}
          and e.participant_id = ${input.participantId}
          and sr.status = 'open'
          and ri.state = 'awaiting_supplement'
        union all
        select 'revision',
               e.id, e.item_id, i.title,
               ev.created_at::text,
               (extract(epoch from ev.created_at) * 1000)::float8,
               u.display_name,
               ev.reason
        from entries e
        join assessment_items i on i.tenant_id = e.tenant_id and i.id = e.item_id
        left join lateral (
          select ee.created_at, ee.reason, ee.actor_id
          from entry_events ee
          where ee.tenant_id = e.tenant_id and ee.entry_id = e.id
            and ee.kind = 'revision-required'
          order by ee.created_at desc
          limit 1
        ) ev on true
        left join users u on u.tenant_id = e.tenant_id and u.id = ev.actor_id
        where e.tenant_id = ${input.tenantId}
          and e.batch_id = ${input.batchId}
          and e.participant_id = ${input.participantId}
          and e.status = 'needs_revision'
        order by at_ms desc
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): MyActionRow => ({
          kind: row.kind as MyActionRow['kind'],
          entryId: row.entry_id,
          itemId: row.item_id,
          itemTitle: row.item_title,
          at: row.at,
          atMs: row.at_ms,
          who: row.who,
          summary: row.summary,
        })),
      ),
    )

export interface MyActivityRow {
  id: string
  source: string
  kind: string
  entryId: string
  itemId: string
  itemTitle: string
  actorName: string | null
  reason: string | null
  comment: string | null
  at: string
  atMs: number
}

/**
 * Everything that happened to this participant's claims, newest first, in
 * business words. Terminal verdicts come from the rounds themselves - a
 * stage-level "approved" is a handover, not news - and the supplement
 * exchange comes only from its structured records, so nothing is told
 * twice. Keyset over (at, source, id): a timestamp alone drops rows that
 * share an instant across sources.
 */
export const myActivityPage = (input: {
  tenantId: string
  batchId: string
  participantId: string
  after?: readonly [string, string, string] | undefined
  limit: number
}) =>
  db
    .query((k) =>
      sql<{
        id: string
        source: string
        kind: string
        entry_id: string
        item_id: string
        item_title: string
        actor_name: string | null
        reason: string | null
        comment: string | null
        at: string
        at_ms: number
      }>`
        with mine as (
          select e.id, e.item_id, i.title
          from entries e
          join assessment_items i on i.tenant_id = e.tenant_id and i.id = e.item_id
          where e.tenant_id = ${input.tenantId}
            and e.batch_id = ${input.batchId}
            and e.participant_id = ${input.participantId}
        ),
        activity as (
          select er.id, 'revision' as source,
                 case when er.revision_no = 1 then 'entry-created' else 'entry-revised' end as kind,
                 m.id as entry_id, m.item_id, m.title as item_title,
                 null::text as actor_name, null::text as reason, null::text as comment,
                 er.created_at
          from entry_revisions er
          join mine m on m.id = er.entry_id
          where er.tenant_id = ${input.tenantId}

          union all
          select re.id, 'review-event',
                 case re.kind
                   when 'submitted' then 'entry-submitted'
                   when 'cancelled-by-submitter' then 'entry-withdrawn'
                   when 'appealed' then 'appeal-filed'
                   when 'escalated' then 'review-escalated'
                 end,
                 m.id, m.item_id, m.title,
                 u.display_name, re.reason, re.comment,
                 re.created_at
          from review_events re
          join review_instances ri
            on ri.tenant_id = re.tenant_id and ri.id = re.review_instance_id
          join mine m on m.id = ri.entry_id
          left join users u on u.tenant_id = re.tenant_id and u.id = re.actor_id
          where re.tenant_id = ${input.tenantId}
            and re.kind in ('submitted', 'cancelled-by-submitter', 'appealed', 'escalated')

          union all
          select ee.id, 'entry-event',
                 case ee.kind
                   when 'abandoned-by-submitter' then 'entry-abandoned'
                   when 'revision-required' then 'revision-required'
                   when 'auto-approved' then 'review-approved'
                 end,
                 m.id, m.item_id, m.title,
                 u.display_name, ee.reason, null,
                 ee.created_at
          from entry_events ee
          join mine m on m.id = ee.entry_id
          left join users u on u.tenant_id = ee.tenant_id and u.id = ee.actor_id
          where ee.tenant_id = ${input.tenantId}
            and ee.kind in ('abandoned-by-submitter', 'revision-required', 'auto-approved')

          union all
          select ri.id, 'verdict',
                 case ri.outcome when 'approved' then 'review-approved' else 'review-rejected' end,
                 m.id, m.item_id, m.title,
                 said.display_name, said.reason, said.comment,
                 ri.completed_at
          from review_instances ri
          join mine m on m.id = ri.entry_id
          left join lateral (
            select u.display_name, re2.reason, re2.comment
            from review_events re2
            left join users u on u.tenant_id = re2.tenant_id and u.id = re2.actor_id
            where re2.tenant_id = ri.tenant_id
              and re2.review_instance_id = ri.id
              and re2.kind = ri.outcome
            order by re2.created_at desc
            limit 1
          ) said on true
          where ri.tenant_id = ${input.tenantId}
            and ri.state = 'completed'
            and ri.outcome in ('approved', 'rejected')
            and ri.completed_at is not null

          union all
          select sr.id, 'supp-req', 'supplement-requested',
                 m.id, m.item_id, m.title,
                 u.display_name, null, sr.instructions,
                 sr.created_at
          from review_supplement_requests sr
          join review_instances ri
            on ri.tenant_id = sr.tenant_id and ri.id = sr.review_instance_id
          join mine m on m.id = ri.entry_id
          left join users u on u.tenant_id = sr.tenant_id and u.id = sr.requested_by
          where sr.tenant_id = ${input.tenantId}

          union all
          select sr.id, 'supp-ans', 'supplement-submitted',
                 m.id, m.item_id, m.title,
                 null, null, null,
                 sr.answered_at
          from review_supplement_requests sr
          join review_instances ri
            on ri.tenant_id = sr.tenant_id and ri.id = sr.review_instance_id
          join mine m on m.id = ri.entry_id
          where sr.tenant_id = ${input.tenantId}
            and sr.answered_at is not null

          union all
          select sr.id, 'supp-cxl', 'supplement-cancelled',
                 m.id, m.item_id, m.title,
                 u.display_name, null, null,
                 sr.cancelled_at
          from review_supplement_requests sr
          join review_instances ri
            on ri.tenant_id = sr.tenant_id and ri.id = sr.review_instance_id
          join mine m on m.id = ri.entry_id
          left join users u on u.tenant_id = sr.tenant_id and u.id = sr.cancelled_by
          where sr.tenant_id = ${input.tenantId}
            and sr.status = 'cancelled'
            and sr.cancelled_at is not null
        )
        select id, source, kind, entry_id, item_id, item_title,
               actor_name, reason, comment,
               created_at::text as at,
               (extract(epoch from created_at) * 1000)::float8 as at_ms
        from activity
        where kind is not null
          ${
            input.after === undefined
              ? sql``
              : sql`and (created_at, source, id) < (${input.after[0]}::timestamptz, ${input.after[1]}, ${input.after[2]}::uuid)`
          }
        order by created_at desc, source desc, id desc
        limit ${input.limit}
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): MyActivityRow => ({
          id: row.id,
          source: row.source,
          kind: row.kind,
          entryId: row.entry_id,
          itemId: row.item_id,
          itemTitle: row.item_title,
          actorName: row.actor_name,
          reason: row.reason,
          comment: row.comment,
          at: row.at,
          atMs: row.at_ms,
        })),
      ),
    )
