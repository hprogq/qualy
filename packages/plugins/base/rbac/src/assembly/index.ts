import fs from 'node:fs'
import path from 'node:path'
import { defineCapabilityProvider, type ContributionInput } from '@qualy/assembly-contract'

// Everything the assembly knows about permissions lives behind this one
// module, and it disappears with rbac: an assembly with no authorization
// resolves no catalog and generates no module naming one.
//
// Permissions are a capability rather than a registry, and the reason is a
// timing fact rather than a preference. rbac mirrors the declared catalog into
// the permissions table while its own layer is built, because every
// authorization statement joins that table; the plugins that declare codes are
// built ON TOP of rbac, so a registry they pushed into would be read empty.
// The seed needs the same catalog without starting an application, which a
// registry cannot offer at all.
//
// Importing this module must stay free of side effects: it runs inside the
// CLI, which has agreed to open nothing.

/** where the host finds the aggregate, relative to its own workspace */
export const PERMISSIONS_MODULE = 'permissions.gen.ts'

export interface PermissionsContribution {
  /** the module whose `permissions` export is this plugin's catalog */
  entry: string
}

export interface PermissionsState {
  /** the plugins that declare codes, in a stable order */
  order: string[]
}

const asState = (value: unknown): PermissionsState => {
  const order = (value as PermissionsState | undefined)?.order
  return { order: Array.isArray(order) ? order.filter((id) => typeof id === 'string') : [] }
}

/** the plugin's short name, which is what a stored row records as its owner */
const ownerOf = (pluginId: string) =>
  pluginId
    .split('/')
    .pop()!
    .replace(/^plugin-/, '')

const localName = (pluginId: string) =>
  `${ownerOf(pluginId).replace(/[^a-zA-Z0-9]+(.)/g, (_match, next: string) => next.toUpperCase())}Permissions`

export function parsePermissionsContribution(input: ContributionInput): PermissionsContribution {
  const where = `${input.pluginId}: qualy.contributions.permissions`
  const raw = input.raw
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where} must be a mapping`)
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'entry') throw new Error(`${where}: unknown key ${key}`)
  }
  const entry = (raw as { entry?: unknown }).entry
  if (typeof entry !== 'string' || !entry.trim()) {
    throw new Error(`${where}.entry must be a path inside the package`)
  }
  if (path.isAbsolute(entry)) {
    throw new Error(`${where}.entry must be relative to the package, got ${entry}`)
  }
  return { entry }
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
 * The declaring module, checked against the subpath the host will import.
 *
 * Cross-plugin references and the seed reach the catalog through
 * `exports['./permissions']`, so a declaration pointing somewhere else would
 * mean two modules, two arrays and two answers to what a code means.
 */
const catalogFile = (
  packageDir: string,
  pluginId: string,
  contribution: PermissionsContribution,
): string => {
  const file = path.resolve(packageDir, contribution.entry)
  const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
  }
  const exported = exportTarget(pkg.exports?.['./permissions'])
  if (!exported || path.resolve(packageDir, exported) !== file) {
    throw new Error(
      `${pluginId}: exports["./permissions"] and qualy.contributions.permissions.entry must point at the same file`,
    )
  }
  return file
}

/**
 * A code claimed twice has no owner.
 *
 * Authorization would answer with whichever definition was registered last,
 * and both plugins would look correct in isolation. Read from source rather
 * than by importing, because resolution reads files and never runs plugin
 * code - importing here would execute a plugin during `qualy resolve`.
 */
function assertNoDuplicateCodes(files: readonly { pluginId: string; file: string }[]): void {
  const owners = new Map<string, string>()
  const clashes: string[] = []
  for (const entry of files) {
    const source = fs.readFileSync(entry.file, 'utf8')
    for (const [, code] of source.matchAll(/\bcode:\s*'([^']+)'/g) as Iterable<RegExpMatchArray>) {
      const previous = owners.get(code!)
      if (previous && previous !== entry.pluginId) {
        clashes.push(`${code} is declared by both ${previous} and ${entry.pluginId}`)
      } else {
        owners.set(code!, entry.pluginId)
      }
    }
  }
  if (clashes.length > 0) {
    throw new Error(`permission codes collide:\n  ${clashes.join('\n  ')}`)
  }
}

export default defineCapabilityProvider<PermissionsContribution, PermissionsState>({
  key: 'permissions',

  parseContribution: parsePermissionsContribution,

  // The ACTIVE set, deliberately. A disabled plugin keeps its tables, because
  // switching it off must not lose data; it must not keep its codes, because a
  // code that still authorizes against a surface nobody serves is a permission
  // granted for nothing. The two capabilities answer the same question
  // differently, which is why each answers it for itself.
  resolve: (context) => ({
    order: [...context.contributions.keys()]
      .filter((pluginId) => context.plugins.get(pluginId)?.state === 'active')
      .sort(),
  }),

  // A catalog is a declaration, not a resource: a plugin that leaves takes its
  // codes with it, and the rows its codes named are rbac's to reconcile.
  retainsPlugin: () => false,

  plan: ({ nextState }) =>
    nextState.order.length > 0
      ? nextState.order.map((id) => `+ ${id}`)
      : ['no plugin declares permissions'],

  modules: (context) => {
    const state = asState(context.state)
    const declaring = state.order.flatMap((pluginId) => {
      const contribution = context.contributions.get(pluginId)
      if (!contribution) return []
      const packageDir = context.resolvePackageDir(pluginId)
      return [{ pluginId, file: catalogFile(packageDir, pluginId, contribution) }]
    })
    assertNoDuplicateCodes(declaring)

    const imports = declaring.map(
      (entry) =>
        `import { permissions as ${localName(entry.pluginId)} } from '${entry.pluginId}/permissions'`,
    )
    const spread = declaring.map(
      (entry) =>
        `  ...${localName(entry.pluginId)}.map((definition) => ({ ...definition, plugin: '${ownerOf(entry.pluginId)}' })),`,
    )
    return [
      {
        path: PERMISSIONS_MODULE,
        // the module carries the layer rather than the array: the tag belongs
        // to a contract package, and a host that named it would be naming a
        // service that does not exist in an assembly without authorization
        layerExport: 'permissionCatalogLayer',
        content: [
          "import { Layer } from 'effect'",
          "import type { ActivePermission } from '@qualy/rbac-contract'",
          "import { PermissionCatalog } from '@qualy/rbac-contract/effect'",
          ...imports,
          '',
          '/** every permission this assembly serves, owned by the plugin that declared it */',
          declaring.length > 0
            ? `export const permissionCatalog: readonly ActivePermission[] = [\n${spread.join('\n')}\n]`
            : 'export const permissionCatalog: readonly ActivePermission[] = []',
          '',
          '/** the catalog as the service rbac reads it from */',
          'export const permissionCatalogLayer = Layer.succeed(PermissionCatalog, permissionCatalog)',
        ].join('\n'),
      },
    ]
  },
})

export type { PermissionsContribution as Contribution, PermissionsState as State }
