import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// The server release image, inspected from the outside.
//
// A Dockerfile says what goes in; this says what came out, on the image a
// release actually ships. The claims: it runs the node the Dockerfile pins; it
// carries this checkout's manifest, lock and lineage byte for byte (compared
// by SHA-256); it carries no tests, no browser sources and
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

// --- what a release is: this checkout's manifest, lock and lineage
//
// Compared by SHA-256 of the bytes, and computed by one script run twice - by
// this node against the checkout and by the image's node against /app - so
// the two sides cannot differ in how they read, sort or hash. A lineage with
// the right names and different SQL is a different release.
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
process.stdout.write(JSON.stringify({
  'qualy.yml': sha(path.join(root, 'qualy.yml')),
  'qualy.lock.json': sha(path.join(root, 'qualy.lock.json')),
  migrations,
}))
`
interface ReleaseDigest {
  readonly 'qualy.yml': string
  readonly 'qualy.lock.json': string
  readonly migrations: Readonly<Record<string, string>>
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
    for (const file of ['qualy.yml', 'qualy.lock.json'] as const) {
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
  }
}
expectOut(
  'the web release store points at a release',
  'test -f /app/packages/plugins/infra/web/client-dist/current.json && echo present',
  'present',
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
