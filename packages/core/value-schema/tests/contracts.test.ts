import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalizeAtomicSchema, canonicalizeInputSchema } from '../src/canonical.ts'
import { integerToDecimal } from '../src/convert.ts'
import {
  isDateString,
  normalizeAtomicSchema,
  normalizeInputSchema,
  validateAtomicProfile,
  validateInputProfile,
  type DecimalSchema,
  type InputSchema,
} from '../src/profile.ts'
import { semanticHashOfAtomic, semanticHashOfInput } from '../src/hash.ts'

describe('the profile', () => {
  it('admits each of the six kinds', () => {
    for (const schema of [
      { type: 'string', minLength: 1, maxLength: 100 },
      { type: 'integer', minimum: 1, maximum: 100 },
      {
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': 4,
        'x-qualy-minimum': '0.00',
        'x-qualy-maximum': '6.00',
      },
      {
        type: 'string',
        enum: ['national', 'provincial'],
        'x-qualy-enumLabels': { national: '国家级' },
      },
      { type: 'boolean' },
      { type: 'string', format: 'date' },
    ]) {
      expect(validateAtomicProfile(schema)).toEqual([])
    }
  })

  it('refuses what the subset deliberately leaves out', () => {
    const reasons = (schema: unknown) => validateAtomicProfile(schema).map((issue) => issue.reason)
    expect(reasons({ type: 'number' })).toContain('unknown-kind')
    expect(reasons({ type: 'array' })).toContain('unknown-kind')
    expect(reasons({ type: 'integer', minimum: 1 })).toContain('integer-bound-missing')
    expect(reasons({ type: 'integer', minimum: 1, maximum: 2 ** 53 })).toContain(
      'integer-bound-unsafe',
    )
    expect(reasons({ type: 'integer', minimum: 5, maximum: 1 })).toContain('bounds-inverted')
    expect(reasons({ type: 'integer', minimum: 1, maximum: 9, exclusiveMinimum: 0 })).toContain(
      'unknown-key',
    )
    expect(reasons({ type: 'string', enum: [] })).toContain('choice-empty')
    expect(reasons({ type: 'string', enum: ['a', 'a'] })).toContain('choice-duplicate')
    expect(reasons({ type: 'string', enum: ['a'], 'x-qualy-enumLabels': { b: 'B' } })).toContain(
      'label-orphan',
    )
    expect(reasons({ type: 'string', pattern: '(' })).toContain('pattern-invalid')
    expect(reasons({ type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': -1 })).toContain(
      'max-scale-invalid',
    )
    expect(
      reasons({
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': 2,
        'x-qualy-minimum': '0.005',
      }),
    ).toContain('decimal-bound-exceeds-scale')
    expect(
      reasons({
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': 2,
        'x-qualy-minimum': '5',
        'x-qualy-maximum': '1',
      }),
    ).toContain('bounds-inverted')
  })

  it('requires a flat input whose required set names every property', () => {
    const legal: InputSchema = {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['a'] },
        base: {
          type: 'string',
          format: 'qualy-decimal',
          'x-qualy-maxScale': 4,
        } as DecimalSchema,
      },
      required: ['level', 'base'],
      additionalProperties: false,
    }
    expect(validateInputProfile(legal)).toEqual([])
    expect(validateInputProfile({ ...legal, required: ['level'] }).map((i) => i.reason)).toContain(
      'required-mismatch',
    )
    expect(
      validateInputProfile({ ...legal, additionalProperties: true }).map((i) => i.reason),
    ).toContain('additional-properties-not-false')
    expect(
      validateInputProfile({
        ...legal,
        properties: { ...legal.properties, nested: { type: 'object' } },
      }).map((i) => i.reason),
    ).toContain('unknown-kind')
    expect(
      validateInputProfile({
        ...legal,
        properties: { 'not a name': { type: 'boolean' } },
        required: ['not a name'],
      }).map((i) => i.reason),
    ).toContain('parameter-name-invalid')
    // the empty input is a legal contract (a fixed-amount formula takes nothing)
    expect(
      validateInputProfile({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      }),
    ).toEqual([])
  })

  it('normalizes to a deep-frozen canonical-bounded form', () => {
    const normalized = normalizeAtomicSchema({
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
      'x-qualy-minimum': '3.00',
    } as DecimalSchema)
    expect((normalized as DecimalSchema)['x-qualy-minimum']).toBe('3')
    expect(Object.isFrozen(normalized)).toBe(true)
    const input = normalizeInputSchema({
      type: 'object',
      properties: { b: { type: 'boolean' }, a: { type: 'integer', minimum: 0, maximum: 9 } },
      required: ['a', 'b'],
      additionalProperties: false,
    })
    expect(Object.keys(input.properties)).toEqual(['a', 'b'])
    expect(Object.isFrozen(input.properties)).toBe(true)
    expect(Object.isFrozen(input.properties['a'])).toBe(true)
    expect(() => normalizeAtomicSchema({ type: 'integer' } as never)).toThrow(TypeError)
  })

  it('keeps the real calendar for dates', () => {
    expect(isDateString('2024-02-29')).toBe(true)
    expect(isDateString('2026-02-29')).toBe(false)
    expect(isDateString('2026-13-01')).toBe(false)
    expect(isDateString('2026-00-10')).toBe(false)
    expect(isDateString('2026-8-9')).toBe(false)
  })
})

