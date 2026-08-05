import fs from 'node:fs'
import path from 'node:path'
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

/**
 * Two plugins may not name the same entity or the same table.
 *
 * Both are silent in a concatenation: the tuple simply contains two elements
 * with one name, and whichever the orm registers last decides what a query
 * means. Read from source rather than by importing the modules, because
 * resolution reads files and never loads plugin code - importing here would
 * run a plugin's module during `qualy resolve`.
 */
export function assertNoCollisions(contributions: readonly EntityContribution[]): void {
  const entities = new Map<string, string>()
  const tables = new Map<string, string>()
  const clashes: string[] = []
  for (const entry of contributions) {
    const source = fs.readFileSync(entry.file, 'utf8')
    for (const [, kind, value] of source.matchAll(
      /\b(name|tableName):\s*'([^']+)'/g,
    ) as Iterable<RegExpMatchArray>) {
      const seen = kind === 'name' ? entities : tables
      const owner = seen.get(value!)
      if (owner && owner !== entry.pluginId) {
        clashes.push(`${kind} ${value} is declared by both ${owner} and ${entry.pluginId}`)
      } else {
        seen.set(value!, entry.pluginId)
      }
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
  ].join('\n')
}
