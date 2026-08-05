import { createPackageResolver, hostDirFor, readManifest, type PackageResolver } from '@qualy/assembly'
import { manifestPath } from './read-entries.ts'

// Plugin packages resolve from the host the manifest names, which is the
// package that declares them. Resolving from the repository root instead would
// find packages that host never declared, and pnpm's isolation means those are
// exactly the ones that fail to load.
//
// This needs the host directory and nothing else, so it stays synchronous.
// Routing it through a full resolution would make every caller await a
// capability provider import to answer a question about a file path.

const resolvers = new Map<string, PackageResolver>()

export function hostResolver(ymlPath?: string): PackageResolver {
  const host = hostDirFor(readManifest(manifestPath(ymlPath)))
  const cached = resolvers.get(host)
  if (cached) return cached
  const resolver = createPackageResolver(host)
  resolvers.set(host, resolver)
  return resolver
}

export const resolvePluginModuleUrl = (specifier: string, ymlPath?: string): string =>
  hostResolver(ymlPath).resolveModuleUrl(specifier)

export const resolvePackageDir = (id: string, ymlPath?: string): string =>
  hostResolver(ymlPath).resolvePackageDir(id)
