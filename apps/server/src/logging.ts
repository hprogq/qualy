import { inspect } from 'node:util'
import chalk from 'chalk'
import { Cause, Context, Layer, Logger, LogLevel, Option, References } from 'effect'
import { RequestContext } from '@qualy/api-kit/request'

// How this process speaks, resolved before it says anything.
//
// One file, two views: qualy.yml's `application.logging` is the committed
// DEFAULT - it is deliberately outside the assembly hash, so turning a level
// up is not a resolve and never reads as drift - and the QUALY_LOG_* /
// LOG_LEVEL environment variables override it per environment. Neither is a
// template language: the manifest stays deterministic, the environment wins.

export type AccessLogMode = 'off' | 'api' | 'all'

export interface LoggingSettings {
  readonly level: LogLevel.LogLevel
  readonly format: 'pretty' | 'json'
  readonly access: {
    readonly mode: AccessLogMode
    /** the level a successful request line is emitted at */
    readonly level: LogLevel.LogLevel
    readonly exclude: readonly string[]
  }
  /** per-source minimum levels, keyed by the `source` log annotation */
  readonly sources: Readonly<Record<string, LogLevel.LogLevel>>
}

// canonical spellings plus the aliases other ecosystems taught people
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

const level = (value: unknown, where: string): LogLevel.LogLevel => {
  if (typeof value !== 'string' || !(value.toLowerCase() in LEVELS)) {
    throw new Error(
      `${where} must be one of ${Object.keys(LEVELS).join(', ')}, got ${JSON.stringify(value)}`,
    )
  }
  return LEVELS[value.toLowerCase()]!
}

const record = (value: unknown, where: string): Record<string, unknown> => {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where} must be a mapping`)
  }
  return value as Record<string, unknown>
}

const only = (value: Record<string, unknown>, where: string, keys: readonly string[]) => {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${where}: unknown key ${key}`)
  }
}

/** manifest defaults <- environment overrides <- mode defaults, strictest reading */
export function resolveLogging(
  declared: unknown,
  environment: Record<string, string | undefined>,
  mode: 'development' | 'production',
): LoggingSettings {
  const where = 'qualy.yml application.logging'
  const block = record(declared, where)
  only(block, where, ['level', 'format', 'access', 'sources'])
  const access = record(block.access, `${where}.access`)
  only(access, `${where}.access`, ['mode', 'level', 'exclude'])

  const environmentLevel = environment.QUALY_LOG_LEVEL ?? environment.LOG_LEVEL
  const declaredFormat = environment.QUALY_LOG_FORMAT ?? block.format ?? 'auto'
  if (declaredFormat !== 'auto' && declaredFormat !== 'pretty' && declaredFormat !== 'json') {
    throw new Error(`${where}.format must be auto, pretty or json`)
  }

  const declaredMode = environment.QUALY_ACCESS_LOG ?? access.mode ?? 'api'
  if (declaredMode !== 'off' && declaredMode !== 'api' && declaredMode !== 'all') {
    throw new Error(`${where}.access.mode must be off, api or all`)
  }

  const exclude = access.exclude ?? ['/health/live', '/health/ready']
  if (!Array.isArray(exclude) || exclude.some((path) => typeof path !== 'string')) {
    throw new Error(`${where}.access.exclude must be a list of paths`)
  }

  const sources: Record<string, LogLevel.LogLevel> = {}
  for (const [source, declaredLevel] of Object.entries(record(block.sources, `${where}.sources`))) {
    sources[source] = level(declaredLevel, `${where}.sources['${source}']`)
  }

  return {
    level:
      environmentLevel !== undefined
        ? level(environmentLevel, 'QUALY_LOG_LEVEL')
        : block.level !== undefined
          ? level(block.level, `${where}.level`)
          : 'Info',
    format:
      declaredFormat === 'auto' ? (mode === 'production' ? 'json' : 'pretty') : declaredFormat,
    access: {
      mode: declaredMode,
      level:
        access.level !== undefined
          ? level(access.level, `${where}.access.level`)
          : mode === 'production'
            ? 'Info'
            : 'Debug',
      exclude: exclude as string[],
    },
    sources,
  }
}

