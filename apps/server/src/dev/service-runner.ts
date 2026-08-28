import { Deferred, Effect } from 'effect'
import type { DevServiceContext, DevServiceModule, DevServiceSpec } from '@qualy/plugin-kit/dev'
import { loggingLayer, resolveLogging } from '../logging.ts'
import { PROTOCOL, hostMessage, tell } from './protocol.ts'

// The process a development service runs in, whichever plugin declared it
// (docs/runtime-redesign.md §16).
//
// It knows nothing about what it is running. A plugin ships a module with two
// functions and this walks it through the same two bands the backend uses:
// find out whether it can run while whatever it would replace is still
// running, say so, wait to be told the old one has gone, and only then take
// anything.
//
// The scope is the shape that matters. `acquire` is called INSIDE a scope
// that stays open until the process is asked to stop, so an
// `Effect.acquireRelease` written in a plugin's runner lasts as long as the
// service rather than as long as the call - which is what a naive
// `Effect.scoped(start())` gets wrong, closing the scope the moment start
// returns and releasing everything it just took.

const fail = (reason: string): never => {
  process.stderr.write(`dev service runner: ${reason}\n`)
  process.exit(1)
}

if (typeof process.send !== 'function') fail('started without a channel to its supervisor')

const accepted = Deferred.makeUnsafe<void>()
const stopped = Deferred.makeUnsafe<void>()
/** whether anything has been acquired yet, which is what a stop has to unwind */
let launched = false
let told: { spec: DevServiceSpec; origin: string } | null = null
let onSpec: (() => void) | null = null

process.on('message', (raw: unknown) => {
  const message = hostMessage(raw)
  if (message === null) return
  if (message.type === 'spec') {
    told = { spec: message.spec, origin: message.origin }
    onSpec?.()
    return
  }
  if (message.type === 'accept') {
    launched = true
    Deferred.doneUnsafe(accepted, Effect.void)
  }
  // a refusal and a stop end the same way here: this process owns nothing
  // the supervisor has to wait for
  if (message.type === 'reject' || message.type === 'shutdown') {
    Deferred.doneUnsafe(stopped, Effect.void)
  }
})
// The channel closing is this process's lease, the same as for the backend,
// and it means the same two things: a runner that has taken something
// unwinds, and one still waiting to be let in has nothing to unwind.
process.on('disconnect', () => {
  Deferred.doneUnsafe(stopped, Effect.void)
  if (!launched) process.exit(0)
})

const spec = await new Promise<{ spec: DevServiceSpec; origin: string }>((resolve) => {
  if (told !== null) return resolve(told)
  onSpec = () => resolve(told!)
})

const loaded = (await import(spec.spec.moduleUrl)) as {
  default?: DevServiceModule<unknown, unknown>
} & Partial<DevServiceModule<unknown, unknown>>
const service = loaded.default ?? (loaded as DevServiceModule<unknown, unknown>)
if (typeof service.prepare !== 'function' || typeof service.acquire !== 'function') {
  fail(`${spec.spec.key} does not export prepare and acquire`)
}

const context: DevServiceContext = {
  plugin: {
    id: spec.spec.pluginId,
    config: spec.spec.config,
    manifestDir: spec.spec.manifestDir,
  },
  runtime: { origin: spec.origin },
}

// the same rendering every other child of this session uses, and named by
// which service is speaking: two log formats in one terminal is one too many
const logs = loggingLayer(resolveLogging(undefined, process.env, 'development'))

await Effect.runPromise(
  Effect.provide(
    Effect.annotateLogs(
      Effect.scoped(
        Effect.gen(function* () {
          const prepared = yield* service.prepare(context)
          yield* Effect.sync(() =>
            tell({ protocol: PROTOCOL, type: 'prepared', role: 'service', key: spec.spec.key }),
          )
          yield* Deferred.await(accepted)
          yield* service.acquire(prepared, context)
          yield* Effect.sync(() =>
            tell({ protocol: PROTOCOL, type: 'ready', role: 'service', key: spec.spec.key }),
          )
          // held here so the scope above stays open: everything acquire took is
          // released by the scope closing, which is this returning
          yield* Deferred.await(stopped)
        }),
      ),
      { source: `dev:${spec.spec.id}` },
    ),
    logs,
  ),
).catch((error: unknown) => {
  fail(`${spec.spec.key} failed: ${error instanceof Error ? error.message : String(error)}`)
})

// Everything acquired has been released by now, and the channel is a
// referenced handle: left open, this process would sit here having finished,
// while a supervisor waits for it to be gone.
if (process.connected) process.disconnect()
