import { Effect } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AttachmentMeta, Storage } from '@qualy/plugin-storage/server'
import type { UploadTicket } from '@qualy/plugin-storage/upload'
import { AttachmentUnavailable, EntryActionRefused, ItemNotFound } from '../errors.ts'
import { itemOf } from '../item/db.ts'
export interface AttachmentUploadInput {
  readonly batchId: string
  readonly itemId: string
  readonly filename: string
  readonly declaredMime: string
  readonly size: bigint
}

export interface AttachmentMetaView {
  readonly id: string
  readonly filename: string
  readonly declaredMime: string
  readonly size: string
  readonly status: AttachmentMeta['status']
}

export interface AttachmentMethods {
  readonly prepareAttachmentUpload: (
    tenantId: string,
    input: AttachmentUploadInput,
    as: Principal,
  ) => Effect.Effect<UploadTicket, ItemNotFound | EntryActionRefused>
  readonly completeAttachmentUpload: (
    tenantId: string,
    reservationId: string,
    as: Principal,
  ) => Effect.Effect<AttachmentMetaView, AttachmentUnavailable | EntryActionRefused>
}

export interface AttachmentDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  readonly storage: Storage['Service']
  /** may this person put material into this batch at all: an active member, or staff who records */
  readonly uploadStanding: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<boolean>
}

export const makeAttachmentMethods = (deps: AttachmentDeps): AttachmentMethods => {
  const { withDb } = deps

  const metaView = (meta: AttachmentMeta): AttachmentMetaView => ({
    id: meta.id,
    filename: meta.filename,
    declaredMime: meta.declaredMime,
    size: meta.size.toString(),
    status: meta.status,
  })

  const refuse = (reason: string) => new EntryActionRefused({ action: 'upload', reason })

  const prepareAttachmentUpload: AttachmentMethods['prepareAttachmentUpload'] = Effect.fn(
    'Assessment.prepareAttachmentUpload',
  )(function* (tenantId, input, as) {
    // the ticket names the question it is for, so admission is the
    // question's: a live item in a round this person may put material into.
    // What the file may back is still decided at bind, where the field's
    // own rules hold every citation.
    const item = yield* withDb(itemOf(tenantId, input.itemId)).pipe(
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )
    if (item === null || item.batchId !== input.batchId) return yield* new ItemNotFound()
    if (item.status !== 'active') return yield* refuse('item-not-active')
    if (!(yield* deps.uploadStanding(tenantId, input.batchId, as))) {
      return yield* refuse('not-participant')
    }
    return yield* deps.storage
      .prepareUpload({
        tenantId,
        ownerUserId: as.userId,
        filename: input.filename,
        declaredMime: input.declaredMime,
        size: input.size,
      })
      .pipe(
        Effect.catchTags({
          STORAGE_UPLOAD_REFUSED: (refused) => refuse(refused.reason),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
  })

  const completeAttachmentUpload: AttachmentMethods['completeAttachmentUpload'] = Effect.fn(
    'Assessment.completeAttachmentUpload',
  )(function* (tenantId, reservationId, as) {
    return yield* deps.storage
      .completeUpload({ tenantId, ownerUserId: as.userId, reservationId })
      .pipe(
        Effect.map(metaView),
        Effect.catchTags({
          STORAGE_RESERVATION_NOT_FOUND: () => new AttachmentUnavailable(),
          STORAGE_RESERVATION_INVALID: (refused) => refuse(refused.reason),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
  })

  return {
    prepareAttachmentUpload,
    completeAttachmentUpload,
  }
}
