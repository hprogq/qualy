import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from '@qualy/plugin-database/plugin'
import { sql } from 'kysely'
import { entities } from '../db/entities.ts'

// Storage's own view of the database: its two tables and nothing else.
//
// The closure is deliberately empty of other plugins. Storage does not know
// what a tenant or a user is beyond an id somebody hands it, so there is no
// table it could usefully join against.
//
// Every instant crosses this boundary as epoch milliseconds and every
// comparison against "now" takes it as a parameter rather than calling
// `now()`. The reason is the sweeper: it is tested on a clock the suite moves,
// and a query that asked postgres what time it was would answer from a
// different clock than the code deciding what to sweep.

const closure = [...entities] as const

export const db = Db.scope(closure)

/** a timestamptz column as epoch milliseconds */
const epoch = (column: string) =>
  sql<number | null>`(extract(epoch from ${sql.ref(column)}) * 1000)::float8`

/**
 * An epoch-millisecond instant as something a query can bind.
 *
 * A Date rather than a `to_timestamp` expression: the driver sends it as a
 * timestamptz parameter, which the builder accepts for a nullable column where
 * a raw expression does not, and it round-trips to the same microsecond - which
 * matters, because a cleanup claim is released by matching the instant it was
 * taken at.
 */
const at = (ms: number) => new Date(ms)

/**
 * An instant as the row hands it over.
 *
 * The scoped kysely hydrates result columns through the entity metadata, so
 * an alias that shares a datetime property's name comes back as a Date. These
 * aliases are suffixed to avoid that, and this normalizes what survives.
 */
const msOf = (value: unknown): number | null =>
  value == null ? null : value instanceof Date ? value.getTime() : Number(value)

/** a byte count as the row hands it over: the driver's bigint is a string */
const bytesOf = (value: unknown): bigint => BigInt(String(value ?? 0))

export type ReservationStatus = 'issued' | 'completed' | 'expired' | 'failed'
export type AttachmentStatus = 'staged' | 'bound' | 'retired'

export interface ReservationRow {
  id: string
  tenantId: string
  ownerUserId: string
  attachmentId: string
  backend: string
  storageKey: string
  filename: string
  declaredMime: string
  reservedBytes: bigint
  status: ReservationStatus
  grantExpiresAt: number
  cleanupAfter: number
  createdAt: number
  cleanupClaimedAt: number | null
}

export interface AttachmentRow {
  id: string
  tenantId: string
  ownerUserId: string
  backend: string
  filename: string
  declaredMime: string
  size: bigint
  integrityAlgorithm: string
  integrityValue: string
  etag: string | null
  storageKey: string
  status: AttachmentStatus
  boundAt: number | null
  createdAt: number
}

const reservationColumns = [
  'id',
  'tenantId',
  'ownerUserId',
  'attachmentId',
  'backend',
  'storageKey',
  'filename',
  'declaredMime',
  'reservedBytes',
  'status',
] as const

const reservationInstants = [
  epoch('grant_expires_at').as('grantExpiresMs'),
  epoch('cleanup_after').as('cleanupAfterMs'),
  epoch('created_at').as('createdMs'),
  epoch('cleanup_claimed_at').as('cleanupClaimedMs'),
]

const toReservation = (row: Record<string, unknown>): ReservationRow => ({
  id: String(row['id']),
  tenantId: String(row['tenantId']),
  ownerUserId: String(row['ownerUserId']),
  attachmentId: String(row['attachmentId']),
  backend: String(row['backend']),
  storageKey: String(row['storageKey']),
  filename: String(row['filename']),
  declaredMime: String(row['declaredMime']),
  reservedBytes: bytesOf(row['reservedBytes']),
  status: String(row['status']) as ReservationStatus,
  grantExpiresAt: msOf(row['grantExpiresMs']) ?? 0,
  cleanupAfter: msOf(row['cleanupAfterMs']) ?? 0,
  createdAt: msOf(row['createdMs']) ?? 0,
  cleanupClaimedAt: msOf(row['cleanupClaimedMs']),
})

const attachmentColumns = [
  'id',
  'tenantId',
  'ownerUserId',
  'backend',
  'filename',
  'declaredMime',
  'size',
  'integrityAlgorithm',
  'integrityValue',
  'etag',
  'storageKey',
  'status',
] as const

const attachmentInstants = [epoch('bound_at').as('boundMs'), epoch('created_at').as('createdMs')]

