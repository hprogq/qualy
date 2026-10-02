import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The deploy scripts' own rules, run as the scripts run them: deploy/lib.sh
// sourced by sh, against a stand-in `docker` and `curl` first on PATH that
// answer from files - which server of which color runs on which release, and
// what each release image's db/migrations holds - and write down what they
// were asked. The release smoke drives the real thing end to end on every CI
// run, but with no edge in front; this pins what it cannot reach: a move of
// a Caddy edge, a step killed between moving the edge and writing .env, an
// edge left on the maintenance page, two steps at once, and a migration's
// rollout line.

const ROOT = path.resolve(import.meta.dirname, '../..')
const LIB = path.join(ROOT, 'deploy/lib.sh')

const FAKE_DOCKER = `#!/bin/sh
# docker, as far as lib.sh asks it
printf '%s\\n' "$*" >> "$FAKE/docker.log"
if [ -n "$FAKE_STDOUT" ]; then printf '%s' "$FAKE_STDOUT"; fi
if [ "$1" = compose ]; then
  service=; saw_ps=
  for arg in "$@"; do
    if [ -n "$saw_ps" ] && [ "$arg" != -q ]; then service=$arg; fi
    [ "$arg" = ps ] && saw_ps=1
  done
  [ -n "$saw_ps" ] && [ -f "$FAKE/running/$service" ] && printf 'id-%s\\n' "$service"
  exit 0
fi
if [ "$1" = inspect ]; then
  id=$(eval "printf '%s' \\"\\\${$#}\\"")
  service=\${id#id-}
  case "$3" in
    *State.Running*) printf 'true\\n' ;;
    *Config.Image*) printf 'qualy-server:%s\\n' "$(cat "$FAKE/running/$service")" ;;
  esac
  exit 0
fi
if [ "$1" = run ]; then
  image=; command=; next_is_command=
  for arg in "$@"; do
    if [ -n "$next_is_command" ]; then command=$arg; next_is_command=; fi
    [ "$arg" = -c ] && next_is_command=1
    case $arg in qualy-server:*) image=\${arg#qualy-server:} ;; esac
  done
  cd "$FAKE/images/$image" && sh -c "$command"
  exit $?
fi
exit 0
`

// every server is ready, and says which web release it serves
const FAKE_CURL = `#!/bin/sh
for url; do :; done
case $url in
  */__qualy/release) printf '{"releaseId":"r_web"}\\n' ;;
esac
exit 0
`

let fake: string
let envFile: string
let snippet: string

const run = (script: string, extra: Record<string, string> = {}) =>
  spawnSync('sh', ['-c', `here="$1"; . "$2"; ${script}`, 'sh', path.dirname(LIB), LIB], {
    env: {
      ...process.env,
      PATH: `${path.join(fake, 'bin')}:${process.env.PATH ?? ''}`,
      FAKE: fake,
      QUALY_ENV_FILE: envFile,
      QUALY_PROXY_UPSTREAM: snippet,
      ...extra,
    },
    encoding: 'utf8',
  })

const serverRuns = (color: string, release: string) => {
  fs.mkdirSync(path.join(fake, 'running'), { recursive: true })
  fs.writeFileSync(path.join(fake, 'running', `server-${color}`), release)
}
const edgeOn = (port: number) =>
  fs.writeFileSync(snippet, `reverse_proxy 127.0.0.1:${String(port)} {\n\tflush_interval -1\n}\n`)
const envOf = () => fs.readFileSync(envFile, 'utf8')

beforeEach(() => {
  fake = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-deploy-scripts-'))
  fs.mkdirSync(path.join(fake, 'bin'))
  fs.writeFileSync(path.join(fake, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 })
  fs.writeFileSync(path.join(fake, 'bin', 'curl'), FAKE_CURL, { mode: 0o755 })
  envFile = path.join(fake, 'deployment.env')
  snippet = path.join(fake, 'upstream.caddy')
  fs.writeFileSync(
    envFile,
    [
      'POSTGRES_PASSWORD=kept as it was',
      'QUALY_PORT_BLUE=3001',
      'QUALY_PORT_GREEN=3002',
      'QUALY_ACTIVE_COLOR=blue',
      'QUALY_RELEASE=r1',
      'QUALY_RELEASE_BLUE=r1',
      'QUALY_RELEASE_GREEN=r2',
      '',
    ].join('\n'),
    { mode: 0o600 },
  )
})

afterEach(() => {
  fs.rmSync(fake, { recursive: true, force: true })
})

