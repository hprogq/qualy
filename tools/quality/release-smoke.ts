import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'

// One release, deployed the way deploy/compose.yaml deploys it, on a
// throwaway compose project - and taken through the moves a deployment makes.
//
//   node tools/quality/release-smoke.ts <release>
//
// The images qualy-server:<release>, qualy-sandbox-runtime:<release> and
// qualy-sandbox-authoring:<release> must exist (pnpm release:build). In
// order: the database comes up; a server started before the migration job
// refuses; the job applies the lineage; the server and both sandboxes come
// up and the server reports ready; the shell, the manifest and one hashed
// asset are served; both sandboxes answer the RPC handshake from inside the
// server container; a second migration run finds nothing to do; the
// database is dumped, dropped, restored, brought up to date and served
// again with its data intact. Then everything, volumes included, is removed.

const release = process.argv[2]
if (!release) {
  console.error('usage: node tools/quality/release-smoke.ts <release>')
  process.exit(2)
}

const project = `qualy-smoke-${process.pid.toString(36)}`
const composeFile = path.join(repoRoot, 'deploy/compose.yaml')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-release-smoke-'))
const envFile = path.join(work, 'smoke.env')

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'))
        else resolve(address.port)
      })
    })
  })
const port = await freePort()
const base = `http://127.0.0.1:${String(port)}`

fs.writeFileSync(
  envFile,
  [
    `QUALY_RELEASE=${release}`,
    'POSTGRES_USER=qualy',
    'POSTGRES_PASSWORD=smoke',
    'POSTGRES_DB=qualy',
    'DATABASE_URL=postgres://qualy:smoke@postgres:5432/qualy',
    `QUALY_PORT=${String(port)}`,
    'QUALY_LOG_FORMAT=json',
    'QUALY_LOG_LEVEL=info',
    '',
  ].join('\n'),
)

interface Ran {
  readonly code: number
  readonly out: string
  readonly stdout: Buffer
}
const compose = (
  args: readonly string[],
  options: { input?: Buffer; timeoutMs?: number } = {},
): Ran => {
  const ran = spawnSync(
    'docker',
    ['compose', '--project-name', project, '--file', composeFile, '--env-file', envFile, ...args],
    {
      cwd: repoRoot,
      env: { ...process.env, QUALY_ENV_FILE: envFile },
      input: options.input,
      maxBuffer: 256 * 1024 * 1024,
      timeout: options.timeoutMs ?? 300_000,
    },
  )
  const stdout = ran.stdout ?? Buffer.alloc(0)
  return {
    code: ran.status ?? 1,
    out: `${stdout.toString('utf8')}${(ran.stderr ?? Buffer.alloc(0)).toString('utf8')}`.trim(),
    stdout,
  }
}

let failed = false
const step = (line: string) => console.log(`release-smoke: ${line}`)
class SmokeFailed extends Error {}
// a declaration, not an arrow in a const: only a name with an explicit type
// narrows the code after the call, and `never` is what the callers lean on
function refuse(line: string): never {
  throw new SmokeFailed(line)
}
const expectCode = (label: string, ran: Ran, want: number) => {
  if (ran.code !== want)
    refuse(
      `${label}: exited ${String(ran.code)}, expected ${String(want)}:\n${ran.out.slice(-2000)}`,
    )
}
const expectIn = (label: string, haystack: string, needle: string | RegExp) => {
  const found = typeof needle === 'string' ? haystack.includes(needle) : needle.test(haystack)
  if (!found) refuse(`${label}: expected ${String(needle)} in:\n${haystack.slice(-2000)}`)
}

const waitReady = async (label: string, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health/ready`)
      if (response.status === 200) {
        step(`${label}: /health/ready 200`)
        return
      }
      last = `status ${String(response.status)}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  refuse(`${label}: not ready within ${String(timeoutMs)}ms (${last})`)
}