const toAttachment = (row: Record<string, unknown>): AttachmentRow => ({
  id: String(row['id']),
  tenantId: String(row['tenantId']),
  ownerUserId: String(row['ownerUserId']),
  backend: String(row['backend']),
  filename: String(row['filename']),
  declaredMime: String(row['declaredMime']),
  size: bytesOf(row['size']),
  integrityAlgorithm: String(row['integrityAlgorithm']),
  integrityValue: String(row['integrityValue']),
  etag: row['etag'] == null ? null : String(row['etag']),
  storageKey: String(row['storageKey']),
  status: String(row['status']) as AttachmentStatus,
  boundAt: msOf(row['boundMs']),
  createdAt: msOf(row['createdMs']) ?? 0,
})

/**
 * A lock key derived from a name, the same way in every process.
 *
 * Postgres advisory locks are numbers, and the thing being serialized is a
 * tenant or a person. `hashtext` would do it in the database, but it is
 * unspecified across major versions - two nodes on different servers would
 * take different locks and neither would be wrong. A digest computed here is
 * the same number everywhere.
 */
export const lockKey = (namespace: string, id: string): bigint => {
  const digest = createHash('sha256').update(`${namespace}:${id}`).digest()
  return BigInt.asIntN(64, digest.readBigUInt64BE(0))
}

/**
 * Holds a lock until the transaction ends, whichever way it ends.
 *
 * Transaction-scoped on purpose: there is no unlock call to forget, and a
 * fiber interrupted between admission and insert cannot leave a tenant's
 * uploads wedged behind a lock nobody holds.
 */
export const advisoryLock = (key: bigint) =>
  db.query((k) => sql`select pg_advisory_xact_lock(${key.toString()}::bigint)`.execute(k))

export interface OwnerUsage {
  /** upload tickets asked for inside the rate window */
  readonly recentPrepares: number
  /** tickets still outstanding, which is what a key hoarder accumulates */
  readonly activeReservations: number
  readonly reservedBytes: bigint
  readonly stagedBytes: bigint
  /** everything of this owner's that exists, in any state */
  readonly storedBytes: bigint
  /** the same for the whole tenant, plus what its members have reserved */
  readonly tenantCommittedBytes: bigint
}

/**
 * Everything admission has to weigh, in one round trip.
 *
 * Written as one statement because it is asked inside the advisory locks:
 * six queries would hold them six times as long, and they are the point at
 * which every upload in a tenant is serialized.
 */