describe("the deploy scripts' record of what serves", () => {
  it('writes several keys in one replacement, keeping the rest and the mode', () => {
    fs.appendFileSync(envFile, 'QUALY_LAST=no newline after me')
    const ran = run('env_set QUALY_ACTIVE_COLOR green QUALY_RELEASE r2 QUALY_NEW value')
    expect(ran.status, ran.stderr).toBe(0)
    const written = envOf()
    expect(written).toContain('POSTGRES_PASSWORD=kept as it was\n')
    expect(written).toMatch(/^QUALY_ACTIVE_COLOR=green$/m)
    expect(written).toMatch(/^QUALY_RELEASE=r2$/m)
    expect(written).toMatch(/^QUALY_LAST=no newline after me$/m)
    expect(written).toMatch(/^QUALY_NEW=value$/m)
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600)
    // nothing left beside it
    expect(fs.readdirSync(fake).filter((name) => name.startsWith('.'))).toEqual([])
  })

  it('reads where the edge sends traffic from the snippet, not from .env', () => {
    expect(run('serving_color').stdout).toBe('none')
    edgeOn(3002)
    expect(run('serving_color').stdout).toBe('green')
    fs.writeFileSync(snippet, 'error "maintenance" 503\n')
    expect(run('serving_color').stdout).toBe('maintenance')
    edgeOn(4000)
    expect(run('serving_color').stdout).toBe('unclear')
  })

  // the window a cancelled job leaves: the edge moved, .env did not
  it('brings the record back to the color the edge serves, and says so', () => {
    edgeOn(3002)
    serverRuns('green', 'r2')
    const ran = run('reconcile')
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toContain('RECONCILED: the edge serves green running r2')
    expect(envOf()).toMatch(/^QUALY_ACTIVE_COLOR=green$/m)
    expect(envOf()).toMatch(/^QUALY_RELEASE=r2$/m)
    // and says nothing when the two already agree
    expect(run('reconcile').stdout).toBe('')
  })

  it('refuses when the fact cannot settle it', () => {
    // the edge on a color whose server is not running
    edgeOn(3002)
    expect(run('reconcile').stderr).toContain('its server is not running')
    // a maintenance page an upgrade left up, while a color is on record
    fs.writeFileSync(snippet, 'error "maintenance" 503\n')
    expect(run('reconcile').stderr).toContain('while')
    expect(run('reconcile').status).toBe(1)
    // with no edge, both servers running
    serverRuns('blue', 'r1')
    serverRuns('green', 'r2')
    expect(run('reconcile', { QUALY_PROXY: 'none' }).stderr).toContain(
      'cannot tell which color serves',
    )
    expect(envOf()).toMatch(/^QUALY_ACTIVE_COLOR=blue$/m)
  })

  // a restore runs on a deployment that is down, or again after one that
  // stopped halfway
  it('lets a restore through when the stopped color is the one on record', () => {
    // no edge, nothing running: only the record speaks
    expect(run('reconcile --stopped-ok', { QUALY_PROXY: 'none' }).status).toBe(0)
    expect(run('reconcile', { QUALY_PROXY: 'none' }).status).toBe(1)
    // the edge on the recorded color, stopped
    edgeOn(3001)
    expect(run('reconcile --stopped-ok').status).toBe(0)
    expect(run('reconcile').status).toBe(1)
    // the edge on the other one, stopped: which release it ran is not known
    edgeOn(3002)
    expect(run('reconcile --stopped-ok').stderr).toContain('its server is not running')
    expect(envOf()).toMatch(/^QUALY_ACTIVE_COLOR=blue$/m)
  })

  it('lets a first deployment through: nothing serves and nothing is on record', () => {
    fs.writeFileSync(envFile, 'QUALY_PORT_BLUE=3001\n', { mode: 0o600 })
    fs.writeFileSync(snippet, 'error "maintenance" 503\n')
    expect(run('reconcile').status).toBe(0)
  })
})

