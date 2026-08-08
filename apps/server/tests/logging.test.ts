import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { loggingLayer, resolveLogging } from '../src/logging.ts'

// The merge order is the contract: manifest defaults, environment overrides,
// mode defaults underneath - and misspellings are refused by name, because a
// level that silently fell back to Info would look applied while it is not.

describe('logging settings', () => {
  it('defaults by mode and lets the manifest raise them', () => {
    const dev = resolveLogging(undefined, {}, 'development')
    expect(dev).toMatchObject({ level: 'Info', format: 'pretty' })
    expect(dev.access).toMatchObject({ mode: 'api', level: 'Debug' })
    expect(dev.access.exclude).toEqual(['/health/live', '/health/ready'])

    const production = resolveLogging(undefined, {}, 'production')
    expect(production).toMatchObject({ level: 'Info', format: 'json' })
    expect(production.access.level).toBe('Info')

    const declared = resolveLogging(
      { level: 'warn', access: { mode: 'all' }, sources: { 'web:vite': 'error' } },
      {},
      'development',
    )
    expect(declared.level).toBe('Warn')
    expect(declared.access.mode).toBe('all')
    expect(declared.sources).toEqual({ 'web:vite': 'Error' })
  })

  it('lets the environment override the manifest, aliases included', () => {
    const settings = resolveLogging({ level: 'warn' }, { QUALY_LOG_LEVEL: 'verbose' }, 'production')
    expect(settings.level).toBe('Debug')
    // the unprefixed spelling works, the prefixed one wins
    expect(
      resolveLogging(undefined, { LOG_LEVEL: 'silent', QUALY_LOG_LEVEL: 'notice' }, 'development')
        .level,
    ).toBe('Info')
    expect(resolveLogging(undefined, { QUALY_ACCESS_LOG: 'off' }, 'development').access.mode).toBe(
      'off',
    )
  })

  // A per-source minimum is a FLOOR. The first implementation compared the two
  // levels the other way round, which kept the chatter and dropped exactly the
  // records an operator turns a source down to keep - errors - with no second
  // logger to catch them, because Logger.layer replaces the default set.
  it('applies a per-source minimum as a floor, sentinels included', () => {
    const written: string[] = []
    const settings = resolveLogging(
      { sources: { '@qualy/plugin-database': 'warn', quiet: 'off', loud: 'trace' } },
      {},
      'development',
    )
    const capture = { log: console.log }
    console.log = (line: string) => written.push(line)
    try {
      Effect.runSync(
        Effect.provide(
          Effect.gen(function* () {
            const say = (source: string) =>
              Effect.annotateLogs(
                Effect.all([
                  Effect.logDebug(`${source}-debug`),
                  Effect.logError(`${source}-error`),
                ]),
                { source },
              )
            yield* say('@qualy/plugin-database')
            yield* say('quiet')
            yield* say('loud')
            yield* say('unlisted')
          }),
          loggingLayer({ ...settings, level: 'Trace' }),
        ),
      )
    } finally {
      console.log = capture.log
    }
    const said = written.join('\n')
    // 'warn' keeps what is at or above it and drops what is below
    expect(said).toContain('@qualy/plugin-database-error')
    expect(said).not.toContain('@qualy/plugin-database-debug')
    // 'off' silences a source completely; 'trace' and an unlisted source keep everything
    expect(said).not.toContain('quiet-')
    expect(said).toContain('loud-debug')
    expect(said).toContain('loud-error')
    expect(said).toContain('unlisted-debug')
  })

  it('refuses what it cannot mean', () => {
    expect(() => resolveLogging({ level: 'loud' }, {}, 'development')).toThrow(
      /application\.logging\.level must be one of/,
    )
    expect(() => resolveLogging({ verbosity: 'info' }, {}, 'development')).toThrow(
      /unknown key verbosity/,
    )
    expect(() => resolveLogging(undefined, { QUALY_ACCESS_LOG: 'some' }, 'development')).toThrow(
      /access\.mode must be off, api or all/,
    )
  })
})
