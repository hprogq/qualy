import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  compareDecimal,
  fractionalDigits,
  isDecimalString,
  parseDecimal,
  type DecimalParts,
} from '../src/decimal.ts'
import { parameterSchemaAt } from '../src/diagnose.ts'
import {
  isDateString,
  normalizeAtomicSchema,
  normalizeInputSchema,
  type AtomicSchema,
  type InputSchema,
} from '../src/profile.ts'
import { compilePattern } from '../src/regex.ts'
import { validateValue, type ValueIssue } from '../src/validate.ts'

// the validator takes NORMALIZED schemas only: the brand is what lets its
// compile cache key by identity, so every fixture goes through the factory
const atomic = (schema: AtomicSchema) => normalizeAtomicSchema(schema)
const input = (schema: InputSchema) => normalizeInputSchema(schema)

const decimal = atomic({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 2,
  'x-qualy-minimum': '1.00',
  'x-qualy-maximum': '6.00',
})

const reasons = (schema: Parameters<typeof validateValue>[0], value: unknown) =>
  validateValue(schema, value).map((issue) => issue.reason)

describe('instance validation', () => {
  it('judges decimals by the frozen semantics', () => {
    expect(reasons(decimal, '3.5')).toEqual([])
    // trailing zeros are lexical noise: the semantic digits fit the scale
    expect(reasons(decimal, '3.1400')).toEqual([])
    expect(reasons(decimal, '3.145')).toEqual(['x-qualy-maxScale'])
    expect(reasons(decimal, '0.5')).toEqual(['x-qualy-minimum'])
    expect(reasons(decimal, '7')).toEqual(['x-qualy-maximum'])
    // lexical failure is the format's verdict alone — bounds abstain
    expect(reasons(decimal, '03')).toEqual(['format'])
    expect(reasons(decimal, 3.5)).toEqual(['type'])
  })

  it('never coerces, defaults or strips', () => {
    expect(reasons(atomic({ type: 'integer', minimum: 1, maximum: 10 }), '3')).toEqual(['type'])
    expect(reasons(atomic({ type: 'boolean' }), 'true')).toEqual(['type'])
    const shape = input({
      type: 'object',
      properties: { n: { type: 'integer', minimum: 0, maximum: 9 } },
      required: ['n'],
      additionalProperties: false,
    })
    expect(reasons(shape, {})).toEqual(['required'])
    const extra = { n: 3, stray: 1 }
    expect(reasons(shape, extra)).toEqual(['additionalProperties'])
    // removeAdditional stays off: the judged object is untouched
    expect(extra).toEqual({ n: 3, stray: 1 })
  })

  it('walks every property and reports paths', () => {
    const shape = input({
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['a', 'b'] },
        when: { type: 'string', format: 'date' },
      },
      required: ['level', 'when'],
      additionalProperties: false,
    })
    const issues = validateValue(shape, { level: 'c', when: '2026-02-29' })
    expect(issues).toContainEqual({ path: '/level', reason: 'enum' })
    expect(issues).toContainEqual({ path: '/when', reason: 'format' })
  })
})

describe('prototype names as parameters, judged fail-closed', () => {
  // A parameter may legally be called `constructor` or `toString` (only
  // `__proto__` is refused by the profile). The interpreter reads own
  // properties only, so a name that spells a prototype member is neither
  // present nor a value: a missing value NEVER passes. Pinned end to end,
  // so a change of reading goes red before any caller does.
  const contract = (name: string) =>
    normalizeInputSchema({
      type: 'object',
      properties: { [name]: { type: 'integer', minimum: 0, maximum: 9 } },
      required: [name],
      additionalProperties: false,
    })

  it('refuses an empty object however the required name spells', () => {
    for (const name of ['constructor', 'toString', 'valueOf']) {
      expect(validateValue(contract(name), {}), name).not.toEqual([])
    }
  })

  it('accepts an own value, on a plain and a null-prototype carrier alike', () => {
    for (const name of ['constructor', 'toString', 'valueOf']) {
      expect(validateValue(contract(name), { [name]: 3 }), name).toEqual([])
      const bare = Object.assign(Object.create(null), { [name]: 3 })
      expect(validateValue(contract(name), bare), name).toEqual([])
    }
  })

  it('answers an issue path with an own parameter schema or nothing', () => {
    // the diagnosis face reads the same record: a path derived from data
    // must never hand back Object.prototype's members as schemas
    const spoken = contract('constructor')
    expect(parameterSchemaAt(spoken, '/constructor')).toBe(spoken.properties['constructor'])
    expect(parameterSchemaAt(contract('level'), '/constructor')).toBeUndefined()
    expect(parameterSchemaAt(contract('level'), '/toString')).toBeUndefined()
  })
})

