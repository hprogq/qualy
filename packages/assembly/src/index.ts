export { canonicalHash, shortId } from './hash.ts'
export {
  MANIFEST_VERSION,
  hostDirFor,
  lockPathFor,
  manifestHash,
  parseManifest,
  readManifest,
  renderManifest,
  runtimePlanPathFor,
  type AssemblyManifest,
  type ManifestEntry,
} from './manifest.ts'
export { createPackageResolver, type PackageResolver, type PluginMetadata } from './metadata.ts'
export { loadProviders, type LoadedProvider } from './registry.ts'
export {
  activePlugins,
  resolveAssembly,
  retainedPlugins,
  type ResolveOptions,
  type Resolution,
  type ResolvedCapability,
  type ResolvedPlugin,
  type PluginState,
} from './resolve.ts'
export {
  LOCKFILE_VERSION,
  frozenLockfile,
  lockDrift,
  lockFromResolution,
  lockSelfHash,
  readLock,
  renderLock,
  writeAtomic,
  writeLock,
  type AssemblyLock,
  type LockedCapability,
  type LockedPlugin,
} from './lock.ts'
export {
  renderRuntimePlan,
  runtimeEntries,
  writeRuntimePlan,
  type RuntimeEntry,
} from './runtime-plan.ts'
export { capabilityContext, capabilityWork, type CapabilityWork } from './work.ts'
