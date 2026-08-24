import { Cause, Context, Effect, Option, Tracer, type LogLevel } from 'effect'
import { HttpServerError, HttpServerRequest } from 'effect/unstable/http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { RequestContext } from '@qualy/api-kit/request'
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
      // the id the request context middleware minted, when it sits outside
      // this one; the same id an audit event or error report would carry
      const requestId = Option.getOrUndefined(
        Option.map(Context.getOption(fiber.context, RequestContext), (c) => c.requestId),
      )
      // the server span this request runs under: its ids let a log line be
      // looked up in the trace backend and beside the audit trail ('noop' is
      // the disabled tracer's sentinel, not an id)
      const span = Option.getOrUndefined(Context.getOption(fiber.context, Tracer.ParentSpan))
      const traceId = span === undefined || span.traceId === 'noop' ? undefined : span.traceId
      const spanId = span === undefined || span.spanId === 'noop' ? undefined : span.spanId
      // The content type rides the response BODY, not the headers record -
      // upstream merges it into the wire headers only at write time - so
      // that is where to look. An event stream's end is connection
      // lifecycle, not an access event: it "succeeds" when the browser lets
      // go politely and "fails" (carrying its 200) when the hangup lands
      // mid-write, and neither is worth more than Debug.
      const isEventStream = (value: unknown): boolean =>
        (
          (value as { body?: { contentType?: string } }).body?.contentType ??
          (value as { headers?: Record<string, string> }).headers?.['content-type'] ??
          ''
        ).startsWith('text/event-stream')
      return Effect.flatMap(Effect.exit(httpApp), (exit) => {
        const elapsed = Math.round(performance.now() - started)
        const line = (status: number | string, suffix = '') =>
          `${request.method} ${path} ${status} ${elapsed}ms${suffix}`
        const annotated = <X>(effect: Effect.Effect<X>) =>
          Effect.annotateLogs(effect, {
            source: 'http',
            ...(requestId === undefined ? {} : { requestId }),
            ...(traceId === undefined ? {} : { traceId }),
            ...(spanId === undefined ? {} : { spanId }),
          })
        if (exit._tag === 'Success') {
          const status = exit.value.status
          const streamed = isEventStream(exit.value)
          const log =
            status >= 500
              ? Effect.logError(line(status))
              : status === 429
                ? Effect.logWarning(line(status))
                : status >= 400
                  ? Effect.logInfo(line(status))
                  : streamed
                    ? Effect.logDebug(line(status, ' (event stream closed)'))
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
        const log =
          interrupted || (isEventStream(response) && response.status < 400)
            ? Effect.logDebug(line(interrupted ? 'client closed' : response.status))
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