describe('moving the edge from one color to the other', () => {
  const caddy = {
    QUALY_PROXY_VALIDATE: 'true',
    QUALY_PROXY_RELOAD: 'true',
    QUALY_DRAIN_SECONDS: '0',
    QUALY_READY_TIMEOUT: '5',
  }
  const asked = () => fs.readFileSync(path.join(fake, 'docker.log'), 'utf8')

  it('starts the idle color, points the edge at it, records it and stops the other', () => {
    edgeOn(3001)
    const ran = run('take_over green r3 blue', caddy)
    expect(ran.status, ran.stderr).toBe(0)
    expect(fs.readFileSync(snippet, 'utf8')).toMatch(/^reverse_proxy 127\.0\.0\.1:3002 \{$/m)
    expect(envOf()).toMatch(/^QUALY_ACTIVE_COLOR=green$/m)
    expect(envOf()).toMatch(/^QUALY_RELEASE=r3$/m)
    expect(envOf()).toMatch(/^QUALY_RELEASE_GREEN=r3$/m)
    expect(envOf()).toMatch(/^QUALY_RELEASE_BLUE=r1$/m)
    expect(asked()).toContain('up -d server-green sandbox-runtime-green sandbox-authoring-green')
    expect(asked()).toContain('stop -t 40 server-blue sandbox-runtime-blue sandbox-authoring-blue')
  })

  it('leaves the edge, the record and the serving color as they were when the edge will not move', () => {
    edgeOn(3001)
    const ran = run('take_over green r3 blue', { ...caddy, QUALY_PROXY_VALIDATE: 'false' })
    expect(ran.status).toBe(1)
    expect(fs.readFileSync(snippet, 'utf8')).toMatch(/^reverse_proxy 127\.0\.0\.1:3001 \{$/m)
    expect(envOf()).toMatch(/^QUALY_ACTIVE_COLOR=blue$/m)
    // the idle color names what it ran before, for a later rollback
    expect(envOf()).toMatch(/^QUALY_RELEASE_GREEN=r2$/m)
    expect(asked()).toContain(
      'stop -t 10 server-green sandbox-runtime-green sandbox-authoring-green',
    )
    expect(asked()).not.toContain('server-blue sandbox-runtime-blue')
  })

  // sh has one namespace: a helper that assigned `release` or `target` once
  // upgraded a deployment to the release already serving, and wrote a file
  // path where a color belonged
  it("keeps the calling script's names as they were", () => {
    edgeOn(3001)
    serverRuns('blue', 'r0')
    const ran = run(
      'release=r9 target=green previous=blue; reconcile; env_set QUALY_X y; proxy_point http://127.0.0.1:3002; wait_ready http://x 1; printf "%s %s %s" "$release" "$target" "$previous"',
      caddy,
    )
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toMatch(/r9 green blue$/)
  })
})

describe('one deployment step at a time', () => {
  it('waits for an interruptible step and preserves all of its output', () => {
    const ran = run("run_interruptible sh -c 'sleep 0.1; printf complete'")
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toBe('complete')
  })

  it('waits for cancellable compose and preserves the dump on stdout', () => {
    const ran = run('compose_interruptible exec -T postgres pg_dump', { FAKE_STDOUT: 'dump' })
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout).toBe('dump')
  })

  it('interrupts a directly monitored child without waiting for it to finish', async () => {
    const started = Date.now()
    const child = spawn(
      'sh',
      [
        '-c',
        [
          'here="$1"; . "$2"',
          'cleanup() { echo cleanup; }',
          'trap cleanup EXIT',
          "trap 'interrupt_step TERM 143' TERM",
          "run_interruptible_child sh -c 'sleep 0.1; echo ready; sleep 10'",
          'echo continued',
        ].join('; '),
        'sh',
        path.dirname(LIB),
        LIB,
      ],
      { env: { ...process.env, QUALY_ENV_FILE: envFile }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk
    })
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) =>
      child.once('exit', (exitCode) => resolve(exitCode)),
    )
    expect(code).toBe(143)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(output).toContain('cleanup')
    expect(output).not.toContain('continued')
  })

  it('refuses a second step while the first holds the lock', async () => {
    const holder = spawn(
      'sh',
      ['-c', 'here="$1"; . "$2"; take_lock; echo held; sleep 3', 'sh', path.dirname(LIB), LIB],
      { env: { ...process.env, QUALY_ENV_FILE: envFile } },
    )
    await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()))
    const second = run('take_lock')
    holder.kill()
    await new Promise((resolve) => holder.once('exit', resolve))
    expect(second.status).toBe(1)
    expect(second.stderr).toContain('another deployment step holds')
  })

  it('stops a backup after TERM instead of continuing outside its released lock', async () => {
    const started = Date.now()
    const child = spawn(
      'sh',
      [
        '-c',
        [
          'here="$1"; . "$2"',
          'cleanup() { echo cleanup; }',
          'trap cleanup EXIT',
          "trap 'interrupt_step INT 130' INT",
          "trap 'interrupt_step TERM 143' TERM",
          "run_interruptible sh -c 'sleep 0.1; echo ready; sleep 10'",
          'echo continued',
        ].join('; '),
        'sh',
        path.dirname(LIB),
        LIB,
      ],
      { env: { ...process.env, QUALY_ENV_FILE: envFile }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk
    })
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()))
    child.kill('SIGTERM')
    const code = await new Promise<number | null>((resolve) =>
      child.once('exit', (exitCode) => resolve(exitCode)),
    )
    expect(code).toBe(143)
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(output).toContain('cleanup')
    expect(output).not.toContain('continued')
  })
})

