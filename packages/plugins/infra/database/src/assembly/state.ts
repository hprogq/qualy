import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import { CycleError, topoSort } from '@qualy/assembly'
import { ownsObjects, type DatabaseContribution } from './contribution.ts'

// What this capability records in the lock: the order its objects have to be
// built in, and nothing else.
//
// Everything a plugin declared is already in the lock under that plugin, so
// repeating it here would only create a second place for it to be wrong. The
// order is the one thing that is derived rather than declared.

export interface DatabaseState {
  /** plugins that own database objects, dependencies first */
  order: string[]
}

export function resolveDatabase(
  context: CapabilityResolveContext<DatabaseContribution, DatabaseState>,
): DatabaseState {
  const missing: string[] = []
  const edges = new Map<string, string[]>()
  for (const [pluginId, contribution] of context.contributions) {
    for (const required of contribution.dependsOn) {
      // A schema that imports another plugin's tables is unusable without
      // them: postgres refuses the foreign key halfway through applying a
      // migration, naming a relation the reader has no reason to connect to a
      // missing plugin. Said here, the assembly is rejected before anything is
      // generated, by the name of what is missing.
      if (!context.plugins.has(required)) {
        missing.push(`${pluginId} needs ${required}, which this assembly does not include`)
      }
    }
    edges.set(
      pluginId,
      contribution.dependsOn.filter((id) => id !== pluginId && context.plugins.has(id)),
    )
  }
  if (missing.length > 0) {
    throw new Error(`incomplete assembly:\n  ${missing.join('\n  ')}`)
  }

  const owners = [...context.contributions]
    .filter(([, contribution]) => ownsObjects(contribution))
    .map(([pluginId]) => pluginId)
  try {
    return { order: topoSort(owners, edges).order }
  } catch (error) {
    if (!(error instanceof CycleError)) throw error
    // this order has to exist: tables are created in it
    throw new Error(`database dependency cycle: ${error.cycle.join(' -> ')}`)
  }
}

/** what a lock section looks like when it is intact enough to use */
export const asState = (value: unknown): DatabaseState => {
  const order = (value as DatabaseState | undefined)?.order
  return { order: Array.isArray(order) ? order.filter((id) => typeof id === 'string') : [] }
}
