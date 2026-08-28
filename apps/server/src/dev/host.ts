import { createConnection } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import type { FSWatcher } from 'chokidar'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { readManifest } from '@qualy/assembly'
import { manifestPath } from '../manifest.ts'
import { logLine, resolveLogging } from '../logging.ts'
import { PROTOCOL, type PluginRoot } from './protocol.ts'
import {
  backendPrepared,
  exited,
  forkBackend,
  forkService,
  listening,
  send,
  serviceReady,
  servicePrepared,
  stop,
  type Child,
  type Prepared,
} from './child.ts'
import { merge, watch, type Action, type WatchPlan } from './watch.ts'

// The process `pnpm dev` is (docs/runtime-redesign.md §45, §46).
//
// It owns exactly one thing: which child processes exist. The backend owns
// its own resources, the browser's dev server owns the module graph, and this
// owns neither - it starts them, tells each when it may take what it needs,
// and stops them.
//
// Everything that can change the world arrives as an event on one queue and
// is handled by one loop, in order. That is not tidiness: a file event, a
// child exiting and a Ctrl+C can all land in the same millisecond, and three
// callbacks each free to kill and spawn is how a supervisor ends up with two
// backends, or none, depending on the interleaving.
//
// A replacement is staged, never swapped. The candidate does everything that
// touches nothing - reading the manifest, importing descriptors, composing
// layers - while the process it would replace keeps serving; only once it
// says it is ready is the old one asked to stop, and only once that one has
// actually exited is the new one let in. So a candidate that cannot even be
// composed costs nothing: the world it would have replaced never noticed.

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

// One format for the whole terminal.
//
// Everything this supervisor starts renders through the product's logger, and
// a supervisor writing plain lines beside them is two formats for one
// session: the eye scans a level column and a source column, and a line that
// has neither reads as output from somewhere else entirely. It has no Effect
// runtime to install a logger into, so it renders directly - the same
// settings, the same colours, the same per-source minimum.
const logging = resolveLogging(readManifest(manifestPath()).logging, process.env, 'development')
const say = (line: string, level: 'Info' | 'Warn' | 'Error' = 'Info') =>
  logLine(logging, level, line, { source: 'dev' })

/**
 * One environment for every child of this session.
 *
 * Read here rather than inherited, because this process outlives many
 * children: started with `--env-file`, its own `process.env` would hold the
 * `.env` of whenever it happened to start, and every later child would get
 * that instead of what is on disk. The shell wins over the file, which is
 * what anyone typing a variable in front of a command expects.
 */
const childEnv = (manifest: string): NodeJS.ProcessEnv => {
  const file = path.join(repoRoot, '.env')
  const declared = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {}
  return {
    ...declared,
    ...process.env,
    NODE_ENV: 'development',
    QUALY_DEV_SUPERVISED: '1',
    // every child reads one manifest: a browser bundle built from a different
    // selection than the api answering it is a mismatch neither half notices
    QUALY_CONFIG: manifest,
  }
}

const port = Number(process.env.PORT ?? 3000)
const origin = `http://127.0.0.1:${String(port)}`

const portTaken = (at: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createConnection({ host: '127.0.0.1', port: at })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })

interface World {
  backend: Child | null
  topology: readonly DevServiceSpec[]
  roots: readonly PluginRoot[]
  services: Map<string, Child>
}

const active: World = { backend: null, topology: [], roots: [], services: new Map() }

/**
 * The replacement being got ready, and whether it is past the point of no
 * return.
 *
 * Before the commit a candidate holds nothing, so a newer save simply
 * replaces it. After it - the old world is being stopped - it is pinned:
 * dropping it then would leave the old world already gone and the newer
 * source unproven, which is how a supervisor ends up with nothing running.
 */
interface Candidate {
  backend: Child | null
  services: Map<string, Child>
  committed: boolean
}
let candidate: Candidate | null = null
let pending: Action | null = null
let stopping = false
let watcher: FSWatcher | null = null

const manifest = manifestPath()
const env = childEnv(manifest)

const plan = (): WatchPlan => ({
  bootstrap: [
    manifest,
    `${manifest.slice(0, -path.extname(manifest).length)}.lock.json`,
    path.join(repoRoot, 'qualy.lock.json'),
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'pnpm-lock.yaml'),
    path.join(repoRoot, 'pnpm-workspace.yaml'),
  ],
  roots: active.roots,
  services: active.topology,
  repoRoot,
})