describe('an append-only offsite backup command', () => {
  it('refuses the documented COS client when overwrite protection is absent', () => {
    const unsafe = run(
      'assert_immutable_offsite \'coscli -c /etc/qualy/coscli.yaml cp -r "$1" cos://backup/qualy/\'',
    )
    expect(unsafe.status).toBe(1)
    expect(unsafe.stderr).toContain('without --forbid-overwrite=true')

    const safe = run(
      'assert_immutable_offsite \'coscli -c /etc/qualy/coscli.yaml cp -r --forbid-overwrite=true "$1" cos://backup/qualy/\'',
    )
    expect(safe.status, safe.stderr).toBe(0)

    for (const disguised of [
      'coscli -c /etc/qualy/coscli.yaml cp -r "$1" cos://backup/qualy/ # --forbid-overwrite true',
      'coscli -c /etc/qualy/coscli.yaml cp -r "$1" cos://backup/qualy/ --meta "--forbid-overwrite true"',
      'coscli -c /etc/qualy/coscli.yaml cp -r "$1" cos://backup/qualy/\nprintf -- "--forbid-overwrite true"',
    ]) {
      const ran = run('assert_immutable_offsite "$OFFSITE"', { OFFSITE: disguised })
      expect(ran.status).toBe(1)
      expect(ran.stderr).toContain('unsupported shell syntax')
    }

    for (const invalidBoolean of [
      'coscli cp -r --forbid-overwrite true "$1" cos://backup/qualy/',
      'coscli cp -r --forbid-overwrite=true "$1" cos://backup/qualy/ --forbid-overwrite=false',
    ]) {
      const ran = run('assert_immutable_offsite "$OFFSITE"', { OFFSITE: invalidBoolean })
      expect(ran.status).toBe(1)
      expect(ran.stderr).toContain('must pass coscli --forbid-overwrite=true')
    }

    const unrelated = run(
      'assert_immutable_offsite \'rclone copy --immutable "$1" remote:coscli-backups/\'',
    )
    expect(unrelated.status, unrelated.stderr).toBe(0)

    const hidden = run(
      'assert_immutable_offsite \'sh -c "coscli cp --forbid-overwrite=true source target"\'',
    )
    expect(hidden.status).toBe(1)
    expect(hidden.stderr).toContain('must execute coscli directly')

    for (const quoted of [
      '"coscli" cp -r "$1" cos://backup/qualy/',
      '"/usr/local/bin/coscli" cp -r "$1" cos://backup/qualy/',
    ]) {
      const ran = run('assert_immutable_offsite "$OFFSITE"', { OFFSITE: quoted })
      expect(ran.status).toBe(1)
      expect(ran.stderr).toContain('unsupported shell syntax')
    }
  })
})

describe("a pending migration's rollout", () => {
  it('holds back every migration that does not say expand, the silent ones included', () => {
    const migrations = path.join(fake, 'images', 'r2', 'db', 'migrations')
    fs.mkdirSync(migrations, { recursive: true })
    fs.writeFileSync(
      path.join(migrations, '1_expand.sql'),
      '-- rollout: expand\ncreate table a (id int);\n',
    )
    fs.writeFileSync(
      path.join(migrations, '2_maintenance.sql'),
      '-- rollout: maintenance\nalter table a rename to b;\n',
    )
    fs.writeFileSync(path.join(migrations, '3_silent.sql'), 'create table c (id int);\n')
    fs.writeFileSync(path.join(migrations, '4_mention.sql'), 'select 1; -- rollout: expand\n')
    fs.writeFileSync(path.join(migrations, '5_legacy.sql'), 'alter table a add column c int;\n')
    fs.writeFileSync(
      path.join(migrations, '..', 'migration-rollout-overrides.txt'),
      '5_legacy.sql expand\n',
    )
    const ran = run('not_expand_in r2')
    expect(ran.status, ran.stderr).toBe(0)
    expect(ran.stdout.trim().split('\n').sort()).toEqual([
      '2_maintenance.sql',
      '3_silent.sql',
      '4_mention.sql',
    ])
  })
})
