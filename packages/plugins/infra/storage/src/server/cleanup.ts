import { Clock, Context, Effect, Layer, Schedule } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { StorageConfig } from './config.ts'
import { StorageBackends } from './registry.ts'
import { measured } from './metrics.ts'
import type { RevisionEntry } from './backend.ts'
import {
  claimAbandonedReservations,
  claimStagedAttachments,
  deleteStagedAttachment,
  expireReservation,
  factsForKeys,
  type KeyFacts,
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

/**
 * How old a revision at a key nobody issued has to be before it is removed.
 *
 * A key is issued before anything is written to it, so an unknown key is
 * nearly always left over from a sweep that died between its two halves. A
 * day of patience costs nothing and keeps this away from anything a test run
 * or a second process is doing to the same bucket right now.
 */
export const UNKNOWN_KEY_GRACE_MS = 24 * 60 * 60 * 1000

/** how many revisions one reconciliation pass removes at most, so a large backlog drains over several */
const RECONCILE_LIMIT = 1000

/** the part of a store's key space attachments live in */
const ATTACHMENT_PREFIX = 'attachments/'

export type RevisionVerdict = 'keep' | 'remove'

const sameRevision = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === (b ?? null)

/**
 * Whether one revision or marker in a store that keeps revisions stays.
 *
 * Kept: anything at a key whose ticket can still be written with - an upload
 * may be arriving - and the one revision an attachment completed with.
 * Removed: every other revision and marker at a key whose writes are over,
 * and anything at a key no ticket ever named once it is a day old.
 *
 * `frozenSeen` is whether the store holds the attachment's own revision -
 * asked of the store by name, not read off the page this entry came on, so
 * the answer does not depend on where a listing's pages break. When it does
 * not, nothing at the key is removed: the only revision this attachment can
 * be read by must be where the store says it is before anything beside it
 * goes.
 */
export const revisionVerdict = (input: {
  readonly entry: RevisionEntry
  readonly facts: KeyFacts
  readonly frozenSeen: boolean
  readonly now: number
}): RevisionVerdict => {
  const { entry, facts, now } = input
  if (facts.reservation !== undefined && now < facts.reservation.cleanupAfter) return 'keep'
  if (facts.attachment !== undefined) {
    if (!entry.deleteMarker && sameRevision(entry.revision, facts.attachment.storageVersion)) {
      return 'keep'
    }
    if (!input.frozenSeen) return 'keep'
    // an attachment always has its ticket; one without is older than this
    // code, and is only tidied once it is plainly settled
    if (facts.reservation === undefined && now - entry.modifiedAt < UNKNOWN_KEY_GRACE_MS) {
      return 'keep'
    }
    return 'remove'
  }
  if (facts.reservation !== undefined) return 'remove'
  return now - entry.modifiedAt >= UNKNOWN_KEY_GRACE_MS ? 'remove' : 'keep'
}

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    /** tickets past their grace period, whose objects may or may not exist */
    readonly sweepAbandonedUploads: Effect.Effect<SweepReport>
    /** attachments that never entered anyone's history */
    readonly sweepStagedAttachments: Effect.Effect<SweepReport>
    /**
     * In every store that keeps revisions: the revisions and markers no
     * attachment reads, once nothing can write to their key any more.
     */
    readonly reconcileRevisions: Effect.Effect<SweepReport>
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
      measured('sweep_abandoned_uploads'),
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
      measured('sweep_staged_attachments'),
    )

    /**
     * Walks every revision under the attachment prefix of each store that
     * keeps them, and removes what `revisionVerdict` says goes.
     *
     * Two things leave such revisions behind, and nothing else would ever
     * remove them: a write to a key after its attachment completed, while the
     * upload credential was still good - the attachment reads the revision it
     * completed with, and the later one is bytes nobody pays for - and a sweep
     * that removed some of a key's revisions and then died. A bucket rule that
     * expires old versions cannot do this job: the revision an attachment
     * reads is not always the newest.
     */
    const reconcileRevisions = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      let examined = 0
      let removed = 0
      for (const code of yield* backends.installed) {
        const backend = yield* backends.resolve(code)
        const store = backend.revisions
        if (store === undefined) continue
        // A key's revisions can span pages - a hostile uploader can write a
        // thousand to one key inside a credential's lifetime - so whether an
        // attachment's own revision is there is asked of the store, once per
        // key per pass, and every page is then judged on its own.
        const held = new Map<string, boolean>()
        const holds = (key: string, revision: string | null) =>
          Effect.gen(function* () {
            const known = held.get(key)
            if (known !== undefined) return known
            const answer = yield* store.exists(key, revision ?? undefined)
            held.set(key, answer)
            return answer
          })
        let cursor: string | undefined
        do {
          const page = yield* store.list(ATTACHMENT_PREFIX, cursor)
          const keys = [...new Set(page.entries.map((entry) => entry.key))]
          const facts = yield* factsForKeys({ backend: code, keys })
          for (const entry of page.entries) {
            examined += 1
            const known = facts.get(entry.key) ?? { attachment: undefined, reservation: undefined }
            // asked only once nothing can still be written to the key:
            // before that, everything at it stays whatever the answer
            const settled = known.reservation === undefined || now >= known.reservation.cleanupAfter
            const frozenSeen =
              known.attachment !== undefined &&
              settled &&
              (yield* holds(entry.key, known.attachment.storageVersion))
            if (revisionVerdict({ entry, facts: known, frozenSeen, now }) === 'keep') continue
            yield* store.remove(entry.key, entry.revision)
            removed += 1
            if (removed >= RECONCILE_LIMIT) break
          }
          cursor = removed >= RECONCILE_LIMIT ? undefined : page.next
        } while (cursor !== undefined)
      }
      return { claimed: examined, removed }
    }).pipe(
      Effect.catchTags({
        QueryFailed: (error) =>
          Effect.logError('revision reconciliation failed', error).pipe(
            Effect.as({ claimed: 0, removed: 0 }),
          ),
        STORAGE_BACKEND_UNAVAILABLE: (error) =>
          Effect.logWarning(
            'revision reconciliation stopped; retrying on the next pass',
            error,
          ).pipe(Effect.as({ claimed: 0, removed: 0 })),
      }),
      Effect.withSpan('Storage.reconcileRevisions'),
      measured('reconcile_revisions'),
    )

    return StorageCleanup.of({
      sweepAbandonedUploads: withDb(sweepAbandonedUploads),
      sweepStagedAttachments: withDb(sweepStagedAttachments),
      reconcileRevisions: withDb(reconcileRevisions),
    })
  })

