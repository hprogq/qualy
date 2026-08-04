import fs from 'node:fs'
import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { readEntries } from './lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from './lib/packages.ts'

// The permission catalog, pulled instead of pushed.
//
// Today a plugin pushes its codes into rbac from its own constructor. A static
// graph cannot express that: rbac would have to be built after every
// contributor to be complete, and before them to answer their authorization
// calls. Aggregating the catalogs here inverts it. rbac is handed a finished
// catalog and stops being downstream of anyone.
//
// The active set, deliberately. `readEntries({ all: true })` includes disabled
// plugins, which is right for the seed, whose rows must survive a plugin being
// switched off, and wrong here: a disabled plugin's codes must stop
// authorizing. `pnpm build` passes --all for the same seed reason, so this
// generator ignores argv rather than sharing that flag.

const catalogs: string[] = []
const imports: string[] = []
const owners = new Map<string, string>()

for (const entry of (await readEntries({ all: false })).filter((e) =>
  e.name.startsWith('@qualy/'),
)) {
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
  const owner = entry.name.split('/').pop()!.replace(/^plugin-/, '')
  const alias = `${owner.replace(/[^a-zA-Z0-9]+(.)/g, (_m, c: string) => c.toUpperCase())}Permissions`

  // a code claimed twice has no owner, and authorization would answer with
  // whichever definition was registered last. The runtime registry throws on
  // this today; catching it here moves the failure to whoever assembles the
  // release, before anything is deployed
  const module = (await import(resolvePluginModuleUrl(`${entry.name}/permissions`))) as {
    permissions?: ReadonlyArray<{ code: string }>
  }
  for (const definition of module.permissions ?? []) {
    const previous = owners.get(definition.code)
    if (previous) {
      throw new Error(`duplicate permission code ${definition.code}: ${previous} and ${owner}`)
    }
    owners.set(definition.code, owner)
  }

  imports.push(`import { permissions as ${alias} } from '${entry.name}/permissions'`)
  catalogs.push(`  ...${alias}.map((definition) => ({ ...definition, plugin: '${owner}' })),`)
}

writeGenerated(
  'packages/app/permissions.gen.ts',
  [
    "import type { ActivePermission } from '@qualy/rbac-contract'",
    ...imports,
    '',
    '/** every permission this assembly serves, owned by the plugin that declared it */',
    catalogs.length > 0
      ? `export const permissionCatalog: readonly ActivePermission[] = [\n${catalogs.join('\n')}\n]`
      : 'export const permissionCatalog: readonly ActivePermission[] = []',
  ].join('\n'),
)

export {}
