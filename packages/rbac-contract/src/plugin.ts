import { Layer } from 'effect'
import {
  ExtensionPoint,
  Plugin,
  type PluginDescriptor,
  type PluginFeature,
} from '@qualy/plugin-kit'
import type { PermissionDefinition } from './index.ts'
import { Permissions, declarePermissions } from './effect.ts'

// The authorization capability's face in the descriptor model. A permission
// catalog is prepare-phase data - codes, targets, names - and rbac, which
// owns the registry and the table it mirrors into, interprets the set.

export interface PermissionDeclaration {
  /** the plugin's short name, the value a stored permission row records */
  readonly owner: string
  readonly permissions: readonly PermissionDefinition[]
}

/** every plugin's permission declarations, in plugin order */
export const PermissionDeclarations = ExtensionPoint.make<PermissionDeclaration>(
  '@qualy/rbac-contract/permissions',
  { phase: 'prepare' },
)

export const Access = {
  /** declares the codes this plugin defines */
  permissions: (owner: string, permissions: readonly PermissionDefinition[]): PluginFeature =>
    Plugin.contribute(PermissionDeclarations, { owner, permissions }),
}

/**
 * The legacy bridge, until the descriptor assembler takes over the host
 * (docs/plugin-descriptor-plan.md, batch 5): the runtime declaration this
 * contribution used to be, derived from the descriptor so the two shapes
 * cannot drift. Precisely typed, because the generated composition's types
 * are load-bearing until cutover.
 */
export const legacyPermissionLayer = (
  plugin: PluginDescriptor,
): Layer.Layer<never, never, Permissions> =>
  Layer.mergeAll(
    Layer.empty,
    ...Plugin.contributionsOf(plugin, PermissionDeclarations).map((declaration) =>
      declarePermissions(declaration.owner, declaration.permissions),
    ),
  )