export const cleanupLayer: Layer.Layer<
  StorageCleanup,
  never,
  Orm | StorageConfig | StorageBackends
> = Layer.effect(StorageCleanup, make())

/** how often the sweeps run; nothing here is urgent to the minute */
export const SWEEP_INTERVAL = '5 minutes'

/** how often the revisions in stores that keep them are reconciled: it lists the whole prefix */
export const RECONCILE_INTERVAL = '1 hour'

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
      const cleanup = yield* StorageCleanup
      const loop = Effect.repeat(sweep, Schedule.fixed(SWEEP_INTERVAL)).pipe(
        Effect.provideService(StorageCleanup, cleanup),
      )
      const reconcile = Effect.repeat(
        cleanup.reconcileRevisions.pipe(
          Effect.flatMap((report) =>
            report.removed > 0
              ? Effect.logInfo(
                  `removed ${report.removed} unread revision(s) of ${report.claimed} examined`,
                )
              : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Effect.logError('revision reconciliation failed; retrying on the next pass', cause),
          ),
        ),
        Schedule.fixed(RECONCILE_INTERVAL),
      )
      yield* assembled.register({
        name: 'storage/cleanup-scheduler',
        run: Effect.gen(function* () {
          yield* Effect.forkIn(loop, scope)
          yield* Effect.forkIn(reconcile, scope)
          yield* Effect.logDebug(
            `storage sweeping every ${SWEEP_INTERVAL}, reconciling revisions every ${RECONCILE_INTERVAL}`,
          )
        }),
      })
    }),
  )
