import { Effect } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AttachmentMeta, AttachmentOpen, Storage } from '@qualy/plugin-storage/server'
import type { UploadTicket } from '@qualy/plugin-storage/upload'
import { AttachmentUnavailable, EntryActionRefused, ItemNotFound } from '../server/errors.ts'
import { itemOf } from '../item/db.ts'
import { userMayReview } from '../review/db.ts'
import { citingEntries, citingInstances } from './db.ts'

// The assessment attachment authorizer (§3.5): storage knows objects and
// backends, this module knows why a person may read a business material.
// Storage.open runs the decision it is handed and learns nothing from it.
//
// A file belongs to a story, and its readers are the story's people: the
// uploader while it is still staged, the subject whose filings cite it -
// membership is history, an excluded member keeps reading what they filed -
// the staff whose administrative reach covers a citing round, and whoever
// the review predicate admits to a round that judged it. A retired
// attachment answers the same question the same way: retirement stops new
// citations, never the reading of history.

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
  readonly status: string
}

export interface AttachmentDescriptor extends AttachmentMetaView {
  readonly delivery:
    | { readonly kind: 'redirect'; readonly url: string; readonly expiresInSeconds: number }
    | { readonly kind: 'content' }
}

export interface AttachmentMethods {
  readonly openAttachment: (
    tenantId: string,
    attachmentId: string,
    as: Principal,
  ) => Effect.Effect<AttachmentOpen, AttachmentUnavailable>
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
  readonly describeAttachment: (
    tenantId: string,
    attachmentId: string,
    as: Principal,
  ) => Effect.Effect<AttachmentDescriptor, AttachmentUnavailable>
}

export interface AttachmentDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  readonly storage: Storage['Service']
  readonly rosterReach: (as: Principal, tenantId: string, batchId: string) => Effect.Effect<boolean>
  /** may this person put material into this batch at all: an active member, or staff who records */
  readonly uploadStanding: (
    tenantId: string,
    batchId: string,
    as: Principal,
  ) => Effect.Effect<boolean>
}

export const makeAttachmentMethods = (deps: AttachmentDeps): AttachmentMethods => {
  const { withDb } = deps

  const authorize = (tenantId: string, meta: AttachmentMeta, as: Principal) =>
    Effect.gen(function* () {
      // one's own upload, before anything cites it
      if (meta.status === 'staged' && meta.ownerUserId === as.userId) return
      const entries = yield* withDb(citingEntries(tenantId, meta.id))
      if (entries.some((entry) => entry.subjectUserId === as.userId)) return
      for (const batchId of new Set(entries.map((entry) => entry.batchId))) {
        if (yield* deps.rosterReach(as, tenantId, batchId)) return
      }
      const instances = yield* withDb(citingInstances(tenantId, meta.id))
      for (const instance of instances) {
        const judge = yield* withDb(
          userMayReview({
            tenantId,
            userId: as.userId,
            instance: {
              batchId: instance.batchId,
              currentNodeId: instance.currentNodeId,
              currentRoleIds: instance.currentRoleIds,
              subjectUserId: instance.subjectUserId,
              actorId: instance.actorId,
            },
          }),
        )
        if (judge) return
      }
      return yield* new AttachmentUnavailable()
    })

  const openAttachment: AttachmentMethods['openAttachment'] = Effect.fn(
    'Assessment.openAttachment',
  )(function* (tenantId, attachmentId, as) {
    return yield* deps.storage
      .open({ tenantId, attachmentId }, (meta) => authorize(tenantId, meta, as))
      .pipe(
        // absent, refused and backend trouble all read the same from
        // outside: nothing here for this reader
        Effect.catchTag('STORAGE_ATTACHMENT_NOT_FOUND', () => new AttachmentUnavailable()),
        Effect.catchTag('STORAGE_BACKEND_UNAVAILABLE', (error) => Effect.die(error)),
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
  })

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
        Effect.catchTag('STORAGE_UPLOAD_REFUSED', (refused) => refuse(refused.reason)),
        Effect.catchTag('STORAGE_BACKEND_UNAVAILABLE', (error) => Effect.die(error)),
      )
  })

  const completeAttachmentUpload: AttachmentMethods['completeAttachmentUpload'] = Effect.fn(
    'Assessment.completeAttachmentUpload',
  )(function* (tenantId, reservationId, as) {
    return yield* deps.storage
      .completeUpload({ tenantId, ownerUserId: as.userId, reservationId })
      .pipe(
        Effect.map(metaView),
        Effect.catchTag('STORAGE_RESERVATION_NOT_FOUND', () => new AttachmentUnavailable()),
        Effect.catchTag('STORAGE_RESERVATION_INVALID', (refused) => refuse(refused.reason)),
        Effect.catchTag('STORAGE_BACKEND_UNAVAILABLE', (error) => Effect.die(error)),
      )
  })

  const describeAttachment: AttachmentMethods['describeAttachment'] = Effect.fn(
    'Assessment.describeAttachment',
  )(function* (tenantId, attachmentId, as) {
    const opened = yield* openAttachment(tenantId, attachmentId, as)
    if (opened.target.kind === 'redirect') {
      return {
        ...metaView(opened.meta),
        delivery: {
          kind: 'redirect' as const,
          url: opened.target.url,
          expiresInSeconds: opened.target.expiresInSeconds,
        },
      }
    }
    // describing must not spend the stream: a disk opens a descriptor
    // eagerly, and an unread one is a leak
    ;(opened.target.body as { destroy?: () => void }).destroy?.()
    return { ...metaView(opened.meta), delivery: { kind: 'content' as const } }
  })

  return { openAttachment, prepareAttachmentUpload, completeAttachmentUpload, describeAttachment }
}
