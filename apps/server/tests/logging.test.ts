import { describe, expect, it } from 'vitest'
import { resolveLogging } from '../src/logging.ts'

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
    expect(
      resolveLogging(undefined, { QUALY_ACCESS_LOG: 'off' }, 'development').access.mode,
    ).toBe('off')
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
