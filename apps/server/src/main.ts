import { inspect } from 'node:util'
import { NodeRuntime } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer } from 'effect'
import { readManifest } from '@qualy/assembly'
import { telemetryLayer } from '@qualy/telemetry'
import { logLine, loggingLayer, resolveLogging } from './logging.ts'
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
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
const logging = (() => {
  try {
    return resolveLogging(readManifest(manifestPath()).logging, process.env, mode)
  } catch (error) {
    // the manifest would not even read; the default rendering still beats
    // an unhandled-rejection dump
    logLine(
      resolveLogging(undefined, {}, mode),
      'Error',
      `startup failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
})()
const logs = loggingLayer(logging)

/**
 * A boot refusal, said once in the log's own voice, then exit.
 *
 * Everything the pre-launch band throws - an unreadable manifest, a lock
 * drift, an assembly that will not load - is a crafted sentence in a plain
 * Error; those get their message. Anything else is a genuine defect and
 * keeps its evidence.
 */
const refuse = (error: unknown): never => {
  const crafted = error instanceof Error && ('_tag' in error || error.name === 'Error')
  logLine(
    logging,
    'Error',
    `startup failed: ${error instanceof Error ? error.message : String(error)}`,
    crafted ? undefined : inspect(error),
  )
  process.exit(1)
}

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

const resolution = await Effect.runPromise(Effect.provide(prepare, logs)).catch(refuse)

const { makeApplication } = await import('./runtime.ts').catch(refuse)
const application = await makeApplication(resolution, logging).catch(refuse)

/**
 * One report per failed boot, through the application logger.
 *
 * Upstream's error reporting is disabled below: it renders the cause with the
 * default logger - outside `logs` - so a refused database connection used to
 * come out as two inspected stack dumps in a foreign format. Deliberate
 * startup failures across the assembly are tagged Errors carrying an
 * actionable message (a database that refused, web assets missing); those get
 * their message and nothing else. Anything untagged is a genuine defect, and
 * only that keeps the full cause.
 */
const reportStartupFailure = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const seen = new Set<unknown>()
    let dumped = false
    for (const reason of cause.reasons) {
      if (reason._tag === 'Interrupt') continue
      const error = reason._tag === 'Fail' ? reason.error : reason.defect
      if (seen.has(error)) continue
      seen.add(error)
      if (error instanceof Error && '_tag' in error) {
        yield* Effect.logError(`startup failed: ${error.message}`)
      } else if (!dumped) {
        dumped = true
        yield* Effect.logError(`startup failed\n${Cause.pretty(cause)}`)
      }
    }
  })

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
      : reportStartupFailure(exit.cause),
  ),
  // Telemetry wraps the application and sits inside the logger: every span
  // the platform or a plugin creates inherits the exporting tracer from
  // here, the application's scope closes before telemetry's - the drain is
  // traced, then flushed - and whatever telemetry has to say comes out in
  // the process's one log format. Without an OTLP endpoint in the
  // environment this layer is a no-op.
  Effect.provide(telemetryLayer.pipe(Layer.provideMerge(logs))),
)

/**
 * The escalation path out of a shutdown that will not finish.
 *
 * `runMain` interrupts the root fiber on a signal and then waits for every
 * finalizer, and several of them are unbounded waits on the outside world - a
 * pg pool closing against a dead network, an http server draining a connection
 * that never goes idle. A second signal reaches upstream's handler as another
 * interrupt of an already-interrupting fiber, which is a no-op, so without
 * this the operator's only remaining move is SIGKILL by hand.
 *
 * These listeners run BESIDE upstream's: the graceful path is untouched and
 * still the one that normally wins. The first signal starts a deadline longer
 * than the http drain (20s upstream) so a healthy shutdown is never truncated;
 * the second gives up immediately. Both exit 128+signo, the shell's way of
 * saying a signal ended this, which is honest for a shutdown that did not
 * complete - unlike the graceful exit 0 the teardown below reports.
 */
const forceExitAfter = Number(process.env.QUALY_SHUTDOWN_TIMEOUT ?? 30) * 1000
let stoppingSince: number | null = null
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.on(signal, () => {
    if (stoppingSince !== null) {
      // One keystroke fans out through the process tree: the tty delivers
      // to the whole foreground group and pnpm forwards its own copy to the
      // child within milliseconds, so a single Ctrl+C arrives here twice.
      // Only a distinct later press is an operator insisting.
      if (Date.now() - stoppingSince < 1000) return
      logLine(logging, 'Warn', `${signal} again: giving up on the graceful shutdown`)
      process.exit(code)
    }
    stoppingSince = Date.now()
    // say so at once: the drain that follows can take a few seconds, and a
    // silent one is indistinguishable from a press that did not land
    logLine(
      logging,
      'Info',
      signal === 'SIGINT'
        ? 'shutting down; press Ctrl+C again to give up waiting'
        : `${signal}: shutting down`,
    )
    if (forceExitAfter > 0) {
      // unref: this timer must never be the reason the process stays alive
      setTimeout(() => {
        logLine(logging, 'Error', `shutdown did not finish within ${forceExitAfter}ms, exiting`)
        process.exit(code)
      }, forceExitAfter).unref()
    }
  })
}

/**
 * A requested shutdown is a normal outcome, not a failure.
 *
 * The default teardown answers 130 for an interruption-only exit, which is the
 * POSIX convention and makes every `Ctrl+C` in development print a failed
 * command. Anything that is not purely an interruption still takes the default
 * path and keeps its non-zero code.
 */
NodeRuntime.runMain(launched, {
  // the report above is the one and only rendering of a failed boot
  disableErrorReporting: true,
  teardown: (exit, onExit) => {
    if (Exit.isSuccess(exit)) return onExit(0)
    if (Cause.hasInterruptsOnly(exit.cause)) return onExit(0)
    onExit(1)
  },
})
