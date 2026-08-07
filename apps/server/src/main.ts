import { NodeRuntime } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer } from 'effect'
import { readManifest } from '@qualy/assembly'
import { loggingLayer, resolveLogging } from './logging.ts'
import { verifyAssembly } from './verify-assembly.ts'
import { manifestPath } from './manifest.ts'

// Everything this process does before it is an application, and everything it
// says while doing it, through one logger. This process generates nothing:
// frontend artifacts are the frontend toolchain's - the Vite plugin serves
// the chunk registry and regenerates the typed client - and a server that
// could rewrite sources at boot would be a server that repairs.
//
// The logger comes FIRST, from the manifest's runtime settings plus the
// environment, and wraps verification as well as the application: a lock
// drift warning printed by a different logger than everything else was two
// formats for one process.
const logging = resolveLogging(
  readManifest(manifestPath()).logging,
  process.env,
  process.env.NODE_ENV === 'production' ? 'production' : 'development',
)
const logs = loggingLayer(logging)

const prepare = Effect.gen(function* () {
  // Start validates and starts; it never repairs. The descriptors this
  // process imports are selected by the resolution, so an instance whose
  // manifest does not match the reviewed lock is running an assembly nobody
  // approved. Production refuses; development warns, because editing the
  // manifest and restarting is the whole loop.
  const warnings: string[] = []
  const resolution = yield* Effect.promise(() =>
    verifyAssembly(manifestPath(), (message) => warnings.push(message)),
  )
  for (const warning of warnings) yield* Effect.logWarning(warning)
  return resolution
})

const resolution = await Effect.runPromise(Effect.provide(prepare, logs))

const { makeApplication } = await import('./runtime.ts')
const application = await makeApplication(resolution, logging)

// The entry point.
//
// `runMain` installs the signal handlers, interrupts the root fiber and runs
// every finalizer, so graceful shutdown is not something this file implements.
// `Layer.launch` builds the application and then waits: the process stays up
// because the server is running, not because something is holding it open.
//
// The finalizer below is the only evidence a reader gets that shutdown
// actually completed. It logs because it ran, so a silent exit means the
// finalizers did not, which is exactly the failure worth seeing.
const launched = Layer.launch(application).pipe(
  Effect.onExit((exit) =>
    Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
      ? Effect.logInfo('shutdown complete')
      : Effect.void,
  ),
  Effect.provide(logs),
)

/**
 * A requested shutdown is a normal outcome, not a failure.
 *
 * The default teardown answers 130 for an interruption-only exit, which is the
 * POSIX convention and makes every `Ctrl+C` in development print a failed
 * command. Anything that is not purely an interruption still takes the default
 * path and keeps its non-zero code.
 */
NodeRuntime.runMain(launched, {
  teardown: (exit, onExit) => {
    if (Exit.isSuccess(exit)) return onExit(0)
    if (Cause.hasInterruptsOnly(exit.cause)) return onExit(0)
    onExit(1)
  },
})
