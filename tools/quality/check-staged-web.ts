import fs from 'node:fs'
import path from 'node:path'
import { lockPathFor, readLock } from '@qualy/assembly'
import { manifestPath, repoRoot } from '../lib/manifest.ts'
import { readCurrentWebRelease, storeAt } from '../../packages/build/web/src/release-store.ts'
import { PRIVATE_BUILD_FILES } from '../../packages/build/web/src/release-vite.ts'

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
// Nothing in the store may be a source map, or any other file the build
// keeps for itself.
//
// This is the load-bearing half of turning source maps on. A map carries
// `sourcesContent` - the whole source of this product, directory structure
// included - and the store is served publicly, so one that got in would be a
// download link to the codebase with nothing saying so. The release store
// filters them out on the way in; this asserts the result, because the two
// failures that matter are silent: a filter that stops matching a new
// extension, and a file placed in the store by something other than the
// installer.
//
// The map from a public surface to the module behind it is the same kind of
// file for the same reason: the browser is given `page:assessment/review` and
// the build keeps what implements it, and a store holding that map would hand
// the mapping back to anyone who asked.
const debug: string[] = []
const isPrivateBuildFile = (name: string) =>
  PRIVATE_BUILD_FILES.some(
    (file) => name === file || name === `${file}.br` || name === `${file}.gz`,
  )
const scan = (dir: string, within: string) => {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) scan(full, path.posix.join(within, entry.name))
    // the compressed twins too: the installer writes none of these, so
    // anything here arrived by hand, and a hand that copied the file could
    // as easily have copied the brotli beside it
    else if (/\.map(?:\.br|\.gz)?$/.test(entry.name) || isPrivateBuildFile(entry.name)) {
      debug.push(path.posix.join(within, entry.name))
    }
  }
}
scan(store.root, '')
if (debug.length > 0) {
  fail(
    `the store holds ${String(debug.length)} private build file(s), which must never be served: ${debug.slice(0, 5).join(', ')}`,
  )
}

// And nothing a release serves may name the private half of the protocol.
//
// Not a value - no build ever put one in a bundle - but the FIELD NAMES,
// which rode in because the private documents lived in the same module as
// the public probe and the browser imports the probe. A minified bundle
// spelling out `resolutionHash`, `browserContractHash` and `assets` tells a
// reader exactly what this deployment keeps about itself and what to go
// looking for. The split that fixed it is a module boundary, and a module
// boundary holds only as long as nobody re-exports across it.
const PRIVATE_VOCABULARY = ['resolutionHash', 'browserContractHash', 'installedAt']
const leaked: string[] = []
for (const asset of release.assets) {
  if (!/\.(?:js|css|html)$/.test(asset)) continue
  const at = path.join(store.root, asset)
  if (!fs.existsSync(at)) continue
  const body = fs.readFileSync(at, 'utf8')
  for (const word of PRIVATE_VOCABULARY) {
    if (body.includes(word)) leaked.push(`${asset} names ${word}`)
  }
}
if (leaked.length > 0) {
  fail(
    `release ${releaseId} serves the private release vocabulary: ${leaked.slice(0, 5).join(', ')}`,
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
