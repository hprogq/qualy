import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// The server release image, inspected from the outside.
//
// A Dockerfile says what goes in; this says what came out, on the image a
// release actually ships. The claims: it runs the node the Dockerfile pins; it
// carries this checkout's manifest, lock, lineage and deploy scripts byte for
// byte (compared by SHA-256), and no deployment's env file beside the
// scripts; it carries no tests, no browser sources and
// no development toolchain; the assembly resolves from inside it against its
// own lock with nothing mounted; and a start reaches the database before it
// stops - which is as far as a start can get without one.
//
//   node tools/quality/check-release-image.ts qualy-server:local

const image = process.argv[2]
if (!image) {
  console.error('usage: node tools/quality/check-release-image.ts <image>')
  process.exit(2)
}

let failed = false
const ok = (line: string) => console.log(`check-release-image: ${line}`)
const fail = (line: string) => {
  failed = true
  console.error(`check-release-image: FAIL ${line}`)
}

/** a shell line inside the image, as the image's own user */
const inside = (command: string): { code: number; out: string } => {
  const ran = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', command], {
    encoding: 'utf8',
  })
  return { code: ran.status ?? 1, out: `${ran.stdout}${ran.stderr}`.trim() }
}

const expectOut = (label: string, command: string, want: string) => {
  const { out } = inside(command)
  if (out === want) ok(label)
  else fail(`${label}: got ${JSON.stringify(out.slice(0, 200))}, want ${JSON.stringify(want)}`)
}

// --- who runs, on what
expectOut('runs as the unprivileged node user', 'id -u', '1000')
{
  // the version the Dockerfile pins, not merely the major line: a base image
  // that moved within 24.x is a different release input
  const pinned = /^ARG NODE_IMAGE=node:(\d+\.\d+\.\d+)-[\w.-]+@sha256:[0-9a-f]{64}$/m.exec(
    fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8'),
  )?.[1]
  const { out } = inside('node --version')
  if (pinned === undefined) fail('the Dockerfile pins no node image by version and digest')
  else if (out === `v${pinned}`) ok(`node ${out}, as the Dockerfile pins`)
  else fail(`node is ${out}, the Dockerfile pins v${pinned}`)
}

// --- what a release is: this checkout's manifest, lock, lineage and deploy/
//
// Compared by SHA-256 of the bytes, and computed by one script run twice - by
// this node against the checkout and by the image's node against /app - so
// the two sides cannot differ in how they read, sort or hash. A lineage with
// the right names and different SQL is a different release; deploy/ is what
// the deployment host runs as root to move onto it. A deployment's own env
// files and Finder metadata are left out of the walk here (a developer's
// deploy/.env and .DS_Store are not Docker build inputs) and env files are
// refused inside the image below.
const RELEASE_DIGEST = `
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = process.argv[1]
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const lineage = path.join(root, 'db/migrations')
const migrations = {}
for (const name of fs.readdirSync(lineage).filter((one) => one.endsWith('.sql')).sort()) {
  migrations[name] = sha(path.join(lineage, name))
}
const deploy = {}
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (!entry.name.endsWith('.env') && entry.name !== '.DS_Store') {
      deploy[path.relative(root, full)] = sha(full)
    }
  }
}
walk(path.join(root, 'deploy'))
process.stdout.write(JSON.stringify({
  'qualy.yml': sha(path.join(root, 'qualy.yml')),
  'qualy.lock.json': sha(path.join(root, 'qualy.lock.json')),
  'migration-rollout-overrides.txt': sha(path.join(root, 'db/migration-rollout-overrides.txt')),
  migrations,
  deploy: Object.fromEntries(Object.entries(deploy).sort()),
}))
`
interface ReleaseDigest {
  readonly 'qualy.yml': string
  readonly 'qualy.lock.json': string
  readonly 'migration-rollout-overrides.txt': string
  readonly migrations: Readonly<Record<string, string>>
  readonly deploy: Readonly<Record<string, string>>
}
{
  const local = JSON.parse(
    execFileSync(process.execPath, ['-e', RELEASE_DIGEST, repoRoot], { encoding: 'utf8' }),
  ) as ReleaseDigest
  const ran = spawnSync(
    'docker',
    ['run', '--rm', '--entrypoint', 'node', image, '-e', RELEASE_DIGEST, '/app'],
    { encoding: 'utf8' },
  )
  let shipped: ReleaseDigest | undefined
  try {
    shipped = JSON.parse(ran.stdout) as ReleaseDigest
  } catch {
    fail(
      `could not digest the release inside the image: ${`${ran.stdout}${ran.stderr}`.slice(0, 300)}`,
    )
  }
  if (shipped !== undefined) {
    for (const file of [
      'qualy.yml',
      'qualy.lock.json',
      'migration-rollout-overrides.txt',
    ] as const) {
      if (shipped[file] === local[file])
        ok(`${file} is this checkout's (sha256 ${local[file].slice(0, 12)})`)
      else fail(`${file} in the image differs from the checkout`)
    }
    const names = new Set([...Object.keys(local.migrations), ...Object.keys(shipped.migrations)])
    const differing = [...names]
      .sort()
      .filter((name) => local.migrations[name] !== shipped.migrations[name])
    if (differing.length === 0) {
      ok(`db/migrations: ${String(names.size)} committed migration(s), every one byte for byte`)
    } else {
      fail(
        `db/migrations differ from the checkout in ${String(differing.length)} file(s): ${differing
          .map((name) =>
            local.migrations[name] === undefined
              ? `${name} (only in the image)`
              : shipped.migrations[name] === undefined
                ? `${name} (missing from the image)`
                : `${name} (different content)`,
          )
          .join(', ')}`,
      )
    }
    const scripts = new Set([...Object.keys(local.deploy), ...Object.keys(shipped.deploy)])
    const drifted = [...scripts]
      .sort()
      .filter((name) => local.deploy[name] !== shipped.deploy[name])
    if (drifted.length === 0 && scripts.size > 0) {
      ok(`deploy/: ${String(scripts.size)} file(s), every one byte for byte`)
    } else {
      fail(`deploy/ differs from the checkout: ${drifted.join(', ') || 'no files at all'}`)
    }
  }
}
expectOut(
  "no deployment's env file among the deploy scripts",
  `find /app/deploy -type f \\( -name .env -o -name '*.env' \\) | wc -l | tr -d ' '`,
  '0',
)
expectOut(
  'the deploy scripts can be run',
  'test -x /app/deploy/upgrade.sh && test -x /app/deploy/rollback.sh && echo runnable',
  'runnable',
)
expectOut(
  'the web release store points at a release',
  'test -f /app/packages/plugins/infra/web/client-dist/current.json && echo present',
  'present',
)
// where a deployment mounts its own release store: a fresh named volume takes
// the ownership of the directory it is mounted over, and the deploy job,
// running as node, has to be able to install into it
expectOut(
  "the deployment's web release store is there for the runtime user",
  'stat -c %U /var/lib/qualy/web',
  'node',
)

