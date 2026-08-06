import fs from 'node:fs'
import path from 'node:path'
import type { EntitySchema } from '@mikro-orm/core'
import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'

// The retained set's entity contributions, for generation and deployment.
//
// The RUNNING aggregate is the descriptor assembler's now - the prepare-phase
// compile of the active plugins' declarations. This module answers the other
// question, the one only the lock can: which plugins' tables exist, including
// plugins that are switched off or removed. An aggregate built from the
// active set alone hands a diffing schema generator a database missing their
// tables - which is how data gets dropped.

export interface EntityContribution {
  pluginId: string
  /** the import specifier the host will use, e.g. `@qualy/plugin-org/db` */
  specifier: string
  /** absolute path to the module, so its exports can be checked */
  file: string
}

const exportTarget = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return exportTarget(record.import ?? record.default)
  }
  return undefined
}

/**
 * Every retained plugin that ships entities, in database dependency order.
 *
 * The subpath a plugin declares has to be one it also exports: the host cannot
 * import a path the package does not publish, and discovering that at build
 * time rather than here would name the aggregate as the broken file instead of
 * the plugin that broke it.
 */
export function entityContributions(
  context: Pick<
    CapabilityResolveContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir'
  >,
  state: DatabaseState,
): EntityContribution[] {
  const found: EntityContribution[] = []
  for (const pluginId of state.order) {
    const entitiesEntry = context.contributions.get(pluginId)?.entitiesEntry
    if (!entitiesEntry) continue
    const packageDir = context.resolvePackageDir(pluginId)
    const file = path.resolve(packageDir, entitiesEntry)

    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
    }
    const subpath = Object.entries(pkg.exports ?? {}).find(
      ([, target]) =>
        exportTarget(target) && path.resolve(packageDir, exportTarget(target)!) === file,
    )?.[0]
    if (!subpath) {
      throw new Error(
        `${pluginId}: qualy.contributions.database.entitiesEntry (${entitiesEntry}) is not reachable through this package's exports; the host imports it by subpath`,
      )
    }
    found.push({
      pluginId,
      specifier: subpath === '.' ? pluginId : `${pluginId}${subpath.slice(1)}`,
      file,
    })
  }
  return found
}

/** one plugin's entities, as its module exported them */
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
 *
 * Asked of the metadata the modules exported, rather than of their source. The
 * source scan this replaces read `name:` and `tableName:` with a regular
 * expression, so it saw the `name:` of every check constraint and index as an
 * entity, missed anything written with double quotes, and let one plugin
 * declare the same table twice. Reading a declaration is the parser's job, and
 * generation already has the loaded modules in hand.
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
