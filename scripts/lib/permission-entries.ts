import fs from 'node:fs'
import path from 'node:path'
import { readEntries } from './read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './schema-entries.ts'

// permission catalogs are declared capability (qualy.permissions.entry),
// mirroring the schemaEntry discipline: undeclared = no catalog, declared
// but inconsistent = hard failure. The entry must be the same file as the
// package's ./permissions export, so the runtime registry and the seed
// always consume one module.
export interface PermissionCatalogRef {
  plugin: string
  moduleUrl: string
}

export function resolvePermissionCatalogs(): PermissionCatalogRef[] {
  const catalogs = new Map<string, PermissionCatalogRef>()
  for (const entry of readEntries({ all: true })) {
    if (!entry.name.startsWith('@qualy/') || catalogs.has(entry.name)) continue
    const packageDir = resolvePackageDir(entry.name)
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
      qualy?: { permissions?: { entry?: string } }
    }
    const declared = pkg.qualy?.permissions?.entry
    if (!declared) continue
    const exported = pkg.exports?.['./permissions']
    if (typeof exported !== 'string' || path.normalize(exported) !== path.normalize(declared)) {
      throw new Error(
        `${entry.name}: qualy.permissions.entry and exports["./permissions"] must point at the same file`,
      )
    }
    catalogs.set(entry.name, {
      plugin: entry.name.split('/').pop()!.replace(/^plugin-/, ''),
      moduleUrl: resolvePluginModuleUrl(`${entry.name}/permissions`),
    })
  }
  return [...catalogs.values()]
}
