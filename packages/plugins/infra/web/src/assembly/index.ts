import path from 'node:path'
import { Schema } from 'effect'
import { defineCapabilityProvider, type ContributionInput } from '@qualy/assembly-contract'
import { RELEASE_STORE_VARIABLE, WebManifestConfig, rootsFrom } from '../config.ts'

// A deployment's web release store, as deploy work.
//
// An image carries the release it was built with, in a store of its own at
// this plugin's asset root. A deployment that keeps its releases in a store
// outliving images (RELEASE_STORE_VARIABLE) needs that release moved across
// once per release, before the server starts, so that a tab loaded from the
// previous release still finds its chunks when the next one is serving. That
// is deploy work in the lifecycle's sense: it changes something the instance
// keeps, from an artifact the image carries. A start verifies it happened -
// the server refuses a store whose current release is not the one its image
// carries (server/index.ts) - so this needs no record of its own.
//
// Nothing contributes to this capability and its state is empty; it exists
// for its deploy step. Importing this module must stay cheap and free of side
// effects, because every start imports it to check the assembly against the
// lock: the store's machinery is imported when deploy runs.

const PLUGIN_ID = '@qualy/plugin-web'

type WebReleaseState = Record<string, never>

export default defineCapabilityProvider<never, WebReleaseState>({
  key: 'web-release',

  parseContribution: (input: ContributionInput): never => {
    throw new Error(
      `${input.pluginId}: nothing contributes to web-release; it is ${PLUGIN_ID}'s own deploy step`,
    )
  },

  contributionFromDescriptor: () => undefined,

  resolve: () => ({}),

  plan: () => [
    `deploy installs the release this image carries into ${RELEASE_STORE_VARIABLE}, when it is set`,
  ],

  deploy: async (context) => {
    if (context.plugins.get(PLUGIN_ID)?.state !== 'active') {
      console.log(`web-release: ${PLUGIN_ID} is not active; there is no web release to install`)
      return
    }
    const target = process.env[RELEASE_STORE_VARIABLE]?.trim() ?? ''
    if (target === '') {
      console.log(
        `web-release: ${RELEASE_STORE_VARIABLE} is not set; the server serves the release its image carries`,
      )
      return
    }
    if (!path.isAbsolute(target)) {
      throw new Error(`${RELEASE_STORE_VARIABLE} must be an absolute path, not ${target}`)
    }
    const declared = Schema.decodeUnknownSync(WebManifestConfig, { onExcessProperty: 'error' })(
      context.providerConfig ?? {},
    )
    const { assetRoot } = rootsFrom(declared, path.dirname(context.manifestPath))
    const { promoteWebRelease, retentionFromEnv, storeAt } =
      await import('@qualy/web-build/release-store')
    const { release, reused, gc } = await promoteWebRelease({
      from: storeAt(assetRoot),
      to: storeAt(target),
      retention: retentionFromEnv(),
    })
    console.log(
      `web-release: ${release.releaseId} ${reused ? 'was already installed in' : 'installed into'} ${target}`,
    )
    if (gc !== undefined) {
      console.log(
        gc.skipped === undefined
          ? `web-release: kept ${String(gc.retained.length)} release(s); removed ${String(gc.removedReleases.length)} release(s), ${String(gc.removedAssets.length)} asset file(s)`
          : `web-release: nothing collected: ${gc.skipped}`,
      )
    }
  },
})
