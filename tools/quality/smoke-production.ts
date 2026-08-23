import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { repoRoot } from '../lib/manifest.ts'

// The production boot, actually booted - through the same runner `pnpm
// start` uses, so the command people deploy with is the path being tested.
//
// The descriptor model gave up the compile-time proof that the composition
// closes; the boot is the check now, so a boot nobody runs under production
// settings is a trust boundary nobody guards. This starts the real entry
// against the staged assets and the committed lock, asserts the process
// serves - liveness, readiness, the browser shell, the manifest endpoint,
// one hashed asset - and then asserts it can also STOP: SIGTERM has to run
// the finalizers and exit zero.

const PORT = process.env.SMOKE_PORT ?? '3197'
const base = `http://127.0.0.1:${PORT}`

const server = spawn(
  process.execPath,
  [
    '--env-file-if-exists=.env',
    '--import',
    'tsx',
    path.join(repoRoot, 'apps/server/src/run.ts'),
    'production',
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT,
      // production refuses to assume a database; the smoke falls back to the
      // compose stack's url, the same one development assumes. Migrations
      // follow the runner's production default (off): the lineage was applied
      // by `pnpm qualy deploy`, exactly as a deployment would have.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
const output: string[] = []
server.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()))
server.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()))
const exited = new Promise<number | null>((resolve) => server.on('exit', resolve))

const fail = (message: string): never => {
  console.error(`smoke: ${message}`)
  console.error(output.join(''))
  server.kill('SIGKILL')
  process.exit(1)
}

const check = async (
  route: string,
  expect: (response: Response) => Promise<string | undefined>,
) => {
  const response = await fetch(`${base}${route}`).catch((error: unknown) => error as Error)
  if (response instanceof Error) return fail(`${route}: ${response.message}`)
  const complaint = await expect(response)
  if (complaint) return fail(`${route}: ${complaint}`)
  console.log(`smoke: ${route} ok`)
}

// readiness includes migrations and the database probe, so give it time
const deadline = Date.now() + 90_000
for (;;) {
  const ready = await fetch(`${base}/health/ready`).then(
    (response) => response.status,
    () => 0,
  )
  if (ready === 200) break
  if (server.exitCode !== null) fail(`process exited ${server.exitCode} before becoming ready`)
  if (Date.now() > deadline) fail('never became ready')
  await delay(500)
}
console.log('smoke: /health/ready ok')

await check('/health/live', async (response) =>
  response.status === 200 ? undefined : `status ${response.status}`,
)
let shell = ''
await check('/', async (response) => {
  shell = await response.text()
  if (response.status !== 200) return `status ${response.status}`
  return shell.includes('<!doctype html') ? undefined : 'no html shell'
})
// the live channel, answered like any authenticated endpoint: no session,
// no stream - and the route resolving at all means the listener layer
// assembled with the rest of the production graph
await check('/api/assessment/batches/00000000-0000-4000-8000-000000000000/events', (response) =>
  Promise.resolve(
    response.status === 401
      ? undefined
      : `expected 401 for the live channel, got ${response.status}`,
  ),
)

await check('/api/app/manifest', async (response) => {
  if (response.status !== 200) return `status ${response.status}`
  const body = (await response.json()) as { pages?: unknown[] }
  return Array.isArray(body.pages) ? undefined : 'no pages in the manifest'
})
// one hashed asset out of the shell it actually served, so the check follows
// the build instead of hardcoding a chunk name
const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(shell)?.[1]
if (!asset) fail('the shell references no /assets/*.js entry')
await check(asset!, async (response) =>
  response.status === 200 ? undefined : `status ${response.status}`,
)
// and it arrives compressed: the twins are written by the staging step and
// served by the static server, two halves that fail silently on their own -
// a missing twin just means the raw file goes out, five times the bytes
{
  const response = await fetch(`${base}${asset}`, { headers: { 'accept-encoding': 'br' } })
  const encoding = response.headers.get('content-encoding')
  if (encoding !== 'br') {
    fail(`${asset}: served with content-encoding ${encoding ?? 'none'}, expected br`)
  }
  console.log(`smoke: ${asset} served brotli-compressed`)
}

server.kill('SIGTERM')
const code = await Promise.race([exited, delay(15_000).then(() => 'timeout' as const)])
if (code === 'timeout') fail('SIGTERM did not stop the process within 15s')
if (code !== 0) fail(`shutdown exited ${code}`)
console.log('smoke: shutdown clean (exit 0)')
