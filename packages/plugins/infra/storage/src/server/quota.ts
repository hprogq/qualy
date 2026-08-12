import { Effect } from 'effect'
import { UploadRefused } from '../errors.ts'
import type { StorageLimits } from './config.ts'
import { advisoryLock, lockKey, usageOf } from './db.ts'

// Who is allowed to start an upload, and how two of them at once are stopped
// from both being allowed.
//
// The thing being rationed is not disk. It is the right to hold an upload
// ticket: a ticket names a key, reserves a size and expires on its own, so an
// account that asks for a thousand and uploads nothing has still taken a
// thousand tickets' worth of somebody's allowance. Charging only for objects
// that exist would make that free.

const HOUR_MS = 60 * 60 * 1000

/** the namespaces the two locks are derived in; distinct so they cannot collide */
const TENANT_LOCK = '@qualy/plugin-storage/tenant'
const OWNER_LOCK = '@qualy/plugin-storage/owner'

export interface Admission {
  readonly tenantId: string
  readonly ownerUserId: string
  /** what the ticket will reserve, already checked against the file ceiling */
  readonly bytes: bigint
  readonly now: number
}

/**
 * Reads usage under the locks that make the reading true.
 *
 * `sum → validate → insert` without a lock is the classic oversell: two
 * fibers read 90 of a 100 limit, both find 10 fits, and the tenant ends up at
 * 110. The advisory locks are transaction-scoped, so the second reader waits
 * until the first has committed its insert and then reads a total that
 * includes it.
 *
 * Always tenant before owner. Two orders is a deadlock waiting for the day one
 * caller reserves for somebody in another tenant.
 */
export const admit = (input: Admission, limits: StorageLimits) =>
  Effect.gen(function* () {
    yield* advisoryLock(lockKey(TENANT_LOCK, input.tenantId))
    yield* advisoryLock(lockKey(OWNER_LOCK, `${input.tenantId}/${input.ownerUserId}`))

    const usage = yield* usageOf({
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      rateWindowFrom: input.now - HOUR_MS,
    })

    const refuse = (reason: UploadRefused['reason']) => Effect.fail(new UploadRefused({ reason }))

    if (usage.recentPrepares >= limits.prepareRatePerHour) return yield* refuse('rate-limited')
    if (usage.activeReservations >= limits.maxActiveReservationsPerOwner) {
      return yield* refuse('too-many-reservations')
    }
    if (usage.reservedBytes + input.bytes > limits.maxReservedBytesPerOwner) {
      return yield* refuse('owner-quota-exceeded')
    }
    // Every outstanding ticket is a future staged attachment, so the staged
    // and stored limits have to weigh them too. Counting only what exists lets
    // two tickets each fit under the same remaining room and both be granted -
    // the same oversell the advisory lock closes for reserved bytes, one level
    // further along.
    if (usage.stagedBytes + usage.reservedBytes + input.bytes > limits.maxStagedBytesPerOwner) {
      return yield* refuse('owner-quota-exceeded')
    }
    if (usage.storedBytes + usage.reservedBytes + input.bytes > limits.maxStoredBytesPerOwner) {
      return yield* refuse('owner-quota-exceeded')
    }
    if (usage.tenantCommittedBytes + input.bytes > limits.tenantHardBytes) {
      return yield* refuse('tenant-quota-exceeded')
    }

    return usage
  })

/**
 * What the operator should hear about, once an upload has been allowed.
 *
 * A tenant that crosses the warning line has not done anything wrong, so this
 * is not a refusal; it is the only warning anybody gets before the hard limit
 * starts refusing uploads, and it goes to the log rather than to the person
 * uploading, who cannot act on it.
 */
export const tenantPressure = (
  committedBytes: bigint,
  limits: StorageLimits,
): 'critical' | 'warning' | null =>
  committedBytes >= limits.tenantCriticalBytes
    ? 'critical'
    : committedBytes >= limits.tenantWarningBytes
      ? 'warning'
      : null
