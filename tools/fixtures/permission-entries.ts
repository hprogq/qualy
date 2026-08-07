import { isPluginDescriptor, Plugin } from '@qualy/plugin-kit'
import { readEntries, resolvePluginModuleUrl } from '@qualy/assembly/host'
import { manifestPath } from '../lib/manifest.ts'

// The seed reads the same declarations the permissions capability resolves and
// the running assembly compiles: the Access.permissions features on each
// plugin's descriptor. Declared, never probed - a descriptor without the
// feature has no catalog.
//
// It reads descriptors directly rather than the lock because the seed runs
// against a database whose plugins may be disabled, and a disabled plugin's
// rows must survive being switched off.

export type PermissionCatalog =
  import('../../packages/rbac-contract/src/plugin.ts').PermissionDeclaration

// the extension point lives in a package the repository root deliberately does
// not depend on, so it resolves through the host like the plugins themselves
const declarationsPoint = async () =>
  (
    (await import(
      resolvePluginModuleUrl('@qualy/rbac-contract/plugin', manifestPath())
    )) as typeof import('../../packages/rbac-contract/src/plugin.ts')
  ).PermissionDeclarations

export async function resolvePermissionCatalogs(): Promise<PermissionCatalog[]> {
  const point = await declarationsPoint()
  const catalogs: PermissionCatalog[] = []
  const seen = new Set<string>()
  for (const entry of await readEntries({ manifestPath: manifestPath(), all: true })) {
    if (!entry.name.startsWith('@qualy/') || seen.has(entry.name)) continue
    seen.add(entry.name)
    const module = (await import(resolvePluginModuleUrl(entry.name, manifestPath()))) as { default?: unknown }
    if (!isPluginDescriptor(module.default)) {
      throw new Error(`${entry.name} does not default-export a plugin descriptor`)
    }
    catalogs.push(...Plugin.contributionsOf(module.default, point))
  }
  return catalogs
}
