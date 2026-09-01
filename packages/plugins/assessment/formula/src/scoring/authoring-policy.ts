/**
 * Who may point a question at a published formula.
 *
 * You may bind what you wrote. That is the whole rule, and it is an
 * authoring rule rather than a runtime one: it asks who is saving, which
 * the calculator beside it deliberately never learns, so it lives in the
 * seam the host provides for exactly this question.
 *
 * A continuation is not a new binding. When the question already runs this
 * exact program, nothing here is asked - the rule is about who may START
 * something, and turning it into a rule about who may keep a question
 * working would strand every question whose author moved on. Whether the
 * frozen bytes are still the published bytes is a different question with a
 * different answer, and it stays with the calculator: an integrity failure
 * must not be dressed up as somebody lacking permission.
 *
 * Binding does not need the authoring capability either. Somebody who may
 * no longer write formulas is still configuring a round when they point a
 * question at one they published, and that is the round's permission to
 * grant.
 */

import { Effect } from 'effect'
import type { ScoringAuthoringInput } from '@qualy/plugin-assessment/plugin'
import { withDatabase } from '@qualy/plugin-database/server'
import { db } from '../server/db.ts'
import { decodeFormulaConfig, RUNTIME_REF_KIND } from './formula-calculator.ts'

/** the reference a formula binding takes, as the compiler spells its paths */
const AT = 'scoringConfig.calculator.config'

export const formulaAuthoringPolicy = {
  ref: 'formula@1',
  bind: Effect.gen(function* () {
    const database = yield* withDatabase
    return {
      authorize: (input: ScoringAuthoringInput) =>
        Effect.gen(function* () {
          const decoded = decodeFormulaConfig(input.config)
          // a configuration this plugin cannot read is not this seam's
          // refusal to make: the compile names it, once, in its own words
          if (decoded === undefined) return
          const previous = input.previousRuntimeRef
          if (previous?.kind === RUNTIME_REF_KIND && previous.id === decoded.versionId) return
          const row = yield* database(
            db.query((k) =>
              k
                .selectFrom('FormulaVersion as v')
                .innerJoin('FormulaFunction as f', (join) =>
                  join.onRef('f.tenantId', '=', 'v.tenantId').onRef('f.id', '=', 'v.functionId'),
                )
                .select(['f.createdBy as createdBy'])
                .where('v.tenantId', '=', input.tenantId)
                .where('v.id', '=', decoded.versionId)
                .executeTakeFirst(),
            ),
          ).pipe(Effect.orDie)
          // a version nobody can find is the compile's answer to give, in
          // the vocabulary it has already established for it
          if (row === undefined) return
          if ((row as unknown as { createdBy: string }).createdBy !== input.principal.userId) {
            return yield* Effect.fail({ path: AT, reason: 'formula-not-yours' })
          }
        }),
    }
  }),
}
