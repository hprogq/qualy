import fs from 'node:fs'
import path from 'node:path'
import { isPluginDescriptor, Plugin } from '@qualy/plugin-kit'
import { DatabaseEntities, type DatabaseDeclaration } from '../plugin.ts'

// What a plugin says when it owns database objects, read from its descriptor.
//
// Capability is declared, never probed: a plugin without a Db.entities feature
// has no database presence at all, and a declaration that does not validate is
// a hard error rather than an empty one. Validating here means a broken
// declaration fails during `qualy resolve`, before anything has been
// generated, named by the plugin that owns it.
//
// The lock stores a projection, not the declaration: entity values are not
// serialisable and live on the descriptor, so what the lock records is what a
// reviewed assembly diff should show - which entities a plugin declares, what
// its schema depends on, and whether it carries baseline SQL - plus what
// retention needs to answer after the plugin has left the manifest.

export interface DatabaseContribution {
  /** the entity names this plugin declares, sorted - the vocabulary queries use */
  entities: string[]
  /** directory of SQL fragments no schema comparison can see */
  baselineDir?: string
  /** directory of one-time data transitions, compiled once into an instance's lineage */
  transitionsDir?: string
  /** plugins whose tables this plugin's schema references */
  dependsOn: string[]
}

/**
 * The one database declaration on a descriptor, or nothing.
 *
 * One feature carries everything: two Db.entities features would leave
 * dependsOn and baselineDir with two homes and no rule for merging them.
 */
export function declarationOf(
  pluginId: string,
  descriptor: unknown,
): DatabaseDeclaration | undefined {
  if (!isPluginDescriptor(descriptor)) return undefined
  const declared = Plugin.contributionsOf(descriptor, DatabaseEntities)
  if (declared.length === 0) return undefined
  if (declared.length > 1) {
    throw new Error(
      `${pluginId} declares its database face twice; one Db.entities feature carries everything`,
    )
  }
  return declared[0]
}

/** the projection the lock records, with the declaration validated on the way */
export function parseDeclaration(
  pluginId: string,
  packageRoot: string,
  declaration: DatabaseDeclaration,
): DatabaseContribution {
  const where = `${pluginId}: Db.entities`

  if (!Array.isArray(declaration.entities)) {
    throw new Error(`${where} must be given an entity tuple`)
  }
  const entities = declaration.entities.map((entity) => {
    const name = (entity as { meta?: { className?: unknown } } | undefined)?.meta?.className
    if (typeof name !== 'string' || !name) {
      throw new Error(`${where} contains something that is not a defineEntity value`)
    }
    return name
  })

  if (declaration.compositeForeignKeys !== undefined) {
    // a string here would iterate one character at a time into the schema,
    // and each character would be run as a statement
    if (!Array.isArray(declaration.compositeForeignKeys)) {
      throw new Error(`${where}: compositeForeignKeys must be an array of sql statements`)
    }
    for (const statement of declaration.compositeForeignKeys) {
      if (typeof statement !== 'string' || !statement.trim()) {
        throw new Error(
          `${where}: compositeForeignKeys contains something that is not a sql statement: ${String(statement)}`,
        )
      }
    }
  }

  /** a package-relative directory the declaration names, checked to exist inside the package */
  const directory = (key: 'baselineDir' | 'transitionsDir'): string | undefined => {
    const value = declaration[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${where}: ${key} must be a path inside the package`)
    }
    if (path.isAbsolute(value)) {
      throw new Error(`${where}: ${key} must be relative to the package, got ${value}`)
    }
    const target = path.resolve(packageRoot, value)
    if (!target.startsWith(packageRoot + path.sep)) {
      throw new Error(`${where}: ${key} points outside the package: ${value}`)
    }
    if (!fs.existsSync(target)) {
      throw new Error(`${where}: ${key} does not exist: ${value}`)
    }
    return value
  }
  const baselineDir = directory('baselineDir')
  const transitionsDir = directory('transitionsDir')

  const dependsOn = declaration.dependsOn ?? []
  if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== 'string')) {
    throw new Error(`${where}: dependsOn must be a list of plugin ids`)
  }

  return {
    entities: [...entities].sort(),
    ...(baselineDir === undefined ? {} : { baselineDir }),
    ...(transitionsDir === undefined ? {} : { transitionsDir }),
    dependsOn: [...dependsOn].sort(),
  }
}

/**
 * Whether this declaration means the plugin put something into a database.
 *
 * Tables and baseline objects, and transitions too: a data step compiled into
 * an instance's lineage is that instance's history, and the plugin that
 * shipped it stays accounted for so the lineage can keep checking the step
 * against the file it came from.
 */
export const ownsObjects = (contribution: DatabaseContribution | undefined) =>
  Boolean(
    contribution &&
      (contribution.entities.length > 0 || contribution.baselineDir || contribution.transitionsDir),
  )

/**
 * The same question asked of a contribution that came back out of the lock.
 *
 * A hand-edited lock can contain anything, and the answer decides whether a
 * removed plugin is remembered, so it may not assume the shape is intact. The
 * pre-descriptor spelling is still recognised: a lock written before this
 * shape holds `entitiesEntry`, and the plugins it detached own their tables no
 * less for the format having moved on.
 */
export const lockedOwnsObjects = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const record = value as {
    entities?: unknown
    entitiesEntry?: unknown
    baselineDir?: unknown
    transitionsDir?: unknown
  }
  return (
    (Array.isArray(record.entities) && record.entities.length > 0) ||
    typeof record.entitiesEntry === 'string' ||
    typeof record.baselineDir === 'string' ||
    typeof record.transitionsDir === 'string'
  )
}
