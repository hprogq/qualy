import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The deployment host's launcher (ops/deploy-host/qualy-deploy), run as the
// host runs it, against stand-ins first on PATH: a `docker` whose registry
// and local image names are directories, an `id` that says root, a `chown`
// that does nothing, and a `sudo` that writes down what it was asked. Each
// test runs a copy whose one change is where its configuration lives. What
// is pinned: the caller picks a release and three digests and nothing else,
// the images must be one committed release, the scripts that run are the
// ones in the image, and a rollback runs the newer release's scripts.

const ROOT = path.resolve(import.meta.dirname, '../..')
const LAUNCHER = path.join(ROOT, 'ops/deploy-host/qualy-deploy')
const REGISTRY = 'docker.example.test/acme/qualy'
const IMAGES = ['qualy-server', 'qualy-sandbox-runtime', 'qualy-sandbox-authoring'] as const

const FAKE_DOCKER = `#!/bin/sh
# docker, as far as the launcher asks it: the registry is $FAKE/registry/<image>@<digest>/,
# a local name is $FAKE/local/<image>:<tag> holding an image id
printf '%s\\n' "$*" >> "$FAKE/docker.log"
# the launcher pulls with a docker config of its own
if [ "$1" = --config ]; then
  [ "$2" = "$FAKE/docker" ] || { echo "pulled with the config at $2" >&2; exit 1; }
  shift 2
fi
remote() { printf '%s' "\${1#${REGISTRY}/}"; }
case $1 in
  pull) [ -d "$FAKE/registry/$(remote "$3")" ] ;;
  container)
    case $2 in
      ls)
        [ ! -f "$FAKE/containers" ] || cut -d' ' -f1 "$FAKE/containers" ;;
      inspect)
        [ "$FAKE_INSPECT_FAIL" != 1 ] || exit 2
        shift 4
        for container; do grep "^$container " "$FAKE/containers" | cut -d' ' -f2-; done ;;
      *) exit 1 ;;
    esac ;;
  image)
    if [ "$2" = rm ]; then
      [ "$3" = --no-prune ] || exit 2
      shift 3
      for ref; do
        [ "$ref" != "$FAKE_REMOVE_FAIL" ] || exit 2
        case $ref in
          ${REGISTRY}/*@sha256:*) : ;; # the separate digest name in Docker's containerd store
          qualy-*:v*) rm "$FAKE/local/$ref" || exit 2 ;;
          *) exit 2 ;;
        esac
      done
      exit 0
    fi
    [ "$2" = inspect ] || exit 1
    ref=$5
    case $ref in
      ${REGISTRY}/*) dir="$FAKE/registry/$(remote "$ref")"; [ -d "$dir" ] || exit 1
        case $4 in *image.version*) cat "$dir/labels" ;; *) cat "$dir/id" ;; esac ;;
      *) [ -f "$FAKE/local/$ref" ] || exit 1
        id=$(cat "$FAKE/local/$ref")
        case $4 in
          *RepoTags*)
            for dir in "$FAKE"/registry/*; do
              [ "$(cat "$dir/id")" = "$id" ] || continue
              read -r version revision < "$dir/labels"
              origin=${REGISTRY}/\${dir##*/}
              tags=$origin
              for name in "$FAKE"/local/*; do
                [ "$(cat "$name")" != "$id" ] || tags="$tags \${name##*/}"
              done
              printf '%s|%s|%s|%s|%s|%s\\n' "$id" "$(cat "$dir/created")" "$version" "$revision" "$tags" "$origin"
              exit 0
            done
            exit 1 ;;
          *) printf '%s\\n' "$id" ;;
        esac ;;
    esac ;;
  tag) mkdir -p "$FAKE/local"; cat "$FAKE/registry/$(remote "$2")/id" > "$FAKE/local/$3" ;;
  create) printf 'container-%s\\n' "$(remote "$2" | tr '@:' '__')"; remote "$2" > "$FAKE/created" ;;
  cp) cp -R "$FAKE/registry/$(cat "$FAKE/created")/app/deploy" "$3" ;;
  rm) ;;
  version) printf '27.0.0\\n' ;;
esac
`

let fake: string
let root: string
let conf: string
let launcher: string

const digestOf = (seed: string) =>
  `sha256:${seed
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, 'a')}`