// ---------------------------------------------------------------------------
// the queue: everything that can change the world goes through here

type Event =
  | { readonly kind: 'change'; readonly action: Action }
  | { readonly kind: 'exit'; readonly child: Child }
  | { readonly kind: 'stop' }

const queue: Event[] = []
let draining = false

const post = (event: Event) => {
  queue.push(event)
  void drain()
}

const drain = async () => {
  if (draining) return
  draining = true
  while (queue.length > 0) {
    const event = queue.shift()!
    try {
      await handle(event)
    } catch (error) {
      say(
        `supervisor error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        'Error',
      )
    }
  }
  draining = false
}

const watchExit = (child: Child) => {
  child.process.once('exit', () => post({ kind: 'exit', child }))
  return child
}

// ---------------------------------------------------------------------------
// staging

/** whether the assembly's development topology has moved under us (§19) */
const sameTopology = (next: readonly DevServiceSpec[]) => {
  const key = (specs: readonly DevServiceSpec[]) =>
    specs
      .map((spec) => `${spec.key}@${spec.moduleUrl}`)
      .sort((a, b) => a.localeCompare(b))
      .join('|')
  return key(next) === key(active.topology)
}

const adopt = (prepared: Prepared) => {
  active.topology = prepared.topology
  active.roots = prepared.roots
}

/**
 * Stop the active backend and wait for the whole child to be gone.
 *
 * The whole child, not just the port: a process that has released the port
 * may still be closing a pool, flushing telemetry or running a finalizer, and
 * the next backend must not start on top of that.
 */
const retireBackend = async () => {
  if (active.backend === null) return
  await stop(active.backend, 20_000)
  active.backend = null
}

/**
 * Stop everything, for a replacement of the whole session.
 *
 * Only for that. A backend on its own is replaced without touching the
 * development services beside it - taking them down too is exactly the
 * coupling this supervisor exists to undo, and it is invisible from the
 * backend's side: the api comes back, and the browser's session is gone.
 */
const retireSession = async () => {
  await Promise.all([...active.services.values()].map((child) => stop(child, 5_000)))
  active.services.clear()
  await retireBackend()
}

const startServices = async (
  specs: readonly DevServiceSpec[],
  into: Map<string, Child>,
  { tolerant }: { tolerant: boolean },
): Promise<boolean> => {
  const started = specs.map((spec) => ({ spec, child: watchExit(forkService(spec, origin, env)) }))
  let whole = true
  for (const { spec, child } of started) {
    try {
      await servicePrepared(child)
      into.set(spec.key, child)
    } catch {
      say(`${spec.key} could not prepare`, 'Warn')
      whole = false
      if (!tolerant) return false
    }
  }
  return whole || tolerant
}

const acceptServices = async (services: Map<string, Child>) => {
  for (const [key, child] of services) {
    send(child, { protocol: PROTOCOL, type: 'accept' })
    await serviceReady(child).catch(() => say(`${key} failed while starting`, 'Error'))
  }
}

/** a backend and, if asked, the services its own topology declares */
const stageWorld = async (kind: 'backend' | 'session'): Promise<void> => {
  const backend = watchExit(forkBackend(env))
  candidate = { backend, services: new Map(), committed: false }
  let prepared: Prepared
  try {
    prepared = await backendPrepared(backend)
  } catch (error) {
    say(
      active.backend === null
        ? `backend failed to start: ${error instanceof Error ? error.message : String(error)}`
        : `backend reload failed; keeping ${active.backend.name}`,
      'Warn',
    )
    candidate = null
    return
  }
  if (candidate === null) return // superseded while preparing

  // The file that changed said "backend only", but the candidate's own
  // resolution says which services this assembly wants. If those have moved,
  // the classification was wrong and this becomes a session after all.
  const wholeSession = kind === 'session' || !sameTopology(prepared.topology)
  if (wholeSession && kind === 'backend') say('the development topology moved; staging the session')

  if (wholeSession && active.backend !== null) {
    // with a world already running, the replacement is all-or-nothing: a half
    // staged session that then fails would have taken the working one away
    const ready = await startServices(prepared.topology, candidate.services, { tolerant: false })
    if (!ready) {
      say(`session reload failed; keeping ${active.backend.name}`, 'Warn')
      await discard()
      return
    }
  }

  candidate.committed = true
  if (wholeSession) await retireSession()
  else await retireBackend()

  send(backend, { protocol: PROTOCOL, type: 'accept' })
  active.backend = backend
  adopt(prepared)
  if (!(await listening(origin, backend, 60_000))) {
    say(`${backend.name} did not come up; no backend is running`, 'Error')
  }

  if (wholeSession) {
    if (candidate.services.size === 0) {
      // first boot, or a session whose services were never staged: start them
      // now and let a failing one stay failed rather than taking the api with
      // it - a working api beats nothing while a config is fixed
      await startServices(prepared.topology, candidate.services, { tolerant: true })
    }
    for (const [key, child] of candidate.services) active.services.set(key, child)
    await acceptServices(candidate.services)
  }
  candidate = null
  say(`${backend.name} is serving`)
}

/** one development service, replaced under a backend that never stops */
const stageService = async (key: string): Promise<void> => {
  const spec = active.topology.find((one) => one.key === key)
  if (spec === undefined) return
  const child = watchExit(forkService(spec, origin, env))
  candidate = { backend: null, services: new Map([[key, child]]), committed: false }
  try {
    await servicePrepared(child)
  } catch {
    const held = active.services.get(key)
    say(
      held === undefined ? `${key} failed to start` : `${key} reload failed; keeping ${held.name}`,
    )
    candidate = null
    return
  }
  if (candidate === null) return
  candidate.committed = true
  const previous = active.services.get(key)
  if (previous !== undefined) await stop(previous, 5_000)
  send(child, { protocol: PROTOCOL, type: 'accept' })
  active.services.set(key, child)
  await serviceReady(child).catch(() => say(`${key} failed while starting`, 'Error'))
  candidate = null
  say(`${child.name} is serving`)
}

/** throw away a candidate that has taken nothing */
const discard = async () => {
  if (candidate === null) return
  const going = candidate
  candidate = null
  await Promise.all(
    [going.backend, ...going.services.values()]
      .filter((child): child is Child => child !== null)
      .map((child) => stop(child, 5_000)),
  )
}

// ---------------------------------------------------------------------------
// the loop

const handle = async (event: Event): Promise<void> => {
  if (event.kind === 'stop') return teardown()
  if (stopping) return

  if (event.kind === 'exit') {
    const { child } = event
    if (active.backend?.process === child.process) {
      active.backend = null
      say(`${child.name} ended; save something to try again`, 'Warn')
    }
    for (const [key, held] of active.services) {
      if (held.process === child.process) {
        active.services.delete(key)
        say(`${child.name} ended`)
      }
    }
    return
  }

  pending = merge(pending, event.action)
  await reconcile()
}

const reconcile = async (): Promise<void> => {
  while (!stopping && pending !== null) {
    if (candidate !== null) {
      // A candidate past its commit point is pinned: the world it replaces is
      // already being taken down, and dropping it now would leave nothing
      // running while the newer source is still unproven. The change waits.
      if (candidate.committed) return
      say('newer changes; superseding the candidate')
      await discard()
    }
    const action = pending
    pending = null
    if (action === 'session') await stageWorld('session')
    else if (action === 'backend') await stageWorld('backend')
    else await stageService(action.service)
  }
}

const teardown = async () => {
  if (stopping) return
  stopping = true
  say('stopping')
  await watcher?.close()
  await discard()
  await retireSession()
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => post({ kind: 'stop' }))
}

// ---------------------------------------------------------------------------
// the first world

if (await portTaken(port)) {
  say(`port ${String(port)} is already in use; stop what is on it or set PORT`, 'Error')
  process.exit(1)
}

say(`assembly ${manifest}`)
await stageWorld('session')

watcher = watch(plan(), (action, files) => {
  if (action === 'restart-host') {
    say('the supervisor itself changed; restart pnpm dev to pick it up', 'Warn')
    return
  }
  const what = action === 'session' ? 'session' : action === 'backend' ? 'backend' : action.service
  say(
    `${path.relative(repoRoot, files[0] ?? '')}${files.length > 1 ? ` (+${String(files.length - 1)})` : ''} -> ${what}`,
  )
  post({ kind: 'change', action })
})
say('watching for changes')
