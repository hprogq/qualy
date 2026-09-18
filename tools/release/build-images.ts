import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'
import { checkoutOf, type Checkout } from './context.ts'

// The release build: the three images of one release, one tag, one tree, one
// platform.
//
//   pnpm release:build [<release>] [--check] [--allow-dirty] [--platform <os/arch>]
//
// A release is the server image and the two sandbox images built from the
// same checkout and tagged alike, so that deploy/compose.yaml names one value
// and gets a consistent set. What makes that a property of this script
// rather than a habit of whoever runs it:
//
//   - A named release is built from a snapshot of the commit, never from the
//     working directory: a detached git worktree at HEAD, made for the build
//     and removed after it, is the context of all three docker builds. The
//     working directory can hold files git ignores and docker does not, and
//     can change between one build and the next; a worktree holds exactly
//     the commit and nothing moves it. A named release on a checkout whose
//     build inputs differ from the commit is refused - it would not be that
//     commit - unless --allow-dirty says so, and then it is built from the
//     working directory like an unnamed one.
//   - An unnamed release is a development build of the working directory: the
//     tag is the short commit, suffixed -dirty when the build inputs differ,
//     so the tag says it is not a commit. It is fingerprinted before the
//     first build and compared before each later one and after the last, so
//     three images cannot come from two trees without the build failing and
//     its tags being removed.
//   - One target platform for all three, linux/amd64 unless --platform says
//     otherwise: a build takes the daemon's platform by default, which on a
//     developer's laptop is not the server's. Once built, the three images are
//     inspected: same platform, same revision, or the release is removed.
//
// Every image carries the commit it was built from as its revision label.
// --check runs the image inspection on the server image once all three exist,
// and a release that fails it is removed as well.

const args = process.argv.slice(2)
const flagValue = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}
const check = args.includes('--check')
const allowDirty = args.includes('--allow-dirty')
const platform = flagValue('--platform') ?? 'linux/amd64'
const known = new Set(['--check', '--allow-dirty', '--platform'])
const unknownFlags = args.filter((argument) => argument.startsWith('--') && !known.has(argument))
if (unknownFlags.length > 0) {
  console.error(`release-build: unknown option ${unknownFlags.join(', ')}`)
  process.exit(2)
}
if (!/^[a-z0-9]+\/[a-z0-9]+(\/[a-z0-9]+)?$/.test(platform)) {
  console.error(`release-build: --platform wants os/arch, got ${JSON.stringify(platform)}`)
  process.exit(2)
}
const positional = args.filter(
  (argument, at) => !argument.startsWith('--') && args[at - 1] !== '--platform',
)
const named = positional[0]

const git = (gitArgs: readonly string[], cwd = repoRoot) =>
  execFileSync('git', [...gitArgs], { cwd, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })

const IMAGES: readonly (readonly [name: string, dockerfile: string])[] = [
  ['qualy-server', 'Dockerfile'],
  ['qualy-sandbox-runtime', 'apps/sandbox-runtime/Dockerfile'],
  ['qualy-sandbox-authoring', 'apps/sandbox-authoring/Dockerfile'],
]

const started = checkoutOf(repoRoot)
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
// a named release of the commit itself is built from a snapshot of it
const snapshot = named !== undefined && !dirty

const tagged: string[] = []
let worktree: string | undefined
const cleanUp = () => {
  if (worktree !== undefined) {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    fs.rmSync(worktree, { recursive: true, force: true })
    worktree = undefined
  }
}
const abandon = (why: string): never => {
  for (const tag of tagged) {
    spawnSync('docker', ['image', 'rm', '--no-prune', tag], { stdio: 'ignore' })
  }
  cleanUp()
  console.error(`release-build: ${why}`)
  if (tagged.length > 0) {
    console.error(`release-build: removed the tags this run made: ${tagged.join(', ')}`)
  }
  process.exit(1)
}
const unmoved = (when: string) => {
  if (snapshot) return
  if (checkoutOf(repoRoot).fingerprint !== started.fingerprint) {
    abandon(
      `the checkout changed ${when}; the images under ${release} would not come from one tree`,
    )
  }
}

let context = repoRoot
if (snapshot) {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-release-'))
  const added = spawnSync(
    'git',
    ['worktree', 'add', '--detach', '--force', worktree, started.commit],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  if (added.status !== 0) abandon(`could not snapshot ${started.commit}:\n${added.stderr}`)
  context = worktree
  console.log(`release-build: building ${release} from a snapshot of ${started.commit}`)
} else {
  console.log(
    `release-build: building ${release} from the working directory${dirty ? ' (its build inputs differ from the commit)' : ''}`,
  )
}

try {
  for (const [name, dockerfile] of IMAGES) {
    if (tagged.length > 0) unmoved(`before ${name} was built`)
    const tag = `${name}:${release}`
    console.log(`release-build: ${tag} from ${dockerfile} for ${platform}`)
    const built = spawnSync(
      'docker',
      [
        'build',
        '--platform',
        platform,
        '--file',
        path.join(context, dockerfile),
        '--build-arg',
        `QUALY_RELEASE=${release}`,
        '--build-arg',
        `QUALY_REVISION=${revision}`,
        '--tag',
        tag,
        context,
      ],
      { cwd: context, stdio: 'inherit' },
    )
    if (built.status !== 0) abandon(`${name} failed to build`)
    tagged.push(tag)
  }
  unmoved('while the images were being built')
} finally {
  cleanUp()
}

// what came out: one platform, one revision, across all three
for (const tag of tagged) {
  const inspected = spawnSync(
    'docker',
    [
      'image',
      'inspect',
      tag,
      '--format',
      '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}',
    ],
    { encoding: 'utf8' },
  )
  if (inspected.status !== 0) abandon(`could not inspect ${tag}`)
  const [builtFor, labelledRevision, labelledRelease] = inspected.stdout.trim().split(' ')
  if (builtFor !== platform) {
    abandon(`${tag} was built for ${builtFor ?? 'an unknown platform'}, not ${platform}`)
  }
  if (labelledRevision !== revision || labelledRelease !== release) {
    abandon(
      `${tag} is labelled ${labelledRevision ?? '?'} / ${labelledRelease ?? '?'}, not ${revision} / ${release}`,
    )
  }
}

if (check) {
  const inspected = spawnSync(
    process.execPath,
    ['tools/quality/check-release-image.ts', `qualy-server:${release}`],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (inspected.status !== 0) abandon('the server image did not pass inspection')
}

console.log(
  `release-build: ${release} built for ${platform} at ${revision} (${IMAGES.map(([name]) => name).join(', ')})`,
)
