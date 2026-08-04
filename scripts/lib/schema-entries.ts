import fs from 'node:fs'
import path from 'node:path'
import { currentResolution, retainedEntries } from './read-entries.ts'

// Schema aggregation reads the RETAINED set: active, disabled and detached
// alike. Switching a plugin off or taking it out of the manifest never
// changes the schema, so tables outlive both. Database capability is
// declared, never probed: a plugin without qualy.database.schemaEntry
// contributes nothing, a declared entry that fails to resolve is a hard
// error. Cross-plugin database dependencies are checked during resolution,
// before anything here runs.

/**
 * The host owns its plugins: resolution anchors at the directory holding the
 * manifest, mirroring how the loader resolves entries at runtime.
 */
export function resolvePluginModuleUrl(specifier: string): string {
  return currentResolution().resolver.resolveModuleUrl(specifier)
}

export function resolvePackageDir(id: string): string {
  return currentResolution().resolver.resolvePackageDir(id)
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return exportTarget(record.import ?? record.default)
  }
  return undefined
}

export function resolveSchemaEntries(options: { ymlPath?: string } = {}): string[] {
  const resolution = currentResolution(options)
  const entries: string[] = []
  for (const entry of retainedEntries(options)) {
    const plugin = resolution.plugins.get(entry.name)!
    const schemaEntry = plugin.database?.schemaEntry
    if (!schemaEntry) continue
    const packageDir = resolution.resolver.resolvePackageDir(entry.name)
    const file = path.resolve(packageDir, schemaEntry)
    if (!fs.existsSync(file)) {
      throw new Error(
        `${entry.name}: declared schemaEntry ${schemaEntry} does not resolve to a file`,
      )
    }
    // cross-plugin imports and kit aggregation must share one file
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
    }
    const exported = exportTarget(pkg.exports?.['./schema'])
    if (exported && path.resolve(packageDir, exported) !== file) {
      throw new Error(
        `${entry.name}: exports["./schema"] and qualy.database.schemaEntry must point at the same file`,
      )
    }
    entries.push(file)
  }
  return entries
}
