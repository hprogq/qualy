import { Assembled } from '@qualy/api-kit/assembled'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Plugin, type Contributed } from '@qualy/plugin-kit'
import { Effect, Layer } from 'effect'
import {
  ItemTypeCatalog,
  ScoringDefinitionCatalog,
  ScoringRuntimeCatalog,
  ScoringRuntimes,
  type BoundCalculator,
  type CalculatorRegistration,
} from '../plugin.ts'
import { auditStoredPlans, sweepScoringPlans } from './backfill.ts'

/**
 * Bind every registered calculator over the running services, and prove the
 * two scoring channels tell one story.
 *
 * The completeness rule is a calculator-only equality: every declared
 * calculator has exactly one runtime registration and every registration was
 * declared. Aggregators take no part in it - an aggregator IS its
 * definition, a pure fold with no services to acquire and no runtime half.
 *
 * Exported apart from the provider so the test assembly can build a catalog
 * through the same binding and the same refusals the host does.
 */
export const bindScoringRuntimes = (
  contributions: readonly Contributed<CalculatorRegistration<any>>[],
) =>
  Effect.gen(function* () {
    const definitions = yield* ScoringDefinitionCatalog
    const bound = new Map<string, BoundCalculator>()
    const owners = new Map<string, string>()
    for (const contribution of contributions) {
      const registration = contribution.value
      const existing = owners.get(registration.ref)
      if (existing !== undefined) {
        throw new Error(
          `two plugins register the calculator runtime "${registration.ref}": ${existing} and ${contribution.pluginId}`,
        )
      }
      owners.set(registration.ref, contribution.pluginId)
      const calculator = yield* registration.bind
      if (calculator.ref !== registration.ref) {
        throw new Error(
          `the calculator registered as "${registration.ref}" bound itself as "${calculator.ref}"`,
        )
      }
      bound.set(registration.ref, calculator)
    }
    for (const ref of definitions.calculators.keys()) {
      if (!bound.has(ref)) {
        throw new Error(`calculator "${ref}" is declared but has no runtime registration`)
      }
    }
    for (const ref of bound.keys()) {
      if (!definitions.calculators.has(ref)) {
        throw new Error(`calculator runtime "${ref}" is registered but never declared`)
      }
    }
    const demand = (ref: string): BoundCalculator => {
      const calculator = bound.get(ref)
      if (calculator === undefined) {
        // an assembly fault, not a data state: configurations are validated
        // against the installed catalog when saved, and the boot audit
        // refuses stored plans whose driver is gone
        throw new Error(`scoring calculator "${ref}" is not installed in this assembly`)
      }
      return calculator
    }
    return ScoringRuntimeCatalog.of({
      compile: (ref, config, context) => demand(ref).compile(config, context),
      verify: (ref, frozen, context) => demand(ref).verify(frozen, context),
      prepare: (ref, frozen, context) => demand(ref).prepare(frozen, context),
    })
  })

/**
 * The runtime channel's owner: binds the registrations over the running
 * services and registers the scoring boot barrier.
 *
 * The barrier hook is registered HERE, while this layer builds, because a
 * BootHook's run is closed - it captures the catalog value straight out of
 * this build. A hook that tried to resolve the catalog from the environment
 * would be asking for the very layer that is registering it.
 *
 * Revisions written before item plans existed are compiled at the barrier,
 * through the same compiler a save uses - before the port opens, so no
 * request meets a revision whose arithmetic has not been compiled yet. It
 * only ever fills a null: an existing plan is what some score was explained
 * by. And then the plans that already existed: one this build cannot read,
 * or whose driver this assembly no longer provides, refuses ready here -
 * never on a results page.
 */
export const scoringRuntimeProvider = Plugin.provideExtension(ScoringRuntimes, {
  compile: (contributions) =>
    Layer.effect(
      ScoringRuntimeCatalog,
      Effect.gen(function* () {
        const catalog = yield* bindScoringRuntimes(contributions)
        const itemTypes = yield* ItemTypeCatalog
        const definitions = yield* ScoringDefinitionCatalog
        const withDb = yield* withDatabase
        const assembled = yield* Assembled
        const deps = {
          itemTypes,
          definitions,
          compile: catalog.compile,
          verify: catalog.verify,
        }
        yield* assembled.register({
          name: 'assessment/scoring-plans',
          // in a transaction because the sweep's advisory lock is
          // transaction-scoped: without one it would be released the moment
          // its own statement finished, and two booting processes would
          // compile the same rows against each other
          run: withDb(
            transaction(sweepScoringPlans(deps).pipe(Effect.andThen(auditStoredPlans(deps)))).pipe(
              Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
            ),
          ),
        })
        return catalog
      }),
    ),
})
