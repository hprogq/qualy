import { Clock, Context, Effect, Layer } from 'effect'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import {
  AttachmentInvalid,
  AttachmentNotFound,
  BackendUnavailable,
  ReservationInvalid,
  ReservationNotFound,
  UploadRefused,
} from '../errors.ts'
import type { UploadTicket } from '../upload.ts'
import { objectKeyOf, type BackendOpen } from './backend.ts'
import { StorageConfig } from './config.ts'
import {
  attachmentOf,
  bindAttachment,
  completeReservation,
  failReservation,
  insertAttachment,
  insertReservation,
  nextAttachmentId,
  reservationOf,
  retireAttachment,
  type AttachmentRow,
} from './db.ts'
import { admit, tenantPressure } from './quota.ts'
import { StorageBackends } from './registry.ts'

// The service business plugins call, and the only place the upload story is
// told end to end.
//
// The story has one rule behind it: nothing the uploader says is evidence.
// The browser chooses no key, declares no size that is believed, and reports
// no checksum that is recorded. It gets a ticket, writes one object, and says
// "look now" - and every fact about the attachment comes from asking the
// backend about the object that is actually there.
//
// Which backend is a question asked twice, differently. New uploads go to the
// one this deployment writes to; an existing attachment goes to the one that
// wrote it, whatever the deployment writes to today.

export interface AttachmentMeta {
  readonly id: string
  readonly tenantId: string
  readonly ownerUserId: string
  readonly backend: string
  readonly filename: string
  readonly declaredMime: string
  readonly size: bigint
  readonly integrityAlgorithm: string
  readonly integrityValue: string
  readonly status: 'staged' | 'bound' | 'retired'
  readonly createdAt: number
  readonly boundAt: number | null
}

const metaOf = (row: AttachmentRow): AttachmentMeta => ({
  id: row.id,
  tenantId: row.tenantId,
  ownerUserId: row.ownerUserId,
  backend: row.backend,
  filename: row.filename,
  declaredMime: row.declaredMime,
  size: row.size,
  integrityAlgorithm: row.integrityAlgorithm,
  integrityValue: row.integrityValue,
  status: row.status,
  createdAt: row.createdAt,
  boundAt: row.boundAt,
})

export interface PrepareUploadInput {
  readonly tenantId: string
  readonly ownerUserId: string
  readonly filename: string
  readonly declaredMime: string
  /**
   * How large the upload will be.
   *
   * Charged to the owner's allowance now and enforced by the store itself
   * later, so a client that understates it has only made its own upload fail.
   */
  readonly size: bigint
  /** a business rule stricter than the deployment's, if the caller has one */
  readonly maxFileBytes?: bigint | undefined
}

export type PrepareUploadError = UploadRefused | BackendUnavailable
export type CompleteUploadError = ReservationNotFound | ReservationInvalid | BackendUnavailable
export type BindError = AttachmentNotFound | AttachmentInvalid

export interface AttachmentOpen {
  readonly meta: AttachmentMeta
  readonly target: BackendOpen
}

