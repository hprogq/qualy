import fs from 'node:fs'
import path from 'node:path'
import type { EntitySchema } from '@mikro-orm/core'
import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'

// The aggregate of every plugin's entity tuple, as a module the host imports.
//
// This generator does one thing: concatenate. It does not read entity
// definitions, does not know what a check constraint is, and never writes a
// table - a plugin owns its own declarations, and an aggregate that started
// interpreting them would become a second place the schema lives.
//
// The direction is what makes the aggregate possible at all. A plugin exports
// its tuple and never imports this file; the host imports every plugin. A
// plugin reaching back for the aggregate's type would close the same cycle the
// api aggregate already refuses.
//
// The set is the RETAINED order, not the running one. Switching a plugin off
// or taking it out of the manifest does not remove its tables, and an
// aggregate built from the active set alone hands a diffing schema generator a
// database that is missing them - which is how data gets dropped.

/** where the host finds the aggregate, relative to its own workspace */
export const ENTITIES_MODULE = 'entities.gen.ts'

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

/** a stable, collision-free local name for a plugin's tuple */
const localName = (pluginId: string) =>
  `${pluginId
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase())}Entities`

/**
 * The aggregate module.
 *
 * `as const` twice over, and both matter: the tuple is what carries element
 * types into the entity manager, and a spread of arrays would erase them. The
 * generated file is what a host imports, so this is also the only place that
 * decides the order entities are registered in.
 */
export function renderEntityModule(contributions: readonly EntityContribution[]): string {
  const imports = contributions.map(
    (entry) => `import { entities as ${localName(entry.pluginId)} } from '${entry.specifier}'`,
  )
  const spread = contributions.map((entry) => `  ...${localName(entry.pluginId)},`)
  return [
    "// Generated by Qualy codegen from qualy.yml. Run 'pnpm gen' to regenerate.",
    '// Do not edit this file by hand, it will be overwritten.',
    "import { Layer } from 'effect'",
    "import { Entities } from '@qualy/plugin-database/server'",
    ...imports,
    '',
    '/** every entity this assembly retains, in database dependency order */',
    contributions.length > 0
      ? ['export const entities = [', ...spread, '] as const'].join('\n')
      : 'export const entities = [] as const',
    '',
    '/** the tuple type an entity manager carries, so a query knows the tables */',
    'export type Database = typeof entities',
    '',
    '/**',
    ' * The set as the service the connection reads it from.',
    ' *',
    ' * Named here rather than by the host, because a host that named it would',
    ' * be naming a service that does not exist in an assembly with no database.',
    ' */',
    'export const entitiesLayer = Layer.succeed(Entities, entities)',
    '',
  ].join('\n')
}
