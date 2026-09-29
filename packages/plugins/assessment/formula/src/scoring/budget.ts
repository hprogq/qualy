/**
 * The scoring budget this deployment runs formulas under.
 *
 * Only the host watchdog is the deployment's to move, because only it
 * depends on the host: how long a healthy worker can take is a property of
 * the machine, while the soft deadline is what a formula is held to and
 * publication checks against. It comes from the environment rather than the
 * manifest for the same reason the sandbox pool's size does.
 */

import { Config, Context, Effect, Layer } from 'effect'
import {
  DEFAULT_SCORING_HARD_DEADLINE_MS,
  formulaScoringLimits,
  hardDeadlineIssue,
  type FormulaScoringLimits,
} from './limits.ts'

export class FormulaScoringBudget extends Context.Service<
  FormulaScoringBudget,
  { readonly limits: FormulaScoringLimits }
>()('@qualy/plugin-assessment-formula/FormulaScoringBudget') {}

export const HARD_DEADLINE_VARIABLE = 'QUALY_SANDBOX_HARD_DEADLINE_MS'

/** read once at start: a watchdog the rules refuse stops the start, named */
export const scoringBudgetLayer = Layer.effect(
  FormulaScoringBudget,
  Effect.gen(function* () {
    const hardDeadlineMs = yield* Config.Int(HARD_DEADLINE_VARIABLE).pipe(
      Config.withDefault(DEFAULT_SCORING_HARD_DEADLINE_MS),
      Effect.catch(() =>
        Effect.die(new Error(`${HARD_DEADLINE_VARIABLE} must be a whole number of milliseconds`)),
      ),
    )
    const issue = hardDeadlineIssue(hardDeadlineMs)
    if (issue !== undefined)
      return yield* Effect.die(new Error(`${HARD_DEADLINE_VARIABLE} ${issue}`))
    return FormulaScoringBudget.of({ limits: formulaScoringLimits(hardDeadlineMs) })
  }),
)