export class Storage extends Context.Service<
  Storage,
  {
    /** reserves quota and hands out one limited upload credential */
    readonly prepareUpload: (
      input: PrepareUploadInput,
    ) => Effect.Effect<UploadTicket, PrepareUploadError>
    /**
     * Turns a ticket the backend can vouch for into a staged attachment.
     *
     * Idempotent: a client that retries because it never saw the response
     * gets the attachment the first call created.
     */
    readonly completeUpload: (input: {
      readonly tenantId: string
      readonly ownerUserId: string
      readonly reservationId: string
    }) => Effect.Effect<AttachmentMeta, CompleteUploadError>
    readonly metadata: (input: {
      readonly tenantId: string
      readonly attachmentId: string
    }) => Effect.Effect<AttachmentMeta, AttachmentNotFound>
    /**
     * Records that an attachment has entered immutable history.
     *
     * Meant to be called inside the transaction that writes whatever refers
     * to it: bound and referenced then become the same event, and nothing can
     * sweep an attachment a record already mentions.
     */
    readonly bind: (input: {
      readonly tenantId: string
      readonly attachmentId: string
      readonly ownerUserId: string
    }) => Effect.Effect<AttachmentMeta, BindError>
    /**
     * A short-lived way to read the bytes, once the caller has decided the
     * reader may.
     *
     * The decision is the caller's whole business: storage runs the effect it
     * is handed and learns nothing from it, which is what keeps a plugin that
     * knows about buckets from also knowing about students.
     */
    readonly open: <E, R>(
      input: { readonly tenantId: string; readonly attachmentId: string },
      authorize: (meta: AttachmentMeta) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<AttachmentOpen, AttachmentNotFound | BackendUnavailable | E, R>
    /**
     * Takes a bound attachment out of circulation, without deleting anything.
     *
     * Nothing new may refer to it; everything that already does still reads.
     */
    readonly retire: (input: {
      readonly tenantId: string
      readonly attachmentId: string
    }) => Effect.Effect<void, AttachmentNotFound | AttachmentInvalid>
  }
>()('@qualy/plugin-storage/Storage') {}

const make = () =>
  Effect.gen(function* () {
    const config = yield* StorageConfig
    const backends = yield* StorageBackends
    const limits = config.limits
    // the database is bound here rather than demanded by every method: what
    // this service publishes is "attachments", and a caller should not have to
    // hold a connection to ask for one
    const withDb = yield* withDatabase

    const prepareUpload = (input: PrepareUploadInput) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const ceiling =
          input.maxFileBytes === undefined
            ? limits.maxFileBytes
            : input.maxFileBytes < limits.maxFileBytes
              ? input.maxFileBytes
              : limits.maxFileBytes
        if (input.size <= 0n || input.size > ceiling) {
          return yield* Effect.fail(new UploadRefused({ reason: 'file-too-large' }))
        }

        const backend = yield* backends.forWrite
        const grantExpiresAt = now + limits.uploadGrantTtlMinutes * 60 * 1000
        const cleanupAfter = grantExpiresAt + limits.uploadCleanupGraceMinutes * 60 * 1000

        // admission and the insert are one transaction because the locks are
        // what make the reading true, and they end when it commits
        const reserved = yield* transaction(
          Effect.gen(function* () {
            const usage = yield* admit(
              {
                tenantId: input.tenantId,
                ownerUserId: input.ownerUserId,
                bytes: input.size,
                now,
              },
              limits,
            )
            const attachmentId = yield* nextAttachmentId
            const storageKey = objectKeyOf(input.tenantId, attachmentId)
            const reservationId = yield* insertReservation({
              tenantId: input.tenantId,
              ownerUserId: input.ownerUserId,
              attachmentId,
              backend: backend.code,
              storageKey,
              filename: input.filename,
              declaredMime: input.declaredMime,
              reservedBytes: input.size,
              grantExpiresAt,
              cleanupAfter,
              now,
            })
            return { attachmentId, storageKey, reservationId, usage }
          }),
        )

        const pressure = tenantPressure(reserved.usage.tenantCommittedBytes + input.size, limits)
        if (pressure !== null) {
          yield* Effect.logWarning(
            `tenant ${input.tenantId} storage usage is ${pressure}: ${
              reserved.usage.tenantCommittedBytes + input.size
            } of ${limits.tenantHardBytes} bytes committed`,
          )
        }

        // the credential is minted after the ticket is committed, never while
        // holding the tenant's quota lock: signing one is a network call for
        // some providers, and every upload in the tenant would queue behind it
        return yield* backend
          .prepareUpload({
            tenantId: input.tenantId,
            ownerUserId: input.ownerUserId,
            attachmentId: reserved.attachmentId,
            reservationId: reserved.reservationId,
            key: reserved.storageKey,
            maxBytes: input.size,
            grantExpiresAt: new Date(grantExpiresAt),
          })
          .pipe(
            Effect.map((grant): UploadTicket => ({
              reservationId: reserved.reservationId,
              attachmentId: reserved.attachmentId,
              grant,
              expiresAt: grantExpiresAt,
            })),
            // a ticket whose credential never existed holds quota for nothing,
            // and no object can ever appear under its key
            Effect.tapError(() =>
              transaction(failReservation({ id: reserved.reservationId, now })).pipe(
                Effect.catchCause((cause) =>
                  Effect.logError('could not release a reservation whose grant failed', cause),
                ),
              ),
            ),
          )
      }).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        Effect.withSpan('Storage.prepareUpload'),
      )

    const completeUpload = (input: {
      tenantId: string
      ownerUserId: string
      reservationId: string
    }) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const reservation = yield* reservationOf({
          tenantId: input.tenantId,
          ownerUserId: input.ownerUserId,
          id: input.reservationId,
        })
        if (reservation === null) return yield* Effect.fail(new ReservationNotFound())
        if (reservation.status === 'completed') {
          const existing = yield* attachmentOf({
            tenantId: input.tenantId,
            id: reservation.attachmentId,
          })
          // the ticket says the attachment was written; if it is gone, a
          // sweeper removed it, and the truthful answer is that this upload
          // no longer exists rather than a row invented to match the ticket
          if (existing === null) return yield* Effect.fail(new ReservationNotFound())
          return metaOf(existing)
        }
        if (reservation.status === 'expired') {
          return yield* Effect.fail(new ReservationInvalid({ reason: 'expired' }))
        }
        if (reservation.status === 'failed') {
          return yield* Effect.fail(new ReservationInvalid({ reason: 'failed' }))
        }
        // any claim, of any age: see completeReservation for why an expired
        // lease is not the same as a finished sweeper
        if (reservation.cleanupClaimedAt !== null) {
          return yield* Effect.fail(new ReservationInvalid({ reason: 'being-cleaned-up' }))
        }

        const backend = yield* backends.resolve(reservation.backend)
        // the only source of truth in the whole flow
        const stat = yield* backend.stat(reservation.storageKey)
        if (stat === null) {
          // the ticket survives: the ordinary cause is a client that reported
          // success early, and it may upload again until the grant expires
          return yield* Effect.fail(new ReservationInvalid({ reason: 'not-uploaded' }))
        }
        if (stat.size > reservation.reservedBytes) {
          // The ticket stays issued on purpose. Marking it failed here would
          // hand the owner their quota back while the oversized object is
          // still in the store, and nothing would ever come for it: the sweep
          // looks for issued tickets. Left as it is, the ordinary abandoned
          // sweep deletes the object after the grace period and releases the
          // quota then - after the bytes are actually gone.
          yield* Effect.logWarning(
            `upload ${reservation.id} arrived at ${stat.size} bytes against a reservation of ${reservation.reservedBytes}; leaving it to the sweep`,
          )
          return yield* Effect.fail(new ReservationInvalid({ reason: 'oversized' }))
        }

        const written = yield* transaction(
          Effect.gen(function* () {
            const taken = yield* completeReservation({ id: reservation.id, now })
            if (!taken) return null
            yield* insertAttachment({
              id: reservation.attachmentId,
              tenantId: reservation.tenantId,
              ownerUserId: reservation.ownerUserId,
              backend: reservation.backend,
              filename: reservation.filename,
              declaredMime: reservation.declaredMime,
              size: stat.size,
              integrityAlgorithm: stat.integrityAlgorithm,
              integrityValue: stat.integrityValue,
              etag: stat.etag ?? null,
              storageKey: reservation.storageKey,
              now,
            })
            return yield* attachmentOf({
              tenantId: reservation.tenantId,
              id: reservation.attachmentId,
            })
          }),
        )
        if (written !== null) return metaOf(written)

        // somebody else took the ticket between the read and the update, or a
        // sweeper claimed it; either way the answer is whatever is true now
        const settled = yield* attachmentOf({
          tenantId: input.tenantId,
          id: reservation.attachmentId,
        })
        if (settled !== null) return metaOf(settled)
        return yield* Effect.fail(new ReservationInvalid({ reason: 'being-cleaned-up' }))
      }).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        Effect.withSpan('Storage.completeUpload'),
      )

    const metadata = (input: { tenantId: string; attachmentId: string }) =>
      attachmentOf({ tenantId: input.tenantId, id: input.attachmentId }).pipe(
        Effect.flatMap((row) =>
          row === null ? Effect.fail(new AttachmentNotFound()) : Effect.succeed(metaOf(row)),
        ),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        Effect.withSpan('Storage.metadata'),
      )

    const bind = (input: { tenantId: string; attachmentId: string; ownerUserId: string }) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const bound = yield* bindAttachment({
          tenantId: input.tenantId,
          id: input.attachmentId,
          ownerUserId: input.ownerUserId,
          now,
        })
        const row = yield* attachmentOf({ tenantId: input.tenantId, id: input.attachmentId })
        if (row === null) return yield* Effect.fail(new AttachmentNotFound())
        // Ownership first, before the idempotent answer. Asked in the other
        // order, "it is already bound" comes back as success to anybody at
        // all - which is harmless while nothing consults this, and a hole the
        // moment a caller treats a successful bind as proof the file was
        // theirs to use.
        if (row.ownerUserId !== input.ownerUserId) {
          return yield* Effect.fail(new AttachmentInvalid({ reason: 'not-owner' }))
        }
        if (bound) return metaOf(row)
        // it did not move, so say which of the three reasons it was
        if (row.status === 'bound') return metaOf(row)
        if (row.status === 'retired') {
          return yield* Effect.fail(new AttachmentInvalid({ reason: 'retired' }))
        }
        return yield* Effect.fail(new AttachmentInvalid({ reason: 'being-cleaned-up' }))
      }).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        Effect.withSpan('Storage.bind'),
      )

    const open = <E, R>(
      input: { tenantId: string; attachmentId: string },
      authorize: (meta: AttachmentMeta) => Effect.Effect<void, E, R>,
    ) =>
      Effect.gen(function* () {
        const row = yield* attachmentOf({ tenantId: input.tenantId, id: input.attachmentId })
        if (row === null) return yield* Effect.fail(new AttachmentNotFound())
        const meta = metaOf(row)
        yield* authorize(meta)
        // the backend that wrote it, not the one this deployment writes to
        const backend = yield* backends.resolve(row.backend)
        const target = yield* backend.open(row.storageKey, {
          filename: row.filename,
          mime: row.declaredMime,
        })
        return { meta, target }
      }).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        Effect.withSpan('Storage.open'),
      )

    const retire = (input: { tenantId: string; attachmentId: string }) =>
      Effect.gen(function* () {
        const moved = yield* retireAttachment({
          tenantId: input.tenantId,
          id: input.attachmentId,
        })
        if (moved) return
        const row = yield* attachmentOf({ tenantId: input.tenantId, id: input.attachmentId })
        if (row === null) return yield* Effect.fail(new AttachmentNotFound())
        // already retired is the outcome that was asked for
        if (row.status === 'retired') return
        // a staged attachment has no history to take out of circulation; what
        // it has is a sweep waiting for it
        return yield* Effect.fail(new AttachmentInvalid({ reason: 'not-bound' }))
      }).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
        Effect.withSpan('Storage.retire'),
      )

    return Storage.of({
      prepareUpload: (input) => withDb(prepareUpload(input)),
      completeUpload: (input) => withDb(completeUpload(input)),
      metadata: (input) => withDb(metadata(input)),
      bind: (input) => withDb(bind(input)),
      open: (input, authorize) => withDb(open(input, authorize)),
      retire: (input) => withDb(retire(input)).pipe(Effect.asVoid),
    })
  })

export const serviceLayer: Layer.Layer<Storage, never, Orm | StorageConfig | StorageBackends> =
  Layer.effect(Storage, make())
