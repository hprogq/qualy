import { createConnection } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { fork, type ChildProcess } from 'node:child_process'
import { manifestPath } from '../manifest.ts'
import { PROTOCOL, type ChildMessage, type HostMessage } from './protocol.ts'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'

// The process `pnpm dev` is (docs/runtime-redesign.md §45).
//
// It owns one thing: which child processes exist. The backend owns its own
// resources, Vite owns the browser's module graph, and this owns neither -
// it starts them, tells them when they may take what they need, and stops
// them together.
//
// It does not watch anything yet. Staging a replacement while the old one
// serves is the next phase; what this establishes is that the two lifetimes
// are already separate, so a backend can be replaced without the browser's
// dev server noticing.

const here = fileURLToPath(new URL('.', import.meta.url))
const backendEntry = path.resolve(here, '../run.ts')
const serviceEntry = path.resolve(here, 'service-runner.ts')

const say = (line: string) => process.stdout.write(`dev: ${line}\n`)

/**
 * One environment for every child of this session.
 *
 * Read here rather than by the launcher, because this process outlives many
 * children: started with `--env-file`, its own `process.env` would hold the
 * `.env` of whenever it happened to start, and every later child would
 * inherit that instead of what is on disk. The shell wins over the file,
 * which is the precedence anyone typing a variable in front of a command
 * expects.
 */
const childEnv = (manifest: string): NodeJS.ProcessEnv => {
  const file = path.join(process.cwd(), '.env')
  const declared = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}
  return {
    ...declared,
    ...process.env,
    NODE_ENV: 'development',
    QUALY_DEV_SUPERVISED: '1',
    // every child reads one manifest, and this is where that is decided: a
    // browser bundle built from a different selection than the api answering
    // it is a mismatch neither half can notice
    QUALY_CONFIG: manifest,
  }
}

const port = Number(process.env.PORT ?? 3000)

/** whether something is already answering where the backend is about to bind */
const portTaken = (at: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createConnection({ host: '127.0.0.1', port: at })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })

const children = new Map<string, ChildProcess>()

const start = (label: string, entry: string, argv: readonly string[], env: NodeJS.ProcessEnv) => {
  const child = fork(entry, argv, { execArgv: ['--import', 'tsx'], env, stdio: 'inherit' })
  children.set(label, child)
  child.once('exit', (code, signal) => {
    children.delete(label)
    if (!stopping) say(`${label} ended (${signal ?? String(code)})`)
    if (!stopping && label === 'backend') say('no backend is running; fix it and restart')
  })
  return child
}

const tell = (child: ChildProcess, message: HostMessage) => {
  if (child.connected) child.send(message)
}

/** the first message matching, or a rejection if the child ends before it */
const awaits = <Found extends ChildMessage>(
  child: ChildProcess,
  matches: (message: ChildMessage) => message is Found,
  what: string,
) =>
  new Promise<Found>((resolve, reject) => {
    const onMessage = (message: ChildMessage) => {
      if (!matches(message)) return
      child.off('message', onMessage)
      resolve(message)
    }
    child.on('message', onMessage)
    child.once('exit', () => reject(new Error(`the child ended before saying ${what}`)))
  })

const preparedBackend = (
  message: ChildMessage,
): message is Extract<ChildMessage, { type: 'prepared'; role: 'backend' }> =>
  message.type === 'prepared' && message.role === 'backend'

const preparedService = (
  message: ChildMessage,
): message is Extract<ChildMessage, { type: 'prepared'; role: 'service' }> =>
  message.type === 'prepared' && message.role === 'service'

let stopping = false

const stop = async () => {
  if (stopping) return
  stopping = true
  say('stopping')
  const ending = [...children.values()].map(
    (child) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        tell(child, { protocol: PROTOCOL, type: 'shutdown' })
      }),
  )
  // a development session on its way out: whatever has not finished by then
  // dies with this process anyway
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000).unref())
  await Promise.race([Promise.all(ending), deadline])
  for (const child of children.values()) if (child.exitCode === null) child.kill('SIGKILL')
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop())

const manifest = manifestPath()
const env = childEnv(manifest)

if (await portTaken(port)) {
  say(`port ${String(port)} is already in use; stop what is on it or set PORT`)
  process.exit(1)
}

say(`assembly ${manifest}`)
const backend = start('backend', backendEntry, ['development'], env)
const { topology } = await awaits(backend, preparedBackend, 'prepared')
// nothing else is running, so there is nothing to hand over from
tell(backend, { protocol: PROTOCOL, type: 'accept' })

// The browser's own entry, and everything else a plugin asked for. Started
// after the backend has been let in, because a proxy pointed at a port
// nobody is on yet answers the first navigation with an error the developer
// then has to reload past.
const origin = `http://127.0.0.1:${String(port)}`
const services = topology.map((spec: DevServiceSpec) => {
  const child = start(`dev:${spec.key}`, serviceEntry, [], env)
  tell(child, { protocol: PROTOCOL, type: 'spec', spec, origin })
  return { spec, child }
})

for (const { spec, child } of services) {
  await awaits(child, preparedService, 'prepared').catch(() => {
    say(`${spec.key} could not prepare; carrying on without it`)
    return null
  })
  tell(child, { protocol: PROTOCOL, type: 'accept' })
}

if (services.length === 0) say('no development services declared; the api is on its own')