// --- what a release is not: tests, browser sources, the dev toolchain, the repository
expectOut(
  'no test directories or test files',
  `find /app/apps /app/packages -path '*/node_modules' -prune -o \\( -type d -name tests -o -name '*.test.ts' -o -name '*.browser.test.tsx' \\) -print | wc -l | tr -d ' '`,
  '0',
)
expectOut(
  'no browser sources',
  `find /app/apps /app/packages -path '*/node_modules' -prune -o \\( -type d -path '*/src/client' -o -name '*.tsx' \\) -print | wc -l | tr -d ' '`,
  '0',
)
for (const tool of [
  'vitest',
  'vite',
  'typescript',
  '@effect+tsgo',
  'playwright',
  '@vitest+browser',
  'tsx',
  'esbuild',
]) {
  expectOut(
    `no ${tool} in the dependency store`,
    `ls /app/node_modules/.pnpm 2>/dev/null | grep -c "^${tool.replaceAll('+', '\\+')}@" | tr -d ' ' || true`,
    '0',
  )
}
for (const dir of ['tools', 'docs', 'apps/web', 'packages/testkit', '.git', 'legacy', 'repos']) {
  expectOut(`no /app/${dir}`, `test -e /app/${dir} && echo present || echo absent`, 'absent')
}
expectOut('no .env baked in', 'test -e /app/.env && echo present || echo absent', 'absent')
expectOut(
  'no package manager beside node',
  'for tool in npm npx corepack yarn; do command -v $tool; done; ls -d /usr/local/lib/node_modules/* /opt/yarn-* 2>/dev/null; true',
  '',
)

// --- the assembly resolves from inside the image, against its own lock, with nothing mounted
{
  const { code, out } = inside('node apps/cli/src/main.ts resolve --frozen-lockfile')
  if (code === 0 && out.includes('is up to date'))
    ok('the assembly resolves inside the image and matches its lock')
  else
    fail(`resolve --frozen-lockfile inside the image exited ${String(code)}: ${out.slice(0, 300)}`)
}

// --- a start gets as far as the database, and says so when it is not there
{
  const ran = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'DATABASE_URL=postgres://nobody:nobody@127.0.0.1:1/none',
      '-e',
      // a production process refuses to start without one, and the refusal
      // this probe is about is the database's
      `QUALY_SECRETS_MASTER_KEY=${randomBytes(32).toString('base64')}`,
      // and without a mail sender and relay; nothing is sent at boot
      '-e',
      'QUALY_MAIL_FROM=Qualy <no-reply@qualy.invalid>',
      '-e',
      'QUALY_MAIL_SMTP_HOST=127.0.0.1',
      '-e',
      'QUALY_MAIL_SMTP_TLS=none',
      '-e',
      'QUALY_MAIL_SMTP_ALLOW_PLAINTEXT=1',
      '-e',
      'QUALY_MAIL_RESEND_API_KEY=re_smoke_only',
      // and without the address it is reached at
      '-e',
      'QUALY_PUBLIC_URL=https://qualy.invalid',
      '-e',
      'QUALY_LOG_FORMAT=json',
      image,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  )
  const out = `${ran.stdout}${ran.stderr}`
  if (
    ran.status === 1 &&
    out.includes('startup failed') &&
    out.includes('postgres is not reachable')
  ) {
    ok(
      'a start without a database gets past the lock and the web release, and refuses at the database',
    )
  } else {
    fail(
      `a start without a database exited ${String(ran.status)} with:\n${out.split('\n').slice(-8).join('\n')}`,
    )
  }
}

// --- size, for the record
try {
  const size = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Size}}'], {
    encoding: 'utf8',
  }).trim()
  ok(`image size ${(Number(size) / 1024 / 1024).toFixed(0)} MB`)
} catch {
  // informational only
}

if (failed) process.exit(1)
console.log(`check-release-image: ${image} ok`)
