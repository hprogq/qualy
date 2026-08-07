import { Cause, Context, Effect, Option, type LogLevel } from 'effect'
import { HttpServerError, HttpServerRequest } from 'effect/unstable/http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import type { LoggingSettings } from './logging.ts'

// The access log, replacing the upstream one.
//
// Upstream logs every response at Info and prints the CAUSE of any failed
// exit - and an interrupted request (a browser cancelling navigation, a
// closed websocket) is a failed exit, so a normal dev session showed a wall
// of `InterruptError` lines that read like the process was on fire. Here a
// request line has a level that means something: server faults are errors,
// throttling is a warning, client errors are informational, success is
// whatever the settings say - Debug in development, where vite traffic would
// otherwise drown the terminal.

const strip = (url: string): string => {
  const at = url.search(/[?#]/)
  return at === -1 ? url : url.slice(0, at)
}

// the settings speak LogLevel, which admits None (say nothing) and All
// (say everything); logWithLevel speaks Severity, which admits neither
const successLog = (level: LogLevel.LogLevel, message: string): Effect.Effect<void> =>
  level === 'None' ? Effect.void : Effect.logWithLevel(level === 'All' ? 'Trace' : level)(message)

const insideApi = (path: string): boolean =>
  path === QUALY_API_PREFIX || path.startsWith(`${QUALY_API_PREFIX}/`)

export const accessLog =
  (settings: LoggingSettings['access']) =>
  <A extends { readonly status: number }, E, R>(
    httpApp: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R | HttpServerRequest.HttpServerRequest> =>
    Effect.withFiber((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest)
      const path = strip(request.url)
      if (
        settings.mode === 'off' ||
        (settings.mode === 'api' && !insideApi(path)) ||
        settings.exclude.includes(path)
      ) {
        return httpApp
      }
      const started = performance.now()
      return Effect.flatMap(Effect.exit(httpApp), (exit) => {
        const elapsed = Math.round(performance.now() - started)
        const line = (status: number | string, suffix = '') =>
          `${request.method} ${path} ${status} ${elapsed}ms${suffix}`
        const annotated = <X>(effect: Effect.Effect<X>) =>
          Effect.annotateLogs(effect, { source: 'http' })
        if (exit._tag === 'Success') {
          const status = exit.value.status
          const log =
            status >= 500
              ? Effect.logError(line(status))
              : status === 429
                ? Effect.logWarning(line(status))
                : status >= 400
                  ? Effect.logInfo(line(status))
                  : successLog(settings.level, line(status))
          return Effect.andThen(annotated(log), exit)
        }
        // A failed exit usually carries the response that was already sent -
        // upstream strips it out of the cause - and a client hanging up is a
        // 499 or a bare interruption, not a fault of this process.
        const [response, remainder] = HttpServerError.causeResponseStripped(exit.cause)
        // 499 IS the client-closed marker, whether or not the interrupt's
        // own reason still sits beside it in the cause
        const interrupted = Cause.hasInterruptsOnly(exit.cause) || response.status === 499
        const log = interrupted
          ? Effect.logDebug(line('client closed'))
          : response.status >= 500
            ? Effect.logError(
                line(
                  response.status,
                  Option.isSome(remainder) ? `\n${Cause.pretty(remainder.value)}` : '',
                ),
              )
            : Effect.logInfo(line(response.status))
        return Effect.andThen(annotated(log), exit)
      })
    })
