import type { EntitySchema } from '@mikro-orm/core'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import { declarationOf, type DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'

// The retained set's entity declarations, for generation and deployment.
//
// The RUNNING aggregate is the descriptor assembler's - the prepare-phase
// compile of the active plugins' declarations. This module answers the other
// question, the one only the lock can: which plugins' tables exist, including
// plugins that are switched off or removed. An aggregate built from the
// active set alone hands a diffing schema generator a database missing their
// tables - which is how data gets dropped.
//
// The values come from the same descriptors resolution imported. There is no
// module path to follow any more: a retained plugin's package is installed, so
// its descriptor is in the resolution's map, disabled and detached included.

/** what one plugin's declaration contributes to the schema */
export interface EntityModule {
  pluginId: string
  entities: readonly EntitySchema[]
  /** DDL applied after the tables exist, for what the metadata cannot declare */
  compositeForeignKeys?: readonly string[]
}

/**
 * Every retained plugin's declared entities, in database dependency order.
 */
export function declaredEntityModules(
  context: Pick<CapabilityWorkContext<DatabaseContribution, DatabaseState>, 'descriptors'>,
  state: DatabaseState,
): EntityModule[] {
  const modules: EntityModule[] = []
  for (const pluginId of state.order) {
    const declaration = declarationOf(pluginId, context.descriptors.get(pluginId))
    if (!declaration) {
      // the order is derived from the contributions, so a plugin in it whose
      // descriptor says nothing means the resolution and the descriptor map
      // disagree - a fault here, not an empty declaration
      throw new Error(`${pluginId} is in the database order but its descriptor declares nothing`)
    }
    if (declaration.entities.length === 0) continue
    modules.push({
      pluginId,
      entities: declaration.entities,
      ...(declaration.compositeForeignKeys === undefined
        ? {}
        : { compositeForeignKeys: declaration.compositeForeignKeys }),
    })
  }
  assertNoCollisions(modules)
  return modules
}

/** one plugin's entities, as declared */
export interface DeclaredEntities {
  pluginId: string
  entities: readonly EntitySchema[]
}

/**
 * No entity name and no table name may be claimed twice.
 *
 * Both are silent in a concatenation: the tuple simply contains two elements
 * with one name, and whichever the orm registers last decides what a query
 * means. The orm does refuse duplicate table names when it starts, but says
 * only the name - which of a dozen packages put it there is left to the reader,
 * and duplicate entity names it does not check at all.
 */
export function assertNoCollisions(declared: readonly DeclaredEntities[]): void {
  const owners = { name: new Map<string, string>(), table: new Map<string, string>() }
  const clashes: string[] = []
  const claim = (kind: 'name' | 'table', value: string | undefined, pluginId: string) => {
    // a table name the plugin left to the naming strategy is not known until
    // the orm computes it, and the orm checks those itself
    if (!value) return
    const owner = owners[kind].get(value)
    if (owner === undefined) owners[kind].set(value, pluginId)
    else if (owner === pluginId) clashes.push(`${kind} ${value} is declared twice by ${pluginId}`)
    else clashes.push(`${kind} ${value} is declared by both ${owner} and ${pluginId}`)
  }
  for (const entry of declared) {
    for (const entity of entry.entities) {
      claim('name', entity.meta.className, entry.pluginId)
      claim('table', entity.meta.tableName, entry.pluginId)
    }
  }
  if (clashes.length > 0) {
    throw new Error(`entity declarations collide:\n  ${clashes.join('\n  ')}`)
  }
}