export const usageOf = (input: { tenantId: string; ownerUserId: string; rateWindowFrom: number }) =>
  db
    .query((k) =>
      sql<{
        recent_prepares: string
        active_reservations: string
        reserved_bytes: string
        staged_bytes: string
        stored_bytes: string
        tenant_committed_bytes: string
      }>`
        select
          (select count(*) from storage_upload_reservations
             where tenant_id = ${input.tenantId} and owner_user_id = ${input.ownerUserId}
               and created_at >= ${at(input.rateWindowFrom)}) as recent_prepares,
          (select count(*) from storage_upload_reservations
             where tenant_id = ${input.tenantId} and owner_user_id = ${input.ownerUserId}
               and status = 'issued') as active_reservations,
          (select coalesce(sum(reserved_bytes), 0) from storage_upload_reservations
             where tenant_id = ${input.tenantId} and owner_user_id = ${input.ownerUserId}
               and status = 'issued') as reserved_bytes,
          (select coalesce(sum(size), 0) from storage_attachments
             where tenant_id = ${input.tenantId} and owner_user_id = ${input.ownerUserId}
               and status = 'staged') as staged_bytes,
          (select coalesce(sum(size), 0) from storage_attachments
             where tenant_id = ${input.tenantId} and owner_user_id = ${input.ownerUserId}) as stored_bytes,
          (select coalesce(sum(size), 0) from storage_attachments where tenant_id = ${input.tenantId})
            + (select coalesce(sum(reserved_bytes), 0) from storage_upload_reservations
                 where tenant_id = ${input.tenantId} and status = 'issued')
            as tenant_committed_bytes
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) => {
        const row = rows[0]!
        return {
          recentPrepares: Number(row.recent_prepares),
          activeReservations: Number(row.active_reservations),
          reservedBytes: bytesOf(row.reserved_bytes),
          stagedBytes: bytesOf(row.staged_bytes),
          storedBytes: bytesOf(row.stored_bytes),
          tenantCommittedBytes: bytesOf(row.tenant_committed_bytes),
        }
      }),
    )

/** the id the object key is built from, minted where every other id is */
export const nextAttachmentId = db
  .query((k) => sql<{ id: string }>`select uuidv7() as id`.execute(k))
  .pipe(Effect.map(({ rows }) => rows[0]!.id))

export const insertReservation = (input: {
  tenantId: string
  ownerUserId: string
  attachmentId: string
  backend: string
  storageKey: string
  filename: string
  declaredMime: string
  reservedBytes: bigint
  grantExpiresAt: number
  cleanupAfter: number
  now: number
}) =>
  db
    .query((k) =>
      k
        .insertInto('UploadReservation')
        .values({
          tenantId: input.tenantId,
          ownerUserId: input.ownerUserId,
          attachmentId: input.attachmentId,
          backend: input.backend,
          storageKey: input.storageKey,
          filename: input.filename,
          declaredMime: input.declaredMime,
          reservedBytes: input.reservedBytes,
          status: 'issued',
          grantExpiresAt: at(input.grantExpiresAt),
          cleanupAfter: at(input.cleanupAfter),
          createdAt: at(input.now),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => String((row as { id: unknown }).id)))

export const reservationOf = (input: { tenantId: string; ownerUserId: string; id: string }) =>
  db
    .query((k) =>
      k
        .selectFrom('UploadReservation')
        .select(reservationColumns)
        .select(reservationInstants)
        .where('id', '=', input.id)
        .where('tenantId', '=', input.tenantId)
        .where('ownerUserId', '=', input.ownerUserId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? toReservation(row as Record<string, unknown>) : null)))

/**
 * Takes the ticket, or does not.
 *
 * Conditional on the state it was read in, so two completes of the same upload
 * cannot both write an attachment: the loser's update matches no row and it
 * reads back what the winner wrote. The cleanup condition is here too - a
 * ticket a sweeper holds is on its way to being deleted, and turning it into
 * an attachment would race that delete.
 */
export const completeReservation = (input: { id: string; now: number }) =>
  db
    .query((k) =>
      k
        .updateTable('UploadReservation')
        .set({ status: 'completed', completedAt: at(input.now) })
        .where('id', '=', input.id)
        .where('status', '=', 'issued')
        // any claim at all, however old. A lease that has run out says another
        // sweeper may take the work over, not that the first one has stopped:
        // its delete may still be in flight, and an attachment built on an
        // object that is about to disappear is worse than asking for a retry.
        .where('cleanupClaimedAt', 'is', null)
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const failReservation = (input: { id: string; now: number }) =>
  db.query((k) =>
    k
      .updateTable('UploadReservation')
      .set({ status: 'failed', failedAt: at(input.now) })
      .where('id', '=', input.id)
      .where('status', '=', 'issued')
      .execute(),
  )

export const insertAttachment = (input: {
  id: string
  tenantId: string
  ownerUserId: string
  backend: string
  filename: string
  declaredMime: string
  size: bigint
  integrityAlgorithm: string
  integrityValue: string
  etag: string | null
  storageKey: string
  now: number
}) =>
  db.query((k) =>
    k
      .insertInto('Attachment')
      .values({
        id: input.id,
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        backend: input.backend,
        filename: input.filename,
        declaredMime: input.declaredMime,
        size: input.size,
        integrityAlgorithm: input.integrityAlgorithm,
        integrityValue: input.integrityValue,
        etag: input.etag,
        storageKey: input.storageKey,
        status: 'staged',
        createdAt: at(input.now),
      })
      .execute(),
  )

export const attachmentOf = (input: { tenantId: string; id: string }) =>
  db
    .query((k) =>
      k
        .selectFrom('Attachment')
        .select(attachmentColumns)
        .select(attachmentInstants)
        .where('id', '=', input.id)
        .where('tenantId', '=', input.tenantId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => (row ? toAttachment(row as Record<string, unknown>) : null)))

/**
 * staged to bound, if it is still staged and nobody is sweeping it.
 *
 * The whole of "this attachment has entered immutable history" is this one
 * conditional update; the caller runs it inside the transaction that writes
 * the revision, so an attachment is bound exactly when the thing referring to
 * it exists.
 */
export const bindAttachment = (input: {
  tenantId: string
  id: string
  ownerUserId: string
  now: number
}) =>
  db
    .query((k) =>
      k
        .updateTable('Attachment')
        .set({ status: 'bound', boundAt: at(input.now) })
        .where('id', '=', input.id)
        .where('tenantId', '=', input.tenantId)
        .where('ownerUserId', '=', input.ownerUserId)
        .where('status', '=', 'staged')
        // as above: a claimed row is on its way out, and binding it would race
        // a delete this transaction cannot see
        .where('cleanupClaimedAt', 'is', null)
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/**
 * Takes an attachment out of circulation.
 *
 * Only a bound one, because retiring is a statement about history: it says
 * "this was referred to, and nothing new may refer to it again". A staged
 * attachment has no history to speak of - nothing refers to it - so retiring
 * one would mean keeping a row and its bytes forever to record that somebody
 * uploaded a file and never used it. Letting the staged sweep have it is both
 * cheaper and truer.
 */
export const retireAttachment = (input: { tenantId: string; id: string }) =>
  db
    .query((k) =>
      k
        .updateTable('Attachment')
        .set({ status: 'retired' })
        .where('id', '=', input.id)
        .where('tenantId', '=', input.tenantId)
        .where('status', '=', 'bound')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export interface ClaimedReservation {
  readonly id: string
  readonly backend: string
  readonly storageKey: string
}

/**
 * Takes ownership of some abandoned tickets, briefly.
 *
 * `skip locked` because several nodes run this: two sweepers should divide the
 * work rather than queue behind each other. The claim is a timestamp, not a
 * state - a node that dies holding one blocks the object for a lease and no
 * longer.
 */
export const claimAbandonedReservations = (input: {
  now: number
  claimCutoff: number
  limit: number
}) =>
  db
    .query((k) =>
      sql<{ id: string; backend: string; storage_key: string }>`
        update storage_upload_reservations set cleanup_claimed_at = ${at(input.now)}
        where id in (
          select id from storage_upload_reservations
          where status = 'issued'
            and cleanup_after <= ${at(input.now)}
            and (cleanup_claimed_at is null or cleanup_claimed_at < ${at(input.claimCutoff)})
          order by cleanup_after
          limit ${input.limit}
          for update skip locked
        )
        returning id, backend, storage_key
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): ClaimedReservation => ({
          id: String(row.id),
          backend: String(row.backend),
          storageKey: String(row.storage_key),
        })),
      ),
    )

