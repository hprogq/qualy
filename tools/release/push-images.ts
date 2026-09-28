import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

// Publishes a release build-images.ts built: the three images pushed under
// the registry path production pulls from, and a manifest naming each one by
// digest. A tag is a name anyone with push rights can move; the digest is
// the image, so a deployment pulls the digests and nothing else.
//
//   node tools/release/push-images.ts <release> <registry> [--out <file>]
//
// <registry> is the path the images go under (for CNB,
// docker.cnb.cool/<org>/<repo>); the caller has logged in to it. The images
// must be the ones build-images.ts labelled: <release> as their version, one
// revision and one platform across all three. The manifest (release.json by
// default) also carries the web release the server image installs, which is
// what the public address answers once the release serves. Each push is
// timed: the registry is on the other side of the world from the builder.

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const out = outAt >= 0 ? args[outAt + 1] : 'release.json'
const [release, registry] = outAt >= 0 ? args.toSpliced(outAt, 2) : args
if (release === undefined || registry === undefined || out === undefined) {
  console.error('usage: node tools/release/push-images.ts <release> <registry> [--out <file>]')
  process.exit(2)
}
if (!/^[a-z0-9.-]+(:\d+)?(\/[a-z0-9._-]+)+$/.test(registry)) {
  console.error(
    `push-images: ${JSON.stringify(registry)} is not a registry path like docker.cnb.cool/<org>/<repo>`,
  )
  process.exit(2)
}

const IMAGES = ['qualy-server', 'qualy-sandbox-runtime', 'qualy-sandbox-authoring'] as const

function refuse(message: string): never {
  console.error(`push-images: ${message}`)
  process.exit(1)
}

const docker = (dockerArgs: readonly string[], inherit = false) => {
  const ran = spawnSync('docker', [...dockerArgs], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  })
  if (ran.status !== 0) {
    refuse(`docker ${dockerArgs.join(' ')} failed${inherit ? '' : `:\n${ran.stderr}`}`)
  }
  return inherit ? '' : ran.stdout.trim()
}

// what build-images.ts made, before anything leaves this machine
const labelled = IMAGES.map((image) => {
  const [platform, revision, version] = docker([
    'image',
    'inspect',
    `${image}:${release}`,
    '--format',
    '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.version"}}',
  ]).split(' ')
  if (version !== release) refuse(`${image}:${release} is labelled ${version ?? '?'}`)
  return { image, platform: platform ?? '', revision: revision ?? '' }
})
const [first] = labelled
if (first === undefined) refuse('no images')
for (const one of labelled) {
  if (one.platform !== first.platform || one.revision !== first.revision) {
    refuse(
      `${one.image} is ${one.platform} at ${one.revision}, ${first.image} is ${first.platform} at ${first.revision}`,
    )
  }
}
if (first.revision.endsWith('-dirty')) {
  refuse(`${release} was built from a working directory, not a commit (${first.revision})`)
}

const current = JSON.parse(
  docker([
    'run',
    '--rm',
    '--entrypoint',
    'cat',
    `qualy-server:${release}`,
    '/app/packages/plugins/infra/web/client-dist/current.json',
  ]),
) as { releaseId?: unknown }
if (typeof current.releaseId !== 'string') refuse('the server image names no web release')

const images: Record<string, string> = {}
for (const image of IMAGES) {
  const remote = `${registry}/${image}`
  docker(['tag', `${image}:${release}`, `${remote}:${release}`])
  const started = Date.now()
  docker(['push', `${remote}:${release}`], true)
  const seconds = Math.round((Date.now() - started) / 1000)
  const digests = JSON.parse(
    docker(['image', 'inspect', `${remote}:${release}`, '--format', '{{json .RepoDigests}}']),
  ) as string[]
  const pinned = digests.find((digest) => digest.startsWith(`${remote}@sha256:`))
  if (pinned === undefined) refuse(`the registry gave ${remote}:${release} no digest`)
  images[image] = pinned
  console.log(`push-images: ${image} in ${String(seconds)}s as ${pinned}`)
}

const manifest = {
  schema: 1,
  release,
  revision: first.revision,
  platform: first.platform,
  webRelease: current.releaseId,
  images,
}
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`push-images: ${release} recorded in ${out}`)
