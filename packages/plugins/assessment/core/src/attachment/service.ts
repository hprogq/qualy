import { Effect } from 'effect'
import type { Orm } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import type { AttachmentMeta, AttachmentOpen, Storage } from '@qualy/plugin-storage/server'
import { AttachmentUnavailable } from '../server/errors.ts'
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

export interface AttachmentMethods {
  readonly openAttachment: (
    tenantId: string,
    attachmentId: string,
    as: Principal,
  ) => Effect.Effect<AttachmentOpen, AttachmentUnavailable>
}

export interface AttachmentDeps {
  readonly withDb: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>
  readonly storage: Storage['Service']
  readonly rosterReach: (as: Principal, tenantId: string, batchId: string) => Effect.Effect<boolean>
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

  return { openAttachment }
}
