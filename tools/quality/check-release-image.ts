import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// The server release image, inspected from the outside.
//
// A Dockerfile says what goes in; this says what came out, on the image a
// release actually ships. The claims: it carries this checkout's manifest,
// lock and lineage byte for byte; it carries no tests, no browser sources and
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
  const { out } = inside('node --version')
  if (out.startsWith('v24.')) ok(`node ${out}`)
  else fail(`node is ${out}, expected the v24 line`)
}

// --- what a release is: this checkout's manifest, lock and lineage
for (const file of ['qualy.yml', 'qualy.lock.json']) {
  const local = fs.readFileSync(path.join(repoRoot, file), 'utf8')
  const { out } = inside(`cat /app/${file}`)
  if (out === local.trimEnd()) ok(`${file} is this checkout's, byte for byte`)
  else fail(`${file} in the image differs from the checkout`)
}
{
  const local = fs
    .readdirSync(path.join(repoRoot, 'db/migrations'))
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
  const { out } = inside('ls /app/db/migrations | grep "\\.sql$" | sort')
  const shipped = out.split('\n').filter((line) => line !== '')
  if (shipped.join('\n') === local.join('\n'))
    ok(`db/migrations: ${String(local.length)} committed migration(s)`)
  else
    fail(
      `db/migrations differ: image ships ${String(shipped.length)}, checkout has ${String(local.length)}`,
    )
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
