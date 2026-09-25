/**
 * One run of a formula the way scoring runs it: the scoring budget, and one
 * more try when only the soft deadline was crossed.
 *
 * Scoring and the publication gate both call this, so "it finished within
 * the budget when it was published" and "it finishes within the budget when
 * it is scored" are asked of the same limits in the same way.
 */

import { Effect } from 'effect'
import type { Sandbox } from '@qualy/plugin-sandbox/service'
import { FORMULA_SCORING_LIMITS } from './limits.ts'

export const invokeForScore = (
  sandbox: Sandbox['Service'],
  artifact: { readonly runtimeJs: string; readonly runtimeSha256: string },
  input: unknown,
) =>
  sandbox
    .invoke({
      artifact: artifact.runtimeJs,
      artifactHash: artifact.runtimeSha256,
      entrypoint: '__qualyInvoke',
      arguments: [JSON.stringify(input)],
      limits: FORMULA_SCORING_LIMITS,
    })
    .pipe(
      // the soft deadline is wall clock over the whole worker envelope, so a
      // starved host crosses it for a healthy formula; the program is pure,
      // so asking once more costs nothing and a formula that is really slow
      // fails again
      Effect.retry({
        times: 1,
        while: (error) => error._tag === 'SandboxTimeout' && error.phase === 'soft',
      }),
    )
