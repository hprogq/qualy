/**
 * What one question is scored by, for whoever authors the arithmetic.
 *
 * Read from the compiled plan, never from the authored configuration: the
 * configuration is what somebody typed, the plan is what the scorer runs,
 * and the exact runtime identity a calculator was bound to lives only in
 * the plan. A screen that showed the authored versionId would show what a
 * database write claims rather than what this question actually executes.
 *
 * Facts only - no principal, no authorization. Whoever asks has already
 * been through their own gate, and this answers the same for everybody.
 */

import { Effect, Layer } from 'effect'
import { withDatabase } from '@qualy/plugin-database/server'
import { AssessmentScoringAuthoringAccess } from '../plugin.ts'
import { itemOf, revisionOf } from '../item/db.ts'
import { oneBatch } from './db.ts'
import { frozenCalculatorOf, readScoringPlan } from '../scoring/plan.ts'
import { BatchNotFound, ItemNotFound } from './errors.ts'

export const make = Effect.fn('AssessmentScoringAuthoringAccess.make')(function* () {
  const database = yield* withDatabase

  return AssessmentScoringAuthoringAccess.of({
    currentCalculator: (tenantId, batchId, itemId) =>
      database(
        Effect.gen(function* () {
          const batch = yield* oneBatch(tenantId, batchId).pipe(Effect.orDie)
          if (batch === null) return yield* new BatchNotFound()
          const item = yield* itemOf(tenantId, itemId).pipe(Effect.orDie)
          // a question of another round is a question this caller was not
          // asking about: not found, never somebody else's answer
          if (item === null || item.batchId !== batchId) return yield* new ItemNotFound()
          if (item.currentRevisionId === null) return null
          const revision = yield* revisionOf(tenantId, item.currentRevisionId).pipe(Effect.orDie)
          if (revision === null) return null
          // an unreadable frozen plan is an operational failure, not an
          // answer: the same judgment every other reader of a stored plan
          // makes, and the reason this face reads plans rather than configs
          const plan = yield* readScoringPlan(revision).pipe(Effect.orDie)
          return {
            revisionId: revision.id,
            ref: plan.calculator.ref,
            frozen: frozenCalculatorOf(plan),
          }
        }),
      ),
  })
})

export const scoringAuthoringAccessLayer = Layer.effect(AssessmentScoringAuthoringAccess, make())
