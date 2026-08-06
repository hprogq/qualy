import { defineCapabilityProvider, type ContributionInput } from '@qualy/assembly-contract'
import { Plugin, isPluginDescriptor } from '@qualy/plugin-kit'
import { compileCatalog, PermissionDeclarations } from '@qualy/rbac-contract/plugin'

// Everything the assembly knows about permissions lives behind this one
// module, and it disappears with rbac: an assembly with no authorization
// resolves no catalog.
//
// The contributions come from plugin descriptors - the same Access
// declarations the runtime compiles - so resolve validates the real catalog:
// a duplicate code is refused here with both owners named, exactly as boot
// would refuse it, instead of a source-text scan approximating the answer.
// What is left in the lock is who declares codes and which codes, which is
// what a reviewed assembly diff should show.
//
// Importing this module must stay free of side effects: it runs inside the
// CLI, which has agreed to open nothing.

export interface PermissionsContribution {
  /** the plugin's short name, the value a stored permission row records */
  owner: string
  /** the codes this plugin declares, sorted */
  codes: string[]
}

export interface PermissionsState {
  /** the plugins that declare codes, in a stable order */
  order: string[]
}

export default defineCapabilityProvider<PermissionsContribution, PermissionsState>({
  key: 'permissions',

  // package.json declarations are refused by the core once this hook exists;
  // this only satisfies the contract's shape
  parseContribution: (input: ContributionInput): PermissionsContribution => {
    throw new Error(
      `${input.pluginId}: qualy.contributions.permissions moved into the plugin descriptor (Access.permissions)`,
    )
  },

  contributionFromDescriptor: ({ pluginId, descriptor }) => {
    if (!isPluginDescriptor(descriptor)) return undefined
    const declarations = Plugin.contributionsOf(descriptor, PermissionDeclarations)
    if (declarations.length === 0) return undefined
    // one plugin, one owner name: a descriptor declaring under two owners
    // would scatter its rows across identities nobody can audit
    const owners = new Set(declarations.map((declaration) => declaration.owner))
    if (owners.size > 1) {
      throw new Error(
        `${pluginId} declares permissions under several owners: ${[...owners].sort().join(', ')}`,
      )
    }
    return {
      owner: [...owners][0]!,
      codes: declarations
        .flatMap((declaration) => declaration.permissions.map((permission) => permission.code))
        .sort(),
    }
  },

  // The ACTIVE set, deliberately. A disabled plugin keeps its tables, because
  // switching it off must not lose data; it must not keep its codes, because a
  // code that still authorizes against a surface nobody serves is a permission
  // granted for nothing. The two capabilities answer the same question
  // differently, which is why each answers it for itself.
  //
  // Duplicate codes are refused by compiling the same catalog boot compiles:
  // resolve holds the declared values now, so the early answer and the
  // authoritative one are the same function.
  resolve: (context) => {
    const active = [...context.contributions.entries()]
      .filter(([pluginId]) => context.plugins.get(pluginId)?.state === 'active')
      .sort(([a], [b]) => a.localeCompare(b))
    compileCatalog(
      active.map(([, contribution]) => ({
        owner: contribution.owner,
        permissions: contribution.codes.map((code) => ({
          code,
          name: code,
          target: 'tenant' as const,
        })),
      })),
    )
    return { order: active.map(([pluginId]) => pluginId) }
  },

  // A catalog is a declaration, not a resource: a plugin that leaves takes its
  // codes with it, and the rows its codes named are rbac's to reconcile.
  retainsPlugin: () => false,

  plan: ({ nextState }) =>
    nextState.order.length > 0
      ? nextState.order.map((id) => `+ ${id}`)
      : ['no plugin declares permissions'],
})

export type { PermissionsContribution as Contribution, PermissionsState as State }