/** a release in the registry: three images, and deploy/ scripts in the server's */
const publish = (
  release: string,
  seed: string,
  labels: {
    version?: string
    revision?: string
    revisions?: readonly string[]
    created?: string
  } = {},
) => {
  const digests = IMAGES.map((_, at) => digestOf(`${seed}${String(at)}`))
  IMAGES.forEach((image, at) => {
    const dir = path.join(fake, 'registry', `${image}@${digests[at]!}`)
    fs.mkdirSync(dir, { recursive: true })
    const revision = labels.revisions?.[at] ?? labels.revision ?? `commit-${seed}`
    fs.writeFileSync(path.join(dir, 'labels'), `${labels.version ?? release} ${revision}\n`)
    fs.writeFileSync(path.join(dir, 'id'), `${digests[at]!}\n`)
    fs.writeFileSync(path.join(dir, 'created'), labels.created ?? '2026-01-01T00:00:00Z')
  })
  const scripts = path.join(fake, 'registry', `qualy-server@${digests[0]!}`, 'app', 'deploy')
  fs.mkdirSync(scripts, { recursive: true })
  // what ran, from where, with which env file and lock; a success records the release
  for (const [name, serves] of [
    ['upgrade.sh', '$1'],
    ['rollback.sh', '$(cat "$FAKE/older")'],
  ] as const) {
    fs.writeFileSync(
      path.join(scripts, name),
      `#!/bin/sh
printf '%s %s %s %s %s\\n' "${release}" "${name}" "$*" "$QUALY_ENV_FILE" "$QUALY_DEPLOY_LOCK_HELD" >> "$FAKE/ran"
[ "$FAKE_UPGRADE_FAIL" != 1 ] || exit 4
active=$(sed -n 's/^QUALY_ACTIVE_COLOR=//p' "$QUALY_ENV_FILE")
if [ "$active" = blue ]; then target=green; key=QUALY_RELEASE_GREEN; else target=blue; key=QUALY_RELEASE_BLUE; fi
sed -i.bak -e "s/^QUALY_RELEASE=.*/QUALY_RELEASE=${serves}/" \\
  -e "s/^QUALY_ACTIVE_COLOR=.*/QUALY_ACTIVE_COLOR=$target/" \\
  -e "s/^$key=.*/$key=${serves}/" "$QUALY_ENV_FILE"
`,
      { mode: 0o755 },
    )
  }
  return digests
}

const run = (args: readonly string[], env: Record<string, string> = {}) =>
  spawnSync('sh', [launcher, ...args], {
    env: {
      ...process.env,
      PATH: `${path.join(fake, 'bin')}:${process.env.PATH ?? ''}`,
      FAKE: fake,
      ...env,
    },
    encoding: 'utf8',
  })

const ran = () =>
  fs.existsSync(path.join(fake, 'ran')) ? fs.readFileSync(path.join(fake, 'ran'), 'utf8') : ''

