import path from 'node:path'
import { collectDevServices, type DevServiceSpec } from '@qualy/plugin-kit/dev'
import type { Resolution } from '@qualy/assembly'
import type { PluginRoot } from './protocol.ts'

// Which development services this assembly asks for, read from the same
// resolution the runtime is built from.
//
// The host does this rather than the supervisor, and it is the only place
// that can: resolving `@qualy/plugin-web/dev` means asking the dependency
// graph the assembly was resolved against, and that graph belongs to this
// process. What crosses to the supervisor afterwards is plain data.
//
// Only what runs. A plugin kept in the lock for its data but taken off the
// runtime has no development service either - it has no runtime to develop.

export const devTopology = (resolution: Resolution): readonly DevServiceSpec[] =>
  collectDevServices(
    resolution.runtimePlugins.map((id) => {
      const descriptor = resolution.descriptors.get(id)!
      return {
        descriptor,
        packageRoot: resolution.resolver.resolvePackageDir(id),
        config: descriptor.config ? (resolution.manifest.plugins.get(id)?.config ?? {}) : undefined,
      }
    }),
    {
      manifestDir: path.dirname(resolution.manifest.source),
      resolveModuleUrl: (specifier) => resolution.resolver.resolveModuleUrl(specifier),
    },
  )

/**
 * Where every active plugin's package really is.
 *
 * Resolved here for the same reason the service modules are: the dependency
 * graph belongs to this process. A package whose real path lies outside a
 * `node_modules` is one somebody is editing - a workspace member, or a link
 * into a checkout beside this one - and is worth watching; an installed one
 * does not change under anybody.
 */
export const pluginRoots = (resolution: Resolution): readonly PluginRoot[] =>
  resolution.runtimePlugins.map((id) => {
    const root = resolution.resolver.resolvePackageDir(id)
    return { id, root, linked: !root.split(path.sep).includes('node_modules') }
  })
