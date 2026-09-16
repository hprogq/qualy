import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// The release build: the three images of one release, one tag, one checkout.
//
//   pnpm release:build [<release>] [--check] [--allow-dirty]
//
// A release is the server image and the two sandbox images built from the
// same checkout and tagged alike, so that deploy/compose.yaml names one value
// and gets a consistent set. Two things make that a property of this script
// rather than a habit of whoever runs it:
//
//   - A named release is refused on an unclean tree. Without a name the tag is
//     the short commit, suffixed -dirty when the tree has changes, so the tag
//     itself says it is not a commit; a name like v1.0.0 says nothing of the
//     kind, so it needs a clean tree or an explicit --allow-dirty.
//   - The checkout is fingerprinted before the first build (the commit, every
//     tracked change and every untracked file git does not ignore) and
//     compared before each later build and after the last. Three builds run
//     one after another, and a file saved in between would put two trees under
//     one tag; if the fingerprint moves, the tags this run made are removed and
//     the build fails.
//
// Every image carries the commit it was built from as its revision label.
// --check runs the image inspection on the server image once all three exist.

const args = process.argv.slice(2)
const check = args.includes('--check')
const allowDirty = args.includes('--allow-dirty')
const unknownFlags = args.filter(
  (argument) => argument.startsWith('--') && argument !== '--check' && argument !== '--allow-dirty',
)
if (unknownFlags.length > 0) {
  console.error(`release-build: unknown option ${unknownFlags.join(', ')}`)
  process.exit(2)
}
const named = args.find((argument) => !argument.startsWith('--'))

const git = (gitArgs: readonly string[]) =>
  execFileSync('git', [...gitArgs], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
  })

interface Checkout {
  readonly commit: string
  /** the build inputs that differ from the commit, by path */
  readonly changed: readonly string[]
  readonly fingerprint: string
}

/**
 * Whether the build context leaves a path out, by the rules in .dockerignore.
 *
 * A change nothing builds from is not a change to the release: notes kept
 * untracked under docs/, a STATUS.md being written. Docker's reading, closely
 * enough for the patterns this repository writes: a pattern excludes what it
 * matches and everything under it, `!` puts a path back, the last rule that
 * matches decides.
 */
const excludedFromContext = (() => {
  const rules = fs
    .readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!')
      const pattern = (negate ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '')
      return { negate, pattern }
    })
  return (file: string) => {
    const parts = file.split('/')
    const candidates = parts.map((_, at) => parts.slice(0, at + 1).join('/'))
    let excluded = false
    for (const rule of rules) {
      if (candidates.some((candidate) => path.matchesGlob(candidate, rule.pattern))) {
        excluded = !rule.negate
      }
    }
    return excluded
  }
})()

const pathsOf = (output: Buffer) =>
  output
    .toString('utf8')
    .split('\0')
    .filter((name) => name !== '')

/** the checkout a build reads, as one digest over the inputs git can see */
const checkout = (): Checkout => {
  const commit = git(['rev-parse', 'HEAD']).toString('utf8').trim()
  const digest = createHash('sha256').update(commit)
  // tracked files changed from the commit, staged or not, with their content
  const tracked = pathsOf(git(['diff', 'HEAD', '--name-only', '-z']))
    .filter((name) => !excludedFromContext(name))
    .sort()
  if (tracked.length > 0) digest.update(git(['diff', 'HEAD', '--binary', '--', ...tracked]))
  // untracked files that neither git nor the build context ignores
  const untracked = pathsOf(git(['ls-files', '--others', '--exclude-standard', '-z']))
    .filter((name) => !excludedFromContext(name))
    .sort()
  for (const name of untracked) {
    digest.update(`\0${name}\0`)
    const at = path.join(repoRoot, name)
    if (fs.statSync(at, { throwIfNoEntry: false })?.isFile()) digest.update(fs.readFileSync(at))
  }
  return {
    commit,
    changed: [...tracked, ...untracked],
    fingerprint: digest.digest('hex'),
  }
}

const IMAGES: readonly (readonly [name: string, dockerfile: string])[] = [
  ['qualy-server', 'Dockerfile'],
  ['qualy-sandbox-runtime', 'apps/sandbox-runtime/Dockerfile'],
  ['qualy-sandbox-authoring', 'apps/sandbox-authoring/Dockerfile'],
]

const started = checkout()
const dirty = started.changed.length > 0
const release = named ?? `${started.commit.slice(0, 8)}${dirty ? '-dirty' : ''}`
if (!/^[\w][\w.-]{0,127}$/.test(release)) {
  console.error(`release-build: ${JSON.stringify(release)} is not a valid image tag`)
  process.exit(2)
}
if (named !== undefined && dirty && !allowDirty) {
  const changes = started.changed
  console.error(
    `release-build: refusing to tag ${release} from a checkout whose build inputs differ from the commit; a named release is a commit. Commit or stash them, build without a name (the tag will say -dirty), or pass --allow-dirty:\n  ${changes.slice(0, 20).join('\n  ')}${changes.length > 20 ? `\n  ... and ${String(changes.length - 20)} more` : ''}`,
  )
  process.exit(1)
}
const revision = `${started.commit}${dirty ? '-dirty' : ''}`

const tagged: string[] = []
const abandon = (why: string): never => {
  for (const tag of tagged) {
    spawnSync('docker', ['image', 'rm', '--no-prune', tag], { stdio: 'ignore' })
  }
  console.error(`release-build: ${why}`)
  if (tagged.length > 0)
    console.error(`release-build: removed the tags this run made: ${tagged.join(', ')}`)
  process.exit(1)
}
const unmoved = (when: string) => {
  if (checkout().fingerprint !== started.fingerprint) {
    abandon(
      `the checkout changed ${when}; the images under ${release} would not come from one tree`,
    )
  }
}

for (const [name, dockerfile] of IMAGES) {
  if (tagged.length > 0) unmoved(`before ${name} was built`)
  const tag = `${name}:${release}`
  console.log(`release-build: ${tag} from ${dockerfile} at ${revision}`)
  const built = spawnSync(
    'docker',
    [
      'build',
      '--file',
      dockerfile,
      '--build-arg',
      `QUALY_RELEASE=${release}`,
      '--build-arg',
      `QUALY_REVISION=${revision}`,
      '--tag',
      tag,
      '.',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (built.status !== 0) abandon(`${name} failed to build`)
  tagged.push(tag)
}
unmoved('while the images were being built')

if (check) {
  const inspected = spawnSync(
    process.execPath,
    ['tools/quality/check-release-image.ts', `qualy-server:${release}`],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (inspected.status !== 0) process.exit(inspected.status ?? 1)
}

console.log(
  `release-build: ${release} built at ${revision} (${IMAGES.map(([name]) => name).join(', ')})`,
)