const localImage = (name: string) => path.join(fake, 'local', name)
const pin = (tag: string) => path.join(root, 'releases', tag, 'prefetched')
const cached = (tag: string, seed: string, created?: string) => {
  const digests = publish(tag, seed, created === undefined ? {} : { created })
  const fetched = run(['fetch', tag, ...digests])
  expect(fetched.status, fetched.stderr).toBe(0)
  // A release left on disk by the previous launcher does not carry a pin.
  fs.unlinkSync(pin(tag))
  return digests
}
const serving = (blue: string, green: string) => {
  fs.writeFileSync(
    path.join(root, '.env'),
    `QUALY_ACTIVE_COLOR=blue\nQUALY_RELEASE=${blue}\nQUALY_RELEASE_BLUE=${blue}\nQUALY_RELEASE_GREEN=${green}\n`,
  )
  fs.symlinkSync(`releases/${blue}`, path.join(root, 'current'))
}
const removals = () =>
  fs
    .readFileSync(path.join(fake, 'docker.log'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('image rm '))

beforeEach(() => {
  fake = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-deploy-launcher-'))
  root = path.join(fake, 'opt')
  fs.mkdirSync(path.join(fake, 'bin'))
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(fake, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 })
  fs.writeFileSync(path.join(fake, 'bin', 'id'), '#!/bin/sh\nprintf "0\\n"\n', { mode: 0o755 })
  fs.writeFileSync(path.join(fake, 'bin', 'chown'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  conf = path.join(fake, 'deploy.conf')
  fs.writeFileSync(conf, `QUALY_DEPLOY_REGISTRY=${REGISTRY}\nQUALY_DEPLOY_ROOT=${root}\n`)
  fs.writeFileSync(
    path.join(root, '.env'),
    'QUALY_ACTIVE_COLOR=\nQUALY_RELEASE=\nQUALY_RELEASE_BLUE=\nQUALY_RELEASE_GREEN=\n',
    {
      mode: 0o600,
    },
  )
  launcher = path.join(fake, 'qualy-deploy')
  const source = fs.readFileSync(LAUNCHER, 'utf8')
  expect(source).toContain('\nconf=/etc/qualy/deploy.conf\n')
  fs.writeFileSync(launcher, source.replace('\nconf=/etc/qualy/deploy.conf\n', `\nconf=${conf}\n`))
})

afterEach(() => {
  fs.rmSync(fake, { recursive: true, force: true })
})

describe('deploying a published release', () => {
  it("pulls it by digest, names it, and runs its own upgrade under the host's lock", () => {
    const digests = publish('v1.0.0', '1')
    const done = run(['deploy', 'v1.0.0', ...digests])
    expect(done.status, done.stderr).toBe(0)
    const env = path.join(root, '.env')
    expect(ran()).toBe(`v1.0.0 upgrade.sh v1.0.0 ${env} ${env}\n`)
    for (const [at, image] of IMAGES.entries()) {
      expect(fs.readFileSync(path.join(fake, 'local', `${image}:v1.0.0`), 'utf8')).toBe(
        `${digests[at]!}\n`,
      )
    }
    expect(fs.readFileSync(path.join(root, 'releases/v1.0.0/server-digest'), 'utf8')).toBe(
      `${digests[0]!}\n`,
    )
    expect(fs.readlinkSync(path.join(root, 'current'))).toBe('releases/v1.0.0')
    // the upgrade itself asks for the maintenance path only when told to
    const again = run(['deploy', 'v1.0.0', ...digests, '--maintenance'])
    expect(again.status, again.stderr).toBe(0)
    expect(ran().split('\n')[1]).toBe(`v1.0.0 upgrade.sh v1.0.0 --maintenance ${env} ${env}`)
  })

  it('refuses anything but a release name and three digests, before pulling', () => {
    const digests = publish('v1.0.0', '1')
    for (const [args, why] of [
      [['deploy', '../etc', ...digests], 'not a release name'],
      [['deploy', '1.0.0', ...digests], 'not a release name'],
      [['deploy', 'v1.0.0', 'latest', digests[1]!, digests[2]!], 'not an image digest'],
      [['deploy', 'v1.0.0', 'sha256:abc', digests[1]!, digests[2]!], 'not an image digest'],
      [['deploy', 'v1.0.0', ...digests, '--force'], 'usage'],
      [['deploy', 'v1.0.0', digests[0]!, digests[1]!], 'usage'],
      [['sh', '-c', 'id'], 'usage'],
      [[], 'usage'],
    ] as const) {
      const refused = run(args)
      expect(refused.status, args.join(' ')).toBe(1)
      expect(refused.stderr, args.join(' ')).toContain(why)
    }
    expect(fs.existsSync(path.join(fake, 'docker.log'))).toBe(false)
    expect(ran()).toBe('')
  })

  it('refuses images that are not one committed build of that release', () => {
    const cases = [
      [publish('v2.0.0', '2', { version: 'v9.9.9' }), 'labelled release v9.9.9'],
      [publish('v2.0.0', '3', { revision: 'commit-3-dirty' }), 'not built from a commit'],
      [
        publish('v2.0.0', '4', { revisions: ['commit-a', 'commit-a', 'commit-b'] }),
        'built from commit-b, the images before it from commit-a',
      ],
    ] as const
    for (const [digests, why] of cases) {
      const refused = run(['deploy', 'v2.0.0', ...digests])
      expect(refused.status).toBe(1)
      expect(refused.stderr).toContain(why)
    }
    expect(ran()).toBe('')
    expect(fs.existsSync(path.join(root, 'releases/v2.0.0'))).toBe(false)
    // and none of them was given the release's name
    expect(fs.existsSync(path.join(fake, 'local'))).toBe(false)
  })

  it('refuses a release name this host already knows as other images', () => {
    const first = publish('v1.0.0', '1')
    expect(run(['fetch', 'v1.0.0', ...first]).status).toBe(0)
    // fetched, nothing run, and nothing claims it serves
    expect(ran()).toBe('')
    expect(fs.existsSync(path.join(root, 'current'))).toBe(false)
    const other = publish('v1.0.0', '5')
    const refused = run(['deploy', 'v1.0.0', ...other])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('already names another image')
    expect(ran()).toBe('')
  })
})

describe('before the deployment has its settings', () => {
  it('checks and fetches, and refuses to run a script', () => {
    fs.rmSync(path.join(root, '.env'))
    const digests = publish('v1.0.0', '1')
    expect(run(['check']).status).toBe(0)
    const fetched = run(['fetch', 'v1.0.0', ...digests])
    expect(fetched.status, fetched.stderr).toBe(0)
    expect(fs.existsSync(path.join(root, 'releases/v1.0.0/deploy/upgrade.sh'))).toBe(true)
    for (const args of [['deploy', 'v1.0.0', ...digests], ['rollback']]) {
      const refused = run(args)
      expect(refused.status).toBe(1)
      expect(refused.stderr).toContain('write the deployment')
    }
    expect(ran()).toBe('')
  })
})

describe('rolling back', () => {
  it("runs the serving release's rollback, not the older one's", () => {
    const older = publish('v1.0.0', '1')
    const newer = publish('v2.0.0', '2')
    expect(run(['deploy', 'v1.0.0', ...older]).status).toBe(0)
    expect(run(['deploy', 'v2.0.0', ...newer]).status).toBe(0)
    fs.writeFileSync(path.join(fake, 'older'), 'v1.0.0')
    const back = run(['rollback'])
    expect(back.status, back.stderr).toBe(0)
    expect(ran().trim().split('\n').at(-1)).toMatch(/^v2\.0\.0 rollback\.sh {2}/)
    expect(fs.readlinkSync(path.join(root, 'current'))).toBe('releases/v1.0.0')
  })
})

describe('local release image retention', () => {
  it('previews and removes only old, unreferenced Qualy images after an upgrade', () => {
    cached('v1.0.1', '1')
    const overwritten = cached('v1.0.2', '2')
    serving('v1.0.1', 'v1.0.2')
    cached('v1.0.8', '8', '2026-04-01T00:00:00Z')
    const old = cached('v1.0.9', '9', '2026-02-01T00:00:00Z')
    const inUse = cached('v1.0.4', '4')
    fs.writeFileSync(path.join(fake, 'containers'), `exited ${inUse[1]!} unrelated:former-name\n`)
    const aliased = cached('v1.0.5', '5')
    fs.writeFileSync(localImage('another-project:kept'), `${aliased[0]!}\n`)
    cached('v1.0.6', '6')
    fs.unlinkSync(localImage('qualy-sandbox-runtime:v1.0.6'))
    fs.writeFileSync(localImage('qualy-server:v99.0.0'), `${digestOf('ab')}\n`)
    const future = publish('v1.0.7', '7', { created: '2026-12-01T00:00:00Z' })
    expect(run(['fetch', 'v1.0.7', ...future]).status).toBe(0)

    const preview = run(['image-gc-preview'])
    expect(preview.status, preview.stderr).toBe(0)
    expect(preview.stdout.trim().split('\n')).toHaveLength(1)
    expect(preview.stdout).toContain('qualy-server:v1.0.9')
    expect(removals()).toEqual([])
    expect(fs.existsSync(pin('v1.0.7'))).toBe(true)

    const next = publish('v1.0.3', '3')
    expect(run(['fetch', 'v1.0.3', ...next]).status).toBe(0)
    const done = run(['deploy', 'v1.0.3', ...next])
    expect(done.status, done.stderr).toBe(0)
    expect(fs.readlinkSync(path.join(root, 'current'))).toBe('releases/v1.0.3')
    expect(fs.existsSync(pin('v1.0.3'))).toBe(false)
    expect(fs.existsSync(pin('v1.0.7'))).toBe(true)
    expect(removals().sort()).toEqual(
      (
        [
          ['v1.0.2', overwritten],
          ['v1.0.9', old],
        ] as const
      )
        .map(
          ([tag, digests]) =>
            `image rm --no-prune ${IMAGES.flatMap((image, at) => [
              `${REGISTRY}/${image}@${digests[at]}`,
              `${image}:${tag}`,
            ]).join(' ')}`,
        )
        .sort(),
    )
    const left = fs.readdirSync(path.join(fake, 'local'))
    for (const tag of ['v1.0.1', 'v1.0.3', 'v1.0.4', 'v1.0.5', 'v1.0.7', 'v1.0.8']) {
      expect(left.filter((name) => name.endsWith(`:${tag}`))).toHaveLength(3)
    }
    expect(left).toContain('qualy-server:v1.0.6')
    expect(left).toContain('qualy-server:v99.0.0')
    expect(left).toContain('another-project:kept')
  })

  it('does not clean up or unpin the target of a failed deploy', () => {
    cached('v1.0.1', '1')
    cached('v1.0.2', '2')
    serving('v1.0.1', 'v1.0.2')
    const next = publish('v1.0.3', '3')
    expect(run(['fetch', 'v1.0.3', ...next]).status).toBe(0)
    const failed = run(['deploy', 'v1.0.3', ...next], { FAKE_UPGRADE_FAIL: '1' })
    expect(failed.status).toBe(4)
    expect(fs.readlinkSync(path.join(root, 'current'))).toBe('releases/v1.0.1')
    expect(fs.existsSync(pin('v1.0.3'))).toBe(true)
    expect(removals()).toEqual([])
  })

  it.each(['cannot inspect containers', 'cannot remove an image'] as const)(
    'does not fail a successful deploy when cleanup %s',
    (failure) => {
      cached('v1.0.1', '1')
      cached('v1.0.2', '2')
      cached('v1.0.4', '4', '2026-04-01T00:00:00Z')
      serving('v1.0.1', 'v1.0.2')
      fs.writeFileSync(path.join(fake, 'containers'), `exited ${digestOf('f')} other:v1\n`)
      const next = publish('v1.0.3', '3')
      const done = run(
        ['deploy', 'v1.0.3', ...next],
        failure === 'cannot inspect containers'
          ? { FAKE_INSPECT_FAIL: '1' }
          : { FAKE_REMOVE_FAIL: 'qualy-server:v1.0.2' },
      )
      expect(done.status, done.stderr).toBe(0)
      expect(done.stderr).toContain('WARNING: v1.0.3 is deployed, but image cleanup did not finish')
      expect(fs.readlinkSync(path.join(root, 'current'))).toBe('releases/v1.0.3')
      expect(removals()).toHaveLength(failure === 'cannot inspect containers' ? 0 : 1)
    },
  )

  it('respects a host that disabled cleanup', () => {
    cached('v1.0.1', '1')
    cached('v1.0.2', '2')
    cached('v1.0.4', '4')
    serving('v1.0.1', 'v1.0.2')
    fs.appendFileSync(conf, 'QUALY_DEPLOY_IMAGE_KEEP=0\n')
    const done = run(['deploy', 'v1.0.3', ...publish('v1.0.3', '3')])
    expect(done.status, done.stderr).toBe(0)
    expect(done.stdout).toContain('image cleanup is disabled')
    expect(removals()).toEqual([])
  })
})

describe('over SSH', () => {
  it('hands the command line to itself through sudo, word by word, unexpanded', () => {
    fs.writeFileSync(path.join(fake, 'bin', 'id'), '#!/bin/sh\nprintf "1000\\n"\n', {
      mode: 0o755,
    })
    fs.writeFileSync(
      path.join(fake, 'bin', 'sudo'),
      '#!/bin/sh\nfor word; do printf "[%s]" "$word"; done\n',
      { mode: 0o755 },
    )
    const asked = run([], { SSH_ORIGINAL_COMMAND: 'deploy v1.0.0  *  $(id)' })
    expect(asked.status, asked.stderr).toBe(0)
    expect(asked.stdout).toBe('[-n][/usr/local/sbin/qualy-deploy][deploy][v1.0.0][*][$(id)]')
  })
})

describe('asking whether the deployment is well', () => {
  it("runs the serving release's own doctor with the host's settings, and passes its verdict on", () => {
    const deploy = path.join(root, 'releases', 'v2.0.0', 'deploy')
    fs.mkdirSync(deploy, { recursive: true })
    fs.writeFileSync(
      path.join(deploy, 'doctor.sh'),
      '#!/bin/sh\nprintf "doctor with %s\\n" "$QUALY_ENV_FILE"\nexit 3\n',
      { mode: 0o755 },
    )
    fs.symlinkSync('releases/v2.0.0', path.join(root, 'current'))
    const asked = run(['doctor'])
    expect(asked.stdout.trim()).toBe(`doctor with ${path.join(root, '.env')}`)
    expect(asked.status).toBe(3)
  })

  it('says so when the serving release carries no doctor', () => {
    fs.mkdirSync(path.join(root, 'releases', 'v1.0.0'), { recursive: true })
    fs.symlinkSync('releases/v1.0.0', path.join(root, 'current'))
    const asked = run(['doctor'])
    expect(asked.status).toBe(1)
    expect(asked.stderr).toContain('carries no deploy/doctor.sh')
  })
})
