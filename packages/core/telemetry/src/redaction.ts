import { Cause, Exit, Logger, Tracer } from 'effect'

// What a failure may say once it leaves the process.
//
// The OTLP exporters write a failure out whole: a span's status message and
// its `exception` events, a log record's exception attributes, each with the
// error's message and a stack that includes every `cause` below it
// (`Cause.prettyErrors(..., { includeCauseInStack: true })` in
// repos/effect/packages/effect/src/observability/OtlpTracer.ts and
// OtlpLogger.ts). Some of those messages carry the values a request was made
// with: PostgreSQL's `invalid input syntax for type uuid: "..."` is the
// driver's own text, and it travels up through every span that ends with the
// same cause - the statement, its query, the service method, the handler, the
// request. Removing it at one layer leaves it at all the others, so it is
// removed here, where every one of them is exported.
//
// An error says what it may be exported as by carrying `exportMessage`. Such
// an error is exported with that message and its own stack frames, and
// nothing beneath it; an error above it keeps its own words and loses only
// the part of its chain that reaches the marked one. Nothing else is touched:
// the error objects themselves, what the process does with them, and what it
// prints to its own stdout stay as they were.

/** the message an error may be exported with, in place of its own and its causes' */
export const exportMessage: unique symbol = Symbol.for('@qualy/telemetry/exportMessage') as never

const markOf = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const mark = (value as { [exportMessage]?: unknown })[exportMessage]
  return typeof mark === 'string' ? mark : undefined
}

const causeOf = (value: unknown): unknown =>
  value instanceof Error ? (value as { cause?: unknown }).cause : undefined

/** whether anything along this error's chain asks to be exported otherwise */
const reachesMark = (value: unknown): boolean => {
  let current = value
  for (let depth = 0; depth < 16 && current !== undefined; depth += 1) {
    if (markOf(current) !== undefined) return true
    current = causeOf(current)
  }
  return false
}

/** the stack's frames, without the message lines above them */
const framesOf = (stack: string | undefined): string =>
  (stack ?? '')
    .split('\n')
    .filter((line) => line.startsWith('    at '))
    .join('\n')

const errorLike = (name: string, message: string, stack: string, cause?: unknown): Error => {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = name
  error.stack = stack
  return error
}

/**
 * The error as it may be exported: itself when nothing on its chain is
 * marked, a stand-in otherwise. Never mutates what it is given.
 */
export const redactError = (value: unknown, depth = 0): unknown => {
  if (depth >= 16 || !reachesMark(value)) return value
  const error = value as Error
  const mark = markOf(error)
  const name = typeof error.name === 'string' ? error.name : 'Error'
  if (mark !== undefined) {
    const frames = framesOf(error.stack)
    return errorLike(name, mark, frames === '' ? `${name}: ${mark}` : `${name}: ${mark}\n${frames}`)
  }
  return errorLike(name, error.message, error.stack ?? '', redactError(causeOf(error), depth + 1))
}

/** the cause as it may be exported; the same cause when nothing in it is marked */
export const redactCause = <E>(cause: Cause.Cause<E>): Cause.Cause<E> => {
  let changed = false
  const reasons = cause.reasons.map((reason): Cause.Reason<E> => {
    if (Cause.isFailReason(reason)) {
      const redacted = redactError(reason.error)
      if (redacted === reason.error) return reason
      changed = true
      return Cause.makeFailReason(redacted as E).annotate(Cause.reasonAnnotations(reason))
    }
    if (Cause.isDieReason(reason)) {
      const redacted = redactError(reason.defect)
      if (redacted === reason.defect) return reason
      changed = true
      return Cause.makeDieReason(redacted).annotate(Cause.reasonAnnotations(reason))
    }
    return reason
  })
  return changed ? Cause.fromReasons(reasons) : cause
}

/** a tracer whose spans end with their failures as they may be exported */
export const redactingTracer = (inner: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    ...(inner.context === undefined ? {} : { context: inner.context.bind(inner) }),
    span: (options) => {
      const span = inner.span(options)
      const end = span.end.bind(span)
      span.end = (endTime, exit) =>
        end(endTime, Exit.isFailure(exit) ? Exit.failCause(redactCause(exit.cause)) : exit)
      return span
    },
  })

/** a logger that hands its records on with their failures as they may be exported */
export const redactingLogger = <Message, Output>(
  inner: Logger.Logger<Message, Output>,
): Logger.Logger<Message, Output> =>
  Logger.make((options) =>
    inner.log({
      ...options,
      cause: redactCause(options.cause),
      message: (Array.isArray(options.message)
        ? options.message.map((part: unknown) => redactError(part))
        : redactError(options.message)) as Message,
    }),
  )
