import { Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import type { Orm } from '@qualy/plugin-database/server'
import { DeclaredBackends } from '../plugin.ts'
import { cleanupLayer, schedulerLayer, StorageCleanup } from './cleanup.ts'
import { StorageConfig } from './config.ts'
import { barrierLayer, registryLayer, StorageBackends } from './registry.ts'
import { Storage, serviceLayer as storageLayer } from './service.ts'

// What core storage publishes: the service, the registry providers register
// into, and the sweeper. A provider plugin reaches this module for the
// registry and `@qualy/plugin-storage/backend` for the contract; nothing else
// here is any provider's business.

export { config, DEFAULT_LIMITS, StorageConfig, type StorageLimits } from './config.ts'
export { StorageBackends } from './registry.ts'
export {
  objectKeyOf,
  type BackendOpen,
  type BlobStat,
  type PrepareUploadRequest,
  type StorageBackend,
} from './backend.ts'
export {
  Storage,
  type AttachmentMeta,
  type AttachmentOpen,
  type BindError,
  type CompleteUploadError,
  type PrepareUploadError,
  type PrepareUploadInput,
} from './service.ts'
export { CLEANUP_LEASE_MS, StorageCleanup, SWEEP_INTERVAL, type SweepReport } from './cleanup.ts'
export { lockKey } from './db.ts'

/**
 * Everything this plugin runs, in one layer.
 *
 * The order is the only interesting part: the registry exists before any
 * provider builds - they depend on this plugin, so they build after it - and
 * the barrier check runs at assembly, by which time every provider has had
 * its chance to register.
 */
export const serviceLayer: Layer.Layer<
  Storage | StorageBackends | StorageCleanup,
  never,
  Orm | StorageConfig | DeclaredBackends | Assembled
> = Layer.mergeAll(storageLayer, schedulerLayer, barrierLayer).pipe(
  Layer.provideMerge(cleanupLayer),
  Layer.provideMerge(registryLayer),
)
