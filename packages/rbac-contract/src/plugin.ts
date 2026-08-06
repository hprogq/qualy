import { Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import type { ActivePermission, PermissionDefinition } from './index.ts'
import { PermissionCatalog } from './effect.ts'

// The authorization capability's face in the descriptor model. A permission
// catalog is prepare-phase data - codes, targets, names - and rbac, which
// owns the table it mirrors into, interprets the set.

export interface PermissionDeclaration {
  /** the plugin's short name, the value a stored permission row records */
  readonly owner: string
  readonly permissions: readonly PermissionDefinition[]
}

/** every plugin's permission declarations, in plugin order */
export const PermissionDeclarations = ExtensionPoint.make<PermissionDeclaration>(
  '@qualy/rbac-contract/permissions',
  { phase: 'prepare', capability: 'permissions' },
)

/**
 * The declarations flattened with their owners stamped, duplicates refused.
 *
 * A code claimed twice has no owner - authorization would answer with
 * whichever definition arrived last - so compilation refuses the assembly
 * naming both plugins. Exported for harnesses, which build catalogs from the
 * same declarations production compiles.
 */
export const compileCatalog = (
  declarations: readonly PermissionDeclaration[],
): ActivePermission[] => {
  const owners = new Map<string, string>()
  const catalog: ActivePermission[] = []
  for (const declaration of declarations) {
    for (const permission of declaration.permissions) {
      const previous = owners.get(permission.code)
      if (previous) {
        throw new Error(
          `permission ${permission.code} is declared by both ${previous} and ${declaration.owner}`,
        )
      }
      owners.set(permission.code, declaration.owner)
      catalog.push({ ...permission, plugin: declaration.owner })
    }
  }
  return catalog
}

export const Access = {
  /** declares the codes this plugin defines */
  permissions: (owner: string, permissions: readonly PermissionDefinition[]): PluginFeature =>
    Plugin.contribute(PermissionDeclarations, { owner, permissions }),

  /** the owner's interpretation: the finished catalog, before any layer builds */
  provider: Plugin.provideExtension(PermissionDeclarations, {
    compile: (declarations) => Layer.succeed(PermissionCatalog, compileCatalog(declarations)),
  }),
}
