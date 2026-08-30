import { describe, expect, it } from 'vitest'
import { parameterSchemaAt } from '../src/diagnose.ts'
import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  type AtomicSchema,
  type InputSchema,
} from '../src/profile.ts'
import { validateValue } from '../src/validate.ts'

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
  // `__proto__` is refused by the profile). Ajv's required check reads
  // through the prototype - `({}).constructor` is not undefined - but the
  // type check then meets a function and refuses it, so a missing value
  // NEVER passes. This suite pins that end-to-end behaviour: if an ajv
  // upgrade or option change ever lets a prototype member through as a
  // value, this goes red before any caller does.
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

describe('the frozen pattern engine inside ajv', () => {
  it('compiles each pattern once and never crosses instances', () => {
    // pinned because ajv keys its codegen scope by the engine result's
    // toString(): a shared key silently reuses the FIRST compiled pattern
    // for every later one (measured before the unique key existed)
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
