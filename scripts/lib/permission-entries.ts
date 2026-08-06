import fs from 'node:fs'
import path from 'node:path'
import { readEntries } from './read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './packages.ts'

// The seed reads the same declaration the permissions capability resolves,
// `qualy.contributions.permissions.entry`. Declared, never probed: undeclared
// means no catalog, declared but inconsistent is a hard failure, and the entry
// has to be the same file as the package's ./permissions export so the running
// assembly and the seed can never consume two modules.
//
// It reads the declaration directly rather than the lock because the seed runs
// against a database whose plugins may be disabled, and a disabled plugin's
// rows must survive being switched off.
export interface PermissionCatalogRef {
  plugin: string
  moduleUrl: string
}

export async function resolvePermissionCatalogs(): Promise<PermissionCatalogRef[]> {
  const catalogs = new Map<string, PermissionCatalogRef>()
  for (const entry of await readEntries({ all: true })) {
    if (!entry.name.startsWith('@qualy/') || catalogs.has(entry.name)) continue
    const packageDir = resolvePackageDir(entry.name)
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
      qualy?: { contributions?: { permissions?: { entry?: string } } }
    }
    const declared = pkg.qualy?.contributions?.permissions?.entry
    if (!declared) continue
    const exported = pkg.exports?.['./permissions']
    if (typeof exported !== 'string' || path.normalize(exported) !== path.normalize(declared)) {
      throw new Error(
        `${entry.name}: qualy.contributions.permissions.entry and exports["./permissions"] must point at the same file`,
      )
    }
    catalogs.set(entry.name, {
      plugin: entry.name
        .split('/')
        .pop()!
        .replace(/^plugin-/, ''),
      moduleUrl: resolvePluginModuleUrl(`${entry.name}/permissions`),
    })
  }
  return [...catalogs.values()]
}
