import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readEntries } from './read-entries.ts'

// schema aggregation reads the FULL entry list (disabled included):
// deactivating a plugin never changes the schema set, so tables outlive
// deactivation. Database capability is declared, never probed: a plugin
// without qualy.database.schemaEntry contributes nothing, a declared entry
// that fails to resolve is a hard error.

// the host owns its plugins: all plugin resolution anchors at packages/app,
// mirroring how the loader resolves entries at runtime
const hostRequire = createRequire(path.resolve('packages/app/package.json'))

export function resolvePluginModuleUrl(specifier: string): string {
  return pathToFileURL(hostRequire.resolve(specifier)).href
}

export function resolvePackageDir(id: string): string {
  let entryPath: string
  try {
    entryPath = hostRequire.resolve(id)
  } catch {
    throw new Error(
      `${id} cannot be resolved: add it to packages/app dependencies, or check that its exports map declares a "." entry`,
    )
  }
  let dir = path.dirname(entryPath)
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`cannot locate package.json for ${id}`)
    dir = parent
  }
  return fs.realpathSync(dir)
}

interface PackageManifest {
  exports?: Record<string, unknown>
  qualy?: { database?: { schemaEntry?: string } }
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
  const entries: string[] = []
  for (const entry of readEntries({ all: true, ymlPath: options.ymlPath })) {
    if (!entry.name.startsWith('@qualy/')) continue
    const packageDir = resolvePackageDir(entry.name)
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
    ) as PackageManifest
    const schemaEntry = pkg.qualy?.database?.schemaEntry
    if (!schemaEntry) continue
    const file = path.resolve(packageDir, schemaEntry)
    if (!fs.existsSync(file)) {
      throw new Error(
        `${entry.name}: declared schemaEntry ${schemaEntry} does not resolve to a file`,
      )
    }
    // cross-plugin imports and kit aggregation must share one file
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