/** the object is gone; the ticket stops holding quota */
export const expireReservation = (input: { id: string; now: number }) =>
  db
    .query((k) =>
      k
        .updateTable('UploadReservation')
        .set({ status: 'expired', expiredAt: at(input.now), cleanupClaimedAt: null })
        .where('id', '=', input.id)
        .where('status', '=', 'issued')
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export interface ClaimedAttachment {
  readonly id: string
  readonly backend: string
  readonly storageKey: string
}

/**
 * Takes ownership of attachments nobody kept.
 *
 * "Nobody kept" is `staged` past its ttl, and that is a complete statement of
 * it: binding happens in the same transaction as the thing that refers to the
 * attachment, so a staged row is one no immutable record mentions. Storage
 * never has to ask another plugin whether its own row is still needed.
 */
export const claimStagedAttachments = (input: {
  now: number
  stagedBefore: number
  claimCutoff: number
  limit: number
}) =>
  db
    .query((k) =>
      sql<{ id: string; backend: string; storage_key: string }>`
        update storage_attachments set cleanup_claimed_at = ${at(input.now)}
        where id in (
          select id from storage_attachments
          where status = 'staged'
            and created_at < ${at(input.stagedBefore)}
            and (cleanup_claimed_at is null or cleanup_claimed_at < ${at(input.claimCutoff)})
          order by created_at
          limit ${input.limit}
          for update skip locked
        )
        returning id, backend, storage_key
      `.execute(k),
    )
    .pipe(
      Effect.map(({ rows }) =>
        rows.map((row): ClaimedAttachment => ({
          id: String(row.id),
          backend: String(row.backend),
          storageKey: String(row.storage_key),
        })),
      ),
    )

/**
 * Removes the row whose object has just been deleted.
 *
 * Conditional on still being staged and still being ours: an attachment that
 * got bound while the delete was in flight has already lost its object, and
 * deleting the row as well would lose the only record that it ever existed.
 */
export const deleteStagedAttachment = (input: { id: string; claimedAt: number }) =>
  db
    .query((k) =>
      k
        .deleteFrom('Attachment')
        .where('id', '=', input.id)
        .where('status', '=', 'staged')
        .where('cleanupClaimedAt', '=', at(input.claimedAt))
        .returning(['id'])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))
