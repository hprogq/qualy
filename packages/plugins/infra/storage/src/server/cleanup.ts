import { Clock, Context, Effect, Layer, Schedule } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { StorageConfig } from './config.ts'
import { StorageBackends } from './registry.ts'
import {
  claimAbandonedReservations,
  claimStagedAttachments,
  deleteStagedAttachment,
  expireReservation,
} from './db.ts'

// The two things nobody comes back for: an upload ticket that was never used,
// and an attachment nobody saved.
//
// Both are deleted in the same three steps, and the order is the whole design:
// claim the row in a short transaction, commit, delete the object over the
// network, then finalize in another short transaction. Holding a row lock
// across a call to an object store means one slow bucket blocks every writer
// that touches the same table, and there is no timeout that makes that safe.
//
// Losing a step is survivable in one direction only. A claimed row whose
// delete failed keeps its quota and is retried on the next pass; a row deleted
// before its object would leave bytes nothing can name.

/** how many rows one pass takes, so a large backlog drains over several */
const BATCH = 50

/**
 * How long one sweeper's claim keeps other sweepers off a row.
 *
 * Only other sweepers. Business transitions refuse a claimed row whatever its
 * age, because an expired lease says nothing about whether the worker that
 * took it has stopped - its delete may still be in flight. The lease exists so
 * that a node which dies mid-sweep does not strand the row forever.
 */
export const CLEANUP_LEASE_MS = 5 * 60 * 1000

export interface SweepReport {
  readonly claimed: number
  readonly removed: number
}

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    /** tickets past their grace period, whose objects may or may not exist */
    readonly sweepAbandonedUploads: Effect.Effect<SweepReport>
    /** attachments that never entered anyone's history */
    readonly sweepStagedAttachments: Effect.Effect<SweepReport>
  }
>()('@qualy/plugin-storage/StorageCleanup') {}

const make = () =>
  Effect.gen(function* () {
    const config = yield* StorageConfig
    const backends = yield* StorageBackends
    // bound here for the same reason the service binds it: the scheduler runs
    // this on a bare fiber that holds nothing
    const withDb = yield* withDatabase

    /**
     * Deletes the object, tolerating the one failure that is not a failure.
     *
     * An abandoned ticket usually has no object at all - that is why it was
     * abandoned - and the backend contract makes deleting what is not there
     * a success, so this does not have to distinguish the two.
     */
    const removeObject = (code: string, key: string) =>
      backends.resolve(code).pipe(
        Effect.flatMap((backend) => backend.delete(key)),
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning(`could not delete ${key}; retrying on the next sweep`, cause).pipe(
            Effect.as(false),
          ),
        ),
      )

    const sweepAbandonedUploads = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const claimed = yield* transaction(
        claimAbandonedReservations({ now, claimCutoff: now - CLEANUP_LEASE_MS, limit: BATCH }),
      )
      let removed = 0
      for (const row of claimed) {
        if (!(yield* removeObject(row.backend, row.storageKey))) continue
        // the quota is released here and nowhere else: while the object might
        // still exist, the reservation keeps paying for it
        if (yield* transaction(expireReservation({ id: row.id, now }))) removed += 1
      }
      return { claimed: claimed.length, removed }
    }).pipe(
      Effect.catchTag('QueryFailed', (error) =>
        Effect.logError('abandoned upload sweep failed', error).pipe(
          Effect.as({ claimed: 0, removed: 0 }),
        ),
      ),
      Effect.withSpan('Storage.sweepAbandonedUploads'),
    )

    const sweepStagedAttachments = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const stagedBefore = now - config.limits.stagedTtlHours * 60 * 60 * 1000
      const claimed = yield* transaction(
        claimStagedAttachments({
          now,
          stagedBefore,
          claimCutoff: now - CLEANUP_LEASE_MS,
          limit: BATCH,
        }),
      )
      let removed = 0
      for (const row of claimed) {
        if (!(yield* removeObject(row.backend, row.storageKey))) continue
        // conditional on the claim still being ours and the row still staged:
        // an attachment that got bound in between has an owner now
        if (yield* transaction(deleteStagedAttachment({ id: row.id, claimedAt: now }))) removed += 1
      }
      return { claimed: claimed.length, removed }
    }).pipe(
      Effect.catchTag('QueryFailed', (error) =>
        Effect.logError('staged attachment sweep failed', error).pipe(
          Effect.as({ claimed: 0, removed: 0 }),
        ),
      ),
      Effect.withSpan('Storage.sweepStagedAttachments'),
    )

    return StorageCleanup.of({
      sweepAbandonedUploads: withDb(sweepAbandonedUploads),
      sweepStagedAttachments: withDb(sweepStagedAttachments),
    })
  })

export const cleanupLayer: Layer.Layer<
  StorageCleanup,
  never,
  Orm | StorageConfig | StorageBackends
> = Layer.effect(StorageCleanup, make())

/** how often the sweeps run; nothing here is urgent to the minute */
export const SWEEP_INTERVAL = '5 minutes'

const sweep = Effect.gen(function* () {
  const cleanup = yield* StorageCleanup
  const uploads = yield* cleanup.sweepAbandonedUploads
  const staged = yield* cleanup.sweepStagedAttachments
  if (uploads.removed > 0 || staged.removed > 0) {
    yield* Effect.logInfo(
      `swept ${uploads.removed} abandoned upload(s) and ${staged.removed} unsaved attachment(s)`,
    )
  }
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logError('storage sweep failed; retrying on the next tick', cause),
  ),
)

/**
 * The loop, forked at the assembly barrier into this layer's scope.
 *
 * Several nodes may run it. The claim is what makes that safe - `skip locked`
 * divides the work and the lease bounds what a node that dies takes with it -
 * so no deployment has to designate one process for this.
 */
export const schedulerLayer: Layer.Layer<never, never, StorageCleanup | Assembled> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const assembled = yield* Assembled
      const loop = Effect.repeat(sweep, Schedule.fixed(SWEEP_INTERVAL)).pipe(
        Effect.provideService(StorageCleanup, yield* StorageCleanup),
      )
      yield* assembled.register({
        name: 'storage/cleanup-scheduler',
        run: Effect.gen(function* () {
          yield* Effect.forkIn(loop, scope)
          yield* Effect.logDebug(`storage sweeping every ${SWEEP_INTERVAL}`)
        }),
      })
    }),
  )
