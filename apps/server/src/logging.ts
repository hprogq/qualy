import { inspect } from 'node:util'
import chalk from 'chalk'
import { Cause, Layer, Logger, LogLevel, References } from 'effect'

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
export const qualyLogger = (settings: LoggingSettings): Logger.Logger<unknown, void> =>
  Logger.make((options) => {
    const annotations = options.fiber.getRef(References.CurrentLogAnnotations) as Record<
      string,
      unknown
    >
    const source = typeof annotations.source === 'string' ? annotations.source : 'app'
    const minimum = settings.sources[source]
    // level order runs Fatal -> Trace; a record BELOW the source's minimum is
    // one whose level is greater in that order
    if (minimum !== undefined && LogLevel.isGreaterThan(options.logLevel, minimum)) return

    const parts = Array.isArray(options.message) ? options.message : [options.message]
    const message = parts.map(text).join(' ')
    const failure = options.cause.reasons.length === 0 ? undefined : Cause.pretty(options.cause)

    if (settings.format === 'json') {
      console.log(
        JSON.stringify({
          timestamp: options.date.toISOString(),
          level: options.logLevel,
          source,
          fiberId: options.fiber.id,
          message,
          ...(failure === undefined ? {} : { cause: failure }),
          annotations: Object.fromEntries(
            Object.entries(annotations).filter(([key]) => key !== 'source'),
          ),
        }),
      )
      return
    }

    const level = LEVEL_PAINT[options.logLevel]
    const dim = chalk.gray
    const time = `${String(options.date.getHours()).padStart(2, '0')}:${String(
      options.date.getMinutes(),
    ).padStart(2, '0')}:${String(options.date.getSeconds()).padStart(2, '0')}.${String(
      options.date.getMilliseconds(),
    ).padStart(3, '0')}`
    const extra = Object.entries(annotations)
      .filter(([key]) => key !== 'source')
      .map(([key, value]) => `${key}=${text(value)}`)
      .join(' ')
    // fixed columns: the eye scans a level column and a source column, not a
    // ragged line; long sources keep their full name and simply overflow.
    // The colour keys on the DISPLAYED name: two sources that read the same
    // must colour the same, or the palette claims a difference no one can see
    const short = shortSource(source)
    console.log(
      `${dim(time)} ${level(options.logLevel.toUpperCase().padEnd(5))} ` +
        `${sourcePaint(short)(short.padEnd(10))} ${message}${extra ? ` ${dim(extra)}` : ''}` +
        (failure ? `\n${failure}` : ''),
    )
  })

/** the logger and the global minimum, as one layer the root provides */
export const loggingLayer = (settings: LoggingSettings): Layer.Layer<never> =>
  Layer.mergeAll(
    Logger.layer([qualyLogger(settings)]),
    Layer.succeed(References.MinimumLogLevel, settings.level),
  )
