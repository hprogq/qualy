import { Effect, Layer } from 'effect'
import { Rbac } from '@qualy/rbac-contract/effect'
import { AccessDenied } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { withDatabase } from '@qualy/plugin-database/server'
import { AssessmentConfigurationAccess } from '../plugin.ts'
import { batchWithinReach, managementAnchors, oneBatch } from './db.ts'
import { BatchNotFound } from './errors.ts'

/** the one spelling of the batch-administration permission */
export const BATCH_MANAGE = 'assessment.batch.manage'

import type { Orm } from '@qualy/plugin-database/server'

type WithDb = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Orm>>

/**
 * Managing a round means managing where it is run from and everybody in it.
 *
 * Both, never one or the other. The roster alone leaves a round with nobody
 * in it belonging to nobody, and "nobody's" used to mean "anybody holding
 * the permission somewhere" - which is how an administrator of one college
 * could take over another college's empty draft. The frozen anchors say
 * whose round it is; the roster says who is in it today.
 *
 * Asked as the one predicate the list already projects as `manageable`,
 * rather than re-decided here from the anchors as bare node ids. Both
 * halves used to be handed to rbac as ids, which resolves them against the
 * live tree, while the list matches a participant's frozen anchor_path; org
 * rewrites the live paths when a unit is relocated and nothing resyncs a
 * frozen one, so a single move made the two disagree about the same running
 * round. A control the list offers has to be one this guard accepts.
 *
 * A FACTORY on purpose: the Assessment service's own guard and the
 * configuration-access face other plugins consume are the same decision,
 * and two spellings of it is exactly the drift that let the halves disagree
 * once already. Whoever needs the predicate builds it from here.
 */
export const rosterReachOf =
  (rbac: Rbac['Service'], withDb: WithDb) =>
  (as: Principal, tenantId: string, batchId: string): Effect.Effect<void, AccessDenied> =>
    Effect.gen(function* () {
      const held = yield* rbac.listAuthorizedScope(as, BATCH_MANAGE)
      const reach = yield* withDb(batchWithinReach(tenantId, batchId, held)).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
      // No boundary, nobody on the list, or no such batch at all: nothing here
      // says whose round this is. It can happen to a round upgraded from
      // before the boundary existed whose units have since been deleted, so it
      // needs a way back - but "holds the permission somewhere" is exactly the
      // answer that let one college pick up another's empty draft. Only
      // authority over the whole tenant is wide enough to be nobody's in
      // particular, and the callers that care answer BatchNotFound themselves.
      if (!(reach ?? held.tenantWide)) {
        return yield* new AccessDenied({ reason: 'cannot manage assessment batches' })
      }
    })

export const make = Effect.fn('AssessmentConfigurationAccess.make')(function* () {
  const database = yield* withDatabase
  const rbac = yield* Rbac
  const withDb: WithDb = database
  const reach = rosterReachOf(rbac, withDb)
  const existing = (tenantId: string, batchId: string) =>
    withDb(oneBatch(tenantId, batchId)).pipe(
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      Effect.flatMap((batch) => (batch ? Effect.void : Effect.fail(new BatchNotFound()))),
    )
  return AssessmentConfigurationAccess.of({
    requireManage: (tenantId, batchId, as) =>
      existing(tenantId, batchId).pipe(Effect.andThen(reach(as, tenantId, batchId))),
    boundary: (tenantId, batchId) =>
      existing(tenantId, batchId).pipe(
        Effect.andThen(
          withDb(managementAnchors(tenantId, batchId)).pipe(
            Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
            Effect.map((anchors) => ({ managementAnchors: anchors })),
          ),
        ),
      ),
  })
})

export const configurationAccessLayer = Layer.effect(AssessmentConfigurationAccess, make())
