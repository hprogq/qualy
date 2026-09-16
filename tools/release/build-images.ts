import { execFileSync, spawnSync } from 'node:child_process'
import { repoRoot } from '../lib/manifest.ts'

// The release build: the three images of one release, one tag.
//
//   pnpm release:build <release> [--check]
//
// A release is the server image and the two sandbox images built from the
// same checkout and tagged alike, so that deploy/compose.yaml names one value
// and gets a consistent set. Without a tag the short commit hash is used,
// suffixed -dirty when the tree has uncommitted changes - a release built
// from an unclean tree should say so on its label. --check runs the image
// inspection on the server image once it is built.

const args = process.argv.slice(2)
const check = args.includes('--check')
const named = args.find((argument) => !argument.startsWith('--'))

const describe = (): string => {
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
  const dirty =
    execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim() !==
    ''
  return dirty ? `${commit}-dirty` : commit
}

const release = named ?? describe()
if (!/^[\w][\w.-]{0,127}$/.test(release)) {
  console.error(`release-build: ${JSON.stringify(release)} is not a valid image tag`)
  process.exit(2)
}

const IMAGES: readonly (readonly [name: string, dockerfile: string])[] = [
  ['qualy-server', 'Dockerfile'],
  ['qualy-sandbox-runtime', 'apps/sandbox-runtime/Dockerfile'],
  ['qualy-sandbox-authoring', 'apps/sandbox-authoring/Dockerfile'],
]

for (const [name, dockerfile] of IMAGES) {
  console.log(`release-build: ${name}:${release} from ${dockerfile}`)
  const built = spawnSync(
    'docker',
    [
      'build',
      '--file',
      dockerfile,
      '--build-arg',
      `QUALY_RELEASE=${release}`,
      '--tag',
      `${name}:${release}`,
      '.',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (built.status !== 0) {
    console.error(`release-build: ${name} failed`)
    process.exit(built.status ?? 1)
  }
}

if (check) {
  const inspected = spawnSync(
    'node',
    ['tools/quality/check-release-image.ts', `qualy-server:${release}`],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (inspected.status !== 0) process.exit(inspected.status ?? 1)
}

console.log(`release-build: ${release} built (${IMAGES.map(([name]) => name).join(', ')})`)
