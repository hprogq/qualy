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
        .where('state', 'in', ['active', 'blocked'])
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
  rejectPolicy: 'any-stage' | 'terminal-only'
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
}) =>
  db
    .query((k) =>
      sql<{ id: string }>`
        insert into review_instances
          (tenant_id, entry_id, revision_id, round_no, origin, initiator,
           supersedes_instance_id, appealed_instance_id, reject_policy,
           policy_revision_id, effective_chain,
           current_route, current_stage_id, state, current_role_ids, current_node_id,
           current_node_path)
        values (${input.tenantId}, ${input.entryId}, ${input.revisionId}, ${input.roundNo},
                ${input.origin ?? 'initial'}, ${input.initiator ?? 'participant'},
                ${input.supersedesInstanceId ?? null}, ${input.appealedInstanceId ?? null},
                ${input.rejectPolicy}, ${input.policyRevisionId},
                ${jsonb(input.effectivePolicy)},
                ${input.route}, ${input.stageId}, ${input.state},
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
            state = ${input.state}
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
 * Open means `active` or `blocked`. Blocked is a round waiting for somebody
 * to be appointed to the level it stands at - a running state, not a
 * conclusion - and the partial unique index that admits one open round per
 * entry counts it as one. Ending only `active` rounds left every blocked one
 * unendable: the person who filed it could not withdraw it, and nobody could
 * be appointed to release it either, so the claim was stuck for good.
 */
export const cancelReviewInstance = (input: {
  tenantId: string
  instanceId: string
  outcome: string
}) =>
  db
    .query((k) =>
      k
        .updateTable('ReviewInstance')
        .set({ state: 'completed', outcome: input.outcome, completedAt: sql`now()` })
        .where('tenantId', '=', input.tenantId)
        .where('id', '=', input.instanceId)
        .where('state', 'in', ['active', 'blocked'])
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

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
  createdAt: number
  completedAt: number | null
}

/** every review round this entry has been through, oldest first */
export const roundsOfEntry = (tenantId: string, entryId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('ReviewInstance')
        .select(['id', 'state', 'outcome', 'roundNo', 'revisionId'])
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
