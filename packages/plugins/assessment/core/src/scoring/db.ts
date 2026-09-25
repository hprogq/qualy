import { Effect } from 'effect'
import { sql } from 'kysely'
import { db } from '../server/db.ts'
import { VOIDED_WITH_ITEM } from '../entry/db.ts'

// What input collection reads that no other module already provides: the
// participant's entries with the payload each stands on, and the caller's
// own membership row whatever its status - an excluded member still reads
// the history they took part in (§32.56).

const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

const msOf = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Number(value ?? 0)

export const participantRowByUser = (tenantId: string, batchId: string, userId: string) =>
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
    .pipe(Effect.map((row) => (row === undefined ? null : { id: row.id, status: row.status })))

/** a question the audit evaluates: active, configured, with the round it belongs to */
export interface AuditableItem {
  id: string
  tenantId: string
  batchId: string
  itemType: string
  currentRevisionId: string
  batchStatus: string
}

/**
 * Every question anybody can be scored by, across tenants, a page at a time.
 *
 * The audit acts as the system rather than for a principal, so this read is
 * deliberately not tenant-scoped unless asked to be; an archived round still
 * reads its results, so its questions are still here. The keyset is the
 * item's own uuidv7 primary key, which is what makes one global walk sound.
 */
export const auditableItems = (page: {
  readonly after?: string
  readonly tenantId?: string
  readonly batchId?: string
  readonly limit: number
}) =>
  db
    .query((k) => {
      let query = k
        .selectFrom('AssessmentItem as i')
        .innerJoin('AssessmentBatch as b', (join) =>
          join.onRef('b.tenantId', '=', 'i.tenantId').onRef('b.id', '=', 'i.batchId'),
        )
        .select([
          'i.id as id',
          'i.tenantId as tenantId',
          'i.batchId as batchId',
          'i.itemType as itemType',
          'i.currentRevisionId as currentRevisionId',
          'b.status as batchStatus',
        ])
        .where('i.status', '=', 'active')
        .where('i.currentRevisionId', 'is not', null)
        .orderBy('i.id')
        .limit(page.limit)
      if (page.after !== undefined) query = query.where('i.id', '>', page.after)
      if (page.tenantId !== undefined) query = query.where('i.tenantId', '=', page.tenantId)
      if (page.batchId !== undefined) query = query.where('i.batchId', '=', page.batchId)
      return query.execute()
    })
    .pipe(
      Effect.map((rows): AuditableItem[] =>
        rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          batchId: row.batchId,
          itemType: row.itemType,
          currentRevisionId: String(row.currentRevisionId),
          batchStatus: String(row.batchStatus),
        })),
      ),
    )

export interface ScoredEntryRow {
  id: string
  itemId: string
  status: string
  revisionId: string | null
  /** the determination this claim stands on, when it stands on one */
  recognitionId: string | null
  recognition: Record<string, unknown>
  /** whether a round was ever opened on it, which is what submitting does */
  wasSubmitted: boolean
  /** whether it was cancelled because its question was withdrawn */
  voidedWithItem: boolean
  createdAt: number
}

/** every entry this participant holds, with the determination it stands on */
export const participantEntries = (tenantId: string, batchId: string, participantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('Entry as e')
        .leftJoin('EntryRevision as er', (join) =>
          join.onRef('er.tenantId', '=', 'e.tenantId').onRef('er.id', '=', 'e.currentRevisionId'),
        )
        // the determination in the same read as the claim: two reads could
        // see an approval land between them and score a claim against a
        // recognition that was not the one it stood on
        .leftJoin('EntryRecognition as rec', (join) =>
          join
            .onRef('rec.tenantId', '=', 'e.tenantId')
            .onRef('rec.id', '=', 'e.currentRecognitionId'),
        )
        .select([
          'e.id',
          'e.itemId',
          'e.status',
          'e.currentRevisionId as revisionId',
          'e.currentRecognitionId as recognitionId',
          'rec.values as recognition',
        ])
        // whether it was ever put to anybody. §32.30 gives a line to a claim
        // that was formally submitted and is no longer counted, and nothing
        // to a draft somebody abandoned - and submitting is what opens a
        // round, so a round having existed is exactly that question.
        .select((eb) =>
          eb
            .exists(
              eb
                .selectFrom('ReviewInstance as ri')
                .select(eb.lit(1).as('one'))
                .whereRef('ri.tenantId', '=', 'e.tenantId')
                .whereRef('ri.entryId', '=', 'e.id'),
            )
            .as('wasSubmitted'),
        )
        // cancelled with its question: the entry's own record says so, and
        // a claim cancelled that way before the record was kept still has
        // its round's closing word
        .select((eb) =>
          eb
            .and([
              eb('e.status', '=', 'voided'),
              eb.or([
                eb.exists(
                  eb
                    .selectFrom('EntryEvent as ee')
                    .select(eb.lit(1).as('one'))
                    .whereRef('ee.tenantId', '=', 'e.tenantId')
                    .whereRef('ee.entryId', '=', 'e.id')
                    .where('ee.kind', '=', VOIDED_WITH_ITEM),
                ),
                eb.exists(
                  eb
                    .selectFrom('ReviewEvent as re')
                    .innerJoin('ReviewInstance as ri', (join) =>
                      join
                        .onRef('ri.tenantId', '=', 're.tenantId')
                        .onRef('ri.id', '=', 're.reviewInstanceId'),
                    )
                    .select(eb.lit(1).as('one'))
                    .whereRef('ri.tenantId', '=', 'e.tenantId')
                    .whereRef('ri.entryId', '=', 'e.id')
                    .where('re.kind', '=', 'cancelled-item-voided'),
                ),
              ]),
            ])
            .as('voidedWithItem'),
        )
        .select([epoch('e.created_at').as('createdMs')])
        .where('e.tenantId', '=', tenantId)
        .where('e.batchId', '=', batchId)
        .where('e.participantId', '=', participantId)
        .execute(),
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): ScoredEntryRow => ({
          id: row.id,
          itemId: row.itemId,
          status: row.status,
          revisionId: row.revisionId,
          recognitionId: row.recognitionId ?? null,
          recognition: row.recognition ?? {},
          wasSubmitted: row.wasSubmitted === true,
          voidedWithItem: row.voidedWithItem === true,
          createdAt: msOf(row.createdMs),
        })),
      ),
    )
