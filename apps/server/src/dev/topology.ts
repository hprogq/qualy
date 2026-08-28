import path from 'node:path'
import { collectDevServices, type DevServiceSpec } from '@qualy/plugin-kit/dev'
import type { Resolution } from '@qualy/assembly'

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
