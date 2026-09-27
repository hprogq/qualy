import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'

// Where the browser application is, said once for both halves of this plugin.
//
// One schema, two readers. The runtime that serves a built bundle wants
// `assetRoot`; the development service that runs Vite wants `sourceRoot`.
// Splitting them into two schemas would make each half refuse the other's
// key, and a manifest block is written by somebody configuring the product,
// not by whichever half happens to read it.
//
// Paths in a manifest are relative to the manifest. Anchoring them here is
// what keeps the host from needing to know this plugin serves files at all.

/**
 * Where a deployment keeps its web releases, when it keeps them apart from the
 * image: an absolute path, set for the deploy job and the server alike.
 *
 * Unset, the server serves the release its asset root holds, which is how a
 * checkout and a bare image run. Set, the deploy job installs the image's
 * release there and the server serves from there, so the releases before it
 * stay beside it for the tabs still running them. A per-deployment fact, so
 * it comes from the environment and never from the manifest.
 */
export const RELEASE_STORE_VARIABLE = 'QUALY_WEB_RELEASE_STORE'

/** anchored at this package, never at whatever directory a process started in */
export const defaultAssetRoot = fileURLToPath(new URL('../client-dist/', import.meta.url))
export const defaultSourceRoot = fileURLToPath(new URL('../../../../../apps/web/', import.meta.url))

export const WebManifestConfig = Schema.Struct({
  sourceRoot: Schema.optional(Schema.String),
  assetRoot: Schema.optional(Schema.String),
})
export type WebManifestConfig = typeof WebManifestConfig.Type

export interface WebRoots {
  readonly sourceRoot: string
  readonly assetRoot: string
}

/** the block as a pair of absolute paths, with this package's own defaults */
export const rootsFrom = (declared: WebManifestConfig, manifestDir: string): WebRoots => ({
  sourceRoot:
    declared.sourceRoot === undefined
      ? defaultSourceRoot
      : path.resolve(manifestDir, declared.sourceRoot),
  assetRoot:
    declared.assetRoot === undefined
      ? defaultAssetRoot
      : path.resolve(manifestDir, declared.assetRoot),
})
