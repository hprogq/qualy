import fs from 'node:fs'
import path from 'node:path'
import { lockPathFor, readLock } from '@qualy/assembly'
import { manifestPath, repoRoot } from '../lib/manifest.ts'
import { readCurrentWebRelease, storeAt } from '../../packages/build/web/src/release-store.ts'

// The staged web release, whole: the store points at a release, the release
// has its shell and every asset it names, and it was built from the assembly
// the lock records. What CI asks after `pnpm build`, in place of looking for
// one file - and what a deployment may ask before starting a host.

const fail = (message: string): never => {
  console.error(`check-staged-web: ${message}`)
  process.exit(1)
}

const store = storeAt(
  process.argv[2] === undefined
    ? path.join(repoRoot, 'packages/plugins/infra/web/client-dist')
    : path.resolve(process.argv[2]),
)
const current = (() => {
  try {
    return readCurrentWebRelease(store)
  } catch (error) {
    return fail(
      `the store at ${store.root} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
})()
if (current === undefined) fail(`no web release is installed at ${store.root}; run \`pnpm build\``)
const { releaseId, root, release } = current!
if (!fs.existsSync(path.join(root, 'index.html'))) fail(`release ${releaseId} has no index.html`)
const missing = release.assets.filter((asset) => !fs.existsSync(path.join(store.root, asset)))
if (missing.length > 0) {
  fail(
    `release ${releaseId} names ${String(missing.length)} asset(s) the store does not hold: ${missing.slice(0, 5).join(', ')}`,
  )
}
const lock = readLock(lockPathFor(manifestPath()))
if (!lock) fail('no assembly lock; run `pnpm qualy resolve`')
if (release.resolutionHash !== lock!.resolutionHash) {
  fail(
    `release ${releaseId} was built from assembly ${release.resolutionHash}, the lock records ${lock!.resolutionHash}`,
  )
}
console.log(
  `staged web release ${releaseId} (${String(release.assets.length)} assets, ${release.mode}, protocol ${String(release.clientProtocol)})`,
)
