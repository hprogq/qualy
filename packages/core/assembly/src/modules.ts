import path from 'node:path'
import type { CapabilityModule } from '@qualy/assembly-contract'
import type { Resolution } from './resolve.ts'

// The modules capabilities derive, collected so the core can write them and
// compare them without knowing what any of them say.
//
// Two callers need the same answer and must not compute it differently:
// codegen writes these files, and the frozen gate asks whether the tree
// already holds them. A gate that regenerated them to find out would report
// every tree as current.

export interface GeneratedModule {
  /** relative to the product root, the manifest's directory, like every other generated artifact */
  path: string
  content: string
  /** the Layer this module exports, for the runtime module to import and merge */
  layerExport?: string
}

/**
 * Where a capability's module lands.
 *
 * Relative to the product root and nowhere else: the package that installs
 * the plugins is the one that imports what they derive. A module reached by
 * `..` is outside that package, and writing there is the same operation as
 * writing anywhere on the disk.
 */
const locate = (key: string, declared: string): string => {
  if (path.isAbsolute(declared)) {
    throw new Error(`capability ${key} generates an absolute path: ${declared}`)
  }
  const inside = path.posix.normalize(declared.split(path.sep).join('/'))
  if (inside === '..' || inside.startsWith('../')) {
    throw new Error(`capability ${key} generates outside the product root: ${declared}`)
  }
  return inside
}

/**
 * Every module this assembly's capabilities derive, in a stable order.
 *
 * Two capabilities claiming one path is refused here rather than resolved by
 * whichever ran last, which is the same reason two providers may not claim one
 * key.
 */
export function capabilityModules(resolution: Resolution): GeneratedModule[] {
  const owners = new Map<string, string>()
  const modules: GeneratedModule[] = []
  for (const key of [...resolution.providers.keys()].sort()) {
    const provider = resolution.providers.get(key)!.provider
    if (!provider.modules) continue
    const declared: CapabilityModule[] = provider.modules({
      manifestPath: resolution.manifest.source,
      plugins: resolution.plugins,
      contributions: resolution.contributions.get(key) ?? new Map(),
      descriptors: resolution.descriptors,
      resolvePackageDir: resolution.resolver.resolvePackageDir,
      state: resolution.capabilities.get(key)?.state,
    })
    for (const module of declared) {
      const at = locate(key, module.path)
      const owner = owners.get(at)
      if (owner) throw new Error(`capabilities ${owner} and ${key} both generate ${at}`)
      owners.set(at, key)
      modules.push({
        path: at,
        content: module.content,
        ...(module.layerExport === undefined ? {} : { layerExport: module.layerExport }),
      })
    }
  }
  return modules.sort((left, right) => (left.path < right.path ? -1 : 1))
}

/** what a tree is missing before it is the one this manifest generates */
export function moduleDrift(
  modules: readonly GeneratedModule[],
  read: (relative: string) => string | undefined,
): string[] {
  const reasons: string[] = []
  for (const module of modules) {
    const found = read(module.path)
    if (found === undefined) reasons.push(`${module.path} is missing`)
    else if (found !== module.content) {
      reasons.push(`${module.path} is not what this manifest generates`)
    }
  }
  return reasons
}
