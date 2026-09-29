/**
 * One run of a formula the way scoring runs it: the scoring budget, and one
 * more try when either deadline was crossed.
 *
 * Scoring and the publication gate both call this, so "it finished within
 * the budget when it was published" and "it finishes within the budget when
 * it is scored" are asked of the same limits in the same way.
 */

import { Effect } from 'effect'
import type { Sandbox } from '@qualy/plugin-sandbox/service'
import type { FormulaScoringLimits } from './limits.ts'

export const invokeForScore = (
  sandbox: Sandbox['Service'],
  artifact: { readonly runtimeJs: string; readonly runtimeSha256: string },
  input: unknown,
  limits: FormulaScoringLimits,
) =>
  sandbox
    .invoke({
      artifact: artifact.runtimeJs,
      artifactHash: artifact.runtimeSha256,
      entrypoint: '__qualyInvoke',
      arguments: [JSON.stringify(input)],
      limits,
    })
    .pipe(
      // The soft deadline is the program's CPU time, which a fresh worker's
      // cold engine still inflates; the hard one is a watchdog whose worker is
      // replaced at once, so the second try lands on a worker already up. The
      // program is pure: asking once more costs nothing, and a formula that
      // is really slow fails again.
      Effect.retry({ times: 1, while: (error) => error._tag === 'SandboxTimeout' }),
    )
