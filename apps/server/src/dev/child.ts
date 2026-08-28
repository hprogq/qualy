import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fork, type ChildProcess } from 'node:child_process'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { PROTOCOL, type ChildMessage, type HostMessage, type PluginRoot } from './protocol.ts'

// Forking a supervised child, and the few questions the supervisor asks it.
//
// Every child of this supervisor speaks the same short protocol, so what
// differs between a backend and a development service is which entry point is
// forked and which message says it is ready. The waiting is written once here
// because getting it wrong is subtle in one direction: a promise that resolves
// on a message but never rejects on an exit hangs the whole reconcile loop
// when a child dies during startup.

const here = fileURLToPath(new URL('.', import.meta.url))
const backendEntry = path.resolve(here, '../run.ts')
const serviceEntry = path.resolve(here, 'service-runner.ts')

export interface Child {
  /** what the log calls it: `backend#3`, `dev:@qualy/plugin-web:web#1` */
  readonly name: string
  readonly process: ChildProcess
}

let generation = 0

const start = (label: string, entry: string, argv: readonly string[], env: NodeJS.ProcessEnv) => {
  generation += 1
  const process = fork(entry, [...argv], {
    execArgv: ['--import', 'tsx'],
    env,
    stdio: 'inherit',
  })
  return { name: `${label}#${String(generation)}`, process }
}

export const forkBackend = (env: NodeJS.ProcessEnv): Child =>
  start('backend', backendEntry, ['development'], env)

export const forkService = (
  spec: DevServiceSpec,
  origin: string,
  env: NodeJS.ProcessEnv,
): Child => {
  const child = start(`dev:${spec.id}`, serviceEntry, [], env)
  send(child, { protocol: PROTOCOL, type: 'spec', spec, origin })
  return child
}

export const send = (child: Child, message: HostMessage): void => {
  if (child.process.connected) child.process.send(message)
}

export const exited = (child: Child): Promise<number | null> =>
  new Promise((resolve) => {
    if (child.process.exitCode !== null) return resolve(child.process.exitCode)
    child.process.once('exit', (code) => resolve(code))
  })

/** ask it to stop, and wait; whatever is left after the deadline is killed */
export const stop = async (child: Child, within: number): Promise<void> => {
  if (child.process.exitCode !== null) return
  send(child, { protocol: PROTOCOL, type: 'shutdown' })
  const deadline = new Promise<'late'>((resolve) =>
    setTimeout(() => resolve('late'), within).unref(),
  )
  if ((await Promise.race([exited(child), deadline])) === 'late') {
    child.process.kill('SIGKILL')
    await exited(child)
  }
}

export interface Prepared {
  readonly topology: readonly DevServiceSpec[]
  readonly roots: readonly PluginRoot[]
}

class ChildGone extends Error {}

const awaits = <Found extends ChildMessage>(
  child: Child,
  matches: (message: ChildMessage) => message is Found,
): Promise<Found> =>
  new Promise((resolve, reject) => {
    const onMessage = (message: ChildMessage) => {
      if (!matches(message)) return
      child.process.off('message', onMessage)
      resolve(message)
    }
    child.process.on('message', onMessage)
    child.process.once('exit', (code) =>
      reject(new ChildGone(`${child.name} ended (${String(code)})`)),
    )
  })

/** what a candidate backend reports, or a rejection if it never got there */
export const backendPrepared = (child: Child): Promise<Prepared> =>
  awaits(
    child,
    (message): message is Extract<ChildMessage, { type: 'prepared'; role: 'backend' }> =>
      message.type === 'prepared' && message.role === 'backend',
  )

export const servicePrepared = (child: Child): Promise<void> =>
  awaits(
    child,
    (message): message is Extract<ChildMessage, { type: 'prepared'; role: 'service' }> =>
      message.type === 'prepared' && message.role === 'service',
  ).then(() => undefined)

export const serviceReady = (child: Child): Promise<void> =>
  awaits(
    child,
    (message): message is Extract<ChildMessage, { type: 'ready'; role: 'service' }> =>
      message.type === 'ready',
  ).then(() => undefined)

/**
 * Wait for the port to answer, which is what turns starting into running.
 *
 * Asked only while a backend is starting, never afterwards: a supervisor that
 * kept polling would restart a process for being briefly busy, and a
 * development backend is briefly busy all the time.
 */
export const listening = async (origin: string, child: Child, within: number): Promise<boolean> => {
  const end = Date.now() + within
  while (Date.now() < end) {
    if (child.process.exitCode !== null) return false
    try {
      const response = await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(1_000) })
      if (response.status === 200) return true
    } catch {
      // not yet; the process is still building what it owns
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}
