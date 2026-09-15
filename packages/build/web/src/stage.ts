import path from 'node:path'
import { lockPathFor, readLock } from '@qualy/assembly'
import { manifestPath, repoRoot } from './manifest.ts'
import { installWebRelease, retentionFromEnv, storeAt } from './release-store.ts'

// the web build stays in apps/web (composition root), the runtime artifact
// belongs to the web plugin: install the build into its release store. The
// store keeps earlier releases and their assets for a while (release-store.ts),
// so a browser on the last build keeps finding its chunks after this one.

const source = path.join(repoRoot, 'apps/web/dist')
const target = path.join(repoRoot, 'packages/plugins/infra/web/client-dist')

// The bundle carries the hash of the assembly it was built from; production
// boot compares it against the running lock and refuses a release built
// from a different assembly - nothing inside either half can notice that
// mismatch on its own.
const lock = readLock(lockPathFor(manifestPath()))
if (!lock) {
  throw new Error('no assembly lock; run `pnpm qualy resolve` before staging web assets')
}

const { release, reused, gc } = await installWebRelease({
  source,
  store: storeAt(target),
  resolutionHash: lock.resolutionHash,
  retention: retentionFromEnv(),
})

console.log(
  `installed web release ${release.releaseId} -> ${path.relative(process.cwd(), target)}` +
    ` (${reused ? 'already installed' : `${String(release.assets.length)} assets`})`,
)
if (gc !== undefined) {
  console.log(
    gc.skipped === undefined
      ? `  retained ${String(gc.retained.length)} release(s); removed ${String(gc.removedReleases.length)} release(s), ${String(gc.removedAssets.length)} asset file(s)`
      : `  nothing collected: ${gc.skipped}`,
  )
}
