/**
 * Binds every calculator's authoring policy, once, above the service graph.
 *
 * The same shape as the runtime provider beside it: each registration's
 * `bind` runs while this layer builds, acquires whatever running services
 * its policy needs, and hands back something that asks for nothing. What
 * comes out is a lookup by calculator reference - and a calculator with no
 * policy is unrestricted, because most arithmetic is nobody's property.
 *
 * Two refusals at boot rather than a surprise later. A second policy for a
 * reference somebody already claimed would make the newer one silently
 * decide an authorization question, which is exactly how a security seam
 * stops being one; and a policy for a calculator nobody installed is a rule
 * written against a name that will never be asked about, which is a
 * configuration mistake wearing the appearance of a working guard.
 */

import { Effect, Layer } from 'effect'
import type { Contributed } from '@qualy/plugin-kit'
import { Plugin } from '@qualy/plugin-kit'
import {
  ScoringAuthoringPolicies,
  ScoringAuthoringPolicyCatalog,
  ScoringDefinitionCatalog,
  type BoundScoringAuthoringPolicy,
  type ScoringAuthoringPolicyRegistration,
} from '../plugin.ts'

export const bindAuthoringPolicies = (
  contributions: readonly Contributed<ScoringAuthoringPolicyRegistration<any>>[],
) =>
  Effect.gen(function* () {
    const definitions = yield* ScoringDefinitionCatalog
    const bound = new Map<string, BoundScoringAuthoringPolicy>()
    const owners = new Map<string, string>()
    for (const contribution of contributions) {
      const { ref, bind } = contribution.value
      const existing = owners.get(ref)
      if (existing !== undefined) {
        return yield* Effect.die(
          new Error(
            `two plugins vet bindings for the calculator "${ref}": ${existing} and ${contribution.pluginId}`,
          ),
        )
      }
      if (!definitions.calculators.has(ref)) {
        return yield* Effect.die(
          new Error(
            `${contribution.pluginId} vets bindings for the calculator "${ref}", which no selected plugin provides`,
          ),
        )
      }
      owners.set(ref, contribution.pluginId)
      bound.set(ref, yield* bind)
    }
    return ScoringAuthoringPolicyCatalog.of({
      authorize: (ref, input) => {
        const policy = bound.get(ref)
        return policy === undefined ? Effect.void : policy.authorize(input)
      },
    })
  })

export const scoringAuthoringPolicyProvider = Plugin.provideExtension(ScoringAuthoringPolicies, {
  compile: (contributions) =>
    Layer.effect(ScoringAuthoringPolicyCatalog, bindAuthoringPolicies(contributions)),
})
