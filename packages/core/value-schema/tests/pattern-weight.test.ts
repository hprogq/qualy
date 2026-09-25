import { describe, expect, it } from 'vitest'
import {
  MAX_SCHEMA_PATTERN_WEIGHT,
  compilePattern,
  patternIssues,
  patternWeightIssues,
} from '../src/regex.ts'
import { PatternCache } from '../src/pattern-cache.ts'

// What a compiled pattern costs to keep is the rune ranges its program
// holds, not its instruction count: a repeated Unicode class copies the
// class's whole table once per repetition.

const weightOf = (source: string) => {
  const compiled = compilePattern(source)
  if (!compiled.ok) throw new Error(`not a profile pattern: ${source}`)
  return compiled.pattern.weight
}

/** a text parameter for every pattern, the shape a formula's input takes */
const inputOf = (patterns: readonly string[]) => ({
  type: 'object',
  properties: Object.fromEntries(
    patterns.map((pattern, index) => [`p${String(index)}`, { type: 'string', pattern }]),
  ),
  required: [],
  additionalProperties: false,
})

describe('what a pattern weighs', () => {
  it('counts the ranges a repeated class copies, not the instructions', () => {
    // inside the dialect and its instruction ceiling alike
    expect(patternIssues({ type: 'string', pattern: '^\\pL{900}x' })).toEqual([])
    expect(weightOf('^\\pL{900}x')).toBeGreaterThan(MAX_SCHEMA_PATTERN_WEIGHT)
    // everyday shapes stay orders of magnitude away from the line
    expect(weightOf('^[A-Z][0-9]{6}$')).toBeLessThan(100)
    expect(weightOf('^\\d{4}-\\d{2}-\\d{2}$')).toBeLessThan(100)
    expect(weightOf('^[\\p{L}\\s]{1,100}$')).toBeLessThan(MAX_SCHEMA_PATTERN_WEIGHT / 4)
  })

  it('refuses a contract whose patterns weigh too much together, at the one that crosses', () => {
    const heavy = Array.from({ length: 64 }, (_, index) => `^\\pL{100}${String(index)}`)
    const issues = patternWeightIssues(inputOf(heavy))
    expect(issues).toHaveLength(1)
    expect(issues[0]!.reason).toBe('pattern-too-complex')
    expect(issues[0]!.path).toMatch(/^properties\.p\d+\.pattern$/)
    // the dialect check, which frozen contracts are read against, says nothing
    expect(patternIssues(inputOf(heavy))).toEqual([])
    // a contract of everyday patterns is nowhere near it
    expect(
      patternWeightIssues(inputOf(['^[A-Z][0-9]{6}$', '^[\\p{L}\\s]{1,100}$', '^\\w+$'])),
    ).toEqual([])
  })
})

describe('the kept patterns', () => {
  it('stays within its weight however many distinct patterns arrive', () => {
    const one = weightOf('^\\pL{40}a')
    const cache = new PatternCache(one * 5)
    for (let index = 0; index < 60; index += 1) {
      const pattern = cache.get(`^\\pL{40}${String(index)}`)
      expect(pattern.test('x')).toBe(false)
      expect(cache.weight).toBeLessThanOrEqual(one * 6)
    }
    expect(cache.size).toBeLessThanOrEqual(6)
  })

  it('keeps what is used, compiles each pattern once while it is kept', () => {
    const cache = new PatternCache(weightOf('^[A-Z][0-9]{6}$') * 3)
    const plates = cache.get('^[A-Z][0-9]{6}$')
    expect(cache.get('^[A-Z][0-9]{6}$')).toBe(plates)
    cache.get('^a+$')
    // used again just now, so the oldest is the other one
    cache.get('^[A-Z][0-9]{6}$')
    cache.get('^b+$')
    cache.get('^c+$')
    expect(cache.get('^[A-Z][0-9]{6}$')).toBe(plates)
  })

  it('keeps the pattern it just compiled, whatever it weighs', () => {
    const cache = new PatternCache(1)
    const heavy = cache.get('^\\pL{40}x')
    expect(cache.size).toBe(1)
    expect(cache.get('^\\pL{40}x')).toBe(heavy)
  })

  it('refuses a pattern outside the regex profile', () => {
    expect(() => new PatternCache(1_000).get('(a)\\1')).toThrow(/regex profile/)
  })
})