// --- the logger itself ---

// chalk detects what the terminal can actually show - FORCE_COLOR, CI, dumb
// terminals - which a bare isTTY check gets wrong in both directions
type Paint = (value: string) => string
const plain: Paint = (value) => value

const LEVEL_PAINT: Record<LogLevel.LogLevel, Paint> = {
  All: plain,
  Trace: chalk.gray,
  Debug: chalk.gray,
  Info: chalk.blueBright,
  Warn: chalk.yellow,
  Error: chalk.redBright,
  Fatal: chalk.redBright,
  None: plain,
}

// Each source keeps one colour for the whole session, the way cordis scoped
// its logger names: the eye finds "the database lines" by hue before it
// reads a word. Assigned in order of first appearance rather than by hash,
// so distinct sources stay distinct until the palette runs out. Red is
// deliberately absent - that hue belongs to errors.
const SOURCE_PAINT: readonly Paint[] = [
  chalk.cyanBright,
  chalk.greenBright,
  chalk.magentaBright,
  chalk.yellowBright,
  chalk.blueBright,
  chalk.cyan,
  chalk.green,
  chalk.magenta,
]
const assignedPaint = new Map<string, Paint>()
const sourcePaint = (source: string): Paint => {
  const assigned = assignedPaint.get(source)
  if (assigned) return assigned
  const next = SOURCE_PAINT[assignedPaint.size % SOURCE_PAINT.length]!
  assignedPaint.set(source, next)
  return next
}

const text = (part: unknown): string =>
  typeof part === 'string' ? part : inspect(part, { depth: 4, colors: false })

/** `@qualy/plugin-org` reads as `org` on a terminal; json keeps the full id */
const shortSource = (source: string): string => source.replace(/^@qualy\/(plugin-)?/, '')

/**
 * One logger for everything the process says.
 *
 * Pretty lines lead with the source annotation instead of the fiber id -
 * `10:25:46 INFO [org] ...` - because "which plugin said this" is the question
 * a terminal reader is asking; the fiber id stays in the json format, where a
 * machine correlates. Per-source minimums come from the same settings, so a
 * noisy subsystem can be turned down without losing everything else.
 */
interface Line {
  readonly date: Date
  readonly level: LogLevel.LogLevel
  readonly source: string
  readonly message: string
  /** pretty format's annotation tail, already `key=value` joined */
  readonly extra?: string
  /** json format's structured annotations */
  readonly annotations?: Record<string, unknown>
  /**
   * The request and span this line spoke under, top-level in json so a log
   * index (CLS keys on `request_id`/`trace_id`/`span_id`) reaches them
   * without parsing nested objects. Read at emission from the speaking
   * fiber, so a line said inside a business child span carries THAT span's
   * id, not forever the HTTP root's. Absent outside a request or a trace -
   * never fabricated.
   */
  readonly correlation?: {
    readonly requestId?: string
    readonly traceId?: string
    readonly spanId?: string
  }
  readonly fiberId?: number
  readonly failure?: string
}

/** the one rendering, whichever way a line reaches the stream */
const render = (settings: LoggingSettings, line: Line): string => {
  if (settings.format === 'json') {
    return JSON.stringify({
      timestamp: line.date.toISOString(),
      level: line.level,
      source: line.source,
      ...(line.fiberId === undefined ? {} : { fiberId: line.fiberId }),
      ...(line.correlation?.requestId === undefined
        ? {}
        : { request_id: line.correlation.requestId }),
      ...(line.correlation?.traceId === undefined ? {} : { trace_id: line.correlation.traceId }),
      ...(line.correlation?.spanId === undefined ? {} : { span_id: line.correlation.spanId }),
      message: line.message,
      ...(line.failure === undefined ? {} : { cause: line.failure }),
      annotations: line.annotations ?? {},
    })
  }
  const level = LEVEL_PAINT[line.level]
  const dim = chalk.gray
  const time = `${String(line.date.getHours()).padStart(2, '0')}:${String(
    line.date.getMinutes(),
  ).padStart(2, '0')}:${String(line.date.getSeconds()).padStart(2, '0')}.${String(
    line.date.getMilliseconds(),
  ).padStart(3, '0')}`
  // fixed columns: the eye scans a level column and a source column, not a
  // ragged line; long sources keep their full name and simply overflow.
  // The colour keys on the DISPLAYED name: two sources that read the same
  // must colour the same, or the palette claims a difference no one can see
  const short = shortSource(line.source)
  return (
    `${dim(time)} ${level(line.level.toUpperCase().padEnd(5))} ` +
    `${sourcePaint(short)(short.padEnd(10))} ${line.message}` +
    `${line.extra ? ` ${dim(line.extra)}` : ''}` +
    (line.failure ? `\n${line.failure}` : '')
  )
}

