import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'

// Who stands around an attachment: every entry whose history cites it, and
// every review round that judged a revision citing it. The authorizer walks
// these to decide whether a reader belongs to the file's story.

export interface CitingEntryRow {
  entryId: string
  batchId: string
  subjectUserId: string
}

export const citingEntries = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      sql`
        select distinct e.id as entry_id, e.batch_id, bp.user_id as subject_user_id
        from entry_revision_attachments era
        join entry_revisions er on er.tenant_id = era.tenant_id and er.id = era.revision_id
        join entries e on e.tenant_id = er.tenant_id and e.id = er.entry_id
        join batch_participants bp on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
        where era.tenant_id = ${tenantId} and era.attachment_id = ${attachmentId}
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        (rows as Record<string, unknown>[]).map((row): CitingEntryRow => ({
          entryId: String(row['entry_id']),
          batchId: String(row['batch_id']),
          subjectUserId: String(row['subject_user_id']),
        })),
      ),
    )

export interface CitingInstanceRow {
  batchId: string
  currentNodeId: string
  currentRoleIds: readonly string[]
  subjectUserId: string
  actorId: string
}

/** the rounds that judged a revision citing this file, shaped for the reviewer predicate */
export const citingInstances = (tenantId: string, attachmentId: string) =>
  db
    .query((k) =>
      sql`
        select distinct ri.id, e.batch_id, ri.current_node_id, ri.current_role_ids,
               bp.user_id as subject_user_id, er.actor_id
        from review_instances ri
        join entry_revision_attachments era
          on era.tenant_id = ri.tenant_id and era.revision_id = ri.revision_id
        join entry_revisions er on er.tenant_id = ri.tenant_id and er.id = ri.revision_id
        join entries e on e.tenant_id = ri.tenant_id and e.id = ri.entry_id
        join batch_participants bp on bp.tenant_id = e.tenant_id and bp.id = e.participant_id
        where ri.tenant_id = ${tenantId} and era.attachment_id = ${attachmentId}
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        (rows as Record<string, unknown>[]).map((row): CitingInstanceRow => ({
          batchId: String(row['batch_id']),
          currentNodeId: String(row['current_node_id']),
          currentRoleIds: (row['current_role_ids'] as readonly string[]).map(String),
          subjectUserId: String(row['subject_user_id']),
          actorId: String(row['actor_id']),
        })),
      ),
    )
