import { Effect } from 'effect'
import { Assessment } from '../../src/server/index.ts'
import type { Principal } from '@qualy/rbac-contract'

// Starting a batch, for the suites that need one already running.
//
// There is no activation step any more: a batch starts by having its first
// phase committed to a time, which is also what freezes its roster. The suites
// that are about that commitment schedule it themselves; this is for the ones
// that only need a batch which has started.

const HOUR = 3_600_000

/**
 * The first phase, promised for an hour from now.
 *
 * Leaves the batch running but not yet in any phase - the state a batch is in
 * between "we are doing this" and the morning it begins.
 */
export const startBatch = (tenantId: string, batchId: string, as: Principal) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const plan = yield* assessment.getPlan(tenantId, batchId, as)
    return yield* assessment.schedulePhase(tenantId, batchId, plan[0]!.id, Date.now() + HOUR, as)
  })