export const qualyLogger = (settings: LoggingSettings): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    const annotations = options.fiber.getRef(References.CurrentLogAnnotations) as Record<
      string,
      unknown
    >
    const source = typeof annotations.source === 'string' ? annotations.source : 'app'
    const minimum = settings.sources[source]
    // Severity ascends Trace(0) -> Fatal(50000), with None above everything and
    // All below it, so a record is below the minimum when the MINIMUM is the
    // greater of the two - the direction upstream's own gate uses
    // (LogLevel.isEnabled, repos/effect/packages/effect/src/LogLevel.ts:384).
    if (minimum !== undefined && LogLevel.isGreaterThan(minimum, options.logLevel)) return

    const parts = Array.isArray(options.message) ? options.message : [options.message]
    const message = parts.map(text).join(' ')
    const failure = options.cause.reasons.length === 0 ? undefined : Cause.pretty(options.cause)
    const rest = Object.entries(annotations).filter(([key]) => key !== 'source')

    // what the speaking fiber was doing: the request it served, and the span
    // it was inside at this very line ('noop' is the disabled tracer's
    // sentinel, not an id)
    const requestId = Option.getOrUndefined(
      Option.map(Context.getOption(options.fiber.context, RequestContext), (c) => c.requestId),
    )
    const span = options.fiber.currentSpan
    const traced = span !== undefined && span.traceId !== 'noop'

    console.log(
      render(settings, {
        date: options.date,
        level: options.logLevel,
        source,
        message,
        extra: rest.map(([key, value]) => `${key}=${text(value)}`).join(' '),
        annotations: Object.fromEntries(rest),
        correlation: {
          ...(requestId === undefined ? {} : { requestId }),
          ...(traced ? { traceId: span.traceId, spanId: span.spanId } : {}),
        },
        fiberId: options.fiber.id,
        ...(failure === undefined ? {} : { failure }),
      }),
    )
  })

/**
 * A line from outside any fiber - a signal handler, the window before the
 * runtime exists - rendered by the same renderer and gated by the same
 * minimums as everything else. Two formats on one stream would make every
 * consumer parse both, which is how "just console.error it" reads a week
 * later.
 */
/**
 * One line, rendered the way the logger would, before or outside a runtime.
 *
 * The boot says things before the logger layer exists, and the development
 * supervisor has no Effect runtime at all - both would otherwise print in a
 * second format beside everything else in the same terminal. `source` is what
 * the line is attributed to, and it keys the same per-source minimum and the
 * same colour every other line does.
 */
export const logLine = (
  settings: LoggingSettings,
  level: LogLevel.LogLevel,
  message: string,
  options: { readonly failure?: string; readonly source?: string } = {},
): void => {
  const source = options.source ?? 'app'
  const minimum = settings.sources[source] ?? settings.level
  if (LogLevel.isGreaterThan(minimum, level)) return
  console.log(
    render(settings, {
      date: new Date(),
      level,
      source,
      message,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
    }),
  )
}

/** the logger and the global minimum, as one layer the root provides */
export const loggingLayer = (settings: LoggingSettings): Layer.Layer<never> =>
  Layer.mergeAll(
    Logger.layer([qualyLogger(settings)]),
    Layer.succeed(References.MinimumLogLevel, settings.level),
  )
