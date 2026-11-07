import fs from 'node:fs'
import path from 'node:path'
import { lockPathFor, readLock } from '@qualy/assembly'
import { manifestPath, repoRoot } from './manifest.ts'
import { installWebRelease, retentionFromEnv, storeAt } from './release-store.ts'
import { SERVER_BUILD_METADATA, WEB_BUILD_METADATA } from './release-vite.ts'

// The web build stays in apps/web (composition root); what runs belongs to
// the web plugin. A build has two halves (docs/adr/0012-rsc-data-mode.md):
//
// - the browser's, installed into the plugin's release store, which keeps
//   earlier releases and their assets for a while (release-store.ts), so a
//   browser on the last build keeps finding its chunks after this one;
// - the server's - the two environments that draw a document - placed in the
//   plugin's server directory, which is executable code and so travels with
//   the image that runs it: never resolved from a store, never kept from an
//   earlier build. It names the release it draws, which a host checks against
//   the release it pins before it serves a page.

const build = path.join(repoRoot, 'apps/web/dist-rsc')
const client = path.join(build, 'client')
const store = path.join(repoRoot, 'packages/plugins/infra/web/client-dist')
const server = path.join(repoRoot, 'packages/plugins/infra/web/server-dist')

// The bundle carries the hash of the assembly it was built from; production
// boot compares it against the running lock and refuses a release built
// from a different assembly - nothing inside either half can notice that
// mismatch on its own.
const lock = readLock(lockPathFor(manifestPath()))
if (!lock) {
  throw new Error('no assembly lock; run `pnpm qualy resolve` before staging web assets')
}

const { release, reused, gc } = await installWebRelease({
  source: client,
  store: storeAt(store),
  resolutionHash: lock.resolutionHash,
  retention: retentionFromEnv(),
})

console.log(
  `installed web release ${release.releaseId} -> ${path.relative(process.cwd(), store)}` +
    ` (${reused ? 'already installed' : `${String(release.assets.length)} assets`})`,
)
if (gc !== undefined) {
  console.log(
    gc.skipped === undefined
      ? `  retained ${String(gc.retained.length)} release(s); removed ${String(gc.removedReleases.length)} release(s), ${String(gc.removedAssets.length)} asset file(s)`
      : `  nothing collected: ${gc.skipped}`,
  )
}

// The server's half, whole, in place of whatever was there: built beside the
// target and moved in, so a host never starts on half of one build and half
// of another. Source maps stay behind with the build that made them.
const placing = `${server}.placing`
fs.rmSync(placing, { recursive: true, force: true })
fs.mkdirSync(placing, { recursive: true })
for (const environment of ['rsc', 'ssr']) {
  fs.cpSync(path.join(build, environment), path.join(placing, environment), {
    recursive: true,
    filter: (file) => !file.endsWith('.map'),
  })
}
const built = JSON.parse(fs.readFileSync(path.join(client, WEB_BUILD_METADATA), 'utf8')) as {
  readonly releaseId: string
}
fs.writeFileSync(
  path.join(placing, SERVER_BUILD_METADATA),
  `${JSON.stringify({ schema: 1, releaseId: built.releaseId }, null, 2)}\n`,
)
// a package of its own, so node reads the server's modules as modules
fs.writeFileSync(path.join(placing, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`)
fs.rmSync(server, { recursive: true, force: true })
fs.renameSync(placing, server)
console.log(
  `placed the server for release ${built.releaseId} -> ${path.relative(process.cwd(), server)}`,
)
