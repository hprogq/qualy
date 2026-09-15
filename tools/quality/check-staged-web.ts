import fs from 'node:fs'
import path from 'node:path'
import { transform } from 'lightningcss'
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

// The css a viewer is served is built css.
//
// Two things went wrong here at once and neither was visible from inside the
// build. The compiled StyleX rules are appended to one stylesheet in
// `generateBundle`, which is AFTER Vite has minified what it produced - so
// ninety-nine kilobytes of pretty-printed css went out on the end of a
// minified file, and the only way anyone noticed was opening the url and
// reading it. And the plugin finds that stylesheet BY NAME, so the day the
// public file names became opaque it stopped finding one and fell through to
// "the first css asset in the bundle", which was the right one by luck: on
// another day it is the lazy stylesheet of a page nobody has opened, and the
// shell comes up unstyled.
//
// So both are asked of the artifact. Re-minifying is the honest way to ask
// the first - not "does it look minified", but "is there anything left to
// take out" - and a couple of percent is the noise between two minifiers
// rather than a pipeline leaving work undone.
const RE_MINIFY_TOLERANCE = 0.02
{
  const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const linked = [...shell.matchAll(/href="\/?(assets\/[^"]+\.css)"/g)].map((one) => one[1]!)
  // whitespace-tolerant on purpose: a stylesheet that went out unminified is
  // a different fault with a different answer below, and a detector that
  // could not see one would report it as the missing-stylesheet fault instead
  const styled = (body: string) =>
    /@layer priority\d/.test(body) && /\.x[a-z0-9]{6,}\s*\{/.test(body)

  const cssAssets = release.assets.filter((asset) => asset.endsWith('.css'))
  const carrying = cssAssets.filter((asset) =>
    styled(fs.readFileSync(path.join(store.root, asset), 'utf8')),
  )
  if (carrying.length !== 1) {
    fail(
      `${String(carrying.length)} stylesheet(s) carry the compiled style rules, expected exactly 1`,
    )
  } else if (!linked.includes(carrying[0]!)) {
    fail(
      `the shell links ${linked.join(', ') || 'no stylesheet'}, but the style rules are in ${carrying[0]!}`,
    )
  }

  const unminified: string[] = []
  for (const asset of cssAssets) {
    const source = fs.readFileSync(path.join(store.root, asset))
    const { code } = transform({ filename: path.basename(asset), code: source, minify: true })
    const left = (source.length - code.length) / source.length
    if (left > RE_MINIFY_TOLERANCE) {
      unminified.push(`${asset} is ${(left * 100).toFixed(1)}% larger than it needs to be`)
    }
  }
  if (unminified.length > 0) fail(`the release serves unminified css: ${unminified.join(', ')}`)
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
