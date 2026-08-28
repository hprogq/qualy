import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { postgresAvailable } from '@qualy/plugin-database/testkit'

// The supervisor, driven by saving files.
//
// The claim it exists for is not "it restarts things". It is that a
// replacement which turns out not to be composable costs nothing: the process
// it would have replaced never stopped serving, and the browser's development
// server beside it never noticed either.
//
// What gets broken is a manifest of this suite's own, named through
// QUALY_CONFIG. Breaking a source file would have worked too and did, until
// it did not: other suites in the same run fork their own backends, which
// compile whatever is on disk at that moment, and a deliberately unparseable
// file in a shared tree fails them for a reason that names neither this suite
// nor theirs. A manifest nobody else reads breaks the same band of the boot -
// resolution, before anything is acquired - and touches nothing shared.
//
// It runs the actual `pnpm dev` supervisor, so the watcher's roots, the
// manifest precedence and the staging are all exercised as they ship.

const port = 3203
const origin = `http://127.0.0.1:${String(port)}`
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const host = path.join(repoRoot, 'apps/server/src/dev/host.ts')
// beside the real one, so every relative path in it still means what it says
const manifest = path.join(repoRoot, 'qualy.supervisor-test.yml')
const lock = path.join(repoRoot, 'qualy.supervisor-test.lock.json')

let intact = ''
let supervisor: ChildProcess | null = null
let output = ''

beforeAll(() => {
  intact = fs.readFileSync(path.join(repoRoot, 'qualy.yml'), 'utf8')
  fs.writeFileSync(manifest, intact)
  fs.copyFileSync(path.join(repoRoot, 'qualy.lock.json'), lock)
})

afterEach(async () => {
  fs.writeFileSync(manifest, intact)
  if (supervisor !== null && supervisor.exitCode === null) {
    supervisor.kill('SIGINT')
    await new Promise((resolve) => supervisor?.once('exit', resolve))
  }
  supervisor = null
  output = ''
})

afterAll(() => {
  for (const file of [manifest, lock]) fs.rmSync(file, { force: true })
})

const start = () => {
  const child = spawn('node', ['--import', 'tsx', host], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      QUALY_CONFIG: manifest,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  supervisor = child
  const collect = (chunk: Buffer) => {
    output += chunk.toString()
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  return child
}

const until = async (holds: () => boolean | Promise<boolean>, within = 120_000) => {
  const end = Date.now() + within
  while (Date.now() < end) {
    if (await holds()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`never happened; the supervisor said:\n${output}`)
}

const answers = async () => {
  try {
    return (await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(1_000) })).status
  } catch {
    return 0
  }
}

/** which backend generation the supervisor last announced */
const serving = () => [...output.matchAll(/backend#(\d+) is serving/g)].map((match) => match[1]!)

describe.runIf(postgresAvailable)('the development supervisor', () => {
  it('keeps the running world when a replacement will not compile', async () => {
    start()
    await until(() => serving().length === 1)
    await until(async () => (await answers()) === 200)
    const first = serving()[0]!

    // a plugin that is not installed: the candidate fails while resolving the
    // assembly, which is the band before anything is acquired
    fs.writeFileSync(manifest, `${intact}\n  '@qualy/plugin-does-not-exist': {}\n`)
    await until(() => output.includes('reload failed'))
    expect(output).toContain(`keeping backend#${first}`)
    // the point: it never stopped answering
    expect(await answers()).toBe(200)
    expect(serving()).toEqual([first])

    // and it recovers on the next save, without anything else being touched
    fs.writeFileSync(manifest, intact)
    await until(() => serving().length === 2)
    await until(async () => (await answers()) === 200)
    expect(serving()[1]).not.toBe(first)
  }, 300_000)

  it('leaves the browser alone while the backend alone is replaced', async () => {
    start()
    await until(() => output.includes('watching for changes'))
    await until(async () => (await answers()) === 200)
    // one line per web server that has started; there must only ever be one
    const started = () => [...output.matchAll(/web development server on/g)].length
    expect(started()).toBe(1)

    // A backend file, touched rather than rewritten. Its content is what
    // other suites in this run are compiling; its modification time is what
    // the watcher reads, and only one of those is shared.
    const now = new Date()
    fs.utimesSync(path.join(repoRoot, 'apps/server/src/health.ts'), now, now)
    await until(() => serving().length === 2)
    await until(async () => (await answers()) === 200)
    expect(started()).toBe(1)
  }, 300_000)
})