const psql = (sql: string): Ran =>
  compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c ${JSON.stringify(sql)}`,
  ])

try {
  // --- the database
  expectCode('postgres up', compose(['up', '-d', '--wait', 'postgres']), 0)
  step('postgres up')

  // --- a start before the migration job: refused, naming the job
  {
    const ran = compose(['run', '--rm', '--no-deps', 'server'], { timeoutMs: 120_000 })
    if (ran.code === 0) refuse('a server started before the migration job did not refuse')
    expectIn('start before migrate', ran.out, /migration\(s\) behind/)
    expectIn('start before migrate', ran.out, 'startup failed')
    step('a server started before the migration job refuses, naming the job')
  }

  // --- the migration job
  {
    const ran = compose(['run', '--rm', 'migrate'])
    expectCode('migrate', ran, 0)
    expectIn('migrate', ran.out, /applied \d+ migration\(s\)/)
    step(`migrate: ${ran.out.split('\n').find((line) => line.includes('applied')) ?? 'applied'}`)
  }

  // --- the server and the sandboxes
  expectCode(
    'services up',
    compose(['up', '-d', '--wait', 'server', 'sandbox-runtime', 'sandbox-authoring']),
    0,
  )
  await waitReady('first start')

  // --- what it serves: the shell, one hashed asset, the manifest
  {
    const shell = await fetch(`${base}/`)
    if (shell.status !== 200) refuse(`GET / status ${String(shell.status)}`)
    const html = await shell.text()
    expectIn('shell', html, '<!doctype html')
    const asset = /(?:src|href)="(\/[^"]+\.(?:js|css))"/.exec(html)?.[1]
    if (asset === undefined) refuse('the shell references no built asset')
    const fetched = await fetch(`${base}${asset}`)
    if (fetched.status !== 200) refuse(`GET ${asset} status ${String(fetched.status)}`)
    step(`shell and ${asset} served`)
    const manifest = await fetch(`${base}/api/app/manifest`)
    if (manifest.status !== 200) refuse(`manifest status ${String(manifest.status)}`)
    const body = (await manifest.json()) as { pages?: unknown[] }
    if (!Array.isArray(body.pages)) refuse('the manifest carries no pages')
    step(`manifest: ${String(body.pages.length)} page(s) for an anonymous visitor`)
  }

  // --- the sandbox pair, over their sockets, from inside the server
  {
    const ran = compose([
      'exec',
      '-T',
      'server',
      'node',
      'apps/cli/src/main.ts',
      'sandbox',
      'status',
    ])
    expectCode('sandbox status', ran, 0)
    expectIn('sandbox status', ran.out, 'runtime ok')
    expectIn('sandbox status', ran.out, 'authoring ok')
    for (const line of ran.out.split('\n')) step(line)
  }

  // --- the job again: nothing to do
  {
    const ran = compose(['run', '--rm', 'migrate'])
    expectCode('migrate again', ran, 0)
    expectIn('migrate again', ran.out, 'is up to date')
    step('migrate again: up to date')
  }

  // --- backup, destroy, restore, serve again
  const marker = `smoke-${Date.now().toString(36)}`
  expectCode(
    'marker',
    psql(
      `create table release_smoke_marker (value text); insert into release_smoke_marker values ('${marker}')`,
    ),
    0,
  )
  const dump = compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"',
  ])
  expectCode('pg_dump', dump, 0)
  if (dump.stdout.length < 1024) refuse(`pg_dump produced ${String(dump.stdout.length)} bytes`)
  step(`backup: ${String(dump.stdout.length)} bytes`)

  expectCode('server stop', compose(['stop', 'server']), 0)
  expectCode(
    'drop and recreate',
    compose([
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"',
    ]),
    0,
  )
  step('database dropped and recreated empty')
  expectCode(
    'pg_restore',
    compose(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-c',
        'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner',
      ],
      { input: dump.stdout },
    ),
    0,
  )
  {
    const ran = compose(['run', '--rm', 'migrate'])
    expectCode('migrate after restore', ran, 0)
    expectIn('migrate after restore', ran.out, 'is up to date')
    step('restored: the ledger is complete, migrate has nothing to do')
  }
  expectCode('server start', compose(['start', 'server']), 0)
  await waitReady('after restore')
  {
    const shell = await fetch(`${base}/`)
    if (shell.status !== 200) refuse(`GET / after restore: status ${String(shell.status)}`)
    const found = psql('select value from release_smoke_marker')
    expectCode('marker after restore', found, 0)
    expectIn('marker after restore', found.out, marker)
    step('after restore: served, and the row written before the backup is there')
  }
} catch (error) {
  failed = true
  console.error(
    `release-smoke: FAIL ${error instanceof SmokeFailed ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  )
  const logs = compose(['logs', '--no-color', '--tail', '60', 'server', 'postgres'])
  console.error(logs.out)
} finally {
  const down = compose(['down', '--volumes', '--remove-orphans', '--timeout', '20'])
  if (down.code !== 0)
    console.error(`release-smoke: compose down exited ${String(down.code)}:\n${down.out}`)
  fs.rmSync(work, { recursive: true, force: true })
}

if (failed) process.exit(1)
console.log(`release-smoke: ${release} ok`)
