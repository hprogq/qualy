import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
//
// Everything it drives is its own. It used to borrow two things from the
// working tree and both were wrong. The browser half ran the real
// `apps/web`, whose vite config names one port and whose dev service sets
// `strictPort`, so the whole case failed for anybody with `pnpm dev` open -
// not sometimes, but by construction. And the backend reload was triggered by
// touching a real source file, which is a genuine save as far as any OTHER
// watcher is concerned: a development session running beside the suite would
// reload because a test wanted it to.
//
// So the web application here is a temporary directory holding the two files
// the dev service asks for, on a port nobody else uses, and the backend
// reload is triggered through a plugin this suite installs for itself. What
// stays real is everything under test: the supervisor, the watcher, the
// staging protocol and Vite's own lifecycle.

const port = 3203
const webPort = 5273
const origin = `http://127.0.0.1:${String(port)}`
const repoRoot = path.resolve(import.meta.dirname, '../../..')
const host = path.join(repoRoot, 'apps/server/src/dev/host.ts')
// beside the real one, so every relative path in it still means what it says
const manifest = path.join(repoRoot, 'qualy.supervisor-test.yml')
const lock = path.join(repoRoot, 'qualy.supervisor-test.lock.json')

// The plugin this suite installs so it has a backend source file of its own
// to save. It contributes nothing - an id and no features - because what is
// being exercised is the watcher's answer to a save under a plugin root, not
// anything the plugin does. Its package is a temporary directory, linked into
// the host's node_modules the way any installed plugin is; node_modules is
// never watched, so the link itself is invisible to every watcher including
// the one under test.
const triggerId = '@qualy/plugin-supervisor-test-trigger'
const linkedAt = path.join(repoRoot, 'apps/server/node_modules', ...triggerId.split('/'))

let intact = ''
let manifestText = ''
let webRoot = ''
let triggerRoot = ''
let supervisor: ChildProcess | null = null
let detached = false
let output = ''

/** the file whose modification time asks for a backend-only reload */
const triggerFile = () => path.join(triggerRoot, 'src/server/marker.ts')

beforeAll(() => {
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-supervisor-web-'))
  // the two files the web dev service checks for, and a port of this
  // suite's own so a running `pnpm dev` is neither disturbed nor in the way
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html>\n<title>test</title>\n')
  fs.writeFileSync(
    path.join(webRoot, 'vite.config.ts'),
    `export default { server: { port: ${String(webPort)} } }\n`,
  )
  // so the config is read as the ESM it is written in; without a package.json
  // the nearest one decides, and vite warned that a future major will load it
  // natively and fail rather than warn
  fs.writeFileSync(path.join(webRoot, 'package.json'), '{ "type": "module" }\n')

  triggerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-supervisor-plugin-'))
  fs.mkdirSync(path.join(triggerRoot, 'src/server'), { recursive: true })
  fs.writeFileSync(
    path.join(triggerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: triggerId,
        version: '0.0.0',
        private: true,
        type: 'module',
        exports: { '.': './index.js', './package.json': './package.json' },
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(
    path.join(triggerRoot, 'index.js'),
    `export default { _tag: 'Plugin', id: ${JSON.stringify(triggerId)}, dependsOn: [], features: [] }\n`,
  )
  fs.writeFileSync(triggerFile(), 'export const marker = 1\n')
  fs.mkdirSync(path.dirname(linkedAt), { recursive: true })
  fs.rmSync(linkedAt, { force: true, recursive: true })
  fs.symlinkSync(triggerRoot, linkedAt, 'dir')

  intact = fs.readFileSync(path.join(repoRoot, 'qualy.yml'), 'utf8')
  manifestText = intact
    .replace(
      "'@qualy/plugin-web': {}",
      `'@qualy/plugin-web':\n    config: { sourceRoot: ${JSON.stringify(webRoot)} }`,
    )
    .concat(`  '${triggerId}': {}\n`)
  fs.writeFileSync(manifest, manifestText)
  fs.copyFileSync(path.join(repoRoot, 'qualy.lock.json'), lock)
})

afterEach(async () => {
  fs.writeFileSync(manifest, manifestText)
  if (supervisor !== null && supervisor.exitCode === null) {
    // a detached child is its own group, and killing only its leader would
    // leave the backend and the dev server behind
    if (detached && supervisor.pid !== undefined) process.kill(-supervisor.pid, 'SIGKILL')
    else supervisor.kill('SIGINT')
    await new Promise((resolve) => supervisor?.once('exit', resolve))
  }
  supervisor = null
  detached = false
  output = ''
})

afterAll(() => {
  for (const file of [manifest, lock]) fs.rmSync(file, { force: true })
  fs.rmSync(linkedAt, { force: true })
  for (const dir of [webRoot, triggerRoot])
    if (dir !== '') fs.rmSync(dir, { recursive: true, force: true })
})

const start = (options: { ownGroup?: boolean } = {}) => {
  detached = options.ownGroup === true
  const child = spawn('node', [host], {
    cwd: repoRoot,
    // its own process group, which is what a terminal gives a foreground job
    ...(detached ? { detached: true } : {}),
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
    fs.writeFileSync(manifest, `${manifestText}\n  '@qualy/plugin-does-not-exist': {}\n`)
    await until(() => output.includes('reload failed'))
    expect(output).toContain(`keeping backend#${first}`)
    // the point: it never stopped answering
    expect(await answers()).toBe(200)
    expect(serving()).toEqual([first])

    // and it recovers on the next save, without anything else being touched
    fs.writeFileSync(manifest, manifestText)
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

    // A save under this suite's own plugin, in the half the watcher reads as
    // the backend. Nothing else on the machine watches it, so no development
    // session running beside this one reloads because a test asked for it.
    fs.writeFileSync(triggerFile(), `export const marker = ${String(Date.now())}\n`)
    await until(() => serving().length === 2)
    await until(async () => (await answers()) === 200)
    expect(started()).toBe(1)
  }, 300_000)

  // A Ctrl+C in a terminal goes to the whole foreground group, not to the
  // supervisor alone - so every child is already shutting down by the time
  // the supervisor gets round to telling it to. Sending into a channel that
  // is closing reports itself by emitting an `error` event, and an unhandled
  // one of those ends the process: the session died with a stack trace after
  // it had already said it was stopping.
  //
  // Every other case here kills the supervisor by itself, which is why this
  // needs its own: that is the one shape in which the race cannot happen.
  it('stops cleanly when the whole group is interrupted, as a terminal does', async () => {
    const child = start({ ownGroup: true })
    await until(() => output.includes('watching for changes'))
    await until(async () => (await answers()) === 200)

    process.kill(-child.pid!, 'SIGINT')
    const code = await new Promise<number | null>((resolve) => {
      child.once('exit', (status) => resolve(status))
    })
    expect(code).toBe(0)
    expect(output).not.toContain('EPIPE')
    // and the port is free, so nothing was left holding it
    await until(async () => (await answers()) === 0)
  }, 300_000)
})
