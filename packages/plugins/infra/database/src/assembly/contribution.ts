import fs from 'node:fs'
import path from 'node:path'
import type { ContributionInput } from '@qualy/assembly-contract'

// What a plugin declares when it owns database objects.
//
// Capability is declared, never probed: a plugin without a contribution has no
// database presence at all, and a contribution that does not resolve is a hard
// error rather than an empty one. Saying it here means a broken declaration
// fails during `qualy resolve`, before anything has been generated, named by
// the plugin that owns it.

export interface DatabaseContribution {
  /** the module whose named exports are this plugin's tables, enums and views */
  schemaEntry?: string
  /**
   * The module exporting this plugin's entity tuple, as `entities`.
   *
   * Separate from `schemaEntry` because the two coexist during the migration:
   * a plugin ports its tables one at a time, and the aggregate has to be
   * buildable from whichever plugins have arrived. It carries a tuple rather
   * than an array on purpose - the aggregate's element types are what reach
   * the query builder, and widening them makes every table name unusable
   * without making anything fail here.
   */
  entitiesEntry?: string
  /** directory of SQL fragments drizzle cannot derive, compiled into the lineage */
  baselineDir?: string
  /** plugins whose tables this plugin's schema references */
  dependsOn: string[]
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('must be a mapping')
  }
  return value as Record<string, unknown>
}

const KEYS = new Set(['schemaEntry', 'entitiesEntry', 'baselineDir', 'dependsOn'])

export function parseDatabaseContribution(input: ContributionInput): DatabaseContribution {
  const where = `${input.pluginId}: qualy.contributions.database`
  let raw: Record<string, unknown>
  try {
    raw = asRecord(input.raw)
  } catch (error) {
    throw new Error(`${where} ${(error as Error).message}`)
  }
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) throw new Error(`${where}: unknown key ${key}`)
  }

  const relative = (key: 'schemaEntry' | 'entitiesEntry' | 'baselineDir'): string | undefined => {
    const value = raw[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${where}.${key} must be a path inside the package`)
    }
    if (path.isAbsolute(value)) {
      throw new Error(`${where}.${key} must be relative to the package, got ${value}`)
    }
    const target = path.resolve(input.packageRoot, value)
    if (!target.startsWith(input.packageRoot + path.sep)) {
      throw new Error(`${where}.${key} points outside the package: ${value}`)
    }
    if (!fs.existsSync(target)) {
      throw new Error(`${where}.${key} does not exist: ${value}`)
    }
    return value
  }

  const dependsOn = raw.dependsOn ?? []
  if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== 'string')) {
    throw new Error(`${where}.dependsOn must be a list of plugin ids`)
  }

  return {
    schemaEntry: relative('schemaEntry'),
    entitiesEntry: relative('entitiesEntry'),
    baselineDir: relative('baselineDir'),
    dependsOn: [...(dependsOn as string[])].sort(),
  }
}

/** whether this declaration means the plugin put something into a database */
export const ownsObjects = (contribution: DatabaseContribution | undefined) =>
  Boolean(contribution?.schemaEntry ?? contribution?.entitiesEntry ?? contribution?.baselineDir)

/**
 * The same question asked of a declaration that came back out of the lock.
 *
 * A hand-edited lock can contain anything, and the answer decides whether a
 * removed plugin is remembered, so it may not assume the shape is intact.
 */
export const lockedOwnsObjects = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<DatabaseContribution>
  return (
    typeof record.schemaEntry === 'string' ||
    typeof record.entitiesEntry === 'string' ||
    typeof record.baselineDir === 'string'
  )
}