describe('canonical bytes and the semantic hash', () => {
  const labeled = {
    type: 'string',
    enum: ['national', 'provincial'],
    'x-qualy-enumLabels': { national: '国家级', provincial: '省部级' },
  } as const

  it('is unmoved by annotations', () => {
    const relabeled = { ...labeled, 'x-qualy-enumLabels': { national: 'National' } }
    expect(canonicalizeAtomicSchema(relabeled)).toBe(
      canonicalizeAtomicSchema({ type: 'string', enum: ['national', 'provincial'] }),
    )
    expect(semanticHashOfAtomic(relabeled)).toBe(semanticHashOfAtomic(labeled))
  })

  it('is unmoved by key order and by bound spelling', () => {
    const spelledOut = {
      'x-qualy-maximum': '6.00',
      'x-qualy-minimum': '0.00',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
      type: 'string',
    } as unknown as DecimalSchema
    const shortest = {
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
      'x-qualy-minimum': '0',
      'x-qualy-maximum': '6',
    } as DecimalSchema
    expect(semanticHashOfAtomic(spelledOut)).toBe(semanticHashOfAtomic(shortest))
  })

  it('moves when the admitted values move', () => {
    expect(semanticHashOfAtomic({ type: 'string', enum: ['a'] })).not.toBe(
      semanticHashOfAtomic({ type: 'string', enum: ['a', 'b'] }),
    )
  })

  it('orders input parameters before hashing', () => {
    const one: InputSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' } },
      required: ['a', 'b'],
      additionalProperties: false,
    }
    const other: InputSchema = {
      type: 'object',
      properties: { b: { type: 'boolean' }, a: { type: 'boolean' } },
      required: ['b', 'a'],
      additionalProperties: false,
    }
    expect(canonicalizeInputSchema(one)).toBe(canonicalizeInputSchema(other))
    expect(semanticHashOfInput(one)).toBe(semanticHashOfInput(other))
  })
})

describe('the named converter', () => {
  it('renders a safe integer as a canonical decimal string', () => {
    expect(integerToDecimal(3)).toBe('3')
    expect(integerToDecimal(-12)).toBe('-12')
    expect(integerToDecimal(0)).toBe('0')
    expect(integerToDecimal(2 ** 53)).toBeNull()
    expect(integerToDecimal(3.5)).toBeNull()
  })
})

describe('the browser-safe root', () => {
  it('never imports a Node builtin, the validator or the hash', () => {
    const src = path.resolve(import.meta.dirname, '../src')
    const closure = new Set<string>()
    const walk = (file: string): void => {
      if (closure.has(file)) return
      closure.add(file)
      const text = fs.readFileSync(path.join(src, file), 'utf8')
      for (const match of text.matchAll(/from '([^']+)'/g)) {
        const specifier = match[1]!
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\//)
        walk(specifier.slice(2))
      }
    }
    walk('index.ts')
    expect(closure).not.toContain('validate.ts')
    expect(closure).not.toContain('hash.ts')
  })
})