describe('the frozen pattern engine', () => {
  it('keeps each pattern its own', () => {
    const plates = atomic({ type: 'string', pattern: '^[A-Z][0-9]{6}$' })
    const beads = atomic({ type: 'string', pattern: '^b+$' })
    expect(validateValue(plates, 'A123456')).toEqual([])
    expect(validateValue(plates, 'bbb').map((issue) => issue.reason)).toEqual(['pattern'])
    expect(validateValue(beads, 'bbb')).toEqual([])
    expect(validateValue(beads, 'A123456').map((issue) => issue.reason)).toEqual(['pattern'])
  })

  it('finishes a would-be catastrophic input in linear time', () => {
    const tricky = atomic({ type: 'string', pattern: '(a|a)*b', maxLength: 10_000 })
    const bait = `${'a'.repeat(2_000)}c`
    const began = performance.now()
    const issues = validateValue(tricky, bait)
    expect(performance.now() - began).toBeLessThan(200)
    expect(issues.map((issue) => issue.reason)).toEqual(['pattern'])
  })
})

describe('against draft 2020-12, on the oracle', () => {
  // ajv, configured exactly as the validator was when it compiled schemas
  // through `Function`: the keywords, the formats, the frozen pattern
  // engine. It is not in the bundle any more - a browser policy that
  // forbids code from strings is why - but every verdict of the
  // interpreter is held equal to it here, keywords, paths and all.
  const oracle = (() => {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
      validateFormats: true,
      code: {
        regExp: Object.assign(
          (pattern: string, _u: string) => {
            const compiled = compilePattern(pattern)
            if (!compiled.ok) throw new Error(`pattern outside the regex profile: ${pattern}`)
            return {
              test: (value: string) => compiled.pattern.test(value),
              toString: () => `qualy-pattern:${pattern}`,
            }
          },
          { code: 'qualyPattern' },
        ),
      },
    })
    ajv.addFormat('date', { type: 'string', validate: isDateString })
    ajv.addFormat('qualy-decimal', { type: 'string', validate: isDecimalString })
    ajv.addKeyword({
      keyword: 'x-qualy-maxScale',
      type: 'string',
      schemaType: 'number',
      compile: (maxScale: number) => (value: string) => {
        const parts = parseDecimal(value)
        return parts === null || fractionalDigits(parts) <= maxScale
      },
    })
    const bound = (keyword: string, holds: (edge: DecimalParts, value: DecimalParts) => boolean) =>
      ajv.addKeyword({
        keyword,
        type: 'string',
        schemaType: 'string',
        compile: (edge: string) => (value: string) => {
          const parts = parseDecimal(value)
          return parts === null || holds(parseDecimal(edge)!, parts)
        },
      })
    bound('x-qualy-minimum', (edge, value) => compareDecimal(value, edge) >= 0)
    bound('x-qualy-maximum', (edge, value) => compareDecimal(value, edge) <= 0)
    ajv.addKeyword({ keyword: 'x-qualy-enumLabels', schemaType: 'object' })
    ajv.addKeyword({ keyword: 'x-qualy-i18n', schemaType: 'object' })
    ajv.addKeyword({ keyword: 'x-qualy-inputOrder', schemaType: 'array' })
    return (schema: object, value: unknown): ValueIssue[] => {
      const validator = ajv.compile(schema)
      if (validator(value)) return []
      return (validator.errors ?? []).map((error) => {
        const named =
          (error.params as { missingProperty?: string; additionalProperty?: string } | undefined) ??
          {}
        const property = named.missingProperty ?? named.additionalProperty
        return {
          path: property === undefined ? error.instancePath : `${error.instancePath}/${property}`,
          reason: error.keyword,
        }
      })
    }
  })()

  const sorted = (issues: readonly ValueIssue[]) =>
    [...issues].sort((a, b) => `${a.path}|${a.reason}`.localeCompare(`${b.path}|${b.reason}`))

  const atomics: AtomicSchema[] = [
    { type: 'string' },
    { type: 'string', minLength: 2, maxLength: 4 },
    { type: 'string', pattern: '^[a-z]+-[0-9]{2}$' },
    { type: 'string', minLength: 1, pattern: '^\\p{L}+$' },
    { type: 'integer', minimum: -2, maximum: 5 },
    { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
    {
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 1,
      'x-qualy-minimum': '0.5',
      'x-qualy-maximum': '9.5',
    },
    { type: 'string', enum: ['a', 'b', 'c'] },
    { type: 'boolean' },
    { type: 'string', format: 'date' },
  ]
  const values: unknown[] = [
    undefined,
    null,
    true,
    false,
    0,
    -3,
    2.5,
    5,
    6,
    '',
    'a',
    'ab',
    'abcd',
    'abcde',
    'ok-12',
    'OK-12',
    '中文',
    'é',
    '\u{1F600}\u{1F600}',
    '0.5',
    '0.50',
    '0.499',
    '3.14',
    '3.145',
    '9.5',
    '9.51',
    '10',
    '03',
    '-1',
    'c',
    'd',
    '2026-02-28',
    '2026-02-29',
    '2024-02-29',
    '2026-13-01',
    [],
    ['a'],
    {},
    { a: 1 },
  ]

  it('judges every atomic kind as the oracle does, keyword for keyword', () => {
    let compared = 0
    for (const raw of atomics) {
      const schema = atomic(raw)
      for (const value of values) {
        expect(sorted(validateValue(schema, value)), JSON.stringify({ raw, value })).toEqual(
          sorted(oracle(schema, value)),
        )
        compared += 1
      }
    }
    expect(compared).toBe(atomics.length * values.length)
  })

  it('judges input objects as the oracle does, paths included', () => {
    const shape = input({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 3 },
        n: { type: 'integer', minimum: 0, maximum: 9 },
        share: {
          type: 'string',
          format: 'qualy-decimal',
          'x-qualy-maxScale': 2,
          'x-qualy-maximum': '1',
        },
        kind: { type: 'string', enum: ['x', 'y'] },
        on: { type: 'boolean' },
        when: { type: 'string', format: 'date' },
      },
      required: ['name', 'n', 'share', 'kind', 'on', 'when'],
      additionalProperties: false,
    })
    const objects: unknown[] = [
      {},
      { name: 'ab', n: 3 },
      { name: '', n: 3 },
      { name: 'abcd', n: 10 },
      { name: 'ab' },
      { n: 3 },
      { name: 'ab', n: 3, stray: true, other: null },
      { name: 'ab', n: 3, share: '1.5', kind: 'z', on: 'yes', when: '2026-00-01' },
      { name: 'ab', n: 3, share: '0.25', kind: 'x', on: false, when: '2026-09-14' },
      { name: 3, n: 'three' },
      Object.assign(Object.create(null), { name: 'ab', n: 3 }),
      null,
      [],
      'ab',
    ]
    for (const value of objects) {
      expect(sorted(validateValue(shape, value)), JSON.stringify(value)).toEqual(
        sorted(oracle(shape, value)),
      )
    }
  })
})
