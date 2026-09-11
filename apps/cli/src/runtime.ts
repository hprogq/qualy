import { Cause, Effect, Exit, Layer, References, Scope, type LogLevel } from 'effect'
import type { Resolution } from '@qualy/assembly'
import { loadAssembly } from '@qualy/assembly/runtime'
import { headlessGraph, headlessHost } from '@qualy/api-kit/headless'
import { CliRefused, type RuntimeCliCommand } from '@qualy/plugin-kit/cli'
import { stillFinalizing, traceLayerLifecycle } from '@qualy/plugin-kit/shutdown-trace'

// The CLI's runtime edge.
//
// A runtime-tier command hands the host one effect; this is the one place
// that runs it. The assembly is built the way the server builds it and
// unlike the server binds no port, runs no boot hook and applies no
// migration - the graph pins migrations off, and an environment that asked
// for them is refused here, before a descriptor's command is even loaded.
// The command's failure decides the exit code: its own refusal carries one,
// anything else is a defect and says so.

const MIGRATIONS_REFUSED =
  'QUALY_MIGRATIONS=apply is set; a runtime command never applies migrations - they are applied by `pnpm qualy deploy`. Unset it, or set QUALY_MIGRATIONS=off, and run again.'

// canonical spellings plus the aliases other ecosystems taught people; a
// command is a tool, so it speaks up at Warn unless asked for more
const LEVELS: Record<string, LogLevel.LogLevel> = {
  trace: 'Trace',
  debug: 'Debug',
  verbose: 'Debug',
  info: 'Info',
  notice: 'Info',
  warn: 'Warn',
  warning: 'Warn',
  error: 'Error',
  off: 'None',
  silent: 'None',
  none: 'None',
}

const levelFromEnv = (): LogLevel.LogLevel =>
  LEVELS[(process.env.QUALY_LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'warn').toLowerCase()] ?? 'Warn'

/** a boot refusal is a crafted sentence in a plain Error; anything else keeps its evidence */
const isCrafted = (error: unknown): error is Error =>
  error instanceof Error && ('_tag' in error || error.name === 'Error')

const codeOf = (exit: Exit.Exit<unknown, unknown>): number => {
  if (Exit.isSuccess(exit)) return 0
  if (Cause.hasInterruptsOnly(exit.cause)) return 130
  for (const reason of exit.cause.reasons) {
    if (reason._tag !== 'Fail') continue
    if (reason.error instanceof CliRefused) {
      console.error(reason.error.message)
      return reason.error.exitCode
    }
    if (isCrafted(reason.error)) {
      console.error(reason.error.message)
      return 1
    }
  }
  console.error(Cause.pretty(exit.cause))
  return 1
}

export async function runRuntimeCommand(
  resolution: Resolution,
  command: RuntimeCliCommand,
  args: readonly string[],
): Promise<number> {
  if (process.env.QUALY_MIGRATIONS === 'apply') {
    console.error(MIGRATIONS_REFUSED)
    return 1
  }
  const loaded = loadAssembly(resolution, { host: [headlessHost] })
  // the one narrowing of this edge: the assembled layers carry erased
  // channels, and whether the graph closes is the build's answer
  const graph = headlessGraph(loaded, { env: process.env }) as Layer.Layer<unknown, unknown>
  const implementation = await command.load()
  const deadline = Number(process.env.QUALY_SHUTDOWN_TIMEOUT ?? 30) * 1000
  traceLayerLifecycle({ finalizing: () => {}, finalized: () => {} })
  let code = 1
  const built = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(graph, scope)
      const outcome = yield* Effect.exit(
        Effect.provideContext(implementation.run({ args }), context),
      )
      code = codeOf(outcome)
      // the program is done; a finalizer that never returns must not be the
      // reason this process stays alive, and the stuck layer gets named
      if (deadline > 0) {
        setTimeout(() => {
          const stuck = stillFinalizing()
          console.error(
            `shutdown did not finish within ${deadline}ms, exiting; still releasing: ${stuck.length === 0 ? '(none reported)' : stuck.join(', ')}`,
          )
          process.exit(code === 0 ? 1 : code)
        }, deadline).unref()
      }
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.provide(Layer.succeed(References.MinimumLogLevel, levelFromEnv()))),
  )
  traceLayerLifecycle(undefined)
  // the graph itself refusing to build - a database behind its lineage, an
  // unreachable one - is said in its own words, and is not the command's verdict
  return Exit.isSuccess(built) ? code : codeOf(built)
}
